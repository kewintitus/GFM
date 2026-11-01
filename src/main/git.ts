import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type { ChangeFile } from "../../shared/api";

const execFileAsync = promisify(execFile);

export async function runGit(repoPath: string, args: string[]): Promise<string> {
  try {
    const result = await execFileAsync("git", ["-C", repoPath, ...args], {
      windowsHide: true,
      maxBuffer: 20 * 1024 * 1024,
      encoding: "utf8"
    });
    return result.stdout ?? "";
  } catch (error) {
    const stderr = typeof error === "object" && error !== null && "stderr" in error && typeof error.stderr === "string"
      ? error.stderr.trim()
      : "";
    throw new Error(stderr || (error instanceof Error ? error.message : "Git failed."));
  }
}

export async function gitAvailable(): Promise<{ available: boolean; version: string }> {
  try {
    const result = await execFileAsync("git", ["--version"], {
      windowsHide: true,
      encoding: "utf8"
    });
    return { available: true, version: (result.stdout ?? "").trim() };
  } catch {
    return { available: false, version: "" };
  }
}

export function parsePorcelain(raw: unknown): ChangeFile[] {
  const parts = String(raw ?? "").split("\0");
  const changes: ChangeFile[] = [];
  for (let index = 0; index < parts.length; index += 1) {
    const entry = parts[index];
    if (!entry) {
      continue;
    }
    const code = entry.slice(0, 2);
    let filePath = entry.slice(3);
    if (code[0] === "R" || code[0] === "C") {
      filePath = parts[index + 1] ?? filePath;
      index += 1;
    }
    if (!filePath) {
      continue;
    }
    changes.push({ path: filePath, code });
  }
  return changes;
}
