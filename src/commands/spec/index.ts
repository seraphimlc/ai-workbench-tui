import type { StateManager } from "../../state/index.js";
import {
  type CommandResult,
  saveExactModelOutputArtifact,
  summarizeCommandResult,
} from "./artifacts.js";

export interface SpecCommandInput {
  state: StateManager;
  discussionPrompt: string;
  modelOutput: string;
  artifactTaskId?: string;
  artifactName?: string;
}

export type SpecCommandResult = CommandResult & {
  specPath: ".ai/spec.md";
  created: boolean;
};

export async function createOrUpdateSpecFromDiscussion(
  input: SpecCommandInput,
): Promise<SpecCommandResult> {
  const artifact = await saveExactModelOutputArtifact({
    state: input.state,
    taskId: input.artifactTaskId ?? "planning",
    artifactName: input.artifactName ?? "spec-model-output.md",
    modelOutput: input.modelOutput,
  });

  const currentSpec = await loadOptionalText(() => input.state.loadSpec());
  const created = currentSpec === undefined || currentSpec.trim().length === 0;
  const nextSpec = created
    ? ensureTrailingNewline(input.modelOutput)
    : appendSpecUpdate(currentSpec, input.discussionPrompt, input.modelOutput);

  await input.state.saveSpec(nextSpec);

  return {
    specPath: ".ai/spec.md",
    created,
    artifact,
    summary: summarizeCommandResult({
      action: created ? "Created spec from discussion prompt." : "Updated spec from discussion prompt.",
      artifact,
      modelOutput: input.modelOutput,
      details: [`Spec path: .ai/spec.md`],
    }),
  };
}

function appendSpecUpdate(
  currentSpec: string,
  discussionPrompt: string,
  modelOutput: string,
): string {
  return [
    trimTrailingWhitespace(currentSpec),
    "",
    "## Planning Update",
    "",
    `Prompt: ${discussionPrompt.trim() || "(empty prompt)"}`,
    "",
    trimTrailingWhitespace(modelOutput),
    "",
  ].join("\n");
}

function ensureTrailingNewline(value: string): string {
  return value.endsWith("\n") ? value : `${value}\n`;
}

function trimTrailingWhitespace(value: string): string {
  return value.replace(/\s+$/u, "");
}

async function loadOptionalText(read: () => Promise<string>): Promise<string | undefined> {
  try {
    return await read();
  } catch (error) {
    if (isMissingFileError(error)) {
      return undefined;
    }

    throw error;
  }
}

function isMissingFileError(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as NodeJS.ErrnoException).code === "ENOENT"
  );
}
