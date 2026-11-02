import { ENV_RAIL, type EnvironmentName } from "@shared/manifest";
import { useWorkspace } from "./workspace";

export function ManifestCallout() {
  const { snapshot, busy, createManifest } = useWorkspace();
  if (!snapshot?.repoPath || snapshot.manifest.exists) {
    return null;
  }
  return (
    <div className="callout">
      <div>
        <strong>No environment manifest</strong>
        <p>Create gfm/release/environments.json, or set the four base branches on Environments.</p>
      </div>
      <button type="button" className="ghost" disabled={busy} onClick={() => void createManifest()}>
        Create manifest
      </button>
    </div>
  );
}

export function EnvRail({ active, partial = [] }: { active: EnvironmentName[]; partial?: EnvironmentName[] }) {
  const present = new Set(active);
  const some = new Set(partial);
  const label = [
    active.length ? `On ${active.join(", ")}` : "",
    some.size ? `Partly on ${partial.join(", ")}` : ""
  ].filter(Boolean).join(". ") || "Not recorded on an environment";
  return (
    <span className="env-rail" aria-label={label}>
      {ENV_RAIL.map((name) => {
        const state = present.has(name) ? "on" : some.has(name) ? "partial" : "";
        return (
          <span key={name} className={state ? `env-slot ${state} ${name.toLowerCase()}` : "env-slot"}>
            {name}
          </span>
        );
      })}
    </span>
  );
}
