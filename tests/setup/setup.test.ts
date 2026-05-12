import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import {
  doctorWorkbenchProject,
  initWorkbenchProject,
  renderDoctorReport,
} from "../../src/setup/index.js";

async function withTempProject<T>(fn: (root: string) => Promise<T>): Promise<T> {
  const root = await mkdtemp(join(tmpdir(), "setup-"));
  try {
    return await fn(root);
  } finally {
    await rm(root, { force: true, recursive: true });
  }
}

test("initWorkbenchProject creates the minimal .ai project files", async () => {
  await withTempProject(async (root) => {
    const result = await initWorkbenchProject(root, { projectName: "Demo App" });

    assert.equal(result.created.length, 4);
    assert.match(await readFile(join(root, ".ai", "spec.md"), "utf8"), /Demo App/);
    assert.match(await readFile(join(root, ".ai", "workflow-todo.yaml"), "utf8"), /tasks: \[\]/);
    assert.match(await readFile(join(root, ".ai", "alignment.md"), "utf8"), /## Goal/);
    assert.match(
      await readFile(join(root, ".ai", "executor-profiles.yaml"), "utf8"),
      /echo-executor/,
    );
  });
});

test("initWorkbenchProject does not overwrite existing files unless forced", async () => {
  await withTempProject(async (root) => {
    await initWorkbenchProject(root, { projectName: "First" });
    await writeFile(join(root, ".ai", "spec.md"), "custom spec\n", "utf8");

    const skipped = await initWorkbenchProject(root, { projectName: "Second" });
    assert.ok(skipped.skipped.includes(".ai/spec.md"));
    assert.equal(await readFile(join(root, ".ai", "spec.md"), "utf8"), "custom spec\n");

    const forced = await initWorkbenchProject(root, { projectName: "Second", force: true });
    assert.ok(forced.overwritten.includes(".ai/spec.md"));
    assert.match(await readFile(join(root, ".ai", "spec.md"), "utf8"), /Second/);
  });
});

test("doctorWorkbenchProject reports valid initialized projects", async () => {
  await withTempProject(async (root) => {
    await initWorkbenchProject(root, { projectName: "Doctor App" });

    const report = await doctorWorkbenchProject(root);

    assert.equal(report.ok, true);
    assert.equal(report.checks.every((check) => check.status === "pass"), true);
    assert.match(renderDoctorReport(report), /Doctor: pass/);
  });
});

test("doctorWorkbenchProject reports missing files and invalid profiles", async () => {
  await withTempProject(async (root) => {
    await initWorkbenchProject(root, { projectName: "Broken App" });
    await rm(join(root, ".ai", "alignment.md"));
    await writeFile(
      join(root, ".ai", "executor-profiles.yaml"),
      [
        "version: 1",
        "default_profile: missing",
        "profiles:",
        "  bad:",
        "    command: ''",
      ].join("\n"),
      "utf8",
    );

    const report = await doctorWorkbenchProject(root);

    assert.equal(report.ok, false);
    assert.match(renderDoctorReport(report), /missing required file: \.ai\/alignment.md/);
    assert.match(renderDoctorReport(report), /executor profiles invalid/);
  });
});
