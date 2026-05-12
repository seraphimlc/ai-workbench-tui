import type { QueueItem, TaskQueue, TodoTask, WorkflowTodo } from "../shared/types.js";

const QUEUE_VERSION = 1;
const DISPATCHABLE_STATUS = "ready";
const INCOMPLETE_QUEUE_STATUSES = new Set(["pending", "running"]);

export function createEmptyTaskQueue(): TaskQueue {
  return {
    version: QUEUE_VERSION,
    items: [],
  };
}

export function syncQueueFromTodo(
  queue: TaskQueue | undefined,
  todo: WorkflowTodo,
  options: { now?: string; projectId?: string } = {},
): TaskQueue {
  const current = queue ?? createEmptyTaskQueue();
  const dispatchableTasks = getDispatchableTasks(todo);
  const now = options.now ?? new Date().toISOString();
  const itemsByTaskId = new Map(current.items.map((item) => [item.task_id, { ...item }]));

  for (const task of dispatchableTasks) {
    if (itemsByTaskId.has(task.id)) {
      continue;
    }

    itemsByTaskId.set(task.id, {
      task_id: task.id,
      project_id: options.projectId,
      status: "pending",
      priority: priorityForTask(task),
      enqueued_at: now,
      updated_at: now,
    });
  }

  const knownTasks = new Map(todo.tasks.map((task) => [task.id, task]));
  const items = [...itemsByTaskId.values()]
    .filter((item) => shouldKeepQueueItem(item, knownTasks.get(item.task_id)))
    .sort(compareQueueItems);

  return {
    version: QUEUE_VERSION,
    items,
  };
}

export function getDispatchableTasks(todo: WorkflowTodo): TodoTask[] {
  const doneTaskIds = new Set(
    todo.tasks.filter((task) => task.status === "done").map((task) => task.id),
  );

  return todo.tasks.filter(
    (task) =>
      task.status === DISPATCHABLE_STATUS &&
      task.acceptance.length > 0 &&
      task.write_scope.length > 0 &&
      task.dependencies.every((dependency) => doneTaskIds.has(dependency)),
  );
}

export function getNextQueueItems(queue: TaskQueue, limit = 3): QueueItem[] {
  return queue.items
    .filter((item) => item.status === "pending")
    .sort(compareQueueItems)
    .slice(0, limit)
    .map((item) => ({ ...item }));
}

export function updateQueueItemStatus(
  queue: TaskQueue,
  taskId: string,
  status: QueueItem["status"],
  options: { now?: string; reason?: string } = {},
): TaskQueue {
  let found = false;
  const now = options.now ?? new Date().toISOString();
  const items = queue.items.map((item) => {
    if (item.task_id !== taskId) {
      return { ...item };
    }

    found = true;
    return {
      ...item,
      status,
      updated_at: now,
      reason: options.reason,
    };
  });

  if (!found) {
    throw new Error(`Queue item not found: ${taskId}`);
  }

  return {
    version: QUEUE_VERSION,
    items,
  };
}

export function renderTaskQueue(queue: TaskQueue): string {
  if (queue.items.length === 0) {
    return "Queue:\n- empty";
  }

  return [
    "Queue:",
    ...queue.items.map(
      (item) => `- ${item.task_id} ${item.status} p${item.priority} ${item.reason ?? ""}`.trim(),
    ),
  ].join("\n");
}

function priorityForTask(task: TodoTask): number {
  if (task.risk && ["security", "payment", "migration", "data-loss"].includes(task.risk)) {
    return 100;
  }

  return task.dependencies.length === 0 ? 50 : 40;
}

function shouldKeepQueueItem(item: QueueItem, task: TodoTask | undefined): boolean {
  if (!task) {
    return !INCOMPLETE_QUEUE_STATUSES.has(item.status);
  }

  if (task.status === "done") {
    return item.status !== "pending";
  }

  return true;
}

function compareQueueItems(left: QueueItem, right: QueueItem): number {
  const priority = right.priority - left.priority;
  if (priority !== 0) {
    return priority;
  }

  const time = left.enqueued_at.localeCompare(right.enqueued_at);
  if (time !== 0) {
    return time;
  }

  return left.task_id.localeCompare(right.task_id);
}
