import { useState } from "react";
import { ENV_RAIL, branchNames, defaultManifest, type BranchNames, type EnvironmentName } from "@shared/manifest";
import { useWorkspace } from "../workspace";

export function EnvironmentsView() {
  const { snapshot, busy, saveEnvironmentBranches } = useWorkspace();
  const saved = branchNames(snapshot?.manifest.data ?? defaultManifest());
  const savedKey = ENV_RAIL.map((name) => saved[name]).join("\n");
  const [seenKey, setSeenKey] = useState(savedKey);
  const [names, setNames] = useState<BranchNames>(saved);
  if (seenKey !== savedKey) {
    setSeenKey(savedKey);
    setNames(saved);
  }

  const dirty = ENV_RAIL.some((name) => names[name].trim() !== saved[name]);
  const missingFile = snapshot?.manifest.exists === false;

  const setName = (name: EnvironmentName, value: string) => {
    setNames((current) => ({ ...current, [name]: value }));
  };

  return (
    <section className="page">
      <header className="page-head">
        <p className="eyebrow">Environments</p>
        <h1>Manage base branches</h1>
        <p className="lede">
          DEV, QAS, UAT, and PROD each point at one long-lived branch. Work branches are cut from these later. The names are stored in gfm/release/environments.json.
        </p>
      </header>
      {missingFile ? <p className="note">Saving creates gfm/release/environments.json in this repository.</p> : null}
      <form
        className="env-form"
        onSubmit={(event) => {
          event.preventDefault();
          void saveEnvironmentBranches({
            DEV: names.DEV.trim(),
            QAS: names.QAS.trim(),
            UAT: names.UAT.trim(),
            PROD: names.PROD.trim()
          });
        }}
      >
        <div className="env-grid">
          {ENV_RAIL.map((name) => (
            <label key={name} className="field">
              <span>{name}</span>
              <input
                value={names[name]}
                disabled={busy}
                spellCheck={false}
                placeholder={name === "PROD" ? "main" : name.toLowerCase()}
                onChange={(event) => setName(name, event.target.value)}
              />
            </label>
          ))}
        </div>
        <div className="dialog-actions">
          <button type="submit" className="primary" disabled={busy || !dirty}>Save branches</button>
        </div>
      </form>
    </section>
  );
}
