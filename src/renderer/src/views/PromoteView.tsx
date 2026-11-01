import { useEffect, useRef, useState } from "react";
import { findFeature } from "@shared/catalog";
import { ENV_RAIL, branchNames, type EnvironmentName } from "@shared/manifest";
import type { PromotionPlan } from "@shared/plan";
import { defaultPrepareMode, type PrepareMode } from "@shared/promote";
import { Autocomplete } from "../Autocomplete";
import { ManifestCallout } from "../bits";
import { useWorkspace } from "../workspace";

export function PromoteView() {
  const { snapshot, role, busy, buildPlan, preparePromotion } = useWorkspace();
  const tagged = (snapshot?.features ?? []).filter((feature) => feature.id);
  const [featureId, setFeatureId] = useState("");
  const [target, setTarget] = useState<EnvironmentName>("DEV");
  const [mode, setMode] = useState<PrepareMode>("merge");
  const [squash, setSquash] = useState(false);
  const [plan, setPlan] = useState<PromotionPlan | null>(null);
  const releaseManager = role === "release";
  const names = snapshot ? branchNames(snapshot.manifest.data) : null;

  useEffect(() => {
    if (!tagged.some((feature) => feature.id === featureId)) {
      setFeatureId(tagged[0]?.id ?? "");
    }
  }, [tagged, featureId]);

  useEffect(() => {
    setMode(defaultPrepareMode(target));
  }, [target]);

  const selected = tagged.find((feature) => feature.id === featureId);
  const selectedCatalog = selected?.id && snapshot ? findFeature(snapshot.catalog.data, selected.id) : undefined;
  const readyPlan = plan && plan.ok && plan.featureId === featureId && plan.target === target ? plan : null;
  const prepared = featureId ? snapshot?.manifest.data.prepared[target]?.[featureId.toUpperCase()] : undefined;

  return (
    <section className="page">
      <header className="page-head">
        <p className="eyebrow">Release</p>
        <h1>Promote a feature</h1>
        <p className="lede">One parent ticket moves as a set. Prepare checks out a new branch from the updated base, then merges or cherry-picks that feature onto it.</p>
      </header>
      {!releaseManager ? <p className="note">Switch to Release manager to prepare a promotion.</p> : null}
      <ManifestCallout />
      <div className="promote-layout">
        <div className="promote-controls">
          <label className="field">
            <span>Feature</span>
            <Autocomplete
              value={featureId}
              disabled={!releaseManager || busy || tagged.length === 0}
              placeholder={tagged.length === 0 ? "No tagged features" : "Select a feature"}
              options={tagged.flatMap((feature) => {
                if (!feature.id) {
                  return [];
                }
                const name = snapshot ? findFeature(snapshot.catalog.data, feature.id)?.name : "";
                const count = feature.commits.length === 1 ? "1 commit" : `${feature.commits.length} commits`;
                return [{
                  value: feature.id,
                  label: name ? `${name} · ${feature.id}` : feature.id,
                  hint: count
                }];
              })}
              onChange={(next) => {
                setFeatureId(next);
                setPlan(null);
              }}
            />
          </label>
          {selectedCatalog?.description ? <p className="meta latest">{selectedCatalog.description}</p> : selected?.latest?.subject ? <p className="meta latest">{selected.latest.subject}</p> : null}
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
              disabled={!releaseManager || busy || target !== "DEV"}
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
              disabled={!releaseManager || busy || !featureId}
              onClick={() => {
                void buildPlan({ featureId, target }).then((next) => {
                  if (next) {
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
              disabled={!releaseManager || busy || !featureId}
              onClick={() => {
                void preparePromotion({ featureId, target, mode, squash });
              }}
            >
              Prepare branch
            </button>
          </div>
        </div>
        <section className="plan-sheet">
          <header>
            <span>Plan</span>
            {readyPlan ? <em>{readyPlan.branch}</em> : null}
          </header>
          {readyPlan ? <PlanBody plan={readyPlan} /> : (
            <p className="empty">Build a plan to see which commits would move.</p>
          )}
          <footer>Prepare checks out a new branch. The long-lived branch stays unchanged.</footer>
        </section>
      </div>
    </section>
  );
}

function PlanBody({ plan }: { plan: Extract<PromotionPlan, { ok: true }> }) {
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
      {plan.pending.length === 0 ? (
        <p className="meta">Nothing new to move for {plan.featureId}.</p>
      ) : (
        <>
          <button
            type="button"
            className="ghost plan-copy"
            title="Full hashes, oldest first, separated by spaces"
            onClick={() => void copyHashes()}
          >
            {copied ? "Copied" : "Copy hashes"}
          </button>
          <ol className="plan-list">
            {plan.pending.map((commit, index) => (
              <li key={commit.sha}>
                <span>{String(index + 1).padStart(2, "0")}</span>
                <code>{commit.shortSha || commit.sha.slice(0, 7)}</code>
                <em>{commit.subject || "Untitled commit"}</em>
              </li>
            ))}
          </ol>
        </>
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
