export type TaskStatus =
  | "idea"
  | "draft"
  | "ready"
  | "running"
  | "blocked"
  | "review"
  | "fix_needed"
  | "done";

export type AgentRole = "orchestrator" | "executor" | "reviewer" | "main_thread";

export type TaskMode = "interactive" | "background";

export interface TodoTask {
  id: string;
  title: string;
  type: string;
  status: TaskStatus;
  agent: string;
  dependencies: string[];
  write_scope: string[];
  acceptance: string[];
  output: string[];
  risk?: string;
  parallel_group?: string;
  suggested_stack?: string[];
}

export interface WorkflowTodo {
  project: string;
  version: number;
  goal: string;
  tasks: TodoTask[];
  execution_plan?: Record<string, unknown>;
}

export interface WorkbenchProject {
  id: string;
  name: string;
  path: string;
  description?: string;
  last_opened_at?: string;
}

export interface ProjectRegistry {
  version: number;
  current_project_id?: string;
  projects: WorkbenchProject[];
}

export type QueueItemStatus = "pending" | "running" | "review" | "done" | "blocked";

export interface QueueItem {
  task_id: string;
  project_id?: string;
  status: QueueItemStatus;
  priority: number;
  enqueued_at: string;
  updated_at: string;
  reason?: string;
}

export interface TaskQueue {
  version: number;
  items: QueueItem[];
}

export type RunHistoryKind = "run" | "review" | "iteration" | "queue";

export interface RunHistoryEntry {
  id: string;
  task_id?: string;
  project_id?: string;
  kind: RunHistoryKind;
  status: string;
  started_at: string;
  ended_at?: string;
  command?: string;
  summary: string;
  artifacts?: string[];
}

export interface RunHistory {
  version: number;
  entries: RunHistoryEntry[];
}

export interface Route {
  agent: AgentRole;
  model: string;
  mode: TaskMode;
  fallback?: string;
  require_review?: boolean;
  require_human_approval?: boolean;
}

export interface RoutesConfig {
  version: number;
  defaults: Record<string, Route>;
  upgrade_rules?: Array<Record<string, unknown>>;
}
