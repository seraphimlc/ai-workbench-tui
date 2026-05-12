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
