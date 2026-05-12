import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import {
  createNextIterationNote,
  listIterations,
  readLatestIteration,
  renderIterationTemplate,
} from "../../src/iterations/index.js";

async function withTempProject<T>(fn: (root: string) => Promise<T>): Promise<T> {
  const root = await mkdtemp(join(tmpdir(), "iterations-"));
  try {
    await mkdir(join(root, ".ai", "iterations"), { recursive: true });
    return await fn(root);
  } finally {
    await rm(root, { force: true, recursive: true });
  }
}

async function writeIteration(root: string, filename: string, content: string): Promise<void> {
  await writeFile(join(root, ".ai", "iterations", filename), content, "utf8");
}

test("lists existing iteration notes in numeric order and ignores non-notes", async () => {
  await withTempProject(async (root) => {
    await writeIteration(root, "template.md", "# Template\n");
    await writeIteration(root, "0002-round-two.md", "# Iteration 0002: Round Two\n");
    await writeIteration(root, "0010-later.md", "# Iteration 0010: Later\n");
    await writeIteration(root, "0001-foundation.md", "# Iteration 0001: Foundation\n");
    await writeIteration(root, "draft.md", "# Draft\n");

    const iterations = await listIterations(root);

    assert.deepEqual(
      iterations.map((iteration) => iteration.filename),
      ["0001-foundation.md", "0002-round-two.md", "0010-later.md"],
    );
    assert.deepEqual(
      iterations.map((iteration) => iteration.number),
      [1, 2, 10],
    );
    assert.equal(iterations[1]?.title, "Round Two");
  });
});

test("renders numbered template placeholders for the next iteration note", async () => {
  const template = [
    "# Iteration {{number}}: {{title}}",
    "",
    "File slug: {{slug}}",
    "Started because: {{trigger}}",
  ].join("\n");

  const rendered = renderIterationTemplate(template, {
    number: 3,
    title: "Round 3 Review",
    slug: "round-3-review",
    values: {
      trigger: "Review completed.",
    },
  });

  assert.equal(
    rendered,
    [
      "# Iteration 0003: Round 3 Review",
      "",
      "File slug: round-3-review",
      "Started because: Review completed.",
    ].join("\n"),
  );
});

test("creates the next numbered iteration note from the project template", async () => {
  await withTempProject(async (root) => {
    await writeIteration(root, "0001-foundation.md", "# Iteration 0001: Foundation\n");
    await writeIteration(root, "0002-round-two.md", "# Iteration 0002: Round Two\n");
    await writeIteration(
      root,
      "template.md",
      [
        "# Iteration NNNN: Title",
        "",
        "## Trigger",
        "",
        "{{trigger}}",
      ].join("\n"),
    );

    const created = await createNextIterationNote(root, {
      title: "Round 3 Review Memory",
      values: {
        trigger: "Reviewer artifacts are ready.",
      },
    });

    assert.equal(created.number, 3);
    assert.equal(created.filename, "0003-round-3-review-memory.md");
    assert.equal(created.relativePath, ".ai/iterations/0003-round-3-review-memory.md");
    assert.equal(
      await readFile(created.path, "utf8"),
      [
        "# Iteration 0003: Round 3 Review Memory",
        "",
        "## Trigger",
        "",
        "Reviewer artifacts are ready.",
        "",
      ].join("\n"),
    );
  });
});

test("reads the latest iteration note as planning context", async () => {
  await withTempProject(async (root) => {
    await writeIteration(root, "0002-round-two.md", "# Iteration 0002: Round Two\n");
    await writeIteration(root, "0004-latest.md", "# Iteration 0004: Latest\n\nUse me next.\n");
    await writeIteration(root, "0003-middle.md", "# Iteration 0003: Middle\n");

    const latest = await readLatestIteration(root);

    assert.equal(latest?.number, 4);
    assert.equal(latest?.filename, "0004-latest.md");
    assert.match(latest?.content ?? "", /Use me next/);
  });
});
