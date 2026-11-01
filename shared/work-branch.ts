import { normalizeTicket } from "./ticket";

export function workBranchName(base: string, featureId: string, taskId: string, subtaskId: string, subtaskName: string): string {
  const slug = subtaskName
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);
  const id = normalizeTicket(subtaskId);
  const leaf = slug ? `${id}-${slug}` : id;
  return `work/${base.trim()}/${normalizeTicket(featureId)}/${normalizeTicket(taskId)}/${leaf}`;
}

export function branchRefPrefixes(branch: string): string[] {
  const parts = branch.split("/").filter(Boolean);
  const prefixes: string[] = [];
  for (let index = 1; index < parts.length; index += 1) {
    prefixes.push(parts.slice(0, index).join("/"));
  }
  return prefixes;
}

export function usesCurrentBranch(source: string, base: string): boolean {
  const current = source.trim();
  const selected = base.trim();
  return Boolean(current) && current !== "detached" && current === selected;
}

export function sortBaseBranches(available: string[], preferred: string[]): string[] {
  const seen = new Set<string>();
  const ordered: string[] = [];
  const add = (name: string) => {
    const branch = name.trim();
    if (!branch || seen.has(branch)) {
      return;
    }
    seen.add(branch);
    ordered.push(branch);
  };
  for (const name of preferred) {
    add(name);
  }
  const rest = available.map((name) => name.trim()).filter(Boolean).sort((left, right) => left.localeCompare(right));
  for (const name of rest) {
    add(name);
  }
  return ordered;
}
