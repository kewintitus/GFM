import { isTicket, normalizeTicket } from "./ticket";

export interface CommitRecord {
  sha: string;
  shortSha: string;
  author: string;
  date: string;
  subject: string;
  body: string;
  featureId: string | null;
  taskId: string | null;
  subtaskId: string | null;
}

export interface FeatureGroupBase {
  id: string | null;
  label: string;
  commits: CommitRecord[];
  authors: string[];
  latest: CommitRecord | null;
}

export function trailersFromText(text: unknown): { featureId: string | null; taskId: string | null; subtaskId: string | null } {
  const found = { featureId: null as string | null, taskId: null as string | null, subtaskId: null as string | null };
  const trailer = /^(Feature|Task|Subtask|Part):\s*(\S+)\s*$/gim;
  for (const match of String(text ?? "").matchAll(trailer)) {
    const name = (match[1] ?? "").toLowerCase();
    const value = normalizeTicket(match[2]);
    if (!isTicket(value)) {
      continue;
    }
    if (name === "feature" && !found.featureId) {
      found.featureId = value;
    }
    if (name === "task" && !found.taskId) {
      found.taskId = value;
    }
    if ((name === "subtask" || name === "part") && !found.subtaskId) {
      found.subtaskId = value;
    }
  }
  return found;
}

export function parseGitLog(raw: unknown): CommitRecord[] {
  return String(raw ?? "")
    .replace(/\r\n/g, "\n")
    .split("\x1e")
    .map((record) => record.trim())
    .filter(Boolean)
    .flatMap((record) => {
      const [sha = "", shortSha = "", author = "", date = "", subject = "", body = ""] = record.split("\x1f");
      const cleanSha = sha.trim();
      if (!cleanSha) {
        return [];
      }
      const trailers = trailersFromText(`${subject}\n${body}`);
      return [{
        sha: cleanSha,
        shortSha: shortSha.trim(),
        author: author.trim(),
        date: date.trim(),
        subject: subject.trim(),
        body,
        featureId: trailers.featureId,
        taskId: trailers.taskId,
        subtaskId: trailers.subtaskId
      }];
    });
}

export function groupByFeature(commits: CommitRecord[]): FeatureGroupBase[] {
  const groups = new Map<string, CommitRecord[]>();
  for (const commit of commits) {
    const key = commit.featureId ?? "";
    const items = groups.get(key);
    if (items) {
      items.push(commit);
    } else {
      groups.set(key, [commit]);
    }
  }

  return [...groups.entries()].map(([key, items]) => ({
    id: key || null,
    label: key || "Unscoped",
    commits: items,
    authors: [...new Set(items.map((item) => item.author).filter(Boolean))],
    latest: items[0] ?? null
  }));
}
