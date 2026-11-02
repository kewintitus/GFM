import { useState } from "react";
import { COMMIT_TYPES, type CommitType } from "@shared/commit-message";
import { emptyCatalog } from "@shared/catalog";
import { operationLabel } from "@shared/operation";
import { StageTree } from "./StageTree";
import { useWorkspace } from "../workspace";

export function ConflictsView() {
  const { snapshot, busy, stagePaths, unstagePaths, continueOperation, skipOperation, abortOperation, commitOperation } = useWorkspace();
  const operation = snapshot?.operation ?? null;
  const catalog = snapshot?.catalog.data ?? emptyCatalog();
  const [type, setType] = useState<CommitType>("feat");
  const [summary, setSummary] = useState("");
  const [featureId, setFeatureId] = useState("");
  const [taskId, setTaskId] = useState("");
  const [subtaskId, setSubtaskId] = useState("");
  const features = catalog.features.filter((item) => item.active !== false);
  const feature = features.find((item) => item.id === featureId);
  const tasks = feature?.tasks.filter((item) => item.active !== false) ?? [];
  const task = tasks.find((item) => item.id === taskId);
  const subtasks = task?.subtasks.filter((item) => item.active !== false) ?? [];
  const lockedType = task?.commitType || "";
  const chosenType = lockedType || type;
  const canMessage = operation?.kind === "cherry-pick" || operation?.kind === "merge" || operation?.kind === "squash";

  const submitMessage = () => {
    void commitOperation({
      type: chosenType,
      summary,
      featureId,
      taskId,
      subtaskId,
      noVerify: true
    }).then((ok) => {
      if (ok) {
        setSummary("");
      }
    });
  };

  return (
    <section className="page">
      <header className="page-head">
        <p className="eyebrow">Working tree</p>
        <h1>Resolve conflicts</h1>
        <p className="lede">Fix the files in your editor, stage them here, then continue. Continue keeps the original message and skips the commit hook.</p>
      </header>
      {!operation ? (
        <div className="empty">No cherry-pick or merge is in progress.</div>
      ) : (
        <div className="conflict-layout">
          <div className="conflict-main">
            <article className="conflict-card">
              <p className="eyebrow">{operationLabel(operation.kind)}</p>
              <h2>{operation.subject || "Untitled commit"}</h2>
              {operation.kind === "cherry-pick" && operation.remaining > 0 ? (
                <p className="meta">{operation.remaining} {operation.remaining === 1 ? "commit" : "commits"} left after this one.</p>
              ) : null}
              {operation.kind === "squash" ? (
                <p className="meta">Continue is unavailable until this is a normal merge or cherry-pick. Abort clears it. A new message can still record the staged resolution.</p>
              ) : null}
              {operation.kind === "rebase" || operation.kind === "revert" ? (
                <p className="meta">Abort is available for this {operationLabel(operation.kind).toLowerCase()}. Continue and skip stay on cherry-pick and merge.</p>
              ) : null}
              {operation.conflicted.length > 0 ? (
                <ul className="warnings">
                  {operation.conflicted.map((file) => <li key={file}>{file}</li>)}
                </ul>
              ) : (
                <p className="meta">No unmerged files remain.</p>
              )}
              <div className="action-row">
                <button type="button" className="primary" disabled={busy || !operation.canContinue} onClick={() => void continueOperation()}>
                  Continue
                </button>
                <button type="button" className="ghost" disabled={busy || !operation.canSkip} onClick={() => void skipOperation()}>
                  Skip
                </button>
                <button type="button" className="ghost" disabled={busy || !operation.canAbort} onClick={() => void abortOperation()}>
                  Abort
                </button>
              </div>
            </article>
            {canMessage ? (
              <form
                className="conflict-card"
                onSubmit={(event) => {
                  event.preventDefault();
                  submitMessage();
                }}
              >
                <h2>Commit this step with a new message</h2>
                <p className="meta">This finishes the current step. The completed-subtask check is skipped, and the hook is not run.</p>
                <label className="field">
                  <span>Type</span>
                  <select value={chosenType} disabled={busy || Boolean(lockedType)} onChange={(event) => setType(event.target.value as CommitType)}>
                    {COMMIT_TYPES.map((item) => <option key={item} value={item}>{item}</option>)}
                  </select>
                </label>
                <label className="field">
                  <span>Summary</span>
                  <input value={summary} disabled={busy} onChange={(event) => setSummary(event.target.value)} />
                </label>
                <label className="field">
                  <span>Feature</span>
                  <select
                    value={featureId}
                    disabled={busy}
                    onChange={(event) => {
                      setFeatureId(event.target.value);
                      setTaskId("");
                      setSubtaskId("");
                    }}
                  >
                    <option value="">Select a feature</option>
                    {features.map((item) => <option key={item.id} value={item.id}>{item.name} · {item.id}</option>)}
                  </select>
                </label>
                <label className="field">
                  <span>Task</span>
                  <select
                    value={taskId}
                    disabled={busy || !feature}
                    onChange={(event) => {
                      setTaskId(event.target.value);
                      setSubtaskId("");
                    }}
                  >
                    <option value="">Select a task</option>
                    {tasks.map((item) => <option key={item.id} value={item.id}>{item.name} · {item.id}</option>)}
                  </select>
                </label>
                <label className="field">
                  <span>Subtask</span>
                  <select value={subtaskId} disabled={busy || !task} onChange={(event) => setSubtaskId(event.target.value)}>
                    <option value="">Select a subtask</option>
                    {subtasks.map((item) => <option key={item.id} value={item.id}>{item.name} · {item.id}</option>)}
                  </select>
                </label>
                <button type="submit" className="primary" disabled={busy || operation.conflicted.length > 0}>
                  Commit this step
                </button>
              </form>
            ) : null}
          </div>
          <StageTree changes={snapshot?.changes ?? []} busy={busy} onStage={(paths) => void stagePaths(paths)} onUnstage={(paths) => void unstagePaths(paths)} />
        </div>
      )}
    </section>
  );
}
