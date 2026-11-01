import type { Catalog, CommitType } from "./catalog";
import { COMMIT_TYPES, findFeature, findTask } from "./catalog";
import { isTicket, normalizeTicket } from "./ticket";

export { COMMIT_TYPES };
export type { CommitType };

export interface CommitDraft {
  type?: string;
  summary?: string;
  featureId?: string;
  taskId?: string;
  subtaskId?: string;
}

export interface PreparedCommit {
  ok: boolean;
  errors: string[];
  message: string;
  featureId?: string;
  taskId?: string | null;
  subtaskId?: string | null;
  subject?: string;
}

export { isTicket, normalizeTicket } from "./ticket";

export function prepareCommit(input: CommitDraft | undefined, catalog?: Catalog): PreparedCommit {
  const type = String(input?.type ?? "").trim();
  const summary = String(input?.summary ?? "").trim().replace(/\s+/g, " ");
  const featureId = normalizeTicket(input?.featureId);
  const taskRaw = String(input?.taskId ?? "").trim();
  const subtaskRaw = String(input?.subtaskId ?? "").trim();
  const taskId = taskRaw ? normalizeTicket(taskRaw) : "";
  const subtaskId = subtaskRaw ? normalizeTicket(subtaskRaw) : "";
  const errors: string[] = [];

  if (!COMMIT_TYPES.includes(type as CommitType)) {
    errors.push("Choose a commit type.");
  }
  if (!summary) {
    errors.push("Write a summary.");
  } else if (summary.length > 72) {
    errors.push("Keep the summary to 72 characters.");
  }
  if (!featureId) {
    errors.push("Choose a feature.");
  } else if (!isTicket(featureId)) {
    errors.push("Feature ticket looks like F-1.");
  }
  if (!taskId) {
    errors.push("Choose a task.");
  } else if (!isTicket(taskId)) {
    errors.push("Task ticket looks like T-1.");
  }
  if (!subtaskId) {
    errors.push("Choose a subtask.");
  } else if (!isTicket(subtaskId)) {
    errors.push("Subtask ticket looks like ST-1.");
  }
  if (taskId && featureId && taskId === featureId) {
    errors.push("Task differs from the feature.");
  }
  if (subtaskId && (subtaskId === featureId || subtaskId === taskId)) {
    errors.push("Subtask differs from the feature and the task.");
  }

  const feature = catalog && featureId ? findFeature(catalog, featureId) : undefined;
  const task = catalog && feature && taskId ? findTask(catalog, featureId, taskId) : undefined;
  if (catalog && featureId && isTicket(featureId) && !feature) {
    errors.push("Choose a feature from the catalog.");
  }
  if (feature && !feature.active) {
    errors.push("That feature is inactive.");
  }
  if (feature && taskId && isTicket(taskId) && !task) {
    errors.push("Choose a task from this feature.");
  }
  if (task && !task.active) {
    errors.push("That task is inactive.");
  }
  if (task?.active && subtaskId && isTicket(subtaskId) && !task.subtasks.some((item) => item.id === subtaskId)) {
    errors.push("Choose a subtask from this task.");
  }
  const subtask = task?.subtasks.find((item) => item.id === subtaskId);
  if (subtask && !subtask.active) {
    errors.push("That subtask is inactive.");
  }
  if (subtask?.status === "completed") {
    errors.push("That subtask is completed.");
  }
  if (task?.commitType && type !== task.commitType) {
    errors.push(`This task only accepts the commit type ${task.commitType}.`);
  }

  if (errors.length > 0) {
    return { ok: false, errors, message: "" };
  }

  const head = `${type}: ${summary}`;
  const lines = [head, "", `Feature: ${featureId}`, `Task: ${taskId}`, `Subtask: ${subtaskId}`];

  return {
    ok: true,
    errors: [],
    message: `${lines.join("\n")}\n`,
    featureId,
    taskId: taskId || null,
    subtaskId: subtaskId || null,
    subject: head
  };
}

export function completionCommitMessage(input: {
  type?: string;
  featureId?: string;
  taskId?: string;
  subtaskId?: string;
  completeSubtask?: boolean;
  completeTask?: boolean;
  completeFeature?: boolean;
}): string {
  const featureId = normalizeTicket(input.featureId);
  const taskId = normalizeTicket(input.taskId);
  const subtaskId = normalizeTicket(input.subtaskId);
  const marked = [
    input.completeSubtask ? subtaskId : "",
    input.completeTask ? taskId : "",
    input.completeFeature ? featureId : ""
  ].filter(Boolean);
  let summary = `complete ${marked.join(", ")}`;
  if (summary.length > 72) {
    summary = "complete the selected work";
  }
  const type = COMMIT_TYPES.includes(input.type as CommitType) ? input.type : "chore";
  return `${type}: ${summary}\n\nFeature: ${featureId}\nTask: ${taskId}\nSubtask: ${subtaskId}\n`;
}
