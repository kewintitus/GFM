import { useEffect, useRef, useState } from "react";
import { findFeature, findTask, isReadyToPromote, promotableSubtaskIds, type Catalog } from "@shared/catalog";
import { ENV_RAIL, branchNames, type EnvironmentName } from "@shared/manifest";
import type { PromotionPlan } from "@shared/plan";
import { promotionNodes, selectionBranchName, toggleFeature, toggleSubtask, toggleTask, wholeFeatureSelection, type PrepareMode, type PromotionNode, type PromotionSelection } from "@shared/promote";
import { MultiAutocomplete } from "../Autocomplete";
import { ManifestCallout } from "../bits";
import { useWorkspace } from "../workspace";

const emptySelection: PromotionSelection = { featureIds: [], taskIds: [], subtaskIds: [] };

function completedNodes(catalog: Catalog | undefined, nodes: PromotionNode[]): PromotionNode[] {
  if (!catalog) {
    return [];
  }
  return nodes.flatMap((node) => {
    const feature = findFeature(catalog, node.id);
    if (!feature || feature.active === false) {
      return [];
    }
    const tasks = node.tasks.flatMap((task) => {
      const named = findTask(catalog, node.id, task.id);
      if (!named) {
        return [];
      }
      const subtaskIds = promotableSubtaskIds(named, task.subtaskIds);
      if (!subtaskIds) {
        return [];
      }
      return [{ id: task.id, subtaskIds }];
    });
    if (tasks.length === 0) {
      return [];
    }
    return [{ id: node.id, tasks }];
  });
}

export function PromoteView() {
  const { snapshot, role, busy, buildPlan, markPromoted, preparePromotion } = useWorkspace();
  const tagged = (snapshot?.features ?? []).filter((feature) => feature.id);
  const [selection, setSelection] = useState<PromotionSelection>(emptySelection);
  const [target, setTarget] = useState<EnvironmentName>("DEV");
  const [mode, setMode] = useState<PrepareMode>("cherry-pick");
  const [squash, setSquash] = useState(false);
  const [plan, setPlan] = useState<PromotionPlan | null>(null);
  const [plannedKey, setPlannedKey] = useState("");
  const releaseManager = role === "release";
  const names = snapshot ? branchNames(snapshot.manifest.data) : null;
  const catalog = snapshot?.catalog.data;
  const promotable = tagged.flatMap((feature) => feature.commits).filter((commit) => catalog && isReadyToPromote(catalog, commit));
  const nodes = completedNodes(catalog, promotionNodes(catalog?.features ?? [], promotable));
  const whole = wholeFeatureSelection(nodes, selection);
  const selectionKey = [...selection.featureIds, ...selection.taskIds, ...selection.subtaskIds].join("|");
  const chosen = selection.featureIds.length + selection.taskIds.length + selection.subtaskIds.length > 0;

  useEffect(() => {
    setMode(target === "DEV" && whole ? "merge" : "cherry-pick");
  }, [target, whole]);

  const described = selection.featureIds.length === 1 && snapshot ? findFeature(snapshot.catalog.data, selection.featureIds[0] ?? "") : undefined;
  const readyPlan = plan && plan.ok && plan.target === target && plannedKey === selectionKey ? plan : null;
  const preparedId = whole || (selection.featureIds.length === 1 ? selection.featureIds[0] : "");
  const prepared = preparedId ? snapshot?.manifest.data.prepared[target]?.[preparedId.toUpperCase()] : undefined;
  const promoteBranch = names ? selectionBranchName(names[target], nodes, selection) : "";

  return (
    <section className="page">
      <header className="page-head">
        <p className="eyebrow">Release</p>
        <h1>Promote work</h1>
        <p className="lede">A completed task or subtask can move. Open or in-progress work stays off this list. Prepare checks out a new branch from the updated base.</p>
      </header>
      {!releaseManager ? <p className="note">Switch to Release manager to prepare a promotion.</p> : null}
      <ManifestCallout />
      <div className="promote-layout">
        <div className="promote-controls">
          <label className="field">
            <span>Feature</span>
            <MultiAutocomplete
              values={selection.featureIds}
              disabled={!releaseManager || busy || nodes.length === 0}
              placeholder={nodes.length === 0 ? "No completed work" : "Select features"}
              options={nodes.map((node) => {
                const feature = snapshot ? findFeature(snapshot.catalog.data, node.id) : undefined;
                const count = promotable.filter((commit) => commit.featureId === node.id).length;
                return { value: node.id, label: feature?.name ? `${feature.name} · ${node.id}` : node.id, hint: count === 1 ? "1 commit" : `${count} commits` };
              })}
              onToggle={(id) => {
                setSelection((current) => toggleFeature(nodes, current, id));
                setPlan(null);
              }}
            />
          </label>
          <label className="field">
            <span>Task</span>
            <MultiAutocomplete
              values={selection.taskIds}
              disabled={!releaseManager || busy || nodes.every((node) => node.tasks.length === 0)}
              placeholder={nodes.some((node) => node.tasks.length > 0) ? "Select completed tasks" : "No completed tasks"}
              options={nodes.flatMap((node) => node.tasks.map((task) => {
                const named = snapshot ? findTask(snapshot.catalog.data, node.id, task.id) : undefined;
                const feature = snapshot ? findFeature(snapshot.catalog.data, node.id) : undefined;
                return { value: task.id, label: named?.name ? `${named.name} · ${task.id}` : task.id, hint: feature?.name || node.id };
              }))}
              onToggle={(id) => {
                setSelection((current) => toggleTask(nodes, current, id));
                setPlan(null);
              }}
            />
          </label>
          <label className="field">
            <span>Subtask</span>
            <MultiAutocomplete
              values={selection.subtaskIds}
              disabled={!releaseManager || busy || nodes.every((node) => node.tasks.every((task) => task.subtaskIds.length === 0))}
              placeholder={nodes.some((node) => node.tasks.some((task) => task.subtaskIds.length > 0)) ? "Select completed subtasks" : "No completed subtasks"}
              options={nodes.flatMap((node) => node.tasks.flatMap((task) => task.subtaskIds.map((id) => {
                const named = snapshot ? findTask(snapshot.catalog.data, node.id, task.id)?.subtasks.find((item) => item.id === id) : undefined;
                const taskName = snapshot ? findTask(snapshot.catalog.data, node.id, task.id)?.name : "";
                return { value: id, label: named?.name ? `${named.name} · ${id}` : id, hint: taskName || task.id };
              })))}
              onToggle={(id) => {
                setSelection((current) => toggleSubtask(nodes, current, id));
                setPlan(null);
              }}
            />
          </label>
          {described?.description ? <p className="meta latest">{described.description}</p> : null}
          <div className="target-grid" role="radiogroup" aria-label="Target environment">
            {ENV_RAIL.map((name) => {
              const branch = names?.[name] ?? name.toLowerCase();
              const selectedTarget = target === name;
              return (
                <button
                  key={name}
                  type="button"
                  role="radio"
                  aria-checked={selectedTarget}
                  className={selectedTarget ? `target on ${name.toLowerCase()}` : "target"}
                  disabled={!releaseManager || busy}
                  onClick={() => {
                    setTarget(name);
                    setPlan(null);
                  }}
                >
                  <strong>{name}</strong>
                  <span>{branch}</span>
                </button>
              );
            })}
          </div>
          <div className="mode-row" role="radiogroup" aria-label="How to bring the feature">
            <button
              type="button"
              role="radio"
              aria-checked={mode === "merge"}
              className={mode === "merge" ? "mode on" : "mode"}
              disabled={!releaseManager || busy || target !== "DEV" || !whole}
              onClick={() => setMode("merge")}
            >
              Merge
            </button>
            <button
              type="button"
              role="radio"
              aria-checked={mode === "cherry-pick"}
              className={mode === "cherry-pick" ? "mode on" : "mode"}
              disabled={!releaseManager || busy}
              onClick={() => setMode("cherry-pick")}
            >
              Cherry-pick
            </button>
          </div>
          <label className="check">
            <input
              type="checkbox"
              checked={squash}
              disabled={!releaseManager || busy}
              onChange={(event) => setSquash(event.target.checked)}
            />
            <span>Squash into one commit</span>
          </label>
          {prepared ? (
            <p className="meta">Prepared branch {prepared.branch}, cut from {prepared.baseSha.slice(0, 7)} by {prepared.mode}{prepared.squash ? ", squashed" : ""}.</p>
          ) : null}
          <div className="action-row">
            <button
              type="button"
              className="ghost"
              disabled={!releaseManager || busy || !chosen}
              onClick={() => {
                void buildPlan({
                  featureIds: selection.featureIds,
                  taskIds: selection.taskIds,
                  subtaskIds: selection.subtaskIds,
                  target
                }).then((next) => {
                  if (next) {
                    setPlannedKey(selectionKey);
                    setPlan(next);
                  }
                });
              }}
            >
              Build plan
            </button>
            <button
              type="button"
              className="primary"
              disabled={!releaseManager || busy || !chosen}
              onClick={() => {
                void preparePromotion({
                  featureIds: selection.featureIds,
                  taskIds: selection.taskIds,
                  subtaskIds: selection.subtaskIds,
                  target,
                  mode,
                  squash
                });
              }}
            >
              Prepare branch
            </button>
          </div>
        </div>
        <section className="plan-sheet">
          <header>
            <span>Plan</span>
            {readyPlan ? <em>{promoteBranch}</em> : null}
          </header>
          {readyPlan ? (
            <PlanBody
              plan={readyPlan}
              busy={busy}
              onMark={async () => {
                const next = await markPromoted({
                  featureIds: selection.featureIds,
                  taskIds: selection.taskIds,
                  subtaskIds: selection.subtaskIds,
                  target
                });
                if (next) {
                  setPlan(next);
                  setPlannedKey(selectionKey);
                }
              }}
            />
          ) : (
            <p className="empty">Build a plan to see which commits would move.</p>
          )}
          <footer>Prepare checks out a new branch. The long-lived branch stays unchanged.</footer>
        </section>
      </div>
    </section>
  );
}

function PlanBody({ plan, busy, onMark }: { plan: Extract<PromotionPlan, { ok: true }>; busy: boolean; onMark: () => Promise<void> }) {
  const [copied, setCopied] = useState(false);
  const timer = useRef(0);
  const hashes = plan.pending.map((commit) => commit.sha).join(" ");

  useEffect(() => () => window.clearTimeout(timer.current), []);

  const copyHashes = async () => {
    if (!hashes) {
      return;
    }
    await copyText(hashes);
    setCopied(true);
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => setCopied(false), 1600);
  };

  return (
    <div className="plan-body">
      {plan.warnings.length > 0 ? (
        <ul className="warnings">
          {plan.warnings.map((warning) => <li key={warning.code}>{warning.message}</li>)}
        </ul>
      ) : null}
      <div className="plan-actions">
        {plan.pending.length > 0 ? (
          <button
            type="button"
            className="ghost plan-copy"
            title="Full hashes, oldest first, separated by spaces"
            onClick={() => void copyHashes()}
          >
            {copied ? "Copied" : "Copy hashes"}
          </button>
        ) : null}
        <button
          type="button"
          className="primary plan-copy"
          disabled={busy || plan.pending.length === 0}
          onClick={() => void onMark()}
        >
          Mark as promoted
        </button>
      </div>
      {plan.pending.length === 0 ? (
        <p className="meta">Nothing new to move for {plan.featureId}.</p>
      ) : (
        <ol className="plan-list">
          {plan.pending.map((commit, index) => (
            <li key={commit.sha}>
              <span>{String(index + 1).padStart(2, "0")}</span>
              <code>{commit.shortSha || commit.sha.slice(0, 7)}</code>
              <em>{commit.subject || "Untitled commit"}</em>
            </li>
          ))}
        </ol>
      )}
      {plan.already.length > 0 ? (
        <p className="meta">{plan.already.length} already recorded on {plan.target}.</p>
      ) : null}
    </div>
  );
}

async function copyText(text: string): Promise<void> {
  try {
    await navigator.clipboard.writeText(text);
  } catch {
    const area = document.createElement("textarea");
    area.value = text;
    area.setAttribute("readonly", "");
    area.style.position = "fixed";
    area.style.left = "-9999px";
    document.body.append(area);
    area.select();
    document.execCommand("copy");
    area.remove();
  }
}
