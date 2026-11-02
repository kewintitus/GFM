import { contextBridge, ipcRenderer } from "electron";
import type { Catalog } from "../../shared/catalog";
import type { CommitRequest, FeatureReleaseApi, PlanRequest, PrepareRequest, WorkBranchRequest } from "../../shared/api";
import type { BranchNames } from "../../shared/manifest";

const api: FeatureReleaseApi = {
  getSnapshot: () => ipcRenderer.invoke("app:snapshot"),
  chooseRepo: () => ipcRenderer.invoke("repo:choose"),
  openProject: (repoPath: string) => ipcRenderer.invoke("repo:open", repoPath),
  removeProject: (repoPath: string) => ipcRenderer.invoke("repo:remove", repoPath),
  createManifest: () => ipcRenderer.invoke("manifest:create"),
  installHook: () => ipcRenderer.invoke("hook:install"),
  removeHook: () => ipcRenderer.invoke("hook:remove"),
  stagePaths: (paths: string[]) => ipcRenderer.invoke("stage:paths", paths),
  unstagePaths: (paths: string[]) => ipcRenderer.invoke("unstage:paths", paths),
  createCommit: (input: CommitRequest) => ipcRenderer.invoke("commit:create", input),
  saveCatalog: (catalog: Catalog) => ipcRenderer.invoke("catalog:save", catalog),
  saveEnvironmentBranches: (names: BranchNames) => ipcRenderer.invoke("manifest:branches", names),
  planPromotion: (input: PlanRequest) => ipcRenderer.invoke("promote:plan", input),
  markPromoted: (input: PlanRequest) => ipcRenderer.invoke("promote:mark", input),
  preparePromotion: (input: PrepareRequest) => ipcRenderer.invoke("promote:prepare", input),
  listBranches: () => ipcRenderer.invoke("repo:branches"),
  createWorkBranch: (input: WorkBranchRequest) => ipcRenderer.invoke("branch:create", input)
};

contextBridge.exposeInMainWorld("featureRelease", api);
