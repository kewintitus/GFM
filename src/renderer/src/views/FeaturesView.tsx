import { useState } from "react";
import type { CommitRecord } from "@shared/log";
import { EnvRail, ManifestCallout } from "../bits";
import { useWorkspace } from "../workspace";

const COMMIT_PAGE_SIZE = 50;

export function FeaturesView() {
  const { snapshot } = useWorkspace();
  const [openId, setOpenId] = useState<string | null>(null);
  const features = snapshot?.features ?? [];
  const devBranch = snapshot?.manifest.data.devBranch ?? "dev";

  return (
    <section className="page">
      <header className="page-head">
        <p className="eyebrow">{snapshot?.branch || "Branch"}</p>
        <h1>Features on this branch</h1>
        <p className="lede">
          Grouped by the Feature trailer. DEV means the commit is on {devBranch}. QAS, UAT, and PROD come from the manifest.
        </p>
      </header>
      <ManifestCallout />
      {features.length === 0 ? (
        <div className="empty">No commits on this branch yet.</div>
      ) : (
        <div className="feature-list">
          {features.map((feature) => {
            const key = feature.id ?? "unscoped";
            const open = openId === key;
            return (
              <article key={key} className={feature.id ? "feature" : "feature is-unscoped"}>
                <button
                  type="button"
                  className="feature-row"
                  aria-expanded={open}
                  onClick={() => setOpenId(open ? null : key)}
                >
                  <span>
                    <strong>{feature.label}</strong>
                    <span className="meta">
                      {feature.commits.length} {feature.commits.length === 1 ? "commit" : "commits"}
                      {feature.authors.length ? ` · ${feature.authors.join(", ")}` : ""}
                    </span>
                  </span>
                  <span className="subject">{feature.latest?.subject || "No subject"}</span>
                  {feature.id ? <EnvRail active={feature.environments} /> : <span className="meta">No feature trailer</span>}
                </button>
                {open ? <CommitList commits={feature.commits} /> : null}
              </article>
            );
          })}
        </div>
      )}
    </section>
  );
}

function CommitList({ commits }: { commits: CommitRecord[] }) {
  const [page, setPage] = useState(0);
  const pageCount = Math.max(1, Math.ceil(commits.length / COMMIT_PAGE_SIZE));
  const safePage = Math.min(page, pageCount - 1);
  const start = safePage * COMMIT_PAGE_SIZE;
  const visible = commits.slice(start, start + COMMIT_PAGE_SIZE);
  const from = start + 1;
  const to = Math.min(commits.length, start + COMMIT_PAGE_SIZE);

  return (
    <>
      <ul className="commit-list">
        {visible.map((commit) => (
          <li key={commit.sha}>
            <code>{commit.shortSha || commit.sha.slice(0, 7)}</code>
            <span>{commit.subject}</span>
            <span className="meta">
              {commit.author}
              {commit.taskId ? ` · ${commit.taskId}` : ""}
              {commit.subtaskId ? ` · ${commit.subtaskId}` : ""}
              {commit.date ? ` · ${formatDate(commit.date)}` : ""}
            </span>
          </li>
        ))}
      </ul>
      {commits.length > COMMIT_PAGE_SIZE ? (
        <div className="pager commit-pager">
          <span>{from}–{to} of {commits.length}</span>
          <div>
            <button type="button" className="ghost" disabled={safePage === 0} onClick={() => setPage(safePage - 1)}>Previous</button>
            <button type="button" className="ghost" disabled={safePage >= pageCount - 1} onClick={() => setPage(safePage + 1)}>Next</button>
          </div>
        </div>
      ) : null}
    </>
  );
}

function formatDate(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return "";
  }
  return date.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}
