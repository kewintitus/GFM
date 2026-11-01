export function isUntracked(code: string): boolean {
  return code.startsWith("??");
}

export function isStaged(code: string): boolean {
  const index = code[0] ?? " ";
  return !isUntracked(code) && index !== " " && index !== "?";
}

export function isUnstaged(code: string): boolean {
  const worktree = code[1] ?? " ";
  return !isUntracked(code) && worktree !== " ";
}

export function statusLetter(code: string, side: "staged" | "changes"): string {
  if (isUntracked(code)) {
    return "U";
  }
  const letter = side === "staged" ? code[0] : code[1];
  return (letter ?? "M").trim() || "M";
}
