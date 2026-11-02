import { existsSync } from "node:fs";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { app, dialog, type BrowserWindow } from "electron";
import type { CommitRequest, CommitResult, PlanRequest, PrepareRequest, SavedProject, Snapshot } from "../../shared/api";
import { CATALOG_PATH, FEATURES_DIR, LEGACY_CATALOG_PATH, canCompleteFeature, canCompleteTask, catalogFromFeatures, emptyCatalog, findFeature, findTask, isReadyToPromote, parseCatalog, parseFeatureFile, serializeFeature, setFeatureStatus, setSubtaskStatus, setTaskStatus, type Catalog } from "../../shared/catalog";
import { completionCommitMessage, prepareCommit } from "../../shared/commit-message";
import { groupByFeature, parseGitLog } from "../../shared/log";
import { classifyOperation, continueRefusal, messageRefusal, type GitOperation } from "../../shared/operation";
import {
  MANIFEST_PATH,
  LEGACY_MANIFEST_PATH,
  defaultManifest,
  environmentsForFeature,
  parseManifest,
  recordPrepared,
  recordPromotion,
  withBranchNames,
  branchNames,
  ENV_RAIL,
  type BranchNames,
  type Manifest
} from "../../shared/manifest";
import { planPromotion, type PromotionPlan } from "../../shared/plan";
import {
  baseBranch,
  commitInSelection,
  commitsForFeature,
  defaultPrepareMode,
  guardPreparation,
  previousEnvironment,
  promotionNodes,
  selectionBranchName,
  wholeFeatureSelection,
  mergeCommitMessage,
  squashCommitMessage,
  promotionRecordMessage,
  type PromotionSelection
} from "../../shared/promote";
import { normalizeTicket } from "../../shared/ticket";
import { branchRefPrefixes, sortBaseBranches, usesCurrentBranch } from "../../shared/work-branch";
import { gitAvailable, parsePorcelain, runGit } from "./git";
import { isStaged } from "../../shared/status";

const HOOK_MARKER = "feature-release-hook";

function settingsFile(): string {
  return path.join(app.getPath("userData"), "settings.json");
}

interface Settings {
  repoPath?: string;
  projects: SavedProject[];
}

async function loadSettings(): Promise<Settings> {
  try {
    const parsed: unknown = JSON.parse(await fs.readFile(settingsFile(), "utf8"));
    const settings = normalizeSettings(parsed);
    if (!hasProjectList(parsed)) {
      await saveSettings(settings);
    }
    return settings;
  } catch {
    return { projects: [] };
  }
}

function normalizeSettings(parsed: unknown): Settings {
  const record = typeof parsed === "object" && parsed !== null ? parsed as Record<string, unknown> : {};
  const projects = Array.isArray(record.projects) ? record.projects.flatMap(readProject) : [];
  const repoPath = typeof record.repoPath === "string" && record.repoPath.trim() ? record.repoPath : undefined;
  if (repoPath && !projects.some((project) => samePath(project.path, repoPath))) {
    projects.unshift({ name: folderName(repoPath), path: repoPath });
  }
  return { repoPath, projects };
}

function readProject(value: unknown): SavedProject[] {
  if (typeof value !== "object" || value === null || !("path" in value) || typeof value.path !== "string" || !value.path.trim()) {
    return [];
  }
  const projectName = "name" in value && typeof value.name === "string" && value.name.trim() ? value.name.trim() : folderName(value.path);
  return [{ name: projectName, path: value.path }];
}

function hasProjectList(parsed: unknown): boolean {
  return typeof parsed === "object" && parsed !== null && "projects" in parsed && Array.isArray(parsed.projects);
}

async function saveSettings(settings: Settings): Promise<void> {
  await fs.mkdir(path.dirname(settingsFile()), { recursive: true });
  await fs.writeFile(settingsFile(), `${JSON.stringify(settings, null, 2)}\n`);
}

async function rememberProject(repoPath: string): Promise<void> {
  const settings = await loadSettings();
  const projects = settings.projects.filter((project) => !samePath(project.path, repoPath));
  projects.unshift({ name: folderName(repoPath), path: repoPath });
  await saveSettings({ repoPath, projects });
}

function folderName(repoPath: string): string {
  return path.basename(repoPath.replace(/[\\/]+$/, "")) || repoPath;
}

function samePath(left: string, right: string): boolean {
  const clean = (value: string) => path.normalize(value).replace(/[\\/]+$/, "").toLowerCase();
  return clean(left) === clean(right);
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
    const names = await listFeatureFiles(repoPath);
    if (names.length > 0) {
      const features = [];
      for (const name of names) {
        const text = await fs.readFile(featureFilePath(repoPath, name), "utf8");
        features.push(parseFeatureFile(text, name));
      }
      return { exists: true, path: FEATURES_DIR, data: catalogFromFeatures(features), error: "" };
    }
    const found = await readRepoFile(repoPath, CATALOG_PATH, LEGACY_CATALOG_PATH);
    if (!found) {
      return { exists: false, path: FEATURES_DIR, data: emptyCatalog(), error: "" };
    }
    return { exists: true, path: found.path, data: parseCatalog(found.text), error: "" };
  } catch (error) {
    const message = error instanceof Error ? error.message : "gfm/release/features could not be read.";
    return { exists: true, path: FEATURES_DIR, data: emptyCatalog(), error: message };
  }
}

async function listFeatureFiles(repoPath: string): Promise<string[]> {
  try {
    const entries = await fs.readdir(path.join(repoPath, ...FEATURES_DIR.split("/")), { withFileTypes: true });
    return entries
      .filter((entry) => entry.isFile() && entry.name.toLowerCase().endsWith(".json"))
      .map((entry) => entry.name)
      .sort();
  } catch (error) {
    if (isEnoent(error)) {
      return [];
    }
    throw error;
  }
}

function featureFilePath(repoPath: string, name: string): string {
  return path.join(repoPath, ...FEATURES_DIR.split("/"), name);
}

function assertSafePath(filePath: string): void {
  if (!filePath || path.win32.isAbsolute(filePath) || path.posix.isAbsolute(filePath)) {
    throw new Error("Choose files from the working tree list.");
  }
  if (filePath.split(/[\\/]/).includes("..")) {
    throw new Error("Choose files from the working tree list.");
  }
}

function emptySnapshot(git: { available: boolean; version: string }, projects: SavedProject[] = [], error = ""): Snapshot {
  return {
    ok: true,
    gitAvailable: git.available,
    gitVersion: git.version,
    gitUser: "",
    repoPath: null,
    projects,
    branch: "",
    hookInstalled: false,
    manifest: { exists: false, path: MANIFEST_PATH, data: defaultManifest() },
    catalog: { exists: false, path: FEATURES_DIR, data: emptyCatalog(), error: "" },
    changes: [],
    features: [],
    operation: null,
    error: error || (git.available ? "" : "Git is not available on PATH.")
  };
}

export async function snapshot(): Promise<Snapshot> {
  const git = await gitAvailable();
  const settings = await loadSettings();
  if (!git.available || !settings.repoPath) {
    return emptySnapshot(git, settings.projects);
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
      environments: environmentsForFeature(group.id, manifest.data)
    }));

    return {
      ...emptySnapshot(git, settings.projects),
      repoPath,
      branch,
      gitUser,
      hookInstalled: await readHookInstalled(repoPath),
      manifest,
      catalog,
      changes,
      features,
      operation: await readOperation(repoPath),
      error: ""
    };
  } catch (error) {
    return emptySnapshot(git, settings.projects, error instanceof Error ? error.message : "Could not read the repository.");
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
  await rememberProject(repoPath);
  return snapshot();
}

export async function openProject(repoPath: string): Promise<Snapshot> {
  const settings = await loadSettings();
  const known = settings.projects.find((project) => samePath(project.path, repoPath));
  if (!known) {
    throw new Error("That project is not saved on this machine.");
  }
  const resolved = await resolveRepo(known.path);
  await rememberProject(resolved);
  return snapshot();
}

export async function removeProject(repoPath: string): Promise<Snapshot> {
  const settings = await loadSettings();
  const projects = settings.projects.filter((project) => !samePath(project.path, repoPath));
  const repoWasOpen = Boolean(settings.repoPath && samePath(settings.repoPath, repoPath));
  await saveSettings({
    repoPath: repoWasOpen ? projects[0]?.path : settings.repoPath,
    projects
  });
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
  const dir = path.join(current.repoPath, ...FEATURES_DIR.split("/"));
  await fs.mkdir(dir, { recursive: true });
  const existing = new Set(await listFeatureFiles(current.repoPath));
  const wanted = new Map(validated.features.map((feature) => [`${feature.id}.json`, serializeFeature(feature)]));
  for (const [name, text] of wanted) {
    const fullPath = featureFilePath(current.repoPath, name);
    let previous = "";
    try {
      previous = await fs.readFile(fullPath, "utf8");
    } catch (error) {
      if (!isEnoent(error)) {
        throw error;
      }
    }
    if (previous !== text) {
      await replaceFile(fullPath, text);
    }
  }
  for (const name of existing) {
    if (!wanted.has(name)) {
      await fs.rm(featureFilePath(current.repoPath, name), { force: true });
    }
  }
  const removed = [];
  for (const relative of [CATALOG_PATH, LEGACY_CATALOG_PATH]) {
    try {
      await fs.rm(path.join(current.repoPath, ...relative.split("/")));
      removed.push(relative);
    } catch (error) {
      if (!isEnoent(error)) {
        throw error;
      }
    }
  }
  await runGit(current.repoPath, ["add", "-A", "--", FEATURES_DIR, ...removed]);
  return snapshot();
}

async function replaceFile(fullPath: string, text: string): Promise<void> {
  const temporary = `${fullPath}.${process.pid}.tmp`;
  await fs.writeFile(temporary, text);
  try {
    await fs.rename(temporary, fullPath);
  } catch (error) {
    if (!existsSync(fullPath)) {
      await fs.rm(temporary, { force: true });
      throw error;
    }
    await fs.rm(fullPath, { force: true });
    await fs.rename(temporary, fullPath);
  }
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
  if (current.operation) {
    throw new Error(`Finish or abort the current ${current.operation.kind} before starting another commit.`);
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
  const commits = (await commitsOn(current.repoPath, readBranch)).filter((commit) => isReadyToPromote(current.catalog.data, commit));
  const plan = planPromotion({
    featureId: input.featureId,
    featureIds: input.featureIds,
    taskIds: input.taskIds,
    subtaskIds: input.subtaskIds,
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

export async function markPromoted(input: PlanRequest): Promise<Snapshot> {
  const plan = await buildPlan(input);
  if (!plan.ok) {
    throw new Error(plan.error);
  }
  if (plan.pending.length === 0) {
    throw new Error("Nothing new to record.");
  }
  const current = await snapshot();
  if (!current.repoPath) {
    throw new Error("Choose a repository first.");
  }
  if (current.operation) {
    throw new Error(`Finish or abort the current ${current.operation.kind} before recording the promotion.`);
  }
  const repoPath = current.repoPath;
  const branch = current.branch;
  await writeManifest(repoPath, recordPromotion(current.manifest.data, plan.target, plan.pending), false);
  try {
    await commitManifest(repoPath, promotionRecordMessage(plan.target, plan.pending), input.noVerify === true);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Git failed.";
    throw new Error(`The ledger was saved on ${branch}. The commit failed. ${message}`);
  }
  return snapshot();
}

export async function preparePromotion(input: PrepareRequest): Promise<Snapshot> {
  const current = await snapshot();
  if (!current.repoPath) {
    throw new Error("Choose a repository first.");
  }
  if (current.operation) {
    throw new Error(`Finish or abort the current ${current.operation.kind} before preparing another promotion.`);
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
  const oldest = [...newest].reverse().filter((commit) => isReadyToPromote(current.catalog.data, commit));
  const usingSelection = Array.isArray(input.featureIds) || Array.isArray(input.taskIds) || Array.isArray(input.subtaskIds);
  const selection: PromotionSelection = {
    featureIds: (input.featureIds ?? []).map((item) => normalizeTicket(item)).filter(Boolean),
    taskIds: (input.taskIds ?? []).map((item) => normalizeTicket(item)).filter(Boolean),
    subtaskIds: (input.subtaskIds ?? []).map((item) => normalizeTicket(item)).filter(Boolean)
  };
  const nodes = promotionNodes(current.catalog.data.features, oldest);
  const recordedFor = (featureId: string | null) =>
    current.manifest.data.environments[target].features[normalizeTicket(featureId)]?.commits.map((item) => item.source) ?? [];
  const shas = usingSelection
    ? oldest.filter((commit) => commitInSelection(commit, selection) && !recordedFor(commit.featureId).includes(commit.sha)).map((commit) => commit.sha)
    : commitsForFeature(oldest, input.featureId ?? "", recordedFor(input.featureId ?? ""));
  const pending = oldest.filter((commit) => shas.includes(commit.sha));
  const whole = usingSelection ? wholeFeatureSelection(nodes, selection) : normalizeTicket(input.featureId);
  const branchName = usingSelection ? selectionBranchName(base, nodes, selection) : `promote/${base}/${normalizeTicket(input.featureId)}`;
  const guardFeature = whole || selection.featureIds[0] || nodes.find((node) => node.tasks.some((task) => selection.taskIds.includes(task.id) || task.subtaskIds.some((id) => selection.subtaskIds.includes(id))))?.id || normalizeTicket(input.featureId);
  const promoteExists = await refExists(repoPath, `refs/heads/${branchName}`)
    || await refExists(repoPath, `refs/remotes/origin/${branchName}`);
  const localBase = await refExists(repoPath, `refs/heads/${base}`);
  const originBase = await refExists(repoPath, `refs/remotes/origin/${base}`);
  const guard = guardPreparation({
    dirty: current.changes.length > 0,
    featureId: guardFeature,
    target,
    mode,
    sourceBranch,
    baseBranch: base,
    baseExistsLocally: localBase,
    baseExistsOnOrigin: originBase,
    canFastForward: localBase && originBase ? await isAncestor(repoPath, `refs/heads/${base}`, `refs/remotes/origin/${base}`) : false,
    promoteBranchExists: promoteExists,
    pendingCount: shas.length,
    branchName
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
      await commitPreparedMessage(repoPath, squashCommitMessage(guardFeature, pending));
      squashing = false;
    } else if (mode === "merge") {
      await runGit(repoPath, ["merge", "--no-commit", sourceBranch]);
      await commitPreparedMessage(repoPath, mergeCommitMessage(guardFeature, pending));
    } else {
      await runGit(repoPath, ["cherry-pick", ...shas]);
    }
    const recordedIds = [...new Set(pending.map((commit) => normalizeTicket(commit.featureId)).filter(Boolean))];
    let manifest = current.manifest.data;
    for (const id of recordedIds.length > 0 ? recordedIds : [guardFeature]) {
      manifest = recordPrepared(manifest, target, id, {
        branch: guard.branch,
        sourceBranch,
        mode,
        squash,
        baseSha
      });
    }
    await writeManifest(repoPath, manifest);
    return snapshot();
  } catch (error) {
    const message = error instanceof Error ? error.message : "Git failed.";
    const merging = await refExists(repoPath, "MERGE_HEAD");
    const picking = await refExists(repoPath, "CHERRY_PICK_HEAD");
    if (picking || merging) {
      return snapshot();
    }
    if (squashing) {
      const files = await conflictFiles(repoPath);
      if (files.length > 0) {
        return snapshot();
      }
      try {
        await runGit(repoPath, ["reset", "--merge"]);
      } catch {
        // The squash could not be cleared.
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

export async function continueOperation(): Promise<Snapshot> {
  const current = await requireOperation();
  const refusal = continueRefusal(current.operation);
  if (refusal) {
    throw new Error(refusal);
  }
  await runGit(current.repoPath!, ["commit", "--no-edit", "--no-verify"]);
  return snapshot();
}

export async function skipOperation(): Promise<Snapshot> {
  const current = await requireOperation();
  if (current.operation?.kind !== "cherry-pick") {
    throw new Error("Skip is only available during a cherry-pick.");
  }
  await runGit(current.repoPath!, ["cherry-pick", "--skip"]);
  return snapshot();
}

export async function abortOperation(): Promise<Snapshot> {
  const current = await requireOperation();
  const kind = current.operation?.kind;
  const args = kind === "cherry-pick"
    ? ["cherry-pick", "--abort"]
    : kind === "merge"
      ? ["merge", "--abort"]
      : kind === "rebase"
        ? ["rebase", "--abort"]
        : kind === "revert"
          ? ["revert", "--abort"]
          : ["reset", "--merge"];
  await runGit(current.repoPath!, args);
  return snapshot();
}

export async function commitOperation(input: CommitRequest): Promise<Snapshot> {
  const current = await requireOperation();
  const refusal = messageRefusal(current.operation);
  if (refusal) {
    throw new Error(refusal);
  }
  const prepared = prepareCommit(input, current.catalog.data, { allowCompleted: true });
  if (!prepared.ok) {
    throw new Error(prepared.errors[0] ?? "The commit message is not valid.");
  }
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "feature-release-"));
  const messageFile = path.join(directory, "COMMIT_MSG");
  try {
    await fs.writeFile(messageFile, prepared.message.replace(/\r\n/g, "\n"));
    await runGit(current.repoPath!, ["commit", "-F", messageFile, "--no-verify"]);
  } finally {
    await fs.rm(directory, { recursive: true, force: true });
  }
  return snapshot();
}

async function requireOperation(): Promise<Snapshot> {
  const current = await snapshot();
  if (!current.repoPath) {
    throw new Error("Choose a repository first.");
  }
  if (!current.operation) {
    throw new Error("No cherry-pick or merge is in progress.");
  }
  return current;
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

async function readOperation(repoPath: string): Promise<GitOperation | null> {
  const [cherryPick, merge, revert, rebase] = await Promise.all([
    refExists(repoPath, "CHERRY_PICK_HEAD"),
    refExists(repoPath, "MERGE_HEAD"),
    refExists(repoPath, "REVERT_HEAD"),
    rebaseInProgress(repoPath)
  ]);
  const conflicted = await conflictFiles(repoPath);
  const subjectRef = cherryPick ? "CHERRY_PICK_HEAD" : merge ? "MERGE_HEAD" : revert ? "REVERT_HEAD" : "";
  const subject = subjectRef ? await commitSubject(repoPath, subjectRef) : "";
  const remaining = cherryPick ? await sequencerRemaining(repoPath) : 0;
  return classifyOperation({ cherryPick, merge, revert, rebase, conflicted, subject, remaining });
}

async function rebaseInProgress(repoPath: string): Promise<boolean> {
  const [merging, applying] = await Promise.all([
    gitPathExists(repoPath, "rebase-merge"),
    gitPathExists(repoPath, "rebase-apply")
  ]);
  return merging || applying;
}

async function gitPathExists(repoPath: string, name: string): Promise<boolean> {
  try {
    const relative = (await runGit(repoPath, ["rev-parse", "--git-path", name])).trim();
    const full = path.isAbsolute(relative) ? relative : path.join(repoPath, relative);
    await fs.access(full);
    return true;
  } catch {
    return false;
  }
}

async function commitSubject(repoPath: string, ref: string): Promise<string> {
  try {
    return (await runGit(repoPath, ["log", "-1", "--format=%s", ref])).trim();
  } catch {
    return "";
  }
}

async function sequencerRemaining(repoPath: string): Promise<number> {
  try {
    const relative = (await runGit(repoPath, ["rev-parse", "--git-path", "sequencer/todo"])).trim();
    const full = path.isAbsolute(relative) ? relative : path.join(repoPath, relative);
    const text = await fs.readFile(full, "utf8");
    return text.split(/\r?\n/).filter((line) => line.trim() && !line.trim().startsWith("#")).length;
  } catch {
    return 0;
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

async function commitManifest(repoPath: string, message: string, noVerify: boolean): Promise<void> {
  const file = path.join(os.tmpdir(), `feature-release-ledger-${process.pid}.txt`);
  await fs.writeFile(file, message.endsWith("\n") ? message : `${message}\n`);
  const args = ["commit", "-F", file];
  if (noVerify) {
    args.push("--no-verify");
  }
  args.push("--", MANIFEST_PATH);
  try {
    await runGit(repoPath, ["add", "--", MANIFEST_PATH]);
    await runGit(repoPath, args);
  } finally {
    await fs.rm(file, { force: true });
  }
}

async function writeManifest(repoPath: string, manifest: Manifest, stage = true): Promise<void> {
  const fullPath = path.join(repoPath, ...MANIFEST_PATH.split("/"));
  await fs.mkdir(path.dirname(fullPath), { recursive: true });
  const { exists: _exists, ...stored } = manifest;
  await fs.writeFile(fullPath, `${JSON.stringify(stored, null, 2)}\n`);
  if (stage) {
    await runGit(repoPath, ["add", "--", MANIFEST_PATH]);
  }
}
