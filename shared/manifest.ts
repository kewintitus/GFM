import { normalizeTicket } from "./ticket";

export const MANIFEST_PATH = "gfm/release/environments.json";
export const LEGACY_MANIFEST_PATH = "release/environments.json";

export const TARGET_ENVIRONMENTS = ["QAS", "UAT", "PROD"] as const;

export const ENV_RAIL = ["DEV", "QAS", "UAT", "PROD"] as const;

export type TargetEnvironment = (typeof TARGET_ENVIRONMENTS)[number];

export type EnvironmentName = (typeof ENV_RAIL)[number];

export interface PromotedCommit {
  source: string;
  promoted: string;
}

export interface EnvironmentRecord {
  branch: string;
  features: Record<string, { commits: PromotedCommit[] }>;
}

export interface Manifest {
  devBranch: string;
  environments: Record<EnvironmentName, EnvironmentRecord>;
  prepared: Partial<Record<EnvironmentName, Record<string, PreparedPromotion>>>;
  exists?: boolean;
}

export interface PreparedPromotion {
  branch: string;
  sourceBranch: string;
  mode: "merge" | "cherry-pick";
  squash: boolean;
  baseSha: string;
}

export function defaultManifest(): Manifest {
  return {
    devBranch: "dev",
    environments: {
      DEV: { branch: "dev", features: {} },
      QAS: { branch: "qas", features: {} },
      UAT: { branch: "uat", features: {} },
      PROD: { branch: "main", features: {} }
    },
    prepared: {}
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function isTargetEnvironment(value: string): value is TargetEnvironment {
  return (TARGET_ENVIRONMENTS as readonly string[]).includes(value);
}

export function parseManifest(text: string): Manifest {
  const data: unknown = JSON.parse(text);
  const base = defaultManifest();
  const root = isRecord(data) ? data : {};
  const incomingEnvironments = isRecord(root.environments) ? root.environments : {};
  const incomingDev = isRecord(incomingEnvironments.DEV) ? incomingEnvironments.DEV : {};
  const devFromRecord = typeof incomingDev.branch === "string" ? incomingDev.branch.trim() : "";
  const devBranch = typeof root.devBranch === "string" && root.devBranch.trim()
    ? root.devBranch.trim()
    : devFromRecord || base.devBranch;
  const environments = {} as Record<EnvironmentName, EnvironmentRecord>;
  environments.DEV = {
    branch: devBranch,
    features: readFeatures(incomingDev.features)
  };

  for (const name of TARGET_ENVIRONMENTS) {
    const incoming = isRecord(incomingEnvironments[name]) ? incomingEnvironments[name] : {};
    const branch = typeof incoming.branch === "string" && incoming.branch.trim()
      ? incoming.branch.trim()
      : base.environments[name].branch;
    environments[name] = { branch, features: readFeatures(incoming.features) };
  }

  return { devBranch, environments, prepared: readPrepared(root.prepared) };
}

function readFeatures(value: unknown): EnvironmentRecord["features"] {
  const features: EnvironmentRecord["features"] = {};
  const rawFeatures = isRecord(value) ? value : {};
  for (const [featureId, record] of Object.entries(rawFeatures)) {
    const commits = isRecord(record) && Array.isArray(record.commits) ? record.commits : [];
    features[featureId.toUpperCase()] = {
      commits: commits.flatMap((item) => {
        if (!isRecord(item) || typeof item.source !== "string") {
          return [];
        }
        return [{
          source: item.source,
          promoted: typeof item.promoted === "string" ? item.promoted : ""
        }];
      })
    };
  }
  return features;
}

const BRANCH_NAME = /^(?!.*(?:\.\.|@\{|\/\/))(?!.*\.lock$)[A-Za-z0-9][A-Za-z0-9._/-]*[A-Za-z0-9]$|^[A-Za-z0-9]$/;

export interface BranchNames {
  DEV: string;
  QAS: string;
  UAT: string;
  PROD: string;
}

export function branchNames(manifest: Manifest): BranchNames {
  return {
    DEV: manifest.devBranch,
    QAS: manifest.environments.QAS.branch,
    UAT: manifest.environments.UAT.branch,
    PROD: manifest.environments.PROD.branch
  };
}

export function isBranchName(value: string): boolean {
  return BRANCH_NAME.test(value) && !value.endsWith("/") && !value.endsWith(".");
}

export function withBranchNames(
  manifest: Manifest,
  names: BranchNames
): { ok: true; manifest: Manifest } | { ok: false; error: string } {
  const next: BranchNames = {
    DEV: names.DEV.trim(),
    QAS: names.QAS.trim(),
    UAT: names.UAT.trim(),
    PROD: names.PROD.trim()
  };
  for (const name of ENV_RAIL) {
    if (!isBranchName(next[name])) {
      return { ok: false, error: `${name} needs a branch name like dev or release/1.2.` };
    }
  }
  const used = new Map<string, EnvironmentName>();
  for (const name of ENV_RAIL) {
    const previous = used.get(next[name]);
    if (previous) {
      return { ok: false, error: `${next[name]} is already the ${previous} branch.` };
    }
    used.set(next[name], name);
  }
  return {
    ok: true,
    manifest: {
      devBranch: next.DEV,
      environments: {
        DEV: { ...manifest.environments.DEV, branch: next.DEV },
        QAS: { ...manifest.environments.QAS, branch: next.QAS },
        UAT: { ...manifest.environments.UAT, branch: next.UAT },
        PROD: { ...manifest.environments.PROD, branch: next.PROD }
      },
      prepared: manifest.prepared
    }
  };
}

export type EnvPresence = "on" | "partial" | "off";

export function environmentPresence(
  shas: string[],
  recorded: Partial<Record<EnvironmentName, string[]>>
): { on: EnvironmentName[]; partial: EnvironmentName[] } {
  const on: EnvironmentName[] = [];
  const partial: EnvironmentName[] = [];
  for (const name of ENV_RAIL) {
    const sources = new Set(recorded[name] ?? []);
    const hits = shas.filter((sha) => sources.has(sha)).length;
    if (shas.length > 0 && hits === shas.length) {
      on.push(name);
    } else if (hits > 0) {
      partial.push(name);
    }
  }
  return { on, partial };
}

export function environmentsForFeature(
  featureId: string | null,
  manifest: Manifest | null | undefined
): EnvironmentName[] {
  if (!featureId || !manifest) {
    return [];
  }
  const names: EnvironmentName[] = [];
  for (const name of ENV_RAIL) {
    if (manifest.environments[name]?.features?.[featureId]) {
      names.push(name);
    }
  }
  return names;
}

export function recordPromotion(
  manifest: Manifest,
  target: EnvironmentName,
  commits: { featureId: string | null; sha: string }[]
): Manifest {
  const current = manifest.environments[target];
  const features = { ...current.features };
  for (const commit of commits) {
    const id = normalizeTicket(commit.featureId);
    const sha = commit.sha.trim();
    if (!id || !sha) {
      continue;
    }
    const existing = features[id]?.commits ?? [];
    if (existing.some((item) => item.source === sha)) {
      continue;
    }
    features[id] = { commits: [...existing, { source: sha, promoted: "" }] };
  }
  return {
    ...manifest,
    environments: {
      ...manifest.environments,
      [target]: { ...current, features }
    }
  };
}

export function recordPrepared(
  manifest: Manifest,
  target: EnvironmentName,
  featureId: string,
  prepared: PreparedPromotion
): Manifest {
  const id = featureId.trim().toUpperCase();
  return {
    ...manifest,
    environments: manifest.environments,
    prepared: {
      ...manifest.prepared,
      [target]: {
        ...manifest.prepared[target],
        [id]: prepared
      }
    }
  };
}

function readPrepared(value: unknown): Manifest["prepared"] {
  if (!isRecord(value)) {
    return {};
  }
  const prepared: Manifest["prepared"] = {};
  for (const name of ENV_RAIL) {
    const bucket = value[name];
    if (!isRecord(bucket)) {
      continue;
    }
    const features: Record<string, PreparedPromotion> = {};
    for (const [featureId, record] of Object.entries(bucket)) {
      if (!isRecord(record) || typeof record.branch !== "string" || typeof record.sourceBranch !== "string" || typeof record.baseSha !== "string") {
        continue;
      }
      if (record.mode !== "merge" && record.mode !== "cherry-pick") {
        continue;
      }
      features[featureId.toUpperCase()] = {
        branch: record.branch,
        sourceBranch: record.sourceBranch,
        mode: record.mode,
        squash: record.squash === true,
        baseSha: record.baseSha
      };
    }
    if (Object.keys(features).length > 0) {
      prepared[name] = features;
    }
  }
  return prepared;
}
