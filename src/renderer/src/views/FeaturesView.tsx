import { useState } from "react";
import { findFeature, findTask } from "@shared/catalog";
import type { CommitRecord } from "@shared/log";
import { ENV_RAIL, environmentPresence, type EnvironmentName, type Manifest } from "@shared/manifest";
import { EnvRail, ManifestCallout } from "../bits";
import { useWorkspace } from "../workspace";

const COMMIT_PAGE_SIZE = 50;

export function FeaturesView() {
  const { snapshot } = useWorkspace();
  const [openId, setOpenId] = useState<string | null>(null);
  const features = snapshot?.features ?? [];
  const [openTask, setOpenTask] = useState<string | null>(null);
  const [openSubtask, setOpenSubtask] = useState<string | null>(null);

  return (
    <section className="page">
      <header className="page-head">
        <p className="eyebrow">{snapshot?.branch || "Branch"}</p>
        <h1>Features on this branch</h1>
        <p className="lede">
          Grouped by feature, task, and subtask. DEV, QAS, UAT, and PROD follow the recorded promotion SHAs. A dashed name means only some of the commits are there.
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
            const name = feature.id && snapshot ? findFeature(snapshot.catalog.data, feature.id)?.name : "";
            const tasks = feature.id ? tasksFor(feature.commits, feature.id, snapshot?.catalog.data) : [];
            const featureOnly = feature.commits.filter((commit) => !commit.taskId);
            const featureState = feature.id ? presenceFor(feature.commits, feature.id, snapshot?.manifest.data) : null;
            return (
              <article key={key} className={feature.id ? "feature" : "feature is-unscoped"}>
                <button
                  type="button"
                  className="feature-row"
                  aria-expanded={open}
                  onClick={() => setOpenId(open ? null : key)}
                >
                  <span>
                    <span className="kind feature">Feature</span>
                    <strong>{name || feature.label}</strong>
                    <span className="meta">
                      {name && feature.id ? `${feature.id} · ` : ""}
                      {feature.commits.length} {feature.commits.length === 1 ? "commit" : "commits"}
                      {feature.authors.length ? ` · ${feature.authors.join(", ")}` : ""}
                    </span>
                  </span>
                  <span className="subject">{feature.latest?.subject || "No subject"}</span>
                  {featureState ? <EnvRail active={featureState.on} partial={featureState.partial} /> : <span className="meta">No feature trailer</span>}
                </button>
                {open ? (
                  <div className="scope-tree">
                    {featureOnly.length > 0 ? <CommitList commits={featureOnly} /> : null}
                    {tasks.map((task) => {
                      const taskKey = `${key}/${task.id}`;
                      const taskOpen = openTask === taskKey;
                      const taskState = feature.id ? presenceFor(task.commits, feature.id, snapshot?.manifest.data) : null;
                      return (
                        <div key={task.id} className="task-block">
                          <button
                            type="button"
                            className="feature-row scope-row task"
                            aria-expanded={taskOpen}
                            onClick={() => setOpenTask(taskOpen ? null : taskKey)}
                          >
                            <span>
                              <span className="kind task">Task</span>
                              <strong>{task.name}</strong>
                              <span className="meta">{task.id} · {task.commits.length} {task.commits.length === 1 ? "commit" : "commits"}</span>
                            </span>
                            {taskState ? <EnvRail active={taskState.on} partial={taskState.partial} /> : null}
                          </button>
                          {taskOpen ? (
                            <div className="subtask-list">
                              {task.subtasks.map((subtask) => {
                                const subtaskKey = `${taskKey}/${subtask.id}`;
                                const subtaskOpen = openSubtask === subtaskKey;
                                const subtaskState = feature.id ? presenceFor(subtask.commits, feature.id, snapshot?.manifest.data) : null;
                                return (
                                  <div key={subtask.id} className="subtask-block">
                                    <button
                                      type="button"
                                      className="feature-row scope-row subtask"
                                      aria-expanded={subtaskOpen}
                                      onClick={() => setOpenSubtask(subtaskOpen ? null : subtaskKey)}
                                    >
                                      <span>
                                        <span className="kind subtask">Subtask</span>
                                        <strong>{subtask.name}</strong>
                                        <span className="meta">{subtask.id} · {subtask.commits.length} {subtask.commits.length === 1 ? "commit" : "commits"}</span>
                                      </span>
                                      {subtaskState ? <EnvRail active={subtaskState.on} partial={subtaskState.partial} /> : null}
                                    </button>
                                    {subtaskOpen ? <CommitList commits={subtask.commits} /> : null}
                                  </div>
                                );
                              })}
                              {task.loose.length > 0 ? <CommitList commits={task.loose} /> : null}
                            </div>
                          ) : null}
                        </div>
                      );
                    })}
                  </div>
                ) : null}
              </article>
            );
          })}
        </div>
      )}
    </section>
  );
}

function tasksFor(commits: CommitRecord[], featureId: string, catalog: Parameters<typeof findFeature>[0] | undefined) {
  const taskIds = [...new Set(commits.map((commit) => commit.taskId).filter((id): id is string => Boolean(id)))];
  return taskIds.map((taskId) => {
    const named = catalog ? findTask(catalog, featureId, taskId) : undefined;
    const taskCommits = commits.filter((commit) => commit.taskId === taskId);
    const subtaskIds = [...new Set(taskCommits.map((commit) => commit.subtaskId).filter((id): id is string => Boolean(id)))];
    return {
      id: taskId,
      name: named?.name || taskId,
      commits: taskCommits,
      loose: taskCommits.filter((commit) => !commit.subtaskId),
      subtasks: subtaskIds.map((subtaskId) => {
        const subtask = named?.subtasks.find((item) => item.id === subtaskId);
        return {
          id: subtaskId,
          name: subtask?.name || subtaskId,
          commits: taskCommits.filter((commit) => commit.subtaskId === subtaskId)
        };
      })
    };
  });
}

function presenceFor(
  commits: CommitRecord[],
  featureId: string,
  manifest: Manifest | undefined
) {
  const recorded = {} as Partial<Record<EnvironmentName, string[]>>;
  for (const name of ENV_RAIL) {
    recorded[name] = manifest?.environments[name]?.features[featureId]?.commits.map((item) => item.source) ?? [];
  }
  return environmentPresence(commits.map((commit) => commit.sha), recorded);
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
