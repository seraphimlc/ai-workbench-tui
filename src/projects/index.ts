import { mkdir, readFile, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, isAbsolute, join, resolve } from "node:path";

import YAML from "yaml";

import type { ProjectRegistry, WorkbenchProject } from "../shared/types.js";

const REGISTRY_VERSION = 1;

export function defaultProjectRegistryPath(): string {
  return join(homedir(), ".ai-workbench", "projects.yaml");
}

export async function loadProjectRegistry(
  registryPath = defaultProjectRegistryPath(),
): Promise<ProjectRegistry> {
  try {
    const parsed = YAML.parse(await readFile(registryPath, "utf8")) as ProjectRegistry | null;
    return normalizeRegistry(parsed);
  } catch (error) {
    if (isNodeError(error) && error.code === "ENOENT") {
      return emptyProjectRegistry();
    }
    throw error;
  }
}

export async function saveProjectRegistry(
  registry: ProjectRegistry,
  registryPath = defaultProjectRegistryPath(),
): Promise<void> {
  const normalized = normalizeRegistry(registry);
  await mkdir(dirname(registryPath), { recursive: true });
  await writeFile(registryPath, YAML.stringify(normalized), "utf8");
}

export async function registerProject(
  registry: ProjectRegistry,
  project: Omit<WorkbenchProject, "path"> & { path: string },
  options: { now?: string; setCurrent?: boolean } = {},
): Promise<ProjectRegistry> {
  const normalizedProject = normalizeProject(project, options.now);
  const projects = [
    ...registry.projects.filter((candidate) => candidate.id !== normalizedProject.id),
    normalizedProject,
  ].sort((left, right) => left.id.localeCompare(right.id));

  return {
    version: REGISTRY_VERSION,
    current_project_id:
      options.setCurrent === false
        ? registry.current_project_id
        : normalizedProject.id,
    projects,
  };
}

export function selectProject(
  registry: ProjectRegistry,
  projectId: string,
  options: { now?: string } = {},
): ProjectRegistry {
  let found = false;
  const projects = registry.projects.map((project) => {
    if (project.id !== projectId) {
      return { ...project };
    }

    found = true;
    return {
      ...project,
      last_opened_at: options.now ?? new Date().toISOString(),
    };
  });

  if (!found) {
    throw new Error(`Project not found: ${projectId}`);
  }

  return {
    version: REGISTRY_VERSION,
    current_project_id: projectId,
    projects,
  };
}

export function resolveProjectRoot(
  registry: ProjectRegistry,
  projectId: string | undefined,
): string | undefined {
  const id = projectId ?? registry.current_project_id;
  if (!id) {
    return undefined;
  }

  const project = registry.projects.find((candidate) => candidate.id === id);
  return project?.path;
}

export function renderProjectRegistry(registry: ProjectRegistry): string {
  if (registry.projects.length === 0) {
    return "Projects:\n- none";
  }

  return [
    "Projects:",
    ...registry.projects.map((project) => {
      const marker = project.id === registry.current_project_id ? "*" : "-";
      return `${marker} ${project.id} ${project.name} ${project.path}`;
    }),
  ].join("\n");
}

function emptyProjectRegistry(): ProjectRegistry {
  return {
    version: REGISTRY_VERSION,
    projects: [],
  };
}

function normalizeRegistry(registry: ProjectRegistry | null | undefined): ProjectRegistry {
  if (!registry || !Array.isArray(registry.projects)) {
    return emptyProjectRegistry();
  }

  return {
    version: REGISTRY_VERSION,
    current_project_id: registry.current_project_id,
    projects: registry.projects.map((project) => normalizeProject(project)),
  };
}

function normalizeProject(
  project: Omit<WorkbenchProject, "path"> & { path: string },
  now?: string,
): WorkbenchProject {
  if (!project.id.trim()) {
    throw new Error("Project id is required");
  }
  if (!project.name.trim()) {
    throw new Error("Project name is required");
  }
  if (!project.path.trim()) {
    throw new Error("Project path is required");
  }

  const absolutePath = isAbsolute(project.path) ? project.path : resolve(project.path);
  return {
    id: project.id.trim(),
    name: project.name.trim(),
    path: absolutePath,
    description: project.description?.trim() || undefined,
    last_opened_at: now ?? project.last_opened_at,
  };
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error;
}
