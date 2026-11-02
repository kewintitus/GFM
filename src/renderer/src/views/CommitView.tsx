import { useEffect, useState } from "react";
import { COMMIT_TYPES, prepareCommit, type CommitType } from "@shared/commit-message";
import { canCompleteFeature, canCompleteTask, emptyCatalog } from "@shared/catalog";
import { isStaged } from "@shared/status";
import { Autocomplete } from "../Autocomplete";
import { useWorkspace } from "../workspace";
import { StageTree } from "./StageTree";

interface FieldErrors {
  type?: string;
  summary?: string;
  featureId?: string;
  taskId?: string;
  subtaskId?: string;
}

function fieldErrors(errors: string[]): FieldErrors {
  return {
    type: errors.find((error) => error.includes("commit type")),
    summary: errors.find((error) => /summary/i.test(error)),
    featureId: errors.find((error) => error.startsWith("Choose a feature") || error.startsWith("Feature ")),
    taskId: errors.find((error) => error.startsWith("Choose a task") || error.startsWith("Task ")),
    subtaskId: errors.find((error) => /subtask/i.test(error))
  };
}

export function CommitView() {
  const { snapshot, role, busy, installHook, removeHook, commit, stagePaths, unstagePaths, setView } = useWorkspace();
  const [type, setType] = useState<CommitType>("feat");
  const [summary, setSummary] = useState("");
  const [featureId, setFeatureId] = useState("");
  const [taskId, setTaskId] = useState("");
  const [subtaskId, setSubtaskId] = useState("");
  const [push, setPush] = useState(false);
  const [noVerify, setNoVerify] = useState(false);
  const [completeSubtask, setCompleteSubtask] = useState(false);
  const [completeTask, setCompleteTask] = useState(false);
  const [completeFeature, setCompleteFeature] = useState(false);
  const [attempted, setAttempted] = useState(false);
  const catalog = snapshot?.catalog?.data ?? emptyCatalog();
  const features = catalog.features.filter((item) => item.active !== false && item.tasks.some((task) => openTask(task)));
  const feature = features.find((item) => item.id === featureId);
  const tasks = feature?.tasks.filter((task) => openTask(task)) ?? [];
  const task = tasks.find((item) => item.id === taskId);
  const subtasks = task?.subtasks.filter((item) => item.active !== false && item.status !== "completed") ?? [];
  const subtask = subtasks.find((item) => item.id === subtaskId);
  const lockedType = task?.commitType ? task.commitType : "";
  const typeOptions = lockedType ? [lockedType] : [...COMMIT_TYPES];
  const selectedFeature = feature?.id ?? "";
  const selectedTask = task?.id ?? "";
  const selectedSubtask = subtask?.id ?? "";
  const taskReady = Boolean(task && canCompleteTask(task, completeSubtask ? selectedSubtask : ""));
  const featureReady = Boolean(feature && canCompleteFeature(feature, completeTask && taskReady ? selectedTask : "", completeSubtask ? selectedSubtask : ""));
  const changes = snapshot?.changes ?? [];
  const stagedCount = changes.filter((change) => isStaged(change.code)).length;
  const prepared = prepareCommit({
    type,
    summary,
    featureId: selectedFeature,
    taskId: selectedTask,
    subtaskId: selectedSubtask
  }, catalog);
  const errors = attempted ? fieldErrors(prepared.errors) : {};
  const contributor = role === "contributor";
  const canSubmit = contributor && Boolean(snapshot?.repoPath) && !busy;
  const [timelineOpen, setTimelineOpen] = useState(false);
  const timeline = timelineCommits(snapshot?.features ?? []);

  useEffect(() => {
    if (lockedType && type !== lockedType) {
      setType(lockedType);
    }
  }, [lockedType, type]);

  useEffect(() => {
    if (!taskReady && completeTask) {
      setCompleteTask(false);
    }
  }, [taskReady, completeTask]);

  useEffect(() => {
    if (!featureReady && completeFeature) {
      setCompleteFeature(false);
    }
  }, [featureReady, completeFeature]);

  const submit = async () => {
    setAttempted(true);
    if (!prepared.ok || stagedCount === 0) {
      return;
    }
    const created = await commit({
      type,
      summary,
      featureId: selectedFeature,
      taskId: selectedTask,
      subtaskId: selectedSubtask,
      push,
      noVerify,
      completeSubtask: completeSubtask && Boolean(selectedSubtask),
      completeTask: completeTask && taskReady,
      completeFeature: completeFeature && featureReady
    });
    if (!created) {
      return;
    }
    setSummary("");
    setTaskId("");
    setSubtaskId("");
    setCompleteSubtask(false);
    setCompleteTask(false);
    setCompleteFeature(false);
    setAttempted(false);
  };

  return (
    <section className="page">
      <header className="page-head">
        <p className="eyebrow">Working tree</p>
        <h1>Commit to a feature</h1>
        <p className="lede">Choose the feature, task, and subtask from the catalog. Typed ticket ids are not accepted.</p>
      </header>
      {!contributor ? <p className="note">Switch to Contributor to create a commit.</p> : null}
      <div className="commit-layout">
        <div className="commit-form">
          <HookRow
            installed={Boolean(snapshot?.hookInstalled)}
            busy={busy}
            onInstall={() => void installHook()}
            onRemove={() => void removeHook()}
          />
          {features.length === 0 ? (
            <p className="note">
              {catalog.features.length === 0 ? "No features are defined yet. " : "Every subtask is completed. "}
              <button type="button" className="text-button" onClick={() => setView("catalog")}>Open Catalog</button>
            </p>
          ) : null}
          <form
            onSubmit={(event) => {
              event.preventDefault();
              void submit();
            }}
          >
            <fieldset>
              <legend>Change</legend>
              <label className="field field-short">
                <span>Type</span>
                <Autocomplete
                  value={lockedType || type}
                  allowEmpty={false}
                  disabled={busy || Boolean(lockedType)}
                  invalid={Boolean(errors.type)}
                  options={typeOptions.map((item) => ({ value: item, label: item }))}
                  onChange={(next) => setType(next as CommitType)}
                />
                {errors.type ? <small>{errors.type}</small> : null}
              </label>
              <label className="field">
                <span className="field-line">
                  Summary
                  <em className={summary.length > 72 ? "counter over" : "counter"}>{summary.length}/72</em>
                </span>
                <input value={summary} disabled={busy} placeholder="add refund endpoint" onChange={(event) => setSummary(event.target.value)} aria-invalid={Boolean(errors.summary)} />
                {errors.summary ? <small>{errors.summary}</small> : null}
              </label>
            </fieldset>
            <fieldset>
              <legend>Work item</legend>
              <div className="thirds">
                <label className="field">
                  <span>Feature</span>
                  <Autocomplete
                    value={selectedFeature}
                    disabled={busy || features.length === 0}
                    invalid={Boolean(errors.featureId)}
                    placeholder={features.length === 0 ? "No features" : "Select a feature"}
                    options={features.map((item) => ({ value: item.id, label: `${item.id} · ${item.name}` }))}
                    onChange={(next) => {
                      setFeatureId(next);
                      setTaskId("");
                      setSubtaskId("");
                    }}
                  />
                  {errors.featureId ? <small>{errors.featureId}</small> : null}
                </label>
                <label className="field">
                  <span>Task</span>
                  <Autocomplete
                    value={selectedTask}
                    disabled={busy || !feature || tasks.length === 0}
                    invalid={Boolean(errors.taskId)}
                    placeholder={feature && tasks.length === 0 ? "No tasks" : "Select a task"}
                    options={tasks.map((item) => ({ value: item.id, label: `${item.id} · ${item.name}` }))}
                    onChange={(next) => {
                      setTaskId(next);
                      setSubtaskId("");
                    }}
                  />
                  {errors.taskId ? <small>{errors.taskId}</small> : null}
                </label>
                <label className="field">
                  <span>Subtask</span>
                  <Autocomplete
                    value={selectedSubtask}
                    disabled={busy || !task || subtasks.length === 0}
                    invalid={Boolean(errors.subtaskId)}
                    placeholder={task && subtasks.length === 0 ? "No open subtasks" : "Select a subtask"}
                    options={subtasks.map((item) => ({ value: item.id, label: `${item.id} · ${item.name}` }))}
                    onChange={setSubtaskId}
                  />
                  {errors.subtaskId ? <small>{errors.subtaskId}</small> : null}
                </label>
              </div>
            </fieldset>
            <fieldset>
              <legend>Mark completed</legend>
              <div className="commit-options">
                <label className="check">
                  <input type="checkbox" checked={completeSubtask && Boolean(selectedSubtask)} disabled={busy || !selectedSubtask} onChange={(event) => setCompleteSubtask(event.target.checked)} />
                  <span>Subtask</span>
                </label>
                <label className="check" title={taskReady ? undefined : "Complete every subtask first."}>
                  <input type="checkbox" checked={completeTask && taskReady} disabled={busy || !taskReady} onChange={(event) => setCompleteTask(event.target.checked)} />
                  <span>Task</span>
                </label>
                <label className="check" title={featureReady ? undefined : "Complete every task first."}>
                  <input type="checkbox" checked={completeFeature && featureReady} disabled={busy || !featureReady} onChange={(event) => setCompleteFeature(event.target.checked)} />
                  <span>Feature</span>
                </label>
              </div>
              <p className="note">The work commit is created first. A second commit on this branch records the catalog status.</p>
            </fieldset>
            <div className="commit-actions">
              <div className="commit-options">
                <label className="check">
                  <input type="checkbox" checked={push} disabled={busy} onChange={(event) => setPush(event.target.checked)} />
                  <span>Push after the commit</span>
                </label>
                <label className="check">
                  <input type="checkbox" checked={noVerify} disabled={busy} onChange={(event) => setNoVerify(event.target.checked)} />
                  <span>Skip hooks (--no-verify)</span>
                </label>
              </div>
              <button type="submit" className="primary" disabled={!canSubmit}>
                {push ? "Commit and push" : "Create commit"}
              </button>
            </div>
            {attempted && stagedCount === 0 ? <small className="field-error">Stage at least one file in the tree.</small> : null}
          </form>
        </div>
        <div className="commit-side">
          <StageTree
            changes={changes}
            busy={busy || !contributor}
            onStage={(paths) => void stagePaths(paths)}
            onUnstage={(paths) => void unstagePaths(paths)}
          />
          <section className="timeline">
            <button type="button" aria-expanded={timelineOpen} onClick={() => setTimelineOpen((open) => !open)}>
              <span>
                <strong>Timeline</strong>
                <span className="meta">{timeline.length}</span>
              </span>
              <em>{timelineOpen ? "Hide" : "Show"}</em>
            </button>
            {timelineOpen ? (
              timeline.length === 0 ? <p className="empty">No commits on this branch yet.</p> : (
                <ol className="timeline-list">
                  {timeline.map((commit, index) => (
                    <li key={commit.sha}>
                      <span className={index === 0 ? "timeline-dot is-head" : "timeline-dot"} />
                      <span>
                        <strong>{commit.subject || "Untitled commit"}</strong>
                        <span className="meta">
                          {index === 0 && snapshot?.branch ? <em>{snapshot.branch}</em> : null}
                          {commit.author}
                          {commit.date ? ` · ${formatCommitDate(commit.date)}` : ""}
                        </span>
                      </span>
                    </li>
                  ))}
                </ol>
              )
            ) : null}
          </section>
        </div>
      </div>
    </section>
  );
}

function timelineCommits(groups: { commits: { sha: string; shortSha: string; author: string; date: string; subject: string; featureId: string | null; taskId: string | null; subtaskId: string | null }[] }[]) {
  const seen = new Set<string>();
  return groups
    .flatMap((group) => group.commits)
    .filter((commit) => {
      if (seen.has(commit.sha)) {
        return false;
      }
      seen.add(commit.sha);
      return true;
    })
    .sort((left, right) => Date.parse(right.date) - Date.parse(left.date));
}

function formatCommitDate(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return "";
  }
  return date.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

function openTask(task: { active: boolean; subtasks: { active: boolean; status: string }[] }): boolean {
  return task.active !== false && task.subtasks.some((item) => item.active !== false && item.status !== "completed");
}

function HookRow({
  installed,
  busy,
  onInstall,
  onRemove
}: {
  installed: boolean;
  busy: boolean;
  onInstall: () => void;
  onRemove: () => void;
}) {
  return (
    <div className={installed ? "status-row is-ok" : "status-row"}>
      <span className="dot" />
      <div>
        <strong>{installed ? "Commit hook installed" : "Commit hook not installed"}</strong>
        <p>{installed ? "Commits made outside this app are checked for a Feature, Task, and Subtask trailer." : "Install it so a commit made outside this app stays structured."}</p>
      </div>
      {installed ? (
        <button type="button" className="ghost" disabled={busy} onClick={onRemove}>Remove</button>
      ) : (
        <button type="button" className="ghost" disabled={busy} onClick={onInstall}>Install</button>
      )}
    </div>
  );
}
