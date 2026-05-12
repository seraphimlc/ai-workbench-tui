import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import {
  loadProjectRegistry,
  registerProject,
  renderProjectRegistry,
  resolveProjectRoot,
  saveProjectRegistry,
  selectProject,
} from "../../src/projects/index.js";

async function withTempRegistry<T>(fn: (registryPath: string, projectRoot: string) => Promise<T>) {
  const root = await mkdtemp(join(tmpdir(), "project-registry-"));
  try {
    return await fn(join(root, "projects.yaml"), join(root, "project-a"));
  } finally {
    await rm(root, { force: true, recursive: true });
  }
}

test("project registry saves projects and resolves selected project roots", async () => {
  await withTempRegistry(async (registryPath, projectRoot) => {
    const empty = await loadProjectRegistry(registryPath);
    assert.deepEqual(empty.projects, []);

    const registered = await registerProject(empty, {
      id: "alpha",
      name: "Alpha",
      path: projectRoot,
    });
    await saveProjectRegistry(registered, registryPath);

    const loaded = await loadProjectRegistry(registryPath);
    assert.equal(loaded.current_project_id, "alpha");
    assert.equal(resolveProjectRoot(loaded, undefined), projectRoot);
    assert.match(await readFile(registryPath, "utf8"), /alpha/);
    assert.match(renderProjectRegistry(loaded), /\* alpha Alpha/);
  });
});

test("selectProject changes current project and rejects unknown ids", async () => {
  const registry = await registerProject(
    {
      version: 1,
      projects: [],
    },
    {
      id: "alpha",
      name: "Alpha",
      path: "/tmp/alpha",
    },
    { setCurrent: false, now: "2026-05-12T00:00:00.000Z" },
  );

  const selected = selectProject(registry, "alpha", {
    now: "2026-05-12T01:00:00.000Z",
  });

  assert.equal(selected.current_project_id, "alpha");
  assert.equal(selected.projects[0]?.last_opened_at, "2026-05-12T01:00:00.000Z");
  assert.throws(() => selectProject(selected, "missing"), /Project not found/);
});
