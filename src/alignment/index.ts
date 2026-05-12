import { readFile } from "node:fs/promises";
import { join } from "node:path";

import type { TaskStatus, WorkflowTodo } from "../shared/types.js";
import { StateManager } from "../state/index.js";

export type AlignmentDecisionKind = "continue" | "stop" | "ask-human";

export interface AlignmentDocument {
  exists: boolean;
  path: string;
  goal: string[];
  nonGoals: string[];
  stopConditions: string[];
  successCriteria: string[];
}

export interface AlignmentDecision {
  kind: AlignmentDecisionKind;
  reason: string;
}

export interface AlignmentTemplateInput {
  goal: string;
}

const ALIGNMENT_PATH = ".ai/alignment.md";
const ACTIVE_STATUSES = new Set<TaskStatus>([
  "idea",
  "draft",
  "ready",
  "running",
  "review",
]);
const HUMAN_DECISION_STATUSES = new Set<TaskStatus>(["blocked", "fix_needed"]);

export async function loadAlignmentDocument(rootDir = process.cwd()): Promise<AlignmentDocument> {
  const path = join(rootDir, ALIGNMENT_PATH);
  try {
    const content = await readFile(path, "utf8");
    return {
      exists: true,
      path: ALIGNMENT_PATH,
      goal: sectionLines(content, "Goal"),
      nonGoals: sectionLines(content, "Non-goals"),
      stopConditions: sectionLines(content, "Stop Conditions"),
      successCriteria: sectionLines(content, "Success Criteria"),
    };
  } catch (error) {
    if (isMissingFile(error)) {
      return {
        exists: false,
        path: ALIGNMENT_PATH,
        goal: [],
        nonGoals: [],
        stopConditions: [],
        successCriteria: [],
      };
    }
    throw error;
  }
}

export function recommendAlignmentDecision(todo: WorkflowTodo): AlignmentDecision {
  const statuses = todo.tasks.map((task) => task.status);
  if (statuses.some((status) => HUMAN_DECISION_STATUSES.has(status))) {
    return {
      kind: "ask-human",
      reason: "Some tasks are blocked or need fixes; direction should be checked before continuing.",
    };
  }

  if (todo.tasks.length > 0 && statuses.every((status) => status === "done")) {
    return {
      kind: "stop",
      reason: "All tracked tasks are done; prefer review, consolidation, or a new objective lock.",
    };
  }

  if (statuses.some((status) => ACTIVE_STATUSES.has(status))) {
    return {
      kind: "continue",
      reason: "There is active planned work still inside the current todo contract.",
    };
  }

  return {
    kind: "ask-human",
    reason: "No active todo signal is available; human direction should refresh the objective lock.",
  };
}

export async function renderAlignmentCheck(rootDir = process.cwd()): Promise<string> {
  const state = new StateManager(rootDir);
  const [document, todo] = await Promise.all([
    loadAlignmentDocument(rootDir),
    state.loadTodo().catch(() => undefined),
  ]);
  const decision = todo
    ? recommendAlignmentDecision(todo)
    : {
        kind: "ask-human" as const,
        reason: "Workflow todo is missing; alignment cannot be checked against current work.",
      };

  return [
    "Alignment:",
    `- File: ${document.path}${document.exists ? "" : " (alignment.md not found)"}`,
    ...renderSection("Goal", document.goal),
    ...renderSection("Non-goals", document.nonGoals),
    ...renderSection("Stop Conditions", document.stopConditions),
    ...renderSection("Success Criteria", document.successCriteria),
    `- Decision: ${decision.kind}`,
    `- Reason: ${decision.reason}`,
  ].join("\n");
}

export function createDefaultAlignmentDocument(input: AlignmentTemplateInput): string {
  return [
    "# Alignment Checkpoint",
    "",
    "## Goal",
    "",
    `- ${input.goal}`,
    "",
    "## Non-goals",
    "",
    "- Not documented.",
    "",
    "## Stop Conditions",
    "",
    "- Stop when the success criteria are complete.",
    "- Pause before adding capabilities outside this objective.",
    "",
    "## Success Criteria",
    "",
    "- Not documented.",
    "",
  ].join("\n");
}

function renderSection(title: string, values: readonly string[]): string[] {
  if (values.length === 0) {
    return [`- ${title}: Not documented.`];
  }

  const [first = "Not documented.", ...rest] = values;
  return [`- ${title}: ${first}`, ...rest.map((line) => `  ${line}`)];
}

function sectionLines(content: string, sectionTitle: string): string[] {
  const lines = content.split(/\r?\n/);
  const startIndex = lines.findIndex((line) => line.trim() === `## ${sectionTitle}`);
  if (startIndex < 0) {
    return [];
  }

  const section: string[] = [];
  for (const line of lines.slice(startIndex + 1)) {
    if (line.startsWith("## ")) {
      break;
    }
    const normalized = line.trim().replace(/^[-*]\s+/u, "");
    if (normalized) {
      section.push(normalized);
    }
  }

  return section;
}

function isMissingFile(error: unknown): boolean {
  return error instanceof Error && "code" in error && error.code === "ENOENT";
}
