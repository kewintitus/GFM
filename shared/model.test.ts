import { expect, test } from "vitest";
import { addFeature, addSubtask, addTask, canCompleteFeature, canCompleteTask, catalogFromFeatures, compareItemsDescending, emptyCatalog, isReadyToPromote, parseCatalog, parseFeatureFile, promotableSubtaskIds, serializeFeature, setFeatureActive, setSubtaskStatus, subtaskProgress, taskProgress } from "./catalog";
import { isTicket } from "./ticket";
import { completionCommitMessage, prepareCommit } from "./commit-message";
import { groupByFeature, parseGitLog } from "./log";
import { defaultManifest, environmentPresence, environmentsForFeature, parseManifest, recordPrepared, recordPromotion, withBranchNames } from "./manifest";
import { planPromotion } from "./plan";
import { commitInSelection, guardPreparation, mergeCommitMessage, promoteBranchName, promotionNodes, promotionRecordMessage, selectionBranchName, squashCommitMessage, toggleFeature, toggleSubtask, toggleTask, wholeFeatureSelection } from "./promote";
import { branchRefPrefixes, sortBaseBranches, usesCurrentBranch, workBranchName } from "./work-branch";

const catalog = parseCatalog(JSON.stringify({
  features: [
    {
      id: "PAY-142",
      name: "Refunds",
      tasks: [
        {
          id: "PAY-150",
          name: "Refund API",
          subtasks: [{ id: "PAY-188", name: "Validation" }]
        }
      ]
    }
  ]
}));

test("prepareCommit writes feature, task, and subtask trailers from the catalog", () => {
  const prepared = prepareCommit({
    type: "feat",
    summary: "add refund endpoint",
    featureId: "pay-142",
    taskId: "pay-150",
    subtaskId: "pay-188"
  }, catalog);

  expect(prepared.ok).toBe(true);
  expect(prepared.message).toBe(
    "feat: add refund endpoint\n\nFeature: PAY-142\nTask: PAY-150\nSubtask: PAY-188\n"
  );
});

test("prepareCommit requires a feature, a task, and a subtask", () => {
  const missing = prepareCommit({ type: "feat", summary: "add refund endpoint", featureId: "PAY-142" }, catalog);
  expect(missing.ok).toBe(false);
  expect(missing.errors).toContain("Choose a task.");
  expect(missing.errors).toContain("Choose a subtask.");

  const taskOnly = prepareCommit({
    type: "feat",
    summary: "add refund endpoint",
    featureId: "PAY-142",
    taskId: "PAY-150"
  }, catalog);
  expect(taskOnly.ok).toBe(false);
  expect(taskOnly.errors).toContain("Choose a subtask.");
});

test("prepareCommit rejects a completed subtask", () => {
  const done = parseCatalog(JSON.stringify({
    features: [{
      id: "F-2",
      name: "RAZOR_PAY",
      tasks: [{
        id: "T-1",
        name: "UI",
        subtasks: [{ id: "ST-1", name: "Layout", status: "completed" }]
      }]
    }]
  }));
  const prepared = prepareCommit({
    type: "feat",
    summary: "finish the layout",
    featureId: "F-2",
    taskId: "T-1",
    subtaskId: "ST-1"
  }, done);
  expect(prepared.ok).toBe(false);
  expect(prepared.errors).toContain("That subtask is completed.");
});

test("completion follows the last open subtask and records a second commit message", () => {
  const parsed = parseCatalog(JSON.stringify({
    features: [{
      id: "F-3",
      name: "Mailer",
      tasks: [{
        id: "T-2",
        name: "Mailer setup",
        commitType: "fix",
        subtasks: [
          { id: "ST-2", name: "Setup", status: "completed" },
          { id: "ST-9", name: "Wire", status: "in-progress" }
        ]
      }, {
        id: "T-8",
        name: "Docs",
        subtasks: [{ id: "ST-8", name: "Notes", status: "completed" }]
      }]
    }]
  }));
  const feature = parsed.features[0]!;
  const task = feature.tasks[0]!;
  expect(canCompleteTask(task, "")).toBe(false);
  expect(canCompleteTask(task, "ST-9")).toBe(true);
  expect(canCompleteFeature(feature, "", "")).toBe(false);
  expect(canCompleteFeature(feature, "T-2", "ST-9")).toBe(true);
  const message = completionCommitMessage({
    type: "fix",
    featureId: "F-3",
    taskId: "T-2",
    subtaskId: "ST-9",
    completeSubtask: true,
    completeTask: true,
    completeFeature: true
  });
  expect(message.startsWith("fix: complete ST-9, T-2, F-3\n")).toBe(true);
  expect(message).toContain("Feature: F-3\nTask: T-2\nSubtask: ST-9\n");
});

test("prepareCommit keeps a typed task on that commit type", () => {
  const typed = parseCatalog(JSON.stringify({
    features: [{
      id: "F-3",
      name: "Mailer",
      tasks: [{
        id: "T-2",
        name: "Mailer setup",
        commitType: "fix",
        subtasks: [{ id: "ST-2", name: "Setup" }]
      }]
    }]
  }));
  const wrong = prepareCommit({
    type: "feat",
    summary: "fix the mailer",
    featureId: "F-3",
    taskId: "T-2",
    subtaskId: "ST-2"
  }, typed);
  expect(wrong.ok).toBe(false);
  expect(wrong.errors).toContain("This task only accepts the commit type fix.");

  const right = prepareCommit({
    type: "fix",
    summary: "fix the mailer",
    featureId: "F-3",
    taskId: "T-2",
    subtaskId: "ST-2"
  }, typed);
  expect(right.ok).toBe(true);
  expect(right.message.startsWith("fix: fix the mailer\n")).toBe(true);
});

test("addTask stores the selected commit type and leaves older tasks blank", () => {
  const added = addTask(catalog, "PAY-142", { name: "Docs", description: "Notes", commitType: "docs" });
  expect(added.ok).toBe(true);
  if (!added.ok) {
    return;
  }
  expect(added.catalog.features[0]?.tasks.find((task) => task.name === "Docs")?.commitType).toBe("docs");
  const parsed = parseCatalog(JSON.stringify(added.catalog));
  expect(parsed.features[0]?.tasks.find((task) => task.id === "PAY-150")?.commitType).toBe("");
});

test("workBranchName uses the base, feature, task, subtask, and name", () => {
  expect(workBranchName("dev", "f-2", "t-1", "st-1", "Mailer setup")).toBe("work/dev/F-2/T-1/ST-1-mailer-setup");
  expect(branchRefPrefixes("work/dev/F-2/T-1/ST-1-mailer-setup")).toEqual([
    "work",
    "work/dev",
    "work/dev/F-2",
    "work/dev/F-2/T-1"
  ]);
  expect(sortBaseBranches(["feature/login", "main", "qas"], ["dev", "qas", "uat", "main"])).toEqual([
    "dev",
    "qas",
    "uat",
    "main",
    "feature/login"
  ]);
  expect(usesCurrentBranch("dev", "dev")).toBe(true);
  expect(usesCurrentBranch("dev", "qas")).toBe(false);
  expect(usesCurrentBranch("detached", "detached")).toBe(false);
});

test("new ids are random, reserved ids are kept, and a duplicate is refused", () => {
  expect(isTicket("F-1")).toBe(true);
  expect(isTicket("T-1")).toBe(true);
  expect(isTicket("ST-1")).toBe(true);
  expect(isTicket("F-7C9E2A1B4D")).toBe(true);

  const first = addFeature(emptyCatalog(), { name: "Refunds", description: "Customer refund flow", createdBy: "Ada Lovelace" });
  expect(first.ok).toBe(true);
  if (!first.ok) {
    return;
  }
  expect(first.catalog.features[0]?.id).toMatch(/^F-[0-9A-F]{10}$/);
  expect(first.catalog.features[0]).toMatchObject({ description: "Customer refund flow", createdBy: "Ada Lovelace" });
  expect(first.catalog.features[0]?.createdAt).toBe(first.catalog.features[0]?.updatedAt);
  expect(Number.isNaN(Date.parse(first.catalog.features[0]?.createdAt ?? ""))).toBe(false);
  expect(first.catalog.sequences).toEqual({ F: 1, T: 1, ST: 1 });

  const second = addFeature(first.catalog, { name: "Payouts", description: "" });
  expect(second.ok).toBe(true);
  if (!second.ok) {
    return;
  }
  expect(second.catalog.features[1]?.id).toMatch(/^F-[0-9A-F]{10}$/);
  expect(second.catalog.features[1]?.id).not.toBe(first.catalog.features[0]?.id);
  expect(second.catalog.sequences).toEqual({ F: 1, T: 1, ST: 1 });

  const reserved = addFeature(emptyCatalog(), { id: "f-7c9e2a1b4d", name: "Settlements" });
  expect(reserved.ok).toBe(true);
  if (!reserved.ok) {
    return;
  }
  expect(reserved.catalog.features[0]?.id).toBe("F-7C9E2A1B4D");
  const duplicate = addFeature(reserved.catalog, { id: "F-7C9E2A1B4D", name: "Again" });
  expect(duplicate.ok).toBe(false);
  if (duplicate.ok) {
    return;
  }
  expect(duplicate.error).toBe("F-7C9E2A1B4D is already in the catalog.");

  const withTask = addTask(reserved.catalog, "F-7C9E2A1B4D", { id: "T-AABBCCDDEE", name: "Refund API", description: "Endpoint", commitType: "feat" });
  expect(withTask.ok).toBe(true);
  if (!withTask.ok) {
    return;
  }
  const withSubtask = addSubtask(withTask.catalog, "F-7C9E2A1B4D", "T-AABBCCDDEE", { id: "ST-1122334455", name: "Validation", description: "Checks" });
  expect(withSubtask.ok).toBe(true);
  if (!withSubtask.ok) {
    return;
  }
  expect(withSubtask.catalog.features[0]?.tasks[0]?.subtasks[0]?.id).toBe("ST-1122334455");
  expect(withSubtask.catalog.sequences).toEqual({ F: 1, T: 1, ST: 1 });
});

test("existing numeric ids still parse and accept a commit", () => {
  const parsed = parseCatalog(JSON.stringify({
    features: [{
      id: "F-1",
      name: "Refunds",
      tasks: [{
        id: "T-1",
        name: "API",
        commitType: "feat",
        subtasks: [{ id: "ST-1", name: "Checks" }]
      }]
    }]
  }));
  const prepared = prepareCommit({
    type: "feat",
    summary: "add the check",
    featureId: "F-1",
    taskId: "T-1",
    subtaskId: "ST-1"
  }, parsed);
  expect(prepared.ok).toBe(true);
  expect(prepared.message).toContain("Feature: F-1\nTask: T-1\nSubtask: ST-1\n");
});

test("stamped rows sort ahead of numeric ids, newest first", () => {
  const parsed = parseCatalog(JSON.stringify({
    features: [
      { id: "F-1", name: "Older number" },
      { id: "F-9", name: "Newer number" },
      { id: "F-7C9E2A1B4D", name: "Earlier stamp", createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-01T00:00:00.000Z" },
      { id: "F-AABBCCDDEE", name: "Later stamp", createdAt: "2026-06-01T00:00:00.000Z", updatedAt: "2026-06-01T00:00:00.000Z" }
    ]
  }));
  expect([...parsed.features].sort(compareItemsDescending).map((feature) => feature.id)).toEqual([
    "F-AABBCCDDEE",
    "F-7C9E2A1B4D",
    "F-9",
    "F-1"
  ]);
});

test("a feature file round-trips and a folder assembles into one catalog", () => {
  const parsed = parseCatalog(JSON.stringify({
    sequences: { F: 10, T: 4, ST: 8 },
    features: [
      { id: "F-1", name: "Older number" },
      { id: "F-9", name: "Newer number" },
      { id: "F-7C9E2A1B4D", name: "Earlier stamp", createdAt: "2026-01-01T00:00:00.000Z" },
      { id: "F-AABBCCDDEE", name: "Later stamp", createdAt: "2026-06-01T00:00:00.000Z" }
    ]
  }));
  const files = parsed.features.map((feature) => ({
    name: `${feature.id}.json`,
    text: serializeFeature(feature)
  }));
  const loaded = files.map((file) => parseFeatureFile(file.text, file.name));
  expect(serializeFeature(loaded[0]!)).toBe(files[0]?.text);
  expect(() => parseFeatureFile(files[0]!.text, "F-9.json")).toThrow(/must be named F-1.json/);
  const assembled = catalogFromFeatures([loaded[2]!, loaded[0]!, loaded[3]!, loaded[1]!]);
  expect(assembled.features.map((feature) => feature.id)).toEqual([
    "F-AABBCCDDEE",
    "F-7C9E2A1B4D",
    "F-9",
    "F-1"
  ]);
  expect(assembled.sequences).toEqual({ F: 10, T: 1, ST: 1 });
  expect(() => catalogFromFeatures([loaded[0]!, loaded[0]!])).toThrow(/listed more than once/);
});

test("parseCatalog derives the next id when sequences are missing", () => {
  const parsed = parseCatalog(JSON.stringify({
    features: [{ id: "F-4", name: "Refunds", tasks: [{ id: "T-2", name: "API", subtasks: [] }] }]
  }));
  expect(parsed.sequences).toEqual({ F: 5, T: 3, ST: 1 });
  expect(parsed.features[0]?.description).toBe("");
  expect(parsed.features[0]?.active).toBe(true);
  expect(parsed.features[0]?.createdAt).toBe("");
  expect(parsed.features[0]?.createdBy).toBe("");
  expect(parsed.features[0]?.tasks[0]?.updatedAt).toBe("");
});

test("subtask status starts as to-do and completed subtasks count toward the task", () => {
  const parsed = parseCatalog(JSON.stringify({
    features: [{
      id: "F-2",
      name: "RAZOR_PAY",
      tasks: [{
        id: "T-1",
        name: "UI",
        subtasks: [
          { id: "ST-1", name: "Layout" },
          { id: "ST-2", name: "Spacing", status: "completed" },
          { id: "ST-3", name: "Copy", status: "in-progress" }
        ]
      }, {
        id: "T-2",
        name: "API",
        subtasks: [{ id: "ST-4", name: "Endpoint", status: "completed" }]
      }]
    }]
  }));
  expect(parsed.features[0]?.tasks[0]?.subtasks[0]?.status).toBe("todo");
  expect(subtaskProgress(parsed.features[0]!.tasks[0]!)).toEqual({ done: 1, total: 3 });
  expect(taskProgress(parsed.features[0]!)).toEqual({ done: 1, total: 2 });

  const updated = setSubtaskStatus(parsed, "F-2", "T-1", "ST-1", "completed");
  const task = updated.features[0]?.tasks.find((item) => item.id === "T-1");
  expect(task?.subtasks.find((item) => item.id === "ST-1")?.status).toBe("completed");
  expect(subtaskProgress(task!)).toEqual({ done: 2, total: 3 });
});

test("setFeatureActive keeps the feature and the next id", () => {
  const parsed = parseCatalog(JSON.stringify({
    sequences: { F: 3, T: 2, ST: 1 },
    features: [{
      id: "F-2",
      name: "RAZOR_PAY",
      description: "Init",
      createdAt: "2026-01-02T03:04:05.000Z",
      updatedAt: "2026-01-02T03:04:05.000Z",
      tasks: []
    }]
  }));
  const inactive = setFeatureActive(parsed, "F-2", false);
  expect(inactive.features).toHaveLength(1);
  expect(inactive.features[0]?.active).toBe(false);
  expect(inactive.features[0]?.createdAt).toBe("2026-01-02T03:04:05.000Z");
  expect(inactive.features[0]?.updatedAt).not.toBe("2026-01-02T03:04:05.000Z");
  expect(inactive.sequences.F).toBe(3);
});

test("a completed subtask or task can be promoted while the other is still open", () => {
  const openTask = {
    active: true,
    status: "" as const,
    subtasks: [
      { id: "ST-1", name: "API", description: "", active: true, status: "completed" as const, createdBy: "", createdAt: "", updatedAt: "" },
      { id: "ST-2", name: "UI", description: "", active: true, status: "in-progress" as const, createdBy: "", createdAt: "", updatedAt: "" }
    ]
  };
  expect(promotableSubtaskIds(openTask, ["ST-1", "ST-2"])).toEqual(["ST-1"]);
  expect(promotableSubtaskIds({ ...openTask, status: "completed", subtasks: openTask.subtasks.map((item) => ({ ...item, status: "todo" as const })) }, ["ST-1"])).toEqual([]);
  expect(promotableSubtaskIds({ ...openTask, subtasks: openTask.subtasks.map((item) => ({ ...item, status: "todo" as const })) }, ["ST-1"])).toBeNull();

  const ready = parseCatalog(JSON.stringify({
    features: [{
      id: "F-1",
      name: "SMS",
      tasks: [{
        id: "T-1",
        name: "Setup",
        subtasks: [
          { id: "ST-1", name: "API", status: "completed" },
          { id: "ST-2", name: "UI", status: "in-progress" }
        ]
      }]
    }]
  }));
  expect(isReadyToPromote(ready, { featureId: "F-1", taskId: "T-1", subtaskId: "ST-1" })).toBe(true);
  expect(isReadyToPromote(ready, { featureId: "F-1", taskId: "T-1", subtaskId: "ST-2" })).toBe(false);
  expect(isReadyToPromote(ready, { featureId: "F-1", taskId: "T-1", subtaskId: null })).toBe(false);
  const taskDone = parseCatalog(JSON.stringify({
    features: [{
      id: "F-1",
      name: "SMS",
      tasks: [{ id: "T-1", name: "Setup", status: "completed", subtasks: [] }]
    }]
  }));
  expect(isReadyToPromote(taskDone, { featureId: "F-1", taskId: "T-1", subtaskId: null })).toBe(true);
});

test("parseGitLog groups commits that share a parent feature", () => {
  const raw = [
    ["aaa111", "aaa", "Ada", "2026-10-01T00:00:00Z", "feat: api", "Feature: PAY-142\nTask: PAY-150\nSubtask: PAY-188"].join("\x1f"),
    ["bbb222", "bbb", "Ben", "2026-10-02T00:00:00Z", "feat: screen", "Feature: PAY-142"].join("\x1f"),
    ["ccc333", "ccc", "Cara", "2026-10-03T00:00:00Z", "chore: notes", "No trailer"].join("\x1f"),
    ["ddd444", "ddd", "Kewin", "2026-11-01T12:00:00Z", "feat: setup init", "Feature: F-A695F29394\nTask: T-A374407A87\nSubtask: ST-6076324777"].join("\x1f")
  ].join("\x1e") + "\x1e";

  const commits = parseGitLog(raw);
  const groups = groupByFeature(commits);

  expect(groups[0]?.id).toBe("PAY-142");
  expect(groups[0]?.commits.length).toBe(2);
  expect(groups[0]?.commits[0]?.taskId).toBe("PAY-150");
  expect(groups[0]?.commits[0]?.subtaskId).toBe("PAY-188");
  expect(groups.find((group) => group.id === "F-A695F29394")?.commits[0]?.subtaskId).toBe("ST-6076324777");
  expect(groups.find((group) => group.label === "Unscoped")?.commits).toHaveLength(1);
});

test("planPromotion lists oldest commits first and skips ones already on the target", () => {
  const manifest = {
    ...parseManifest(JSON.stringify({
      ...defaultManifest(),
      environments: {
        ...defaultManifest().environments,
        QAS: {
          branch: "qas",
          features: {
            "PAY-142": { commits: [{ source: "older", promoted: "qas-sha" }] }
          }
        }
      }
    })),
    exists: true
  };

  const plan = planPromotion({
    featureId: "PAY-142",
    target: "QAS",
    branch: "dev",
    manifest,
    commitsNewestFirst: [
      { sha: "newer", featureId: "PAY-142", subject: "second" },
      { sha: "older", featureId: "PAY-142", subject: "first" },
      { sha: "other", featureId: "PAY-200", subject: "elsewhere" }
    ]
  });

  expect(plan.ok).toBe(true);
  if (!plan.ok) {
    return;
  }
  expect(plan.pending.map((commit) => commit.sha)).toEqual(["newer"]);
  expect(plan.already.map((commit) => commit.sha)).toEqual(["older"]);
  expect(environmentsForFeature("PAY-142", manifest)).toEqual(["QAS"]);
});

test("withBranchNames keeps promoted commits and rejects a shared branch", () => {
  const manifest = parseManifest(JSON.stringify({
    devBranch: "dev",
    environments: {
      QAS: { branch: "qas", features: { "F-2": { commits: [{ source: "abc", promoted: "def" }] } } },
      UAT: { branch: "uat", features: {} },
      PROD: { branch: "main", features: {} }
    }
  }));
  const renamed = withBranchNames(manifest, { DEV: "develop", QAS: "release/qas", UAT: "uat", PROD: "main" });
  expect(renamed.ok).toBe(true);
  if (!renamed.ok) {
    return;
  }
  expect(renamed.manifest.devBranch).toBe("develop");
  expect(renamed.manifest.environments.DEV.branch).toBe("develop");
  expect(renamed.manifest.environments.QAS.branch).toBe("release/qas");
  expect(renamed.manifest.environments.QAS.features["F-2"]?.commits[0]?.source).toBe("abc");

  const shared = withBranchNames(manifest, { DEV: "main", QAS: "qas", UAT: "uat", PROD: "main" });
  expect(shared.ok).toBe(false);
});

test("guardPreparation refuses a dirty tree, a diverged base, an existing promote branch, and a merge past DEV", () => {
  const ready = {
    dirty: false,
    featureId: "F-2",
    target: "DEV" as const,
    mode: "merge" as const,
    sourceBranch: "portfolio-revamp",
    baseBranch: "dev",
    baseExistsLocally: true,
    baseExistsOnOrigin: true,
    canFastForward: true,
    promoteBranchExists: false,
    pendingCount: 2
  };
  expect(guardPreparation(ready)).toEqual({ ok: true, branch: "promote/dev/F-2" });
  expect(guardPreparation({ ...ready, dirty: true }).ok).toBe(false);
  expect(guardPreparation({ ...ready, canFastForward: false }).ok).toBe(false);
  expect(guardPreparation({ ...ready, promoteBranchExists: true })).toEqual({
    ok: false,
    error: "promote/dev/F-2 already exists."
  });
  expect(promoteBranchName("qas", "f-2")).toBe("promote/qas/F-2");
  expect(guardPreparation({ ...ready, target: "QAS", mode: "merge" }).ok).toBe(false);
  expect(guardPreparation({ ...ready, sourceBranch: "dev" }).ok).toBe(false);
});

test("recordPrepared stores the branch without marking the feature as already promoted", () => {
  const manifest = defaultManifest();
  manifest.environments.QAS.features["F-2"] = { commits: [{ source: "abc", promoted: "def" }] };
  const next = recordPrepared(manifest, "DEV", "f-2", {
    branch: "promote/dev/F-2",
    sourceBranch: "portfolio-revamp",
    mode: "merge",
    squash: false,
    baseSha: "abc123def"
  });
  expect(next.prepared.DEV?.["F-2"]).toEqual({
    branch: "promote/dev/F-2",
    sourceBranch: "portfolio-revamp",
    mode: "merge",
    squash: false,
    baseSha: "abc123def"
  });
  expect(next.environments.QAS.features["F-2"]?.commits).toEqual([{ source: "abc", promoted: "def" }]);
  expect(next.environments.DEV.features).toEqual({});
  const parsed = parseManifest(JSON.stringify(next));
  expect(parsed.prepared.DEV?.["F-2"]?.baseSha).toBe("abc123def");
  const renamed = withBranchNames(next, { DEV: "develop", QAS: "qas", UAT: "uat", PROD: "main" });
  expect(renamed.ok).toBe(true);
  if (!renamed.ok) {
    return;
  }
  expect(renamed.manifest.prepared.DEV?.["F-2"]?.branch).toBe("promote/dev/F-2");
  expect(renamed.manifest.environments.QAS.features["F-2"]?.commits[0]?.source).toBe("abc");
});

test("a selected subtask moves without the rest of the feature", () => {
  const nodes = promotionNodes(
    [{ id: "F-2", tasks: [{ id: "T-1", subtasks: [{ id: "ST-1" }, { id: "ST-2" }] }, { id: "T-2", subtasks: [{ id: "ST-3" }] }] }],
    [
      { featureId: "F-2", taskId: "T-1", subtaskId: "ST-1" },
      { featureId: "F-2", taskId: "T-1", subtaskId: "ST-2" },
      { featureId: "F-2", taskId: "T-2", subtaskId: "ST-3" },
      { featureId: "F-2", taskId: null, subtaskId: null }
    ]
  );
  const selected = toggleSubtask(nodes, { featureIds: [], taskIds: [], subtaskIds: [] }, "ST-1");
  expect(selected).toEqual({ featureIds: [], taskIds: [], subtaskIds: ["ST-1"] });
  expect(selectionBranchName("dev", nodes, selected)).toBe("promote/dev/F-2/ST-1");
  const whole = toggleFeature(nodes, { featureIds: [], taskIds: [], subtaskIds: [] }, "F-2");
  expect(wholeFeatureSelection(nodes, whole)).toBe("F-2");
  expect(selectionBranchName("dev", nodes, whole)).toBe("promote/dev/F-2");
  const oneTask = toggleTask(nodes, { featureIds: [], taskIds: [], subtaskIds: [] }, "T-2");
  expect(oneTask.taskIds).toEqual(["T-2"]);
  expect(oneTask.subtaskIds).toEqual(["ST-3"]);
  expect(selectionBranchName("qas", nodes, oneTask)).toBe("promote/qas/F-2/T-2");
  const several = toggleSubtask(nodes, toggleSubtask(nodes, { featureIds: [], taskIds: [], subtaskIds: [] }, "ST-1"), "ST-3");
  expect(selectionBranchName("dev", nodes, several)).toBe("promote/dev/F-2/partial");

  const commits = [
    { sha: "sub", featureId: "F-2", taskId: "T-1", subtaskId: "ST-1", subject: "one" },
    { sha: "sib", featureId: "F-2", taskId: "T-1", subtaskId: "ST-2", subject: "two" },
    { sha: "bare", featureId: "F-2", taskId: null, subtaskId: null, subject: "feature only" }
  ];
  expect(commits.filter((commit) => commitInSelection(commit, selected)).map((commit) => commit.sha)).toEqual(["sub"]);
  expect(commits.filter((commit) => commitInSelection(commit, whole)).map((commit) => commit.sha)).toEqual(["sub", "sib", "bare"]);
  const plan = planPromotion({
    featureIds: whole.featureIds,
    taskIds: whole.taskIds,
    subtaskIds: whole.subtaskIds,
    target: "QAS",
    branch: "dev",
    manifest: defaultManifest(),
    commitsNewestFirst: [...commits].reverse()
  });
  expect(plan.ok).toBe(true);
  if (!plan.ok) {
    return;
  }
  expect(plan.pending.map((commit) => commit.sha)).toEqual(["sub", "sib", "bare"]);
  expect(environmentPresence(["sub", "sib"], { QAS: ["sub"] })).toEqual({ on: [], partial: ["QAS"] });
  expect(environmentPresence(["sub"], { DEV: ["sub"], QAS: ["sub"] })).toEqual({ on: ["DEV", "QAS"], partial: [] });
  expect(environmentPresence(["sib"], { DEV: ["sub"], QAS: ["sub"] })).toEqual({ on: [], partial: [] });
  expect(environmentPresence(["sub", "sib"], { DEV: ["sub"] })).toEqual({ on: [], partial: ["DEV"] });
});

test("planPromotion includes DEV and keeps the work branch as a valid source", () => {
  const plan = planPromotion({
    featureId: "F-2",
    target: "DEV",
    branch: "portfolio-revamp",
    manifest: defaultManifest(),
    commitsNewestFirst: [
      { sha: "newer", featureId: "F-2", subject: "second" },
      { sha: "older", featureId: "F-2", subject: "first" }
    ]
  });
  expect(plan.ok).toBe(true);
  if (!plan.ok) {
    return;
  }
  expect(plan.branch).toBe("dev");
  expect(plan.pending.map((commit) => commit.sha)).toEqual(["older", "newer"]);
  expect(plan.warnings.some((warning) => warning.code === "source-branch")).toBe(false);
});

test("a manifest without a DEV block loads an empty ledger on the dev branch", () => {
  const parsed = parseManifest(JSON.stringify({
    devBranch: "develop",
    environments: {
      QAS: { branch: "qas", features: {} },
      UAT: { branch: "uat", features: {} },
      PROD: { branch: "main", features: {} }
    }
  }));
  expect(parsed.devBranch).toBe("develop");
  expect(parsed.environments.DEV).toEqual({ branch: "develop", features: {} });
});

test("marking a plan records its pending commits once, and one subtask can be on DEV alone", () => {
  const manifest = defaultManifest();
  const before = JSON.stringify(manifest);
  const commits = [
    { sha: "sub", featureId: "F-2", taskId: "T-1", subtaskId: "ST-1", subject: "one" },
    { sha: "sib", featureId: "F-2", taskId: "T-1", subtaskId: "ST-2", subject: "two" }
  ];
  const plan = planPromotion({
    featureIds: [],
    taskIds: [],
    subtaskIds: ["ST-1"],
    target: "DEV",
    branch: "portfolio-revamp",
    manifest,
    commitsNewestFirst: [...commits].reverse()
  });
  expect(JSON.stringify(manifest)).toBe(before);
  expect(plan.ok).toBe(true);
  if (!plan.ok) {
    return;
  }
  expect(plan.pending.map((commit) => commit.sha)).toEqual(["sub"]);
  const marked = recordPromotion(manifest, plan.target, plan.pending);
  expect(marked.environments.DEV.features["F-2"]?.commits).toEqual([{ source: "sub", promoted: "" }]);
  expect(marked.environments.QAS.features).toEqual({});
  const again = recordPromotion(marked, "DEV", plan.pending);
  expect(again.environments.DEV.features["F-2"]?.commits).toEqual([{ source: "sub", promoted: "" }]);
  expect(environmentPresence(["sub"], { DEV: ["sub"] })).toEqual({ on: ["DEV"], partial: [] });
  expect(environmentPresence(["sib"], { DEV: ["sub"] })).toEqual({ on: [], partial: [] });
  const next = planPromotion({
    featureIds: [],
    taskIds: [],
    subtaskIds: ["ST-1", "ST-2"],
    target: "DEV",
    manifest: again,
    commitsNewestFirst: [...commits].reverse()
  });
  expect(next.ok).toBe(true);
  if (!next.ok) {
    return;
  }
  expect(next.pending.map((commit) => commit.sha)).toEqual(["sib"]);
  expect(next.already.map((commit) => commit.sha)).toEqual(["sub"]);
  const prepared = recordPrepared(again, "DEV", "F-2", {
    branch: "promote/dev/F-2/ST-2",
    sourceBranch: "portfolio-revamp",
    mode: "cherry-pick",
    squash: false,
    baseSha: "base"
  });
  expect(prepared.environments.DEV.features["F-2"]?.commits).toEqual([{ source: "sub", promoted: "" }]);
  expect(prepared.prepared.DEV?.["F-2"]?.branch).toBe("promote/dev/F-2/ST-2");
});

test("squashCommitMessage marks the commit and lists each included commit", () => {
  const message = squashCommitMessage("f-2", [
    { sha: "aaaaaaaaaaaa", shortSha: "aaaaaaa", subject: "Setup", taskId: "T-1", subtaskId: "ST-1" },
    { sha: "bbbbbbbbbbbb", shortSha: "bbbbbbb", subject: "Wire the client", taskId: "T-1", subtaskId: "ST-2" }
  ]);
  expect(message.startsWith("squash: F-2\n")).toBe(true);
  expect(message).toContain("Feature: F-2\n");
  expect(message).toContain("Prepared: squash\n");
  expect(message).not.toMatch(/^Task:/m);
  expect(message).not.toMatch(/^Subtask:/m);
  expect(message).toContain("- aaaaaaa T-1 ST-1 Setup");
  expect(message).toContain("- bbbbbbb T-1 ST-2 Wire the client");
});

test("promotionRecordMessage records the ledger without a task or subtask", () => {
  const message = promotionRecordMessage("DEV", [
    { sha: "aaaaaaaaaaaa", shortSha: "aaaaaaa", subject: "Setup", featureId: "f-2" },
    { sha: "bbbbbbbbbbbb", shortSha: "bbbbbbb", subject: "Wire the client", featureId: "F-3" }
  ]);
  expect(message.startsWith("chore: record promotion on DEV\n")).toBe(true);
  expect(message).toContain("Prepared: promoted\n");
  expect(message).toContain("Feature: F-2\n");
  expect(message).toContain("Feature: F-3\n");
  expect(message).toContain("- aaaaaaa Setup");
  expect(message).not.toMatch(/^Task:/m);
  expect(message).not.toMatch(/^Subtask:/m);
});

test("mergeCommitMessage carries the feature and the merge marker", () => {
  const message = mergeCommitMessage("F-3", [
    { sha: "cccccccccccc", shortSha: "ccccccc", subject: "Add the form", taskId: "T-2", subtaskId: "ST-4" }
  ]);
  expect(message.startsWith("merge: F-3\n")).toBe(true);
  expect(message).toContain("Feature: F-3\n");
  expect(message).toContain("Prepared: merge\n");
  expect(message).toContain("- ccccccc T-2 ST-4 Add the form");
});
