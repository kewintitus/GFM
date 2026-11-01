import { branchNames, ENV_RAIL, type EnvironmentName, type Manifest } from "./manifest";

export interface PlanCommit {
  sha: string;
  featureId: string | null;
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
  target?: string;
  commitsNewestFirst?: PlanCommit[];
  manifest?: Manifest;
  branch?: string;
}): PromotionPlan {
  const warnings: PlanWarning[] = [];
  const id = String(input.featureId ?? "").trim().toUpperCase();
  const empty = { warnings, pending: [] as PlanCommit[], already: [] as PlanCommit[] };

  if (!id) {
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

  const featureCommits = (input.commitsNewestFirst ?? []).filter((commit) => commit.featureId === id);
  const oldestFirst = [...featureCommits].reverse();
  const recorded = target === "DEV" ? [] : manifest.environments[target].features[id]?.commits ?? [];
  const promotedSources = new Set(recorded.map((item) => item.source));
  const pending = oldestFirst.filter((commit) => !promotedSources.has(commit.sha));
  const already = oldestFirst.filter((commit) => promotedSources.has(commit.sha));

  if (featureCommits.length === 0) {
    warnings.push({
      code: "empty",
      message: `${id} has no commits on this branch.`
    });
  }

  return {
    ok: true,
    featureId: id,
    target,
    branch: branchNames(manifest)[target],
    pending,
    already,
    warnings
  };
}
