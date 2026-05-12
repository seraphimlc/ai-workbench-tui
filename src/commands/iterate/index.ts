import {
  InvalidTaskTransitionError,
  isValidTaskTransition,
  type StateManager,
} from "../../state/index.js";
import type { TaskStatus, TodoTask, WorkflowTodo } from "../../shared/types.js";
import type {
  ReviewFinding,
  ReviewFindingSeverity,
  ReviewOutcome,
  ReviewVerdict,
} from "../../review/index.js";

export type IterationTodoChange =
  | {
      kind: "update_task";
      taskId: string;
      before: TodoTask;
      after: TodoTask;
      reason: string;
    }
  | {
      kind: "upsert_task";
      task: TodoTask;
      previous?: TodoTask;
      reason: string;
    };

export interface IterationProposal {
  taskId: string;
  verdict: ReviewVerdict;
  summary: string;
  changes: IterationTodoChange[];
}

export type IterationProposalDecision =
  | { kind: "accept" }
  | { kind: "edit"; proposal: IterationProposal }
  | { kind: "reject" };

export interface IterationApplyResult {
  todo: WorkflowTodo;
  applied: boolean;
  summary: string[];
}

export interface IterateCommandInput {
  state: StateManager;
  taskId: string;
  reviewArtifactName?: string;
  decision?: IterationProposalDecision;
}

export interface IterateCommandResult {
  proposal: IterationProposal;
  decision: IterationProposalDecision;
  todo: WorkflowTodo;
  applied: boolean;
  markdownSummary: string;
}

const ACTIONABLE_SEVERITIES = new Set<ReviewFindingSeverity>([
  "blocking",
  "high",
  "medium",
]);

export async function runIterateCommand(
  input: IterateCommandInput,
): Promise<IterateCommandResult> {
  const todo = await input.state.loadTodo();
  const reviewMarkdown = await input.state.loadRunArtifact(
    input.taskId,
    input.reviewArtifactName ?? "review.md",
  );
  const review = parseReviewOutcomeMarkdown(reviewMarkdown, input.taskId);
  const proposal = proposeTodoChangesFromReview(todo, review);
  const decision = input.decision ?? { kind: "reject" };
  const applied = applyIterationProposalDecision(todo, proposal, decision);

  if (applied.applied) {
    await input.state.saveTodo(applied.todo);
  }

  return {
    proposal,
    decision,
    todo: applied.todo,
    applied: applied.applied,
    markdownSummary: formatIterationProposalMarkdown(proposal),
  };
}

export function proposeTodoChangesFromReview(
  todo: WorkflowTodo,
  review: ReviewOutcome,
): IterationProposal {
  const reviewedTask = todo.tasks.find((task) => task.id === review.taskId);
  if (!reviewedTask) {
    throw new Error(`Task not found: ${review.taskId}`);
  }

  const needsFix = reviewNeedsFix(review);
  const changes: IterationTodoChange[] = [];
  const nextStatus: TaskStatus = needsFix ? "fix_needed" : "done";

  if (reviewedTask.status !== nextStatus) {
    changes.push({
      kind: "update_task",
      taskId: reviewedTask.id,
      before: { ...reviewedTask },
      after: { ...reviewedTask, status: nextStatus },
      reason: needsFix
        ? "Review requested fixes for this task."
        : "Review approved this task.",
    });
  }

  if (needsFix) {
    const fixFindings = actionableFindings(review);
    fixFindings.forEach((finding, index) => {
      const task = buildFixTask(reviewedTask, finding, index);
      const previous = todo.tasks.find((candidate) => candidate.id === task.id);
      changes.push({
        kind: "upsert_task",
        task,
        ...(previous ? { previous: { ...previous } } : {}),
        reason: `Fix-needed review finding: ${finding.title}`,
      });
    });
  }

  return {
    taskId: review.taskId,
    verdict: review.verdict,
    summary: review.summary,
    changes,
  };
}

export function applyIterationProposalDecision(
  todo: WorkflowTodo,
  proposal: IterationProposal,
  decision: IterationProposalDecision,
): IterationApplyResult {
  if (decision.kind === "reject") {
    return {
      todo: cloneTodo(todo),
      applied: false,
      summary: [`Rejected ${proposal.changes.length} proposed todo change(s).`],
    };
  }

  const selectedProposal = decision.kind === "edit" ? decision.proposal : proposal;
  const nextTodo = selectedProposal.changes.reduce(
    (currentTodo, change) => applyTodoChange(currentTodo, change),
    cloneTodo(todo),
  );

  return {
    todo: nextTodo,
    applied: true,
    summary: [
      `${decision.kind === "edit" ? "Edited and applied" : "Applied"} ${
        selectedProposal.changes.length
      } proposed todo change(s).`,
    ],
  };
}

export function formatIterationProposalMarkdown(proposal: IterationProposal): string {
  const lines = [
    `# Iteration proposal: ${proposal.taskId}`,
    `Verdict: ${proposal.verdict}`,
    "",
    "## Review Summary",
    proposal.summary || "(none)",
    "",
    "## Proposed Todo Changes",
  ];

  if (proposal.changes.length === 0) {
    lines.push("None.");
  } else {
    proposal.changes.forEach((change, index) => {
      if (change.kind === "update_task") {
        lines.push(
          `${index + 1}. Update ${change.taskId}: ${change.before.status} -> ${change.after.status}`,
          `   Reason: ${change.reason}`,
        );
      } else {
        lines.push(
          `${index + 1}. Upsert ${change.task.id}: ${change.task.title}`,
          `   Status: ${change.task.status}`,
          `   Reason: ${change.reason}`,
        );
      }
    });
  }

  return `${lines.join("\n")}\n`;
}

export function parseReviewOutcomeMarkdown(
  markdown: string,
  fallbackTaskId: string,
): ReviewOutcome {
  const taskId = markdown.match(/^#\s+Review:\s*(.+?)\s*$/mu)?.[1]?.trim() ?? fallbackTaskId;
  const verdict = parseVerdict(markdown);
  const summary = sectionContent(markdown, "Summary") ?? "";
  const findingsMarkdown = sectionContent(markdown, "Findings") ?? "";
  const findings = parseFindings(findingsMarkdown);

  return {
    taskId,
    verdict,
    summary: summary.trim(),
    findings,
  };
}

function applyTodoChange(todo: WorkflowTodo, change: IterationTodoChange): WorkflowTodo {
  if (change.kind === "update_task") {
    const currentTask = todo.tasks.find((task) => task.id === change.taskId);
    if (!currentTask) {
      throw new Error(`Task not found: ${change.taskId}`);
    }
    if (
      currentTask.status !== change.after.status &&
      !isValidTaskTransition(currentTask.status, change.after.status)
    ) {
      throw new InvalidTaskTransitionError(
        change.taskId,
        currentTask.status,
        change.after.status,
      );
    }

    return {
      ...todo,
      tasks: todo.tasks.map((task) =>
        task.id === change.taskId ? { ...change.after } : { ...task },
      ),
    };
  }

  const existingIndex = todo.tasks.findIndex((task) => task.id === change.task.id);
  if (existingIndex === -1) {
    return {
      ...todo,
      tasks: [...todo.tasks.map((task) => ({ ...task })), { ...change.task }],
    };
  }

  return {
    ...todo,
    tasks: todo.tasks.map((task, index) =>
      index === existingIndex ? mergeExistingTaskWithUpsert(task, change.task) : { ...task },
    ),
  };
}

function mergeExistingTaskWithUpsert(existing: TodoTask, incoming: TodoTask): TodoTask {
  if (
    existing.status !== incoming.status &&
    !isValidTaskTransition(existing.status, incoming.status)
  ) {
    return {
      ...incoming,
      status: existing.status,
    };
  }

  return { ...incoming };
}

function buildFixTask(
  reviewedTask: TodoTask,
  finding: ReviewFinding,
  index: number,
): TodoTask {
  const id = `${reviewedTask.id}-FIX-${String(index + 1).padStart(3, "0")}`;

  return {
    id,
    title: `Fix review finding: ${finding.title}`,
    type: reviewedTask.type,
    status: "draft",
    agent: "executor",
    dependencies: [...reviewedTask.dependencies],
    write_scope: finding.file ? [finding.file] : [...reviewedTask.write_scope],
    acceptance: [
      `Address review finding for ${reviewedTask.id}: ${finding.title}`,
      finding.details,
    ],
    output: ["changed_files", "test_results", `.ai/runs/${id}/result.md`],
    ...(reviewedTask.parallel_group ? { parallel_group: reviewedTask.parallel_group } : {}),
  };
}

function actionableFindings(review: ReviewOutcome): ReviewFinding[] {
  const findings = review.findings.filter((finding) => findingNeedsAction(finding));
  if (findings.length > 0) {
    return findings;
  }

  if (review.verdict === "changes_requested") {
    return [
      {
        severity: "high",
        title: "Address requested review changes",
        details: review.summary || "Review requested changes without a specific finding.",
        actionable: true,
      },
    ];
  }

  return [];
}

function reviewNeedsFix(review: ReviewOutcome): boolean {
  return (
    review.verdict === "changes_requested" ||
    review.findings.some((finding) => findingNeedsAction(finding))
  );
}

function findingNeedsAction(finding: ReviewFinding): boolean {
  return finding.actionable === true || ACTIONABLE_SEVERITIES.has(finding.severity);
}

function parseVerdict(markdown: string): ReviewVerdict {
  const value = markdown.match(/^Verdict:\s*(approved|changes_requested)\s*$/mu)?.[1];
  if (value !== "approved" && value !== "changes_requested") {
    throw new Error("Review markdown must include Verdict: approved or Verdict: changes_requested");
  }

  return value;
}

function parseFindings(markdown: string): ReviewFinding[] {
  if (!markdown.trim() || markdown.trim() === "None.") {
    return [];
  }

  return markdown
    .split(/^###\s+\d+\.\s+/mu)
    .map((section) => section.trim())
    .filter(Boolean)
    .map(parseFindingSection);
}

function parseFindingSection(section: string): ReviewFinding {
  const lines = section.split(/\r?\n/);
  const title = lines.shift()?.trim();
  if (!title) {
    throw new Error("Review finding is missing a title.");
  }

  const severity = fieldValue(section, "Severity") as ReviewFindingSeverity;
  if (!isReviewFindingSeverity(severity)) {
    throw new Error(`Invalid review finding severity: ${severity}`);
  }

  const actionable = fieldValue(section, "Actionable") === "yes";
  const file = fieldValue(section, "File");
  const details = lines
    .filter((line) => !line.startsWith("- Severity:"))
    .filter((line) => !line.startsWith("- Actionable:"))
    .filter((line) => !line.startsWith("- File:"))
    .join("\n")
    .trim();

  return {
    severity,
    title,
    details,
    actionable,
    ...(file ? { file } : {}),
  };
}

function sectionContent(markdown: string, heading: string): string | undefined {
  const lines = markdown.split(/\r?\n/);
  const startIndex = lines.findIndex((line) => line.trim() === `## ${heading}`);
  if (startIndex === -1) {
    return undefined;
  }

  const sectionLines: string[] = [];
  for (const line of lines.slice(startIndex + 1)) {
    if (line.startsWith("## ")) {
      break;
    }
    sectionLines.push(line);
  }

  return sectionLines.join("\n");
}

function fieldValue(section: string, field: string): string | undefined {
  return section.match(new RegExp(`^-\\s+${escapeRegExp(field)}:\\s*(.+?)\\s*$`, "mu"))?.[1]?.trim();
}

function isReviewFindingSeverity(value: string | undefined): value is ReviewFindingSeverity {
  return (
    value === "blocking" ||
    value === "high" ||
    value === "medium" ||
    value === "low"
  );
}

function cloneTodo(todo: WorkflowTodo): WorkflowTodo {
  return {
    ...todo,
    tasks: todo.tasks.map((task) => ({ ...task })),
  };
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
}
