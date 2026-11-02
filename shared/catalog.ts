import { isTicket, normalizeTicket } from "./ticket";

export const CATALOG_PATH = "gfm/release/catalog.json";
export const LEGACY_CATALOG_PATH = "release/catalog.json";
export const FEATURES_DIR = "gfm/release/features";

const DESCRIPTION_LIMIT = 400;

export type SequenceKey = "F" | "T" | "ST";

export interface Sequences {
  F: number;
  T: number;
  ST: number;
}

export type WorkStatus = "todo" | "in-progress" | "completed";

export const WORK_STATUSES: WorkStatus[] = ["todo", "in-progress", "completed"];

export const COMMIT_TYPES = ["feat", "fix", "refactor", "perf", "docs", "test", "chore"] as const;

export type CommitType = (typeof COMMIT_TYPES)[number];

export interface SubtaskItem {
  id: string;
  name: string;
  description: string;
  active: boolean;
  status: WorkStatus;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
}

export interface TaskItem {
  id: string;
  name: string;
  description: string;
  active: boolean;
  status: WorkStatus | "";
  commitType: CommitType | "";
  createdBy: string;
  createdAt: string;
  updatedAt: string;
  subtasks: SubtaskItem[];
}

export interface FeatureItem {
  id: string;
  name: string;
  description: string;
  active: boolean;
  status: WorkStatus | "";
  createdBy: string;
  createdAt: string;
  updatedAt: string;
  tasks: TaskItem[];
}

export interface Catalog {
  sequences: Sequences;
  features: FeatureItem[];
}

export interface CatalogFile {
  exists: boolean;
  path: string;
  data: Catalog;
  error: string;
}

export interface ItemDraft {
  id?: string;
  name?: string;
  description?: string;
  createdBy?: string;
  commitType?: string;
}

type CatalogResult = { ok: true; catalog: Catalog } | { ok: false; error: string };

export function emptyCatalog(): Catalog {
  return { sequences: { F: 1, T: 1, ST: 1 }, features: [] };
}

export function serializeCatalog(catalog: Catalog): string {
  return `${JSON.stringify(catalog, omitEmpty, 2)}\n`;
}

export function serializeFeature(feature: FeatureItem): string {
  return `${JSON.stringify(feature, omitEmpty, 2)}\n`;
}

export function parseFeatureFile(text: string, fileName: string): FeatureItem {
  const feature = readFeature(JSON.parse(text), new Set<string>());
  const stem = fileName.replace(/\.json$/i, "");
  if (normalizeTicket(stem) !== feature.id) {
    throw new Error(`${fileName} must be named ${feature.id}.json.`);
  }
  return feature;
}

export function catalogFromFeatures(features: FeatureItem[]): Catalog {
  const seen = new Set<string>();
  for (const feature of features) {
    for (const id of allIds({ sequences: { F: 1, T: 1, ST: 1 }, features: [feature] })) {
      if (seen.has(id)) {
        throw new Error(`${id} is listed more than once.`);
      }
      seen.add(id);
    }
  }
  const sorted = [...features].sort(compareItemsDescending);
  return { sequences: resolveSequences(undefined, sorted), features: sorted };
}

function omitEmpty(key: string, value: unknown): unknown {
  if ((key === "createdAt" || key === "updatedAt" || key === "createdBy" || key === "commitType" || key === "status") && value === "") {
    return undefined;
  }
  return value;
}

export function parseCatalog(text: string): Catalog {
  const data: unknown = JSON.parse(text);
  if (!isRecord(data) || !Array.isArray(data.features)) {
    throw new Error("Catalog must contain a features list.");
  }
  const seen = new Set<string>();
  const features = data.features.map((item) => readFeature(item, seen));
  return { sequences: resolveSequences(data.sequences, features), features };
}

const RANDOM_ID = /^(F|T|ST)-[0-9A-F]{10}$/;

export function generateId(key: SequenceKey): string {
  const bytes = new Uint8Array(5);
  crypto.getRandomValues(bytes);
  const suffix = [...bytes].map((byte) => byte.toString(16).padStart(2, "0")).join("").toUpperCase();
  return `${key}-${suffix}`;
}

export function compareIdsDescending(left: string, right: string): number {
  const gap = idNumber(right) - idNumber(left);
  return gap === 0 ? right.localeCompare(left) : gap;
}

export function compareItemsDescending(
  left: { id: string; createdAt: string },
  right: { id: string; createdAt: string }
): number {
  const leftTime = stampTime(left.createdAt);
  const rightTime = stampTime(right.createdAt);
  if (leftTime !== null && rightTime !== null && leftTime !== rightTime) {
    return rightTime - leftTime;
  }
  if ((leftTime !== null) !== (rightTime !== null)) {
    return leftTime !== null ? -1 : 1;
  }
  return compareIdsDescending(left.id, right.id);
}

export function addFeature(catalog: Catalog, input: ItemDraft): CatalogResult {
  const text = readDraft(input, "Feature");
  if (!text.ok) {
    return text;
  }
  const issued = issue(catalog, "F", input.id);
  if (!issued.ok) {
    return issued;
  }
  return {
    ok: true,
    catalog: {
      sequences: catalog.sequences,
      features: [...catalog.features, { id: issued.id, name: text.name, description: text.description, active: true, status: "", createdBy: cleanCreatedBy(input.createdBy), ...freshStamps(), tasks: [] }]
    }
  };
}

export function addTask(catalog: Catalog, featureId: string, input: ItemDraft): CatalogResult {
  const parent = normalizeTicket(featureId);
  const feature = catalog.features.find((item) => item.id === parent);
  if (!feature) {
    return { ok: false, error: "Choose a feature before adding a task." };
  }
  const text = readDraft(input, "Task");
  if (!text.ok) {
    return text;
  }
  const commitType = readCommitType(input.commitType);
  if (!commitType) {
    return { ok: false, error: "Choose a task type." };
  }
  const issued = issue(catalog, "T", input.id);
  if (!issued.ok) {
    return issued;
  }
  return {
    ok: true,
    catalog: {
      sequences: catalog.sequences,
      features: catalog.features.map((item) => item.id === parent
        ? { ...item, tasks: [...item.tasks, { id: issued.id, name: text.name, description: text.description, active: true, status: "", commitType, createdBy: cleanCreatedBy(input.createdBy), ...freshStamps(), subtasks: [] }] }
        : item)
    }
  };
}

export function addSubtask(catalog: Catalog, featureId: string, taskId: string, input: ItemDraft): CatalogResult {
  const parentFeature = normalizeTicket(featureId);
  const parentTask = normalizeTicket(taskId);
  const feature = catalog.features.find((item) => item.id === parentFeature);
  const task = feature?.tasks.find((item) => item.id === parentTask);
  if (!feature || !task) {
    return { ok: false, error: "Choose a task before adding a subtask." };
  }
  const text = readDraft(input, "Subtask");
  if (!text.ok) {
    return text;
  }
  const issued = issue(catalog, "ST", input.id);
  if (!issued.ok) {
    return issued;
  }
  return {
    ok: true,
    catalog: {
      sequences: catalog.sequences,
      features: catalog.features.map((item) => item.id === parentFeature
        ? {
          ...item,
          tasks: item.tasks.map((entry) => entry.id === parentTask
            ? { ...entry, subtasks: [...entry.subtasks, { id: issued.id, name: text.name, description: text.description, active: true, status: "todo", createdBy: cleanCreatedBy(input.createdBy), ...freshStamps() }] }
            : entry)
        }
        : item)
    }
  };
}

export function setFeatureActive(catalog: Catalog, featureId: string, active: boolean): Catalog {
  const id = normalizeTicket(featureId);
  return {
    sequences: catalog.sequences,
    features: catalog.features.map((item) => item.id === id ? touch(item, active) : item)
  };
}

export function setTaskActive(catalog: Catalog, featureId: string, taskId: string, active: boolean): Catalog {
  const parent = normalizeTicket(featureId);
  const id = normalizeTicket(taskId);
  return {
    sequences: catalog.sequences,
    features: catalog.features.map((item) => item.id === parent
      ? { ...item, tasks: item.tasks.map((task) => task.id === id ? touch(task, active) : task) }
      : item)
  };
}

export function setSubtaskActive(
  catalog: Catalog,
  featureId: string,
  taskId: string,
  subtaskId: string,
  active: boolean
): Catalog {
  const parentFeature = normalizeTicket(featureId);
  const parentTask = normalizeTicket(taskId);
  const id = normalizeTicket(subtaskId);
  return {
    sequences: catalog.sequences,
    features: catalog.features.map((item) => item.id === parentFeature
      ? {
        ...item,
        tasks: item.tasks.map((task) => task.id === parentTask
          ? { ...task, subtasks: task.subtasks.map((subtask) => subtask.id === id ? touch(subtask, active) : subtask) }
          : task)
      }
      : item)
  };
}

export function setFeatureStatus(catalog: Catalog, featureId: string, status: WorkStatus): Catalog {
  if (status !== "completed") {
    return catalog;
  }
  const id = normalizeTicket(featureId);
  return {
    sequences: catalog.sequences,
    features: catalog.features.map((item) => item.id === id ? { ...item, status, updatedAt: new Date().toISOString() } : item)
  };
}

export function setTaskStatus(catalog: Catalog, featureId: string, taskId: string, status: WorkStatus): Catalog {
  if (status !== "completed") {
    return catalog;
  }
  const parent = normalizeTicket(featureId);
  const id = normalizeTicket(taskId);
  return {
    sequences: catalog.sequences,
    features: catalog.features.map((item) => item.id === parent
      ? { ...item, tasks: item.tasks.map((task) => task.id === id ? { ...task, status, updatedAt: new Date().toISOString() } : task) }
      : item)
  };
}

export function setSubtaskStatus(
  catalog: Catalog,
  featureId: string,
  taskId: string,
  subtaskId: string,
  status: WorkStatus
): Catalog {
  if (!WORK_STATUSES.includes(status)) {
    return catalog;
  }
  const parentFeature = normalizeTicket(featureId);
  const parentTask = normalizeTicket(taskId);
  const id = normalizeTicket(subtaskId);
  return {
    sequences: catalog.sequences,
    features: catalog.features.map((item) => item.id === parentFeature
      ? {
        ...item,
        tasks: item.tasks.map((task) => task.id === parentTask
          ? {
            ...task,
            subtasks: task.subtasks.map((subtask) => subtask.id === id
              ? { ...subtask, status, updatedAt: new Date().toISOString() }
              : subtask)
          }
          : task)
      }
      : item)
  };
}

export function subtaskProgress(task: TaskItem): { done: number; total: number } {
  return {
    done: task.subtasks.filter((subtask) => subtask.status === "completed").length,
    total: task.subtasks.length
  };
}

export function canCompleteTask(task: TaskItem, completingSubtaskId = ""): boolean {
  const open = task.subtasks.filter((item) => item.active);
  if (open.length === 0) {
    return false;
  }
  const finishing = normalizeTicket(completingSubtaskId);
  return open.every((item) => item.status === "completed" || (finishing !== "" && item.id === finishing));
}

export function canCompleteFeature(feature: FeatureItem, completingTaskId = "", completingSubtaskId = ""): boolean {
  const tasks = feature.tasks.filter((item) => item.active);
  if (tasks.length === 0) {
    return false;
  }
  const finishing = normalizeTicket(completingTaskId);
  const subtask = normalizeTicket(completingSubtaskId);
  return tasks.every((item) => {
    if (item.status === "completed" || canCompleteTask(item, "")) {
      return true;
    }
    return finishing !== "" && item.id === finishing && canCompleteTask(item, subtask);
  });
}

export function taskProgress(feature: FeatureItem): { done: number; total: number } {
  return {
    done: feature.tasks.filter((task) => {
      const progress = subtaskProgress(task);
      return progress.total > 0 && progress.done === progress.total;
    }).length,
    total: feature.tasks.length
  };
}

export function removeFeature(catalog: Catalog, featureId: string): Catalog {
  const id = normalizeTicket(featureId);
  return { sequences: catalog.sequences, features: catalog.features.filter((item) => item.id !== id) };
}

export function removeTask(catalog: Catalog, featureId: string, taskId: string): Catalog {
  const parent = normalizeTicket(featureId);
  const id = normalizeTicket(taskId);
  return {
    sequences: catalog.sequences,
    features: catalog.features.map((item) => item.id === parent
      ? { ...item, tasks: item.tasks.filter((task) => task.id !== id) }
      : item)
  };
}

export function removeSubtask(catalog: Catalog, featureId: string, taskId: string, subtaskId: string): Catalog {
  const parentFeature = normalizeTicket(featureId);
  const parentTask = normalizeTicket(taskId);
  const id = normalizeTicket(subtaskId);
  return {
    sequences: catalog.sequences,
    features: catalog.features.map((item) => item.id === parentFeature
      ? {
        ...item,
        tasks: item.tasks.map((task) => task.id === parentTask
          ? { ...task, subtasks: task.subtasks.filter((subtask) => subtask.id !== id) }
          : task)
      }
      : item)
  };
}

export function findFeature(catalog: Catalog, featureId: string): FeatureItem | undefined {
  return catalog.features.find((item) => item.id === normalizeTicket(featureId));
}

export function findTask(catalog: Catalog, featureId: string, taskId: string): TaskItem | undefined {
  return findFeature(catalog, featureId)?.tasks.find((item) => item.id === normalizeTicket(taskId));
}

export function promotableSubtaskIds(task: Pick<TaskItem, "active" | "status" | "subtasks">, subtaskIds: string[]): string[] | null {
  if (task.active === false) {
    return null;
  }
  const ready = subtaskIds.filter((id) => task.subtasks.some((item) => item.id === id && item.active !== false && item.status === "completed"));
  if (task.status !== "completed" && ready.length === 0) {
    return null;
  }
  return ready;
}

export function isReadyToPromote(catalog: Catalog, commit: { featureId: string | null; taskId?: string | null; subtaskId?: string | null }): boolean {
  const feature = commit.featureId ? findFeature(catalog, commit.featureId) : undefined;
  if (!feature || feature.active === false) {
    return false;
  }
  if (commit.subtaskId) {
    for (const task of feature.tasks) {
      const subtask = task.subtasks.find((item) => item.id === normalizeTicket(commit.subtaskId));
      if (subtask) {
        return subtask.active !== false && subtask.status === "completed";
      }
    }
    return false;
  }
  if (commit.taskId) {
    const task = findTask(catalog, feature.id, commit.taskId);
    return Boolean(task && task.active !== false && task.status === "completed");
  }
  return feature.status === "completed";
}

function issue(catalog: Catalog, key: SequenceKey, requested?: string): { ok: true; id: string } | { ok: false; error: string } {
  const taken = new Set(allIds(catalog));
  const reserved = normalizeTicket(requested);
  if (reserved) {
    if (!RANDOM_ID.test(reserved) || !reserved.startsWith(`${key}-`)) {
      return { ok: false, error: `Id looks like ${key}-7C9E2A1B4D.` };
    }
    if (taken.has(reserved)) {
      return { ok: false, error: `${reserved} is already in the catalog.` };
    }
    return { ok: true, id: reserved };
  }
  let id = generateId(key);
  while (taken.has(id)) {
    id = generateId(key);
  }
  return { ok: true, id };
}

function stampTime(value: string): number | null {
  if (!value) {
    return null;
  }
  const time = Date.parse(value);
  return Number.isNaN(time) ? null : time;
}

function resolveSequences(value: unknown, features: FeatureItem[]): Sequences {
  const derived = deriveSequences(features);
  const stored = readStoredSequences(value);
  return {
    F: Math.max(derived.F, stored.F),
    T: Math.max(derived.T, stored.T),
    ST: Math.max(derived.ST, stored.ST)
  };
}

function deriveSequences(features: FeatureItem[]): Sequences {
  const next = { F: 1, T: 1, ST: 1 };
  for (const id of allIds({ sequences: next, features })) {
    const match = /^(F|T|ST)-(\d+)$/.exec(id);
    if (!match) {
      continue;
    }
    const key = match[1] as SequenceKey;
    const number = Number(match[2]);
    next[key] = Math.max(next[key], number + 1);
  }
  return next;
}

function readStoredSequences(value: unknown): Sequences {
  if (!isRecord(value)) {
    return { F: 1, T: 1, ST: 1 };
  }
  return {
    F: positive(value.F),
    T: positive(value.T),
    ST: positive(value.ST)
  };
}

function positive(value: unknown): number {
  const number = typeof value === "number" ? value : Number(value);
  return Number.isInteger(number) && number > 0 ? number : 1;
}

function idNumber(id: string): number {
  const match = /^(?:F|T|ST)-(\d+)$/.exec(normalizeTicket(id));
  return match ? Number(match[1]) : 0;
}

function readDraft(input: ItemDraft, label: string): { ok: true; name: string; description: string } | { ok: false; error: string } {
  const name = cleanName(input.name);
  const description = cleanDescription(input.description);
  if (!name) {
    return { ok: false, error: `Enter a name for the ${label.toLowerCase()}.` };
  }
  if (name.length > 80) {
    return { ok: false, error: "Keep the name to 80 characters." };
  }
  if (description.length > DESCRIPTION_LIMIT) {
    return { ok: false, error: `Keep the description to ${DESCRIPTION_LIMIT} characters.` };
  }
  return { ok: true, name, description };
}

function allIds(catalog: Catalog): string[] {
  const ids: string[] = [];
  for (const feature of catalog.features) {
    ids.push(feature.id);
    for (const task of feature.tasks) {
      ids.push(task.id);
      for (const subtask of task.subtasks) {
        ids.push(subtask.id);
      }
    }
  }
  return ids;
}

function readFeature(value: unknown, seen: Set<string>): FeatureItem {
  if (!isRecord(value)) {
    throw new Error("Each feature needs an id and a name.");
  }
  const id = claimId(value.id, seen, "Feature");
  const name = claimName(value.name, "Feature");
  const description = claimDescription(value.description);
  const tasks = Array.isArray(value.tasks) ? value.tasks.map((item) => readTask(item, seen)) : [];
  return { id, name, description, active: readActive(value.active), status: readParentStatus(value.status), createdBy: cleanCreatedBy(value.createdBy), ...readStamps(value), tasks };
}

function readTask(value: unknown, seen: Set<string>): TaskItem {
  if (!isRecord(value)) {
    throw new Error("Each task needs an id and a name.");
  }
  const id = claimId(value.id, seen, "Task");
  const name = claimName(value.name, "Task");
  const description = claimDescription(value.description);
  const subtasks = Array.isArray(value.subtasks) ? value.subtasks.map((item) => readSubtask(item, seen)) : [];
  return { id, name, description, active: readActive(value.active), status: readParentStatus(value.status), commitType: readCommitType(value.commitType), createdBy: cleanCreatedBy(value.createdBy), ...readStamps(value), subtasks };
}

function readSubtask(value: unknown, seen: Set<string>): SubtaskItem {
  if (!isRecord(value)) {
    throw new Error("Each subtask needs an id and a name.");
  }
  return {
    id: claimId(value.id, seen, "Subtask"),
    name: claimName(value.name, "Subtask"),
    description: claimDescription(value.description),
    active: readActive(value.active),
    status: readWorkStatus(value.status),
    createdBy: cleanCreatedBy(value.createdBy),
    ...readStamps(value)
  };
}

function claimId(value: unknown, seen: Set<string>, label: string): string {
  const id = normalizeTicket(value);
  if (!isTicket(id)) {
    throw new Error(`${label} ticket looks like F-1.`);
  }
  if (seen.has(id)) {
    throw new Error(`${id} is listed more than once.`);
  }
  seen.add(id);
  return id;
}

function claimName(value: unknown, label: string): string {
  const name = cleanName(value);
  if (!name || name.length > 80) {
    throw new Error(`Each ${label.toLowerCase()} needs a name.`);
  }
  return name;
}

function claimDescription(value: unknown): string {
  const description = cleanDescription(value);
  if (description.length > DESCRIPTION_LIMIT) {
    throw new Error(`Keep the description to ${DESCRIPTION_LIMIT} characters.`);
  }
  return description;
}

function readActive(value: unknown): boolean {
  return value !== false;
}

function readParentStatus(value: unknown): WorkStatus | "" {
  return value === "completed" ? "completed" : "";
}

function readWorkStatus(value: unknown): WorkStatus {
  return WORK_STATUSES.includes(value as WorkStatus) ? value as WorkStatus : "todo";
}

function readCommitType(value: unknown): CommitType | "" {
  const text = String(value ?? "").trim();
  return (COMMIT_TYPES as readonly string[]).includes(text) ? text as CommitType : "";
}

function cleanCreatedBy(value: unknown): string {
  return String(value ?? "").trim().replace(/\s+/g, " ").slice(0, 120);
}

function freshStamps(): { createdAt: string; updatedAt: string } {
  const stamp = new Date().toISOString();
  return { createdAt: stamp, updatedAt: stamp };
}

function touch<T extends { createdAt: string; updatedAt: string }>(item: T, active: boolean): T {
  return { ...item, active, updatedAt: new Date().toISOString() };
}

function readStamps(value: Record<string, unknown>): { createdAt: string; updatedAt: string } {
  return { createdAt: readStamp(value.createdAt), updatedAt: readStamp(value.updatedAt) };
}

function readStamp(value: unknown): string {
  if (typeof value !== "string" || !value.trim()) {
    return "";
  }
  const time = Date.parse(value);
  return Number.isNaN(time) ? "" : new Date(time).toISOString();
}

function cleanName(value: unknown): string {
  return String(value ?? "").trim().replace(/\s+/g, " ");
}

function cleanDescription(value: unknown): string {
  return String(value ?? "").trim().replace(/[ \t]+/g, " ");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
