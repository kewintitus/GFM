import { branchNames, type EnvironmentName, type Manifest } from "./manifest";
import { isTicket, normalizeTicket } from "./ticket";

export type PrepareMode = "merge" | "cherry-pick";

export const SQUASH_TRAILER = "Prepared: squash";

export const MERGE_TRAILER = "Prepared: merge";

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
  const branch = promoteBranchName(input.baseBranch, id);
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

interface PreparedCommitLine {
  sha: string;
  shortSha?: string;
  subject?: string;
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
