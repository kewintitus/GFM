import { branchNames, ENV_RAIL, type EnvironmentName, type Manifest } from "./manifest";
import { commitInSelection, type PromotionSelection } from "./promote";
import { normalizeTicket } from "./ticket";

export interface PlanCommit {
  sha: string;
  featureId: string | null;
  taskId?: string | null;
  subtaskId?: string | null;
  subject?: string;
  shortSha?: string;
}

export interface PlanWarning {
  code: string;
  message: string;
}

export type PromotionPlan =
  | {
      ok: true;
      featureId: string;
      target: EnvironmentName;
      branch: string;
      pending: PlanCommit[];
      already: PlanCommit[];
      warnings: PlanWarning[];
    }
  | {
      ok: false;
      error: string;
      warnings: PlanWarning[];
      pending: PlanCommit[];
      already: PlanCommit[];
    };

export function planPromotion(input: {
  featureId?: string;
  featureIds?: string[];
  taskIds?: string[];
  subtaskIds?: string[];
  target?: string;
  commitsNewestFirst?: PlanCommit[];
  manifest?: Manifest;
  branch?: string;
}): PromotionPlan {
  const warnings: PlanWarning[] = [];
  const selection = selectionFrom(input);
  const legacyId = normalizeTicket(input.featureId);
  const id = legacyId || selectionLabel(selection);
  const empty = { warnings, pending: [] as PlanCommit[], already: [] as PlanCommit[] };

  if (selection && selection.featureIds.length + selection.taskIds.length + selection.subtaskIds.length === 0) {
    return { ok: false, error: "Choose a feature, task, or subtask.", ...empty };
  }
  if (!selection && !legacyId) {
    return { ok: false, error: "Choose a feature.", ...empty };
  }
  if (!input.target || !(ENV_RAIL as readonly string[]).includes(input.target)) {
    return { ok: false, error: "Choose DEV, QAS, UAT, or PROD.", ...empty };
  }
  const target = input.target as EnvironmentName;
  if (target !== "DEV" && !input.manifest?.environments?.[target]) {
    return { ok: false, error: "The environment manifest is missing this target.", ...empty };
  }

  const manifest = input.manifest;
  if (!manifest) {
    return { ok: false, error: "The environment manifest is missing this target.", ...empty };
  }
  if (manifest.exists === false) {
    warnings.push({
      code: "manifest",
      message: "No gfm/release/environments.json yet. Promotion history for this repository is empty."
    });
  }
  if (target !== "DEV" && input.branch && manifest.devBranch && input.branch !== manifest.devBranch) {
    warnings.push({
      code: "source-branch",
      message: `These commits are on ${input.branch}. Promotions are taken from ${manifest.devBranch}.`
    });
  }

  const featureCommits = (input.commitsNewestFirst ?? []).filter((commit) => selection
    ? commitInSelection(commit, selection)
    : commit.featureId === id);
  const oldestFirst = [...featureCommits].reverse();
  const pending = oldestFirst.filter((commit) => !isRecorded(manifest, target, commit));
  const already = oldestFirst.filter((commit) => isRecorded(manifest, target, commit));

  if (featureCommits.length === 0) {
    warnings.push({
      code: "empty",
      message: `${id} has no commits on this branch.`
    });
  }

  return {
    ok: true,
    featureId: id || selectionLabel(selection),
    target,
    branch: branchNames(manifest)[target],
    pending,
    already,
    warnings
  };
}

function selectionFrom(input: { featureIds?: string[]; taskIds?: string[]; subtaskIds?: string[] }): PromotionSelection | null {
  if (!input.featureIds && !input.taskIds && !input.subtaskIds) {
    return null;
  }
  return {
    featureIds: (input.featureIds ?? []).map((item) => normalizeTicket(item)).filter(Boolean),
    taskIds: (input.taskIds ?? []).map((item) => normalizeTicket(item)).filter(Boolean),
    subtaskIds: (input.subtaskIds ?? []).map((item) => normalizeTicket(item)).filter(Boolean)
  };
}

function selectionLabel(selection: PromotionSelection | null): string {
  return selection?.featureIds[0] || selection?.taskIds[0] || selection?.subtaskIds[0] || legacyFallback();
}

function legacyFallback(): string {
  return "selection";
}

function isRecorded(manifest: Manifest, target: EnvironmentName, commit: PlanCommit): boolean {
  const id = normalizeTicket(commit.featureId);
  const recorded = manifest.environments[target]?.features[id]?.commits ?? [];
  return recorded.some((item) => item.source === commit.sha);
}
