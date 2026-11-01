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

export function EnvRail({ active }: { active: EnvironmentName[] }) {
  const present = new Set(active);
  return (
    <span className="env-rail" aria-label={active.length ? `On ${active.join(", ")}` : "Not recorded on an environment"}>
      {ENV_RAIL.map((name) => (
        <span key={name} className={present.has(name) ? `env-slot on ${name.toLowerCase()}` : "env-slot"}>
          {name}
        </span>
      ))}
    </span>
  );
}
