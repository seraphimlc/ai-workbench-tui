import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";

import {
  InvalidTaskTransitionError,
  isValidTaskTransition,
} from "../state/index.js";
import type { TaskStatus, TodoTask, WorkflowTodo } from "../shared/types.js";

export type ReviewVerdict = "approved" | "changes_requested";
export type ReviewFindingSeverity = "blocking" | "high" | "medium" | "low";

export interface ReviewFinding {
  severity: ReviewFindingSeverity;
  title: string;
  details: string;
  actionable?: boolean;
  file?: string;
}

export interface ReviewOutcome {
  taskId: string;
  verdict: ReviewVerdict;
  summary: string;
  findings: readonly ReviewFinding[];
}

export interface ReviewerRequestInput {
  task: TodoTask;
  diff: string;
  testOutput: string;
  executionReport: string;
  maxSectionCharacters?: number;
  extraInstructions?: readonly string[];
}

export interface ReviewerRequest {
  taskId: string;
  taskTitle: string;
  acceptanceCriteria: readonly string[];
  diff: string;
  testOutput: string;
  executionReport: string;
  prompt: string;
}

const DEFAULT_MAX_SECTION_CHARACTERS = 20_000;
const ACTIONABLE_SEVERITIES = new Set<ReviewFindingSeverity>([
  "blocking",
  "high",
  "medium",
]);

export function buildReviewerRequest(input: ReviewerRequestInput): ReviewerRequest {
  const maxSectionCharacters =
    input.maxSectionCharacters ?? DEFAULT_MAX_SECTION_CHARACTERS;
  const diff = boundedSection(input.diff, maxSectionCharacters);
  const testOutput = boundedSection(input.testOutput, maxSectionCharacters);
  const executionReport = boundedSection(input.executionReport, maxSectionCharacters);
  const acceptanceCriteria = [...input.task.acceptance];

  const sections = [
    `# Review dispatch for ${input.task.id}`,
    `## Task\n${input.task.title}`,
    `## Write scope\n${formatList(input.task.write_scope)}`,
    `## Acceptance criteria\n${formatList(acceptanceCriteria)}`,
    `## Diff\n${diff}`,
    `## Test output\n${testOutput}`,
    `## Execution report\n${executionReport}`,
    `## Reviewer instructions\n${formatList([
      "Review the diff and evidence against the acceptance criteria.",
      "Report only findings that are grounded in the provided evidence.",
      "Use verdict approved when there are no actionable findings.",
      "Use verdict changes_requested when implementation fixes are required.",
    ])}`,
  ];

  if (input.extraInstructions && input.extraInstructions.length > 0) {
    sections.push(`## Additional instructions\n${formatList(input.extraInstructions)}`);
  }

  return {
    taskId: input.task.id,
    taskTitle: input.task.title,
    acceptanceCriteria,
    diff,
    testOutput,
    executionReport,
    prompt: `${sections.join("\n\n")}\n`,
  };
}

export async function saveReviewOutcome(
  projectRoot: string,
  outcome: ReviewOutcome,
): Promise<string> {
  const runDir = join(projectRoot, ".ai", "runs", outcome.taskId);
  const reviewPath = join(runDir, "review.md");

  await mkdir(runDir, { recursive: true });
  await writeFile(reviewPath, formatReviewOutcome(outcome), "utf8");

  return reviewPath;
}

export function applyReviewOutcomeToTodo(
  todo: WorkflowTodo,
  outcome: ReviewOutcome,
): WorkflowTodo {
  const nextStatus: TaskStatus = reviewNeedsFix(outcome) ? "fix_needed" : "done";
  const task = todo.tasks.find((candidate) => candidate.id === outcome.taskId);

  if (!task) {
    throw new Error(`Task not found: ${outcome.taskId}`);
  }

  if (!isValidTaskTransition(task.status, nextStatus)) {
    throw new InvalidTaskTransitionError(outcome.taskId, task.status, nextStatus);
  }

  return {
    ...todo,
    tasks: todo.tasks.map((task) =>
      task.id === outcome.taskId ? { ...task, status: nextStatus } : task,
    ),
  };
}

export function formatReviewOutcome(outcome: ReviewOutcome): string {
  const findingSections =
    outcome.findings.length === 0
      ? "None."
      : outcome.findings
          .map((finding, index) => {
            const lines = [
              `### ${index + 1}. ${finding.title}`,
              `- Severity: ${finding.severity}`,
              `- Actionable: ${findingNeedsAction(finding) ? "yes" : "no"}`,
            ];

            if (finding.file) {
              lines.push(`- File: ${finding.file}`);
            }

            lines.push("", finding.details);
            return lines.join("\n");
          })
          .join("\n\n");

  return [
    `# Review: ${outcome.taskId}`,
    `Verdict: ${outcome.verdict}`,
    "",
    "## Summary",
    outcome.summary,
    "",
    "## Findings",
    findingSections,
    "",
  ].join("\n");
}

function reviewNeedsFix(outcome: ReviewOutcome): boolean {
  return (
    outcome.verdict === "changes_requested" ||
    outcome.findings.some((finding) => findingNeedsAction(finding))
  );
}

function findingNeedsAction(finding: ReviewFinding): boolean {
  return finding.actionable === true || ACTIONABLE_SEVERITIES.has(finding.severity);
}

function boundedSection(value: string, maxCharacters: number): string {
  if (value.length === 0) {
    return "(empty)";
  }

  if (value.length <= maxCharacters) {
    return value;
  }

  return `${value.slice(0, Math.max(0, maxCharacters))}\n\n[truncated to ${maxCharacters} characters]`;
}

function formatList(values: readonly string[]): string {
  if (values.length === 0) {
    return "- none";
  }

  return values.map((value) => `- ${value}`).join("\n");
}
