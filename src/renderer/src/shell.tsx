import type { ReactElement } from "react";
import { IconCatalog, IconCommit, IconEnvironments, IconFeatures, IconFolder, IconPromote, IconRefresh, Mark } from "./icons";
import { useWorkspace, type View } from "./workspace";
import { CatalogView } from "./views/CatalogView";
import { CommitView } from "./views/CommitView";
import { EnvironmentsView } from "./views/EnvironmentsView";
import { FeaturesView } from "./views/FeaturesView";
import { PromoteView } from "./views/PromoteView";

const NAV: { id: View; label: string; icon: ReactElement }[] = [
  { id: "commit", label: "Commit", icon: <IconCommit /> },
  { id: "catalog", label: "Catalog", icon: <IconCatalog /> },
  { id: "features", label: "Features", icon: <IconFeatures /> },
  { id: "environments", label: "Environments", icon: <IconEnvironments /> },
  { id: "promote", label: "Promote", icon: <IconPromote /> }
];

export function App() {
  const workspace = useWorkspace();
  const { snapshot, view, busy, notice, error, dismissToast } = workspace;
  const repoReady = Boolean(snapshot?.gitAvailable && snapshot.repoPath);

  return (
    <div className="shell" data-app="feature-release">
      <Sidebar />
      <div className="workspace">
        {busy ? <div className="busy-bar" /> : null}
        <Topbar />
        <main className="content">
          {!snapshot ? <p className="loading">Reading the repository…</p> : null}
          {snapshot && !snapshot.gitAvailable ? <GitMissing /> : null}
          {snapshot && snapshot.gitAvailable && !snapshot.repoPath ? <EmptyRepo /> : null}
          {repoReady ? (
            <>
              <div hidden={view !== "commit"}><CommitView /></div>
              <div hidden={view !== "catalog"}><CatalogView /></div>
              <div hidden={view !== "features"}><FeaturesView /></div>
              <div hidden={view !== "environments"}><EnvironmentsView /></div>
              <div hidden={view !== "promote"}><PromoteView /></div>
            </>
          ) : null}
        </main>
      </div>
      {(error || notice) ? (
        <div className={error ? "toast is-error" : "toast"} role="status">
          <p>{error || notice}</p>
          <button type="button" onClick={dismissToast}>Dismiss</button>
        </div>
      ) : null}
    </div>
  );
}

function Sidebar() {
  const { role, view, setRole, setView, snapshot } = useWorkspace();
  const tagged = snapshot?.features.filter((feature) => feature.id).length ?? 0;
  const defined = snapshot?.catalog?.data.features.length ?? 0;

  return (
    <aside className="sidebar">
      <div className="brand">
        <Mark />
        <div className="brand-copy">
          <strong>Git Feature Manager</strong>
          <span>GFM</span>
        </div>
      </div>
      <nav aria-label="Sections">
        {NAV.map((item) => (
          <button
            key={item.id}
            type="button"
            aria-current={view === item.id ? "page" : undefined}
            onClick={() => setView(item.id)}
          >
            {item.icon}
            <span>{item.label}</span>
            {item.id === "catalog" && defined > 0 ? <em>{defined}</em> : null}
            {item.id === "features" && tagged > 0 ? <em>{tagged}</em> : null}
          </button>
        ))}
      </nav>
      <div className="role">
        <span className="eyebrow">Role</span>
        <button type="button" aria-pressed={role === "contributor"} onClick={() => setRole("contributor")}>
          Contributor
        </button>
        <button type="button" aria-pressed={role === "release"} onClick={() => setRole("release")}>
          Release manager
        </button>
        <p>Directory sign-in will replace this switch.</p>
      </div>
    </aside>
  );
}

function Topbar() {
  const { snapshot, busy, chooseRepo, refresh } = useWorkspace();
  const repo = snapshot?.repoPath ? splitRepo(snapshot.repoPath) : null;

  return (
    <header className="topbar">
      <button type="button" className="repo-button" onClick={() => void chooseRepo()} disabled={busy} title={snapshot?.repoPath || "Choose a repository"}>
        <IconFolder />
        {repo ? (
          <span>
            <strong>{repo.name}</strong>
            <small>{repo.parent || "Repository root"}</small>
          </span>
        ) : (
          <span>
            <strong>Choose repository</strong>
            <small>Open the git folder for this release</small>
          </span>
        )}
        {snapshot?.branch ? <em>{snapshot.branch}</em> : null}
      </button>
      <button
        type="button"
        className="ghost refresh"
        onClick={() => void refresh()}
        disabled={busy || !snapshot?.repoPath}
      >
        <IconRefresh />
        Refresh
      </button>
    </header>
  );
}

function EmptyRepo() {
  const { busy, chooseRepo } = useWorkspace();
  return (
    <section className="hero">
      <Mark large />
      <p className="eyebrow">Repository</p>
      <h1>Choose the folder this team releases from.</h1>
      <p>Commits stay in git. The parent ticket is the feature. QAS, UAT, and PROD are recorded beside the code.</p>
      <button type="button" className="primary" disabled={busy} onClick={() => void chooseRepo()}>
        Choose repository
      </button>
    </section>
  );
}

function GitMissing() {
  return (
    <section className="hero">
      <Mark large />
      <p className="eyebrow">Git</p>
      <h1>Git is not available on PATH.</h1>
      <p>Install Git, then reopen Git Feature Manager. The app reads history and creates commits through the local git command.</p>
    </section>
  );
}

function splitRepo(repoPath: string): { name: string; parent: string } {
  const parts = repoPath.split(/[\\/]/).filter(Boolean);
  const name = parts.at(-1) ?? repoPath;
  const slash = repoPath.includes("\\") ? "\\" : "/";
  return { name, parent: parts.slice(0, -1).join(slash) };
}
