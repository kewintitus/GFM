export type OperationKind = "cherry-pick" | "merge" | "squash" | "rebase" | "revert";

export interface OperationProbe {
  cherryPick: boolean;
  merge: boolean;
  revert: boolean;
  rebase: boolean;
  conflicted: string[];
  subject?: string;
  remaining?: number;
}

export interface GitOperation {
  kind: OperationKind;
  subject: string;
  remaining: number;
  conflicted: string[];
  canContinue: boolean;
  canSkip: boolean;
  canAbort: boolean;
}

export function classifyOperation(probe: OperationProbe): GitOperation | null {
  const conflicted = probe.conflicted.filter(Boolean);
  const subject = (probe.subject ?? "").trim();
  const remaining = Math.max(0, probe.remaining ?? 0);
  const shared = { subject, remaining, conflicted, canAbort: true };

  if (probe.rebase) {
    return { ...shared, kind: "rebase", canContinue: false, canSkip: false };
  }
  if (probe.revert) {
    return { ...shared, kind: "revert", canContinue: false, canSkip: false };
  }
  if (probe.cherryPick) {
    return { ...shared, kind: "cherry-pick", canContinue: conflicted.length === 0, canSkip: true };
  }
  if (probe.merge) {
    return { ...shared, kind: "merge", canContinue: conflicted.length === 0, canSkip: false };
  }
  if (conflicted.length > 0) {
    return { ...shared, kind: "squash", canContinue: false, canSkip: false };
  }
  return null;
}

export function continueRefusal(operation: GitOperation | null): string | null {
  if (!operation || (operation.kind !== "cherry-pick" && operation.kind !== "merge")) {
    return "Continue is available for a cherry-pick or a merge.";
  }
  if (operation.conflicted.length > 0) {
    return `Resolve and stage the conflicted files first: ${operation.conflicted.join(", ")}.`;
  }
  return null;
}

export function messageRefusal(operation: GitOperation | null): string | null {
  if (!operation || (operation.kind !== "cherry-pick" && operation.kind !== "merge" && operation.kind !== "squash")) {
    return "A new message can finish a cherry-pick, a merge, or a squash.";
  }
  if (operation.conflicted.length > 0) {
    return `Resolve and stage the conflicted files first: ${operation.conflicted.join(", ")}.`;
  }
  return null;
}

export function operationLabel(kind: OperationKind): string {
  if (kind === "cherry-pick") {
    return "Cherry-pick";
  }
  if (kind === "merge") {
    return "Merge";
  }
  if (kind === "squash") {
    return "Squash";
  }
  if (kind === "rebase") {
    return "Rebase";
  }
  return "Revert";
}
