import type { Catalog, CatalogFile } from "./catalog";
import type { CommitDraft } from "./commit-message";
import type { EnvironmentName, Manifest, TargetEnvironment, BranchNames } from "./manifest";
import type { FeatureGroupBase } from "./log";
import type { GitOperation } from "./operation";
import type { PromotionPlan } from "./plan";

export type { PromotionPlan, TargetEnvironment };

export interface ChangeFile {
  path: string;
  code: string;
}

export interface FeatureGroup extends FeatureGroupBase {
  environments: EnvironmentName[];
}

export interface SavedProject {
  name: string;
  path: string;
}

export interface Snapshot {
  ok: true;
  gitAvailable: boolean;
  gitVersion: string;
  gitUser: string;
  repoPath: string | null;
  projects: SavedProject[];
  branch: string;
  hookInstalled: boolean;
  manifest: {
    exists: boolean;
    path: string;
    data: Manifest;
  };
  catalog: CatalogFile;
  changes: ChangeFile[];
  features: FeatureGroup[];
  operation: GitOperation | null;
  error: string;
}

export interface Canceled {
  ok: true;
  canceled: true;
}

export interface IpcFailure {
  ok: false;
  error: string;
}

export interface CommitRequest extends CommitDraft {
  files?: string[];
  push?: boolean;
  noVerify?: boolean;
  completeSubtask?: boolean;
  completeTask?: boolean;
  completeFeature?: boolean;
}

export interface CommitResult {
  ok: boolean;
  error?: string;
  committed?: boolean;
  sha?: string;
  completionSha?: string;
  pushed?: boolean;
  snapshot?: Snapshot;
}

export interface PlanRequest {
  featureId?: string;
  featureIds?: string[];
  taskIds?: string[];
  subtaskIds?: string[];
  target?: EnvironmentName;
}

export interface PrepareRequest {
  featureId?: string;
  featureIds?: string[];
  taskIds?: string[];
  subtaskIds?: string[];
  target?: EnvironmentName;
  mode?: "merge" | "cherry-pick";
  squash?: boolean;
}

export interface WorkBranchRequest {
  base?: string;
  branch?: string;
}

export interface BranchList {
  ok: true;
  branches: string[];
}

export interface FeatureReleaseApi {
  getSnapshot: () => Promise<Snapshot | IpcFailure>;
  chooseRepo: () => Promise<Snapshot | Canceled | IpcFailure>;
  openProject: (repoPath: string) => Promise<Snapshot | IpcFailure>;
  removeProject: (repoPath: string) => Promise<Snapshot | IpcFailure>;
  createManifest: () => Promise<Snapshot | IpcFailure>;
  installHook: () => Promise<Snapshot | Canceled | IpcFailure>;
  removeHook: () => Promise<Snapshot | Canceled | IpcFailure>;
  stagePaths: (paths: string[]) => Promise<Snapshot | IpcFailure>;
  unstagePaths: (paths: string[]) => Promise<Snapshot | IpcFailure>;
  createCommit: (input: CommitRequest) => Promise<CommitResult>;
  saveCatalog: (catalog: Catalog) => Promise<Snapshot | IpcFailure>;
  saveEnvironmentBranches: (names: BranchNames) => Promise<Snapshot | IpcFailure>;
  planPromotion: (input: PlanRequest) => Promise<PromotionPlan | IpcFailure>;
  markPromoted: (input: PlanRequest) => Promise<Snapshot | IpcFailure>;
  preparePromotion: (input: PrepareRequest) => Promise<Snapshot | IpcFailure>;
  continueOperation: () => Promise<Snapshot | IpcFailure>;
  skipOperation: () => Promise<Snapshot | IpcFailure>;
  abortOperation: () => Promise<Snapshot | IpcFailure>;
  commitOperation: (input: CommitRequest) => Promise<Snapshot | IpcFailure>;
  listBranches: () => Promise<BranchList | IpcFailure>;
  createWorkBranch: (input: WorkBranchRequest) => Promise<Snapshot | IpcFailure>;
}
