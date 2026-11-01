import { existsSync } from "node:fs";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { app, dialog, type BrowserWindow } from "electron";
import type { CommitRequest, CommitResult, PlanRequest, PrepareRequest, Snapshot } from "../../shared/api";
import { CATALOG_PATH, LEGACY_CATALOG_PATH, canCompleteFeature, canCompleteTask, emptyCatalog, findFeature, findTask, parseCatalog, serializeCatalog, setFeatureStatus, setSubtaskStatus, setTaskStatus, type Catalog } from "../../shared/catalog";
import { completionCommitMessage, prepareCommit } from "../../shared/commit-message";
import { groupByFeature, parseGitLog } from "../../shared/log";
import {
  MANIFEST_PATH,
  LEGACY_MANIFEST_PATH,
  defaultManifest,
  environmentsForFeature,
  parseManifest,
  recordPrepared,
  withBranchNames,
  branchNames,
  ENV_RAIL,
  type BranchNames,
  type Manifest
} from "../../shared/manifest";
import { planPromotion, type PromotionPlan } from "../../shared/plan";
import {
  baseBranch,
  commitsForFeature,
  defaultPrepareMode,
  guardPreparation,
  previousEnvironment,
  promoteBranchName,
  mergeCommitMessage,
  squashCommitMessage
} from "../../shared/promote";
import { normalizeTicket } from "../../shared/ticket";
import { branchRefPrefixes, sortBaseBranches, usesCurrentBranch } from "../../shared/work-branch";
import { gitAvailable, parsePorcelain, runGit } from "./git";
import { isStaged } from "../../shared/status";

const HOOK_MARKER = "feature-release-hook";

function settingsFile(): string {
  return path.join(app.getPath("userData"), "settings.json");
}

async function loadSettings(): Promise<{ repoPath?: string }> {
  try {
    const parsed: unknown = JSON.parse(await fs.readFile(settingsFile(), "utf8"));
    if (typeof parsed === "object" && parsed !== null && "repoPath" in parsed && typeof parsed.repoPath === "string") {
      return { repoPath: parsed.repoPath };
    }
    return {};
  } catch {
    return {};
  }
}

async function saveSettings(settings: { repoPath: string }): Promise<void> {
  await fs.mkdir(path.dirname(settingsFile()), { recursive: true });
  await fs.writeFile(settingsFile(), `${JSON.stringify(settings, null, 2)}\n`);
}

function isEnoent(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT";
}

async function resolveRepo(startPath: string): Promise<string> {
  try {
    const top = (await runGit(startPath, ["rev-parse", "--show-toplevel"])).trim();
    if (!top) {
      throw new Error("That folder is not a git repository.");
    }
    return top;
  } catch (error) {
    if (error instanceof Error && /not a git repository/i.test(error.message)) {
      throw new Error("That folder is not a git repository.");
    }
    throw error;
  }
}

async function hookFile(repoPath: string): Promise<string> {
  const relative = (await runGit(repoPath, ["rev-parse", "--git-path", "hooks/commit-msg"])).trim();
  return path.resolve(repoPath, relative);
}

function hookSourcePath(): string {
  const candidates = [
    path.join(app.getAppPath(), "hooks", "commit-msg"),
    path.join(process.cwd(), "hooks", "commit-msg"),
    path.join(app.getAppPath(), "hooks", "commit-msg.disabled"),
    path.join(process.cwd(), "hooks", "commit-msg.disabled")
  ];
  const found = candidates.find((candidate) => existsSync(candidate));
  if (!found) {
    throw new Error("The commit hook script is missing from the app.");
  }
  return found;
}

async function readHookInstalled(repoPath: string): Promise<boolean> {
  try {
    const text = await fs.readFile(await hookFile(repoPath), "utf8");
    return text.includes(HOOK_MARKER);
  } catch {
    return false;
  }
}

async function readRepoFile(repoPath: string, primary: string, legacy: string): Promise<{ path: string; text: string } | null> {
  for (const filePath of [primary, legacy]) {
    try {
      const text = await fs.readFile(path.join(repoPath, ...filePath.split("/")), "utf8");
      return { path: filePath, text };
    } catch (error) {
      if (!isEnoent(error)) {
        throw error;
      }
    }
  }
  return null;
}

async function readManifest(repoPath: string): Promise<Snapshot["manifest"]> {
  const found = await readRepoFile(repoPath, MANIFEST_PATH, LEGACY_MANIFEST_PATH);
  if (!found) {
    return { exists: false, path: MANIFEST_PATH, data: defaultManifest() };
  }
  return { exists: true, path: found.path, data: parseManifest(found.text) };
}

async function readGitUser(repoPath: string): Promise<string> {
  try {
    return (await runGit(repoPath, ["config", "--get", "user.name"])).trim();
  } catch {
    return "";
  }
}

async function readCatalog(repoPath: string): Promise<Snapshot["catalog"]> {
  try {
    const found = await readRepoFile(repoPath, CATALOG_PATH, LEGACY_CATALOG_PATH);
    if (!found) {
      return { exists: false, path: CATALOG_PATH, data: emptyCatalog(), error: "" };
    }
    return { exists: true, path: found.path, data: parseCatalog(found.text), error: "" };
  } catch (error) {
    const message = error instanceof Error ? error.message : "gfm/release/catalog.json could not be read.";
    return { exists: true, path: CATALOG_PATH, data: emptyCatalog(), error: message };
  }
}

function assertSafePath(filePath: string): void {
  if (!filePath || path.win32.isAbsolute(filePath) || path.posix.isAbsolute(filePath)) {
    throw new Error("Choose files from the working tree list.");
  }
  if (filePath.split(/[\\/]/).includes("..")) {
    throw new Error("Choose files from the working tree list.");
  }
}

function emptySnapshot(git: { available: boolean; version: string }, error = ""): Snapshot {
  return {
    ok: true,
    gitAvailable: git.available,
    gitVersion: git.version,
    gitUser: "",
    repoPath: null,
    branch: "",
    hookInstalled: false,
    manifest: { exists: false, path: MANIFEST_PATH, data: defaultManifest() },
    catalog: { exists: false, path: CATALOG_PATH, data: emptyCatalog(), error: "" },
    changes: [],
    features: [],
    error: error || (git.available ? "" : "Git is not available on PATH.")
  };
}

export async function snapshot(): Promise<Snapshot> {
  const git = await gitAvailable();
  const settings = await loadSettings();
  if (!git.available || !settings.repoPath) {
    return emptySnapshot(git);
  }

  try {
    const repoPath = await resolveRepo(settings.repoPath);
    const branch = (await runGit(repoPath, ["branch", "--show-current"])).trim() || "detached";
    const gitUser = await readGitUser(repoPath);
    const manifest = await readManifest(repoPath);
    const catalog = await readCatalog(repoPath);
    const changes = parsePorcelain(await runGit(repoPath, ["status", "--porcelain=v1", "-z"]));
    let commits = [] as ReturnType<typeof parseGitLog>;
    try {
      const log = await runGit(repoPath, [
        "log",
        "-n",
        "300",
        "--pretty=format:%H%x1f%h%x1f%an%x1f%aI%x1f%s%x1f%b%x1e"
      ]);
      commits = parseGitLog(log);
    } catch (error) {
      if (!(error instanceof Error) || !/does not have any commits/i.test(error.message)) {
        throw error;
      }
    }

    const features = groupByFeature(commits).map((group) => ({
      ...group,
      environments: environmentsForFeature(group.id, manifest.data, branch)
    }));

    return {
      ...emptySnapshot(git),
      repoPath,
      branch,
      gitUser,
      hookInstalled: await readHookInstalled(repoPath),
      manifest,
      catalog,
      changes,
      features,
      error: ""
    };
  } catch (error) {
    return emptySnapshot(git, error instanceof Error ? error.message : "Could not read the repository.");
  }
}

export async function chooseRepo(parent?: BrowserWindow): Promise<Snapshot | { ok: true; canceled: true }> {
  const options = {
    title: "Choose the git repository",
    properties: ["openDirectory"] as "openDirectory"[]
  };
  const picked = parent
    ? await dialog.showOpenDialog(parent, options)
    : await dialog.showOpenDialog(options);
  if (picked.canceled || !picked.filePaths[0]) {
    return { ok: true, canceled: true };
  }
  const repoPath = await resolveRepo(picked.filePaths[0]);
  await saveSettings({ repoPath });
  return snapshot();
}

export async function createManifest(): Promise<Snapshot> {
  const current = await snapshot();
  if (!current.repoPath) {
    throw new Error("Choose a repository first.");
  }
  if (current.manifest.exists) {
    throw new Error("The environment manifest already exists.");
  }
  const fullPath = path.join(current.repoPath, ...MANIFEST_PATH.split("/"));
  await fs.mkdir(path.dirname(fullPath), { recursive: true });
  await fs.writeFile(fullPath, `${JSON.stringify(defaultManifest(), null, 2)}\n`);
  await runGit(current.repoPath, ["add", "--", MANIFEST_PATH]);
  return snapshot();
}

export async function saveEnvironmentBranches(names: BranchNames): Promise<Snapshot> {
  const current = await snapshot();
  if (!current.repoPath) {
    throw new Error("Choose a repository first.");
  }
  const updated = withBranchNames(current.manifest.data, names);
  if (!updated.ok) {
    throw new Error(updated.error);
  }
  const fullPath = path.join(current.repoPath, ...MANIFEST_PATH.split("/"));
  await fs.mkdir(path.dirname(fullPath), { recursive: true });
  await fs.writeFile(fullPath, `${JSON.stringify(updated.manifest, null, 2)}\n`);
  await runGit(current.repoPath, ["add", "--", MANIFEST_PATH]);
  return snapshot();
}

export async function saveCatalog(catalog: Catalog): Promise<Snapshot> {
  const current = await snapshot();
  if (!current.repoPath) {
    throw new Error("Choose a repository first.");
  }
  const validated = parseCatalog(JSON.stringify(catalog));
  const fullPath = path.join(current.repoPath, ...CATALOG_PATH.split("/"));
  await fs.mkdir(path.dirname(fullPath), { recursive: true });
  await fs.writeFile(fullPath, serializeCatalog(validated));
  await runGit(current.repoPath, ["add", "--", CATALOG_PATH]);
  return snapshot();
}

export async function setStaged(paths: string[], staged: boolean): Promise<Snapshot> {
  const current = await snapshot();
  if (!current.repoPath) {
    throw new Error("Choose a repository first.");
  }
  if (paths.length === 0) {
    throw new Error(staged ? "Nothing to stage." : "Nothing to unstage.");
  }
  const known = new Set(current.changes.map((change) => change.path));
  for (const filePath of paths) {
    assertSafePath(filePath);
    if (!known.has(filePath)) {
      throw new Error(`Not in the working tree: ${filePath}`);
    }
  }
  if (staged) {
    await runGit(current.repoPath, ["add", "--", ...paths]);
  } else {
    await runGit(current.repoPath, ["restore", "--staged", "--", ...paths]);
  }
  return snapshot();
}

export async function installHook(parent?: BrowserWindow): Promise<Snapshot | { ok: true; canceled: true }> {
  const current = await snapshot();
  if (!current.repoPath) {
    throw new Error("Choose a repository first.");
  }
  const dest = await hookFile(current.repoPath);
  let existing = "";
  try {
    existing = await fs.readFile(dest, "utf8");
  } catch (error) {
    if (!isEnoent(error)) {
      throw error;
    }
  }
  if (existing && !existing.includes(HOOK_MARKER)) {
    const message = {
      type: "question" as const,
      buttons: ["Replace hook", "Cancel"],
      defaultId: 1,
      cancelId: 1,
      message: "This repository already has a commit-msg hook.",
      detail: "Replacing it installs the Feature trailer check."
    };
    const answer = parent
      ? await dialog.showMessageBox(parent, message)
      : await dialog.showMessageBox(message);
    if (answer.response !== 0) {
      return { ok: true, canceled: true };
    }
  }
  let script = await fs.readFile(hookSourcePath(), "utf8");
  script = script.replace(/^\uFEFF/, "").replace(/\r\n/g, "\n");
  if (!script.endsWith("\n")) {
    script += "\n";
  }
  await fs.mkdir(path.dirname(dest), { recursive: true });
  await fs.writeFile(dest, script, { mode: 0o755 });
  return snapshot();
}

export async function removeHook(parent?: BrowserWindow): Promise<Snapshot | { ok: true; canceled: true }> {
  const current = await snapshot();
  if (!current.repoPath) {
    throw new Error("Choose a repository first.");
  }
  const dest = await hookFile(current.repoPath);
  let existing = "";
  try {
    existing = await fs.readFile(dest, "utf8");
  } catch (error) {
    if (isEnoent(error)) {
      return snapshot();
    }
    throw error;
  }
  if (!existing.includes(HOOK_MARKER)) {
    throw new Error("This repository has a different commit-msg hook. It was left in place.");
  }
  const message = {
    type: "question" as const,
    buttons: ["Remove", "Cancel"],
    defaultId: 1,
    cancelId: 1,
    message: "Remove the commit hook?",
    detail: "Commits made outside this app will no longer be checked for a Feature trailer."
  };
  const answer = parent
    ? await dialog.showMessageBox(parent, message)
    : await dialog.showMessageBox(message);
  if (answer.response !== 0) {
    return { ok: true, canceled: true };
  }
  await fs.rm(dest, { force: true });
  return snapshot();
}

export async function createCommit(input: CommitRequest): Promise<CommitResult> {
  const current = await snapshot();
  if (!current.repoPath) {
    throw new Error("Choose a repository first.");
  }
  const prepared = prepareCommit(input, current.catalog.data);
  if (!prepared.ok) {
    throw new Error(prepared.errors[0] ?? "The commit message is not valid.");
  }
  const feature = prepared.featureId ? findFeature(current.catalog.data, prepared.featureId) : undefined;
  const task = feature && prepared.taskId ? findTask(current.catalog.data, feature.id, prepared.taskId) : undefined;
  const finishingSubtask = input.completeSubtask ? prepared.subtaskId ?? "" : "";
  const finishingTask = input.completeTask ? prepared.taskId ?? "" : "";
  if (input.completeTask && (!task || !canCompleteTask(task, finishingSubtask))) {
    throw new Error("Complete every subtask before marking the task completed.");
  }
  if (input.completeFeature && (!feature || !canCompleteFeature(feature, finishingTask, finishingSubtask))) {
    throw new Error("Complete every task before marking the feature completed.");
  }
  const staged = current.changes.filter((change) => isStaged(change.code));
  if (staged.length === 0) {
    throw new Error("Stage at least one file.");
  }

  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "feature-release-"));
  const messageFile = path.join(directory, "COMMIT_MSG");
  const commitArgs = ["commit", "-F", messageFile];
  if (input.noVerify) {
    commitArgs.push("--no-verify");
  }
  try {
    await fs.writeFile(messageFile, prepared.message.replace(/\r\n/g, "\n"));
    await runGit(current.repoPath, commitArgs);
  } finally {
    await fs.rm(directory, { recursive: true, force: true });
  }

  const sha = (await runGit(current.repoPath, ["rev-parse", "HEAD"])).trim();
  let completionSha = "";
  if (input.completeSubtask || input.completeTask || input.completeFeature) {
    try {
      const latest = await snapshot();
      let next = latest.catalog.data;
      const featureId = prepared.featureId ?? "";
      const taskId = prepared.taskId ?? "";
      const subtaskId = prepared.subtaskId ?? "";
      if (input.completeSubtask) {
        next = setSubtaskStatus(next, featureId, taskId, subtaskId, "completed");
      }
      if (input.completeTask) {
        next = setTaskStatus(next, featureId, taskId, "completed");
      }
      if (input.completeFeature) {
        next = setFeatureStatus(next, featureId, "completed");
      }
      await saveCatalog(next);
      await commitPreparedMessage(current.repoPath, completionCommitMessage({
        type: input.type,
        featureId,
        taskId,
        subtaskId,
        completeSubtask: input.completeSubtask,
        completeTask: input.completeTask,
        completeFeature: input.completeFeature
      }));
      completionSha = (await runGit(current.repoPath, ["rev-parse", "HEAD"])).trim();
    } catch (error) {
      return {
        ok: false,
        committed: true,
        sha,
        completionSha,
        pushed: false,
        error: error instanceof Error ? error.message : "The completion commit failed.",
        snapshot: await snapshot()
      };
    }
  }
  if (input.push) {
    try {
      await runGit(current.repoPath, ["push"]);
    } catch (error) {
      return {
        ok: false,
        committed: true,
        sha,
        completionSha,
        pushed: false,
        error: error instanceof Error ? error.message : "Push failed.",
        snapshot: await snapshot()
      };
    }
  }

  return {
    ok: true,
    committed: true,
    sha,
    completionSha,
    pushed: Boolean(input.push),
    snapshot: await snapshot()
  };
}

export async function buildPlan(input: PlanRequest): Promise<PromotionPlan> {
  const current = await snapshot();
  if (!current.repoPath) {
    throw new Error("Choose a repository first.");
  }
  const target = input.target ?? "QAS";
  const readBranch = target === "DEV"
    ? current.branch
    : baseBranch(current.manifest.data, previousEnvironment(target) ?? "DEV");
  const commits = await commitsOn(current.repoPath, readBranch);
  const plan = planPromotion({
    featureId: input.featureId,
    target,
    commitsNewestFirst: commits,
    manifest: { ...current.manifest.data, exists: current.manifest.exists },
    branch: readBranch
  });
  if (!plan.ok) {
    throw new Error(plan.error);
  }
  return plan;
}

export async function preparePromotion(input: PrepareRequest): Promise<Snapshot> {
  const current = await snapshot();
  if (!current.repoPath) {
    throw new Error("Choose a repository first.");
  }
  const target = input.target;
  if (target !== "DEV" && target !== "QAS" && target !== "UAT" && target !== "PROD") {
    throw new Error("Choose DEV, QAS, UAT, or PROD.");
  }
  const mode = input.mode ?? defaultPrepareMode(target);
  const squash = input.squash === true;
  const repoPath = current.repoPath;
  const sourceBranch = current.branch;
  const base = baseBranch(current.manifest.data, target);
  if (current.changes.length > 0) {
    throw new Error("Commit or remove local changes before preparing a promotion.");
  }
  await runGit(repoPath, ["fetch", "origin"]);
  const readBranch = target === "DEV" ? sourceBranch : baseBranch(current.manifest.data, previousEnvironment(target) ?? "DEV");
  const newest = await commitsOn(repoPath, readBranch);
  const oldest = [...newest].reverse();
  const recorded = target === "DEV"
    ? []
    : current.manifest.data.environments[target].features[normalizeTicket(input.featureId)]?.commits.map((item) => item.source) ?? [];
  const shas = commitsForFeature(oldest, input.featureId ?? "", recorded);
  const pending = oldest.filter((commit) => shas.includes(commit.sha));
  const branchName = promoteBranchName(base, input.featureId ?? "");
  const promoteExists = await refExists(repoPath, `refs/heads/${branchName}`)
    || await refExists(repoPath, `refs/remotes/origin/${branchName}`);
  const localBase = await refExists(repoPath, `refs/heads/${base}`);
  const originBase = await refExists(repoPath, `refs/remotes/origin/${base}`);
  const guard = guardPreparation({
    dirty: current.changes.length > 0,
    featureId: input.featureId ?? "",
    target,
    mode,
    sourceBranch,
    baseBranch: base,
    baseExistsLocally: localBase,
    baseExistsOnOrigin: originBase,
    canFastForward: localBase && originBase ? await isAncestor(repoPath, `refs/heads/${base}`, `refs/remotes/origin/${base}`) : false,
    promoteBranchExists: promoteExists,
    pendingCount: shas.length
  });
  if (!guard.ok) {
    throw new Error(guard.error);
  }
  if (mode === "cherry-pick" || squash) {
    for (const sha of shas) {
      if (!await refExists(repoPath, `${sha}^{commit}`)) {
        throw new Error("Those commits are not in this clone.");
      }
    }
  }

  let created = false;
  let squashing = false;
  try {
    await runGit(repoPath, ["switch", base]);
    await runGit(repoPath, ["merge", "--ff-only", `origin/${base}`]);
    const baseSha = (await runGit(repoPath, ["rev-parse", "HEAD"])).trim();
    await runGit(repoPath, ["switch", "-c", guard.branch]);
    created = true;
    if (squash) {
      squashing = true;
      if (mode === "merge") {
        await runGit(repoPath, ["merge", "--squash", sourceBranch]);
      } else {
        await runGit(repoPath, ["cherry-pick", "--no-commit", ...shas]);
      }
      await commitPreparedMessage(repoPath, squashCommitMessage(input.featureId ?? "", pending));
      squashing = false;
    } else if (mode === "merge") {
      await runGit(repoPath, ["merge", "--no-commit", sourceBranch]);
      await commitPreparedMessage(repoPath, mergeCommitMessage(input.featureId ?? "", pending));
    } else {
      await runGit(repoPath, ["cherry-pick", ...shas]);
    }
    await writeManifest(repoPath, recordPrepared(current.manifest.data, target, normalizeTicket(input.featureId ?? ""), {
      branch: guard.branch,
      sourceBranch,
      mode,
      squash,
      baseSha
    }));
    return snapshot();
  } catch (error) {
    const message = error instanceof Error ? error.message : "Git failed.";
    const merging = await refExists(repoPath, "MERGE_HEAD");
    const picking = await refExists(repoPath, "CHERRY_PICK_HEAD");
    if (picking) {
      const files = await conflictFiles(repoPath);
      try {
        await runGit(repoPath, ["cherry-pick", "--abort"]);
      } catch {
        // The cherry-pick had already stopped.
      }
      const detail = files.length > 0 ? ` Conflicted files: ${files.join(", ")}.` : "";
      throw new Error(`${guard.branch} stopped at its base.${detail} ${message}`.trim());
    }
    if (squashing) {
      const files = await conflictFiles(repoPath);
      try {
        await runGit(repoPath, ["reset", "--merge"]);
      } catch {
        // The squash could not be cleared.
      }
      const detail = files.length > 0 ? ` Conflicted files: ${files.join(", ")}.` : "";
      throw new Error(`${guard.branch} stopped at its base.${detail} ${message}`.trim());
    }
    if (merging) {
      const files = await conflictFiles(repoPath);
      try {
        await runGit(repoPath, ["merge", "--abort"]);
      } catch {
        // The merge had already stopped.
      }
      const detail = files.length > 0 ? ` Conflicted files: ${files.join(", ")}.` : "";
      throw new Error(`${guard.branch} stopped at its base.${detail} ${message}`.trim());
    }
    if (!created) {
      try {
        await runGit(repoPath, ["switch", sourceBranch]);
      } catch {
        // The original branch could not be restored.
      }
      throw error;
    }
    throw new Error(`${guard.branch} was created. ${message}`);
  }
}

export async function listBranches(): Promise<{ ok: true; branches: string[] }> {
  const current = await snapshot();
  if (!current.repoPath) {
    throw new Error("Choose a repository first.");
  }
  const local = await runGit(current.repoPath, ["for-each-ref", "--format=%(refname:short)", "refs/heads"]);
  let remote = "";
  try {
    remote = await runGit(current.repoPath, ["for-each-ref", "--format=%(refname:short)", "refs/remotes/origin"]);
  } catch {
    remote = "";
  }
  const names = [
    ...local.split(/\r?\n/),
    ...remote.split(/\r?\n/).flatMap((line) => {
      const short = line.trim();
      if (!short.startsWith("origin/") || short === "origin/HEAD") {
        return [];
      }
      return [short.slice("origin/".length)];
    })
  ];
  const preferred = ENV_RAIL.map((name) => branchNames(current.manifest.data)[name]);
  return { ok: true, branches: sortBaseBranches(names, preferred) };
}

export async function createWorkBranch(input: { base?: string; branch?: string }): Promise<Snapshot> {
  const current = await snapshot();
  if (!current.repoPath) {
    throw new Error("Choose a repository first.");
  }
  const base = input.base?.trim() ?? "";
  const branch = input.branch?.trim() ?? "";
  if (!base || !branch) {
    throw new Error("Choose a base branch.");
  }
  const repoPath = current.repoPath;
  const sourceBranch = current.branch;
  const fromCurrent = usesCurrentBranch(sourceBranch, base);
  if (!fromCurrent && current.changes.length > 0) {
    throw new Error("Local changes are present. A branch cannot be created automatically.");
  }
  if (await refExists(repoPath, `refs/heads/${branch}`) || await refExists(repoPath, `refs/remotes/origin/${branch}`)) {
    throw new Error(`${branch} already exists.`);
  }
  for (const prefix of branchRefPrefixes(branch)) {
    if (await refExists(repoPath, `refs/heads/${prefix}`) || await refExists(repoPath, `refs/remotes/origin/${prefix}`)) {
      throw new Error(`${prefix} already exists, so ${branch} cannot be created.`);
    }
  }
  if (fromCurrent) {
    await runGit(repoPath, ["switch", "-c", branch]);
    return snapshot();
  }
  await runGit(repoPath, ["fetch", "origin"]);
  const localBase = await refExists(repoPath, `refs/heads/${base}`);
  const originBase = await refExists(repoPath, `refs/remotes/origin/${base}`);
  if (!localBase && !originBase) {
    throw new Error(`${base} is not available.`);
  }
  if (!originBase) {
    throw new Error(`origin/${base} is missing.`);
  }
  let leftSource = false;
  try {
    if (localBase) {
      await runGit(repoPath, ["switch", base]);
    } else {
      await runGit(repoPath, ["switch", "--track", `origin/${base}`]);
    }
    leftSource = true;
    await runGit(repoPath, ["merge", "--ff-only", `origin/${base}`]);
    await runGit(repoPath, ["switch", "-c", branch]);
    return snapshot();
  } catch (error) {
    if (leftSource) {
      try {
        await runGit(repoPath, ["switch", sourceBranch]);
      } catch {
        // The original branch could not be restored.
      }
    }
    throw error;
  }
}

async function commitPreparedMessage(repoPath: string, message: string): Promise<void> {
  const file = path.join(os.tmpdir(), `feature-release-squash-${process.pid}.txt`);
  await fs.writeFile(file, message.endsWith("\n") ? message : `${message}\n`);
  try {
    await runGit(repoPath, ["commit", "-F", file]);
  } finally {
    await fs.rm(file, { force: true });
  }
}

async function commitsOn(repoPath: string, branch: string) {
  try {
    const log = await runGit(repoPath, [
      "log",
      branch,
      "-n",
      "300",
      "--pretty=format:%H%x1f%h%x1f%an%x1f%aI%x1f%s%x1f%b%x1e"
    ]);
    return parseGitLog(log);
  } catch (error) {
    if (error instanceof Error && /does not have any commits/i.test(error.message)) {
      return [];
    }
    throw error;
  }
}

async function refExists(repoPath: string, ref: string): Promise<boolean> {
  try {
    await runGit(repoPath, ["rev-parse", "--verify", "--quiet", ref]);
    return true;
  } catch {
    return false;
  }
}

async function isAncestor(repoPath: string, ancestor: string, descendant: string): Promise<boolean> {
  try {
    await runGit(repoPath, ["merge-base", "--is-ancestor", ancestor, descendant]);
    return true;
  } catch {
    return false;
  }
}

async function conflictFiles(repoPath: string): Promise<string[]> {
  try {
    const raw = await runGit(repoPath, ["diff", "--name-only", "--diff-filter=U"]);
    return raw.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  } catch {
    return [];
  }
}

async function writeManifest(repoPath: string, manifest: Manifest): Promise<void> {
  const fullPath = path.join(repoPath, ...MANIFEST_PATH.split("/"));
  await fs.mkdir(path.dirname(fullPath), { recursive: true });
  const { exists: _exists, ...stored } = manifest;
  await fs.writeFile(fullPath, `${JSON.stringify(stored, null, 2)}\n`);
  await runGit(repoPath, ["add", "--", MANIFEST_PATH]);
}
