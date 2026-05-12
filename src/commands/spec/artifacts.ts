import { createHash } from "node:crypto";

import type { StateManager } from "../../state/index.js";

export interface CommandArtifact {
  taskId: string;
  name: string;
  path: string;
  bytes: number;
  sha256: string;
}

export interface CommandResult {
  summary: string[];
  artifact: CommandArtifact;
}

export async function saveExactModelOutputArtifact(input: {
  state: StateManager;
  taskId: string;
  artifactName: string;
  modelOutput: string;
}): Promise<CommandArtifact> {
  await input.state.saveRunArtifact(
    input.taskId,
    input.artifactName,
    input.modelOutput,
  );

  return {
    taskId: input.taskId,
    name: input.artifactName,
    path: `.ai/runs/${input.taskId}/${input.artifactName}`,
    bytes: Buffer.byteLength(input.modelOutput, "utf8"),
    sha256: createHash("sha256").update(input.modelOutput).digest("hex"),
  };
}

export function summarizeCommandResult(input: {
  action: string;
  artifact: CommandArtifact;
  modelOutput: string;
  details?: string[];
}): string[] {
  return [
    input.action,
    ...(input.details ?? []),
    `Saved full model output artifact: ${input.artifact.path} (${input.artifact.bytes} bytes, sha256 ${input.artifact.sha256.slice(0, 12)})`,
    ...summarizeText(input.modelOutput),
  ];
}

function summarizeText(text: string): string[] {
  const lines = text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .slice(0, 3)
    .map((line) => `Model summary: ${truncate(line, 96)}`);

  return lines.length > 0 ? lines : ["Model summary: no non-empty output"];
}

function truncate(value: string, maxLength: number): string {
  if (value.length <= maxLength) {
    return value;
  }

  return `${value.slice(0, maxLength - 3)}...`;
}
