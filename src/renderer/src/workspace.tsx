import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import type { Canceled, CommitRequest, IpcFailure, PlanRequest, PrepareRequest, PromotionPlan, Snapshot, WorkBranchRequest } from "@shared/api";
import type { Catalog } from "@shared/catalog";
import type { BranchNames } from "@shared/manifest";
import { operationLabel } from "@shared/operation";

export type Role = "contributor" | "release";
export type View = "commit" | "catalog" | "features" | "environments" | "promote" | "conflicts";

interface WorkspaceValue {
  snapshot: Snapshot | null;
  role: Role;
  view: View;
  busy: boolean;
  notice: string;
  error: string;
  setRole: (role: Role) => void;
  setView: (view: View) => void;
  dismissToast: () => void;
  chooseRepo: () => Promise<void>;
  openProject: (repoPath: string) => Promise<void>;
  removeProject: (repoPath: string) => Promise<void>;
  refresh: () => Promise<void>;
  createManifest: () => Promise<void>;
  installHook: () => Promise<void>;
  removeHook: () => Promise<void>;
  stagePaths: (paths: string[]) => Promise<void>;
  unstagePaths: (paths: string[]) => Promise<void>;
  commit: (input: CommitRequest) => Promise<boolean>;
  saveCatalog: (catalog: Catalog, notice?: string) => Promise<boolean>;
  saveEnvironmentBranches: (names: BranchNames) => Promise<boolean>;
  buildPlan: (input: PlanRequest) => Promise<PromotionPlan | null>;
  markPromoted: (input: PlanRequest) => Promise<PromotionPlan | null>;
  preparePromotion: (input: PrepareRequest) => Promise<boolean>;
  continueOperation: () => Promise<void>;
  skipOperation: () => Promise<void>;
  abortOperation: () => Promise<void>;
  commitOperation: (input: CommitRequest) => Promise<boolean>;
  listBranches: () => Promise<string[]>;
  createWorkBranch: (input: WorkBranchRequest) => Promise<string>;
}

const WorkspaceContext = createContext<WorkspaceValue | null>(null);

function isFailure(result: { ok: boolean; error?: string }): result is IpcFailure {
  return result.ok === false;
}

function isSnapshot(result: Snapshot | Canceled | IpcFailure): result is Snapshot {
  return result.ok === true && !("canceled" in result);
}

export function WorkspaceProvider({ children }: { children: ReactNode }) {
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const [role, setRole] = useState<Role>("contributor");
  const [view, setView] = useState<View>("commit");
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");

  const apply = (next: Snapshot, keepError = false) => {
    setSnapshot(next);
    if (!keepError) {
      setError(next.error || "");
    }
  };

  const run = async <T,>(work: () => Promise<T>): Promise<T | undefined> => {
    setBusy(true);
    setNotice("");
    setError("");
    try {
      return await work();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Something went wrong.");
      return undefined;
    } finally {
      setBusy(false);
    }
  };

  useEffect(() => {
    if (!window.featureRelease) {
      setError("The desktop bridge did not load.");
      return;
    }
    void run(async () => {
      const result = await window.featureRelease!.getSnapshot();
      if (isFailure(result)) {
        setError(result.error);
        return;
      }
      apply(result);
    });
  }, []);

  useEffect(() => {
    const onFocus = () => {
      if (!window.featureRelease || busy || !snapshot?.repoPath) {
        return;
      }
      void window.featureRelease.getSnapshot().then((result) => {
        if (isFailure(result)) {
          setError(result.error);
          return;
        }
        apply(result);
      }).catch((caught: unknown) => {
        setError(caught instanceof Error ? caught.message : "Could not refresh.");
      });
    };
    window.addEventListener("focus", onFocus);
    return () => window.removeEventListener("focus", onFocus);
  }, [busy, snapshot?.repoPath]);

  const value = useMemo<WorkspaceValue>(() => ({
    snapshot,
    role,
    view,
    busy,
    notice,
    error,
    setRole,
    setView: (next) => {
      setView(next);
      setNotice("");
    },
    dismissToast: () => {
      setNotice("");
      setError("");
    },
    refresh: () => run(async () => {
      const result = await window.featureRelease!.getSnapshot();
      if (isFailure(result)) {
        setError(result.error);
        return;
      }
      apply(result);
      setNotice(result.repoPath ? "Branch and working tree refreshed." : "Refreshed.");
    }),
    chooseRepo: () => run(async () => {
      const result = await window.featureRelease!.chooseRepo();
      if (!isSnapshot(result)) {
        if ("error" in result) {
          setError(result.error);
        }
        return;
      }
      apply(result);
      setNotice("Repository selected.");
    }),
    openProject: (repoPath) => run(async () => {
      const result = await window.featureRelease!.openProject(repoPath);
      if (isFailure(result)) {
        setError(result.error);
        return;
      }
      apply(result);
      setNotice("Project opened.");
    }),
    removeProject: (repoPath) => run(async () => {
      const result = await window.featureRelease!.removeProject(repoPath);
      if (isFailure(result)) {
        setError(result.error);
        return;
      }
      apply(result);
      setNotice("Project removed from this machine.");
    }),
    createManifest: () => run(async () => {
      const result = await window.featureRelease!.createManifest();
      if (isFailure(result)) {
        setError(result.error);
        return;
      }
      apply(result);
      setNotice("Environment manifest created.");
    }),
    installHook: () => run(async () => {
      const result = await window.featureRelease!.installHook();
      if (!isSnapshot(result)) {
        if ("error" in result) {
          setError(result.error);
        }
        return;
      }
      apply(result);
      setNotice("Commit hook installed.");
    }),
    removeHook: () => run(async () => {
      const result = await window.featureRelease!.removeHook();
      if (!isSnapshot(result)) {
        if ("error" in result) {
          setError(result.error);
        }
        return;
      }
      apply(result);
      setNotice("Commit hook removed.");
    }),
    stagePaths: (paths) => run(async () => {
      const result = await window.featureRelease!.stagePaths(paths);
      if (isFailure(result)) {
        setError(result.error);
        return;
      }
      apply(result);
    }),
    unstagePaths: (paths) => run(async () => {
      const result = await window.featureRelease!.unstagePaths(paths);
      if (isFailure(result)) {
        setError(result.error);
        return;
      }
      apply(result);
    }),
    commit: async (input) => {
      const created = await run(async () => {
        const result = await window.featureRelease!.createCommit(input);
        if (result.snapshot) {
          apply(result.snapshot, !result.ok);
        }
        if (!result.ok) {
          setError(result.error || "Commit failed.");
          return Boolean(result.committed);
        }
        const short = result.sha?.slice(0, 7) ?? "the change";
        const completion = result.completionSha ? ` Completion recorded as ${result.completionSha.slice(0, 7)}.` : "";
        setNotice(result.pushed ? `Committed ${short} and pushed.${completion}` : `Committed ${short}.${completion}`);
        return true;
      });
      return created ?? false;
    },
    saveCatalog: async (catalog, notice) => {
      const saved = await run(async () => {
        const result = await window.featureRelease!.saveCatalog(catalog);
        if (isFailure(result)) {
          setError(result.error);
          return false;
        }
        apply(result);
        setNotice(notice || "Catalog saved in the repository.");
        return true;
      });
      return saved ?? false;
    },
    saveEnvironmentBranches: async (names) => {
      const saved = await run(async () => {
        const result = await window.featureRelease!.saveEnvironmentBranches(names);
        if (isFailure(result)) {
          setError(result.error);
          return false;
        }
        apply(result);
        setNotice("Environment branches saved.");
        return true;
      });
      return saved ?? false;
    },
    buildPlan: async (input) => {
      const plan = await run(async () => {
        const result = await window.featureRelease!.planPromotion(input);
        if (result.ok === false) {
          setError("error" in result ? result.error : "Could not build the plan.");
          return null;
        }
        setNotice(`Plan ready for ${result.featureId} → ${result.target}.`);
        return result;
      });
      return plan ?? null;
    },
    markPromoted: async (input) => {
      const plan = await run(async () => {
        const result = await window.featureRelease!.markPromoted(input);
        if (isFailure(result)) {
          setError(result.error);
          return null;
        }
        apply(result);
        const next = await window.featureRelease!.planPromotion(input);
        if (next.ok === false) {
          setNotice("Marked those commits as promoted.");
          return null;
        }
        setNotice(`Marked those commits as promoted on ${next.target}.`);
        return next;
      });
      return plan ?? null;
    },
    preparePromotion: async (input) => {
      const prepared = await run(async () => {
        const result = await window.featureRelease!.preparePromotion(input);
        if (isFailure(result)) {
          setError(result.error);
          const fresh = await window.featureRelease!.getSnapshot();
          if (isSnapshot(fresh)) {
            apply(fresh, true);
          }
          return false;
        }
        apply(result);
        if (result.operation) {
          setView("conflicts");
          setNotice("A conflict is waiting. Resolve it on Conflicts.");
          return false;
        }
        setNotice(`Prepared ${result.branch}.`);
        return true;
      });
      return prepared ?? false;
    },
    continueOperation: () => run(async () => {
      const result = await window.featureRelease!.continueOperation();
      if (isFailure(result)) {
        setError(result.error);
        return;
      }
      apply(result);
      setNotice(result.operation ? `${operationLabel(result.operation.kind)} is still in progress.` : "The sequence is finished.");
    }),
    skipOperation: () => run(async () => {
      const result = await window.featureRelease!.skipOperation();
      if (isFailure(result)) {
        setError(result.error);
        return;
      }
      apply(result);
      setNotice(result.operation ? `${operationLabel(result.operation.kind)} is still in progress.` : "The sequence is finished.");
    }),
    abortOperation: () => run(async () => {
      const result = await window.featureRelease!.abortOperation();
      if (isFailure(result)) {
        setError(result.error);
        return;
      }
      apply(result);
      setNotice(result.operation ? `${operationLabel(result.operation.kind)} is still in progress.` : "The operation was aborted.");
    }),
    commitOperation: async (input) => {
      const saved = await run(async () => {
        const result = await window.featureRelease!.commitOperation(input);
        if (isFailure(result)) {
          setError(result.error);
          return false;
        }
        apply(result);
        setNotice(result.operation ? `${operationLabel(result.operation.kind)} is still in progress.` : "The sequence is finished.");
        return true;
      });
      return saved ?? false;
    },
    listBranches: async () => {
      const result = await window.featureRelease!.listBranches();
      if (isFailure(result)) {
        setError(result.error);
        return [];
      }
      return result.branches;
    },
    createWorkBranch: async (input) => {
      const failure = await run(async () => {
        const result = await window.featureRelease!.createWorkBranch(input);
        if (isFailure(result)) {
          setError(result.error);
          const fresh = await window.featureRelease!.getSnapshot();
          if (isSnapshot(fresh)) {
            apply(fresh, true);
          }
          return result.error;
        }
        apply(result);
        return "";
      });
      return failure ?? "The branch was not created.";
    }
  }), [snapshot, role, view, busy, notice, error]);

  return <WorkspaceContext.Provider value={value}>{children}</WorkspaceContext.Provider>;
}

export function useWorkspace(): WorkspaceValue {
  const value = useContext(WorkspaceContext);
  if (!value) {
    throw new Error("Workspace is unavailable.");
  }
  return value;
}
