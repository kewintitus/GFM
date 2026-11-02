import { branchNames, type EnvironmentName, type Manifest } from "./manifest";
import { isTicket, normalizeTicket } from "./ticket";

export type PrepareMode = "merge" | "cherry-pick";

export const SQUASH_TRAILER = "Prepared: squash";

export const MERGE_TRAILER = "Prepared: merge";

export const PROMOTED_TRAILER = "Prepared: promoted";

export function previousEnvironment(target: EnvironmentName): EnvironmentName | null {
  if (target === "QAS") {
    return "DEV";
  }
  if (target === "UAT") {
    return "QAS";
  }
  if (target === "PROD") {
    return "UAT";
  }
  return null;
}

export function promoteBranchName(baseBranch: string, featureId: string): string {
  return `promote/${baseBranch}/${normalizeTicket(featureId)}`;
}

export interface PromotionSelection {
  featureIds: string[];
  taskIds: string[];
  subtaskIds: string[];
}

export interface PromotionNode {
  id: string;
  tasks: { id: string; subtaskIds: string[] }[];
}

export interface ScopedCommit {
  sha: string;
  featureId: string | null;
  taskId?: string | null;
  subtaskId?: string | null;
}

export function promotionNodes(
  features: { id: string; tasks: { id: string; subtasks: { id: string }[] }[] }[],
  commits: { featureId: string | null; taskId?: string | null; subtaskId?: string | null }[]
): PromotionNode[] {
  const featureIds = [...new Set(commits.map((commit) => normalizeTicket(commit.featureId)).filter(Boolean))];
  return featureIds.map((featureId) => {
    const feature = features.find((item) => item.id === featureId);
    const taskIds = [...new Set(commits.filter((commit) => normalizeTicket(commit.featureId) === featureId).map((commit) => normalizeTicket(commit.taskId)).filter(Boolean))];
    return {
      id: featureId,
      tasks: taskIds.map((taskId) => {
        const task = feature?.tasks.find((item) => item.id === taskId);
        const seen = new Set(commits
          .filter((commit) => normalizeTicket(commit.taskId) === taskId)
          .map((commit) => normalizeTicket(commit.subtaskId))
          .filter(Boolean));
        const subtaskIds = (task?.subtasks.map((item) => item.id) ?? []).filter((id) => seen.has(id));
        for (const id of seen) {
          if (!subtaskIds.includes(id)) {
            subtaskIds.push(id);
          }
        }
        return { id: taskId, subtaskIds };
      })
    };
  });
}

export function toggleFeature(nodes: PromotionNode[], selection: PromotionSelection, featureId: string): PromotionSelection {
  const id = normalizeTicket(featureId);
  const feature = nodes.find((node) => node.id === id);
  const next = cloneSelection(selection);
  if (next.featureIds.includes(id)) {
    next.featureIds = next.featureIds.filter((item) => item !== id);
    for (const task of feature?.tasks ?? []) {
      next.taskIds = next.taskIds.filter((item) => item !== task.id);
      next.subtaskIds = next.subtaskIds.filter((item) => !task.subtaskIds.includes(item));
    }
    return next;
  }
  next.featureIds = uniq([...next.featureIds, id]);
  for (const task of feature?.tasks ?? []) {
    next.taskIds = uniq([...next.taskIds, task.id]);
    next.subtaskIds = uniq([...next.subtaskIds, ...task.subtaskIds]);
  }
  return next;
}

export function toggleTask(nodes: PromotionNode[], selection: PromotionSelection, taskId: string): PromotionSelection {
  const id = normalizeTicket(taskId);
  const parent = taskParent(nodes, id);
  const next = cloneSelection(selection);
  if (!parent) {
    return next;
  }
  if (next.taskIds.includes(id)) {
    next.taskIds = next.taskIds.filter((item) => item !== id);
    next.subtaskIds = next.subtaskIds.filter((item) => !parent.task.subtaskIds.includes(item));
    next.featureIds = next.featureIds.filter((item) => item !== parent.feature.id);
    return next;
  }
  next.taskIds = uniq([...next.taskIds, id]);
  next.subtaskIds = uniq([...next.subtaskIds, ...parent.task.subtaskIds]);
  if (featureIsComplete(parent.feature, next)) {
    next.featureIds = uniq([...next.featureIds, parent.feature.id]);
  }
  return next;
}

export function toggleSubtask(nodes: PromotionNode[], selection: PromotionSelection, subtaskId: string): PromotionSelection {
  const id = normalizeTicket(subtaskId);
  const parent = subtaskParent(nodes, id);
  const next = cloneSelection(selection);
  if (!parent) {
    return next;
  }
  if (next.subtaskIds.includes(id)) {
    next.subtaskIds = next.subtaskIds.filter((item) => item !== id);
    next.taskIds = next.taskIds.filter((item) => item !== parent.task.id);
    next.featureIds = next.featureIds.filter((item) => item !== parent.feature.id);
    return next;
  }
  next.subtaskIds = uniq([...next.subtaskIds, id]);
  if (parent.task.subtaskIds.every((item) => next.subtaskIds.includes(item))) {
    next.taskIds = uniq([...next.taskIds, parent.task.id]);
  }
  if (featureIsComplete(parent.feature, next)) {
    next.featureIds = uniq([...next.featureIds, parent.feature.id]);
  }
  return next;
}

export function commitInSelection(commit: { featureId: string | null; taskId?: string | null; subtaskId?: string | null }, selection: PromotionSelection): boolean {
  const featureId = normalizeTicket(commit.featureId);
  const taskId = normalizeTicket(commit.taskId);
  const subtaskId = normalizeTicket(commit.subtaskId);
  if (subtaskId && selection.subtaskIds.includes(subtaskId)) {
    return true;
  }
  if (taskId && !subtaskId && selection.taskIds.includes(taskId)) {
    return true;
  }
  return Boolean(featureId && !taskId && selection.featureIds.includes(featureId));
}

export function wholeFeatureSelection(nodes: PromotionNode[], selection: PromotionSelection): string | null {
  if (selection.featureIds.length !== 1) {
    return null;
  }
  const feature = nodes.find((node) => node.id === selection.featureIds[0]);
  if (!feature || !featureIsComplete(feature, selection)) {
    return null;
  }
  const taskCount = feature.tasks.length;
  const subtaskCount = feature.tasks.reduce((sum, task) => sum + task.subtaskIds.length, 0);
  if (selection.taskIds.length !== taskCount || selection.subtaskIds.length !== subtaskCount) {
    return null;
  }
  return feature.id;
}

export function selectionBranchName(baseBranch: string, nodes: PromotionNode[], selection: PromotionSelection): string {
  const whole = wholeFeatureSelection(nodes, selection);
  if (whole) {
    return promoteBranchName(baseBranch, whole);
  }
  if (selection.featureIds.length === 0 && selection.taskIds.length === 1) {
    const parent = taskParent(nodes, selection.taskIds[0] ?? "");
    const sameSubtasks = parent
      && parent.task.subtaskIds.length === selection.subtaskIds.length
      && parent.task.subtaskIds.every((id) => selection.subtaskIds.includes(id));
    if (parent && sameSubtasks) {
      return `${promoteBranchName(baseBranch, parent.feature.id)}/${parent.task.id}`;
    }
  }
  if (selection.featureIds.length === 0 && selection.taskIds.length === 0 && selection.subtaskIds.length === 1) {
    const parent = subtaskParent(nodes, selection.subtaskIds[0] ?? "");
    if (parent) {
      return `${promoteBranchName(baseBranch, parent.feature.id)}/${selection.subtaskIds[0]}`;
    }
  }
  const owners = new Set<string>();
  for (const id of selection.featureIds) {
    owners.add(id);
  }
  for (const id of selection.taskIds) {
    const parent = taskParent(nodes, id);
    if (parent) {
      owners.add(parent.feature.id);
    }
  }
  for (const id of selection.subtaskIds) {
    const parent = subtaskParent(nodes, id);
    if (parent) {
      owners.add(parent.feature.id);
    }
  }
  if (owners.size === 1) {
    return `${promoteBranchName(baseBranch, [...owners][0] ?? "")}/partial`;
  }
  return `promote/${baseBranch}/partial`;
}

function featureIsComplete(feature: PromotionNode, selection: PromotionSelection): boolean {
  return feature.tasks.every((task) => selection.taskIds.includes(task.id) && task.subtaskIds.every((id) => selection.subtaskIds.includes(id)));
}

function taskParent(nodes: PromotionNode[], taskId: string): { feature: PromotionNode; task: { id: string; subtaskIds: string[] } } | undefined {
  const id = normalizeTicket(taskId);
  for (const feature of nodes) {
    const task = feature.tasks.find((item) => item.id === id);
    if (task) {
      return { feature, task };
    }
  }
  return undefined;
}

function subtaskParent(nodes: PromotionNode[], subtaskId: string): { feature: PromotionNode; task: { id: string; subtaskIds: string[] } } | undefined {
  const id = normalizeTicket(subtaskId);
  for (const feature of nodes) {
    for (const task of feature.tasks) {
      if (task.subtaskIds.includes(id)) {
        return { feature, task };
      }
    }
  }
  return undefined;
}

function cloneSelection(selection: PromotionSelection): PromotionSelection {
  return {
    featureIds: [...selection.featureIds],
    taskIds: [...selection.taskIds],
    subtaskIds: [...selection.subtaskIds]
  };
}

function uniq(ids: string[]): string[] {
  return [...new Set(ids.map((id) => normalizeTicket(id)).filter(Boolean))];
}

export function defaultPrepareMode(target: EnvironmentName): PrepareMode {
  return target === "DEV" ? "merge" : "cherry-pick";
}

export function commitsForFeature(
  commitsOldestFirst: { sha: string; featureId: string | null }[],
  featureId: string,
  recordedSources: string[]
): string[] {
  const id = normalizeTicket(featureId);
  const recorded = new Set(recordedSources);
  return commitsOldestFirst.filter((commit) => commit.featureId === id && !recorded.has(commit.sha)).map((commit) => commit.sha);
}

export interface PrepareGuardInput {
  dirty: boolean;
  featureId: string;
  target: EnvironmentName;
  mode: PrepareMode;
  sourceBranch: string;
  baseBranch: string;
  baseExistsLocally: boolean;
  baseExistsOnOrigin: boolean;
  canFastForward: boolean;
  promoteBranchExists: boolean;
  pendingCount: number;
  branchName?: string;
}

export function guardPreparation(input: PrepareGuardInput): { ok: true; branch: string } | { ok: false; error: string } {
  const id = normalizeTicket(input.featureId);
  if (!isTicket(id)) {
    return { ok: false, error: "Choose a feature." };
  }
  if (!input.sourceBranch || input.sourceBranch === "detached") {
    return { ok: false, error: "Check out a branch before preparing a promotion." };
  }
  if (input.dirty) {
    return { ok: false, error: "Commit or remove local changes before preparing a promotion." };
  }
  if (input.target === "DEV" && input.sourceBranch === input.baseBranch) {
    return { ok: false, error: `Start from the work branch. ${input.baseBranch} cannot be promoted onto itself.` };
  }
  if (input.mode === "merge" && input.target !== "DEV") {
    return { ok: false, error: "Cherry-pick this feature onto QAS, UAT, and PROD. Merging would bring every other feature." };
  }
  if (!input.baseExistsLocally) {
    return { ok: false, error: `${input.baseBranch} is not a local branch.` };
  }
  if (!input.baseExistsOnOrigin) {
    return { ok: false, error: `origin/${input.baseBranch} is missing.` };
  }
  if (!input.canFastForward) {
    return { ok: false, error: `${input.baseBranch} has diverged from origin/${input.baseBranch}.` };
  }
  const branch = input.branchName || promoteBranchName(input.baseBranch, id);
  if (input.mode === "merge" && branch !== promoteBranchName(input.baseBranch, id)) {
    return { ok: false, error: "Cherry-pick a partial selection. Merging would bring every other commit." };
  }
  if (input.promoteBranchExists) {
    return { ok: false, error: `${branch} already exists.` };
  }
  if (input.pendingCount === 0) {
    return {
      ok: false,
      error: input.mode === "merge" ? `${id} has no commits on ${input.sourceBranch}.` : `Nothing new to move for ${id}.`
    };
  }
  return { ok: true, branch };
}

export function baseBranch(manifest: Manifest, target: EnvironmentName): string {
  return branchNames(manifest)[target];
}

export function squashCommitMessage(featureId: string, commits: PreparedCommitLine[]): string {
  return preparedCommitMessage("squash", featureId, SQUASH_TRAILER, commits);
}

export function mergeCommitMessage(featureId: string, commits: PreparedCommitLine[]): string {
  return preparedCommitMessage("merge", featureId, MERGE_TRAILER, commits);
}

export function promotionRecordMessage(
  target: string,
  commits: PreparedCommitLine[]
): string {
  const lines = [`chore: record promotion on ${target}`, "", PROMOTED_TRAILER];
  const groups = new Map<string, PreparedCommitLine[]>();
  for (const commit of commits) {
    const id = normalizeTicket(commit.featureId) || "unscoped";
    const list = groups.get(id) ?? [];
    list.push(commit);
    groups.set(id, list);
  }
  for (const [id, list] of groups) {
    if (id !== "unscoped") {
      lines.push(`Feature: ${id}`);
    }
    for (const commit of list) {
      const short = commit.shortSha || commit.sha.slice(0, 7);
      lines.push(`- ${short} ${commit.subject || "Untitled commit"}`.trim());
    }
  }
  return `${lines.join("\n")}\n`;
}

interface PreparedCommitLine {
  sha: string;
  shortSha?: string;
  subject?: string;
  featureId?: string | null;
  taskId?: string | null;
  subtaskId?: string | null;
}

function preparedCommitMessage(kind: "squash" | "merge", featureId: string, trailer: string, commits: PreparedCommitLine[]): string {
  const id = normalizeTicket(featureId);
  const lines = [`${kind}: ${id}`, "", `Feature: ${id}`, trailer, "", "Included commits:"];
  for (const commit of commits) {
    const short = commit.shortSha || commit.sha.slice(0, 7);
    const task = commit.taskId ? ` ${commit.taskId}` : "";
    const subtask = commit.subtaskId ? ` ${commit.subtaskId}` : "";
    lines.push(`- ${short}${task}${subtask} ${commit.subject || "Untitled commit"}`);
  }
  return `${lines.join("\n")}\n`;
}
