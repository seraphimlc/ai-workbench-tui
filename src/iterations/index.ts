import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { join, posix } from "node:path";

const ITERATION_FILENAME_PATTERN = /^(\d{4})-(.+)\.md$/u;
const LEGACY_TEMPLATE_HEADING_PATTERN = /^# Iteration NNNN: Title$/mu;

export interface IterationSummary {
  number: number;
  paddedNumber: string;
  title: string;
  filename: string;
  relativePath: string;
  path: string;
}

export interface IterationNote extends IterationSummary {
  content: string;
}

export interface CreateIterationInput {
  title: string;
  values?: Record<string, string>;
}

export interface RenderIterationTemplateInput {
  number: number;
  title: string;
  slug: string;
  values?: Record<string, string>;
}

export async function listIterations(rootDir = process.cwd()): Promise<IterationSummary[]> {
  const dir = iterationsDir(rootDir);
  await mkdir(dir, { recursive: true });
  const entries = await readdir(dir, { withFileTypes: true });
  const summaries = await Promise.all(
    entries
      .filter((entry) => entry.isFile())
      .map(async (entry) => iterationSummaryFromFilename(rootDir, entry.name)),
  );

  return summaries
    .filter((summary): summary is IterationSummary => summary !== undefined)
    .sort((left, right) => left.number - right.number);
}

export async function readLatestIteration(rootDir = process.cwd()): Promise<IterationNote | undefined> {
  const iterations = await listIterations(rootDir);
  const latest = iterations.at(-1);
  if (!latest) {
    return undefined;
  }

  return {
    ...latest,
    content: await readFile(latest.path, "utf8"),
  };
}

export async function createNextIterationNote(
  rootDir: string,
  input: CreateIterationInput,
): Promise<IterationNote> {
  const existing = await listIterations(rootDir);
  const number = (existing.at(-1)?.number ?? 0) + 1;
  const paddedNumber = formatIterationNumber(number);
  const slug = slugifyTitle(input.title);
  const filename = `${paddedNumber}-${slug}.md`;
  const filePath = join(iterationsDir(rootDir), filename);
  await mkdir(iterationsDir(rootDir), { recursive: true });
  const template = await readTemplate(rootDir);
  const content = ensureTrailingNewline(
    renderIterationTemplate(template, {
      number,
      title: input.title,
      slug,
      values: input.values,
    }),
  );

  await writeFile(filePath, content, { encoding: "utf8", flag: "wx" });

  return {
    number,
    paddedNumber,
    title: input.title,
    filename,
    relativePath: iterationRelativePath(filename),
    path: filePath,
    content,
  };
}

async function readTemplate(rootDir: string): Promise<string> {
  try {
    return await readFile(join(iterationsDir(rootDir), "template.md"), "utf8");
  } catch (error) {
    if (isMissingFileError(error)) {
      return DEFAULT_ITERATION_TEMPLATE;
    }

    throw error;
  }
}

export function renderIterationTemplate(
  template: string,
  input: RenderIterationTemplateInput,
): string {
  const paddedNumber = formatIterationNumber(input.number);
  const values: Record<string, string> = {
    number: paddedNumber,
    paddedNumber,
    title: input.title,
    slug: input.slug,
    ...(input.values ?? {}),
  };

  return template
    .replace(LEGACY_TEMPLATE_HEADING_PATTERN, `# Iteration ${paddedNumber}: ${input.title}`)
    .replace(/\{\{\s*([A-Za-z0-9_.-]+)\s*\}\}/gu, (_match, key: string) => values[key] ?? "");
}

function iterationsDir(rootDir: string): string {
  return join(rootDir, ".ai", "iterations");
}

async function iterationSummaryFromFilename(
  rootDir: string,
  filename: string,
): Promise<IterationSummary | undefined> {
  const match = filename.match(ITERATION_FILENAME_PATTERN);
  if (!match) {
    return undefined;
  }

  const paddedNumber = match[1];
  const slug = match[2];
  if (!paddedNumber || !slug) {
    return undefined;
  }

  const filePath = join(iterationsDir(rootDir), filename);
  const content = await readFile(filePath, "utf8");
  const number = Number.parseInt(paddedNumber, 10);

  return {
    number,
    paddedNumber,
    title: titleFromContent(content, number) ?? titleFromSlug(slug),
    filename,
    relativePath: iterationRelativePath(filename),
    path: filePath,
  };
}

function titleFromContent(content: string, number: number): string | undefined {
  const heading = content.match(new RegExp(`^#\\s+Iteration\\s+${formatIterationNumber(number)}:\\s+(.+?)\\s*$`, "mu"));
  return heading?.[1];
}

function titleFromSlug(slug: string): string {
  return slug
    .split("-")
    .filter(Boolean)
    .map((word) => `${word.slice(0, 1).toUpperCase()}${word.slice(1)}`)
    .join(" ");
}

function slugifyTitle(title: string): string {
  const slug = title
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/gu, "")
    .toLowerCase()
    .match(/[a-z0-9]+/gu)
    ?.join("-");

  return slug && slug.length > 0 ? slug : "iteration";
}

function formatIterationNumber(number: number): string {
  return number.toString().padStart(4, "0");
}

function iterationRelativePath(filename: string): string {
  return posix.join(".ai", "iterations", filename);
}

function ensureTrailingNewline(content: string): string {
  return content.endsWith("\n") ? content : `${content}\n`;
}

function isMissingFileError(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as NodeJS.ErrnoException).code === "ENOENT"
  );
}

const DEFAULT_ITERATION_TEMPLATE = `# Iteration NNNN: Title

## Trigger

{{trigger}}

## Current Capability

Not documented.

## Goals

Not documented.

## Decisions

Not documented.

## Todo Changes

Added:

- None

Completed:

- None

Blocked:

- None

Deferred:

- None

## Dispatch Plan

Not documented.

## Execution Summary

Not documented.

## Review Summary

{{reviewSummary}}

## Capability After Iteration

Not documented.

## Remaining Gaps

Not documented.

## Next Iteration Recommendation

Not documented.
`;
