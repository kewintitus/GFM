import { useState } from "react";
import type { ChangeFile } from "@shared/api";
import { isStaged, isUnstaged, isUntracked, statusLetter } from "@shared/status";

type DirectoryNode = {
  kind: "dir";
  name: string;
  path: string;
  children: TreeNode[];
};

type FileNode = {
  kind: "file";
  name: string;
  path: string;
  change: ChangeFile;
};

type TreeNode = DirectoryNode | FileNode;

function buildTree(changes: ChangeFile[]): DirectoryNode {
  const root: DirectoryNode = { kind: "dir", name: "", path: "", children: [] };
  for (const change of changes) {
    const parts = change.path.split(/[\\/]/).filter(Boolean);
    let directory = root;
    for (let index = 0; index < parts.length - 1; index += 1) {
      const name = parts[index] ?? "";
      const path = parts.slice(0, index + 1).join("/");
      let next = directory.children.find((child): child is DirectoryNode => child.kind === "dir" && child.name === name);
      if (!next) {
        next = { kind: "dir", name, path, children: [] };
        directory.children.push(next);
      }
      directory = next;
    }
    const name = parts.at(-1) ?? change.path;
    directory.children.push({ kind: "file", name, path: change.path, change });
  }
  sortTree(root);
  return root;
}

function sortTree(directory: DirectoryNode): void {
  directory.children.sort((left, right) => {
    if (left.kind !== right.kind) {
      return left.kind === "dir" ? -1 : 1;
    }
    return left.name.localeCompare(right.name);
  });
  for (const child of directory.children) {
    if (child.kind === "dir") {
      sortTree(child);
    }
  }
}

function filePaths(directory: DirectoryNode): string[] {
  const paths: string[] = [];
  for (const child of directory.children) {
    if (child.kind === "file") {
      paths.push(child.path);
    } else {
      paths.push(...filePaths(child));
    }
  }
  return paths;
}

function statusTone(letter: string): string {
  if (letter === "U" || letter === "?") return "untracked";
  if (letter === "D") return "deleted";
  if (letter === "A") return "added";
  return "modified";
}

export function StageTree({
  changes,
  busy,
  onStage,
  onUnstage
}: {
  changes: ChangeFile[];
  busy: boolean;
  onStage: (paths: string[]) => void;
  onUnstage: (paths: string[]) => void;
}) {
  const staged = changes.filter((change) => isStaged(change.code));
  const pending = changes.filter((change) => isUnstaged(change.code) || isUntracked(change.code));
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());

  const toggle = (path: string) => {
    setCollapsed((current) => {
      const next = new Set(current);
      if (next.has(path)) {
        next.delete(path);
      } else {
        next.add(path);
      }
      return next;
    });
  };

  if (changes.length === 0) {
    return (
      <aside className="stage-panel">
        <header><span>Source control</span></header>
        <p className="empty">The working tree is clean.</p>
      </aside>
    );
  }

  return (
    <aside className="stage-panel">
      <header><span>Source control</span></header>
      <StageGroup
        title="Staged Changes"
        changes={staged}
        side="staged"
        collapsed={collapsed}
        busy={busy}
        onToggle={toggle}
        onAction={onUnstage}
        actionLabel="Unstage"
        actionGlyph="−"
      />
      <StageGroup
        title="Changes"
        changes={pending}
        side="changes"
        collapsed={collapsed}
        busy={busy}
        onToggle={toggle}
        onAction={onStage}
        actionLabel="Stage"
        actionGlyph="+"
      />
    </aside>
  );
}

function StageGroup({
  title,
  changes,
  side,
  collapsed,
  busy,
  onToggle,
  onAction,
  actionLabel,
  actionGlyph
}: {
  title: string;
  changes: ChangeFile[];
  side: "staged" | "changes";
  collapsed: Set<string>;
  busy: boolean;
  onToggle: (path: string) => void;
  onAction: (paths: string[]) => void;
  actionLabel: string;
  actionGlyph: string;
}) {
  const groupKey = `group:${title}`;
  const open = !collapsed.has(groupKey);
  const tree = buildTree(changes);
  if (changes.length === 0) {
    return null;
  }

  return (
    <section className="stage-group">
      <div className="stage-heading">
        <button type="button" className="twist" aria-expanded={open} onClick={() => onToggle(groupKey)}>
          <Chevron open={open} />
          <strong>{title}</strong>
          <em>{changes.length}</em>
        </button>
        <button
          type="button"
          className="stage-action"
          disabled={busy}
          aria-label={`${actionLabel} all`}
          onClick={() => onAction(filePaths(tree))}
        >
          {actionGlyph}
        </button>
      </div>
      {open ? <TreeNodes nodes={tree.children} depth={0} side={side} scope={side} collapsed={collapsed} busy={busy} onToggle={onToggle} onAction={onAction} actionLabel={actionLabel} actionGlyph={actionGlyph} /> : null}
    </section>
  );
}

function TreeNodes({
  nodes,
  depth,
  side,
  scope,
  collapsed,
  busy,
  onToggle,
  onAction,
  actionLabel,
  actionGlyph
}: {
  nodes: TreeNode[];
  depth: number;
  side: "staged" | "changes";
  scope: "staged" | "changes";
  collapsed: Set<string>;
  busy: boolean;
  onToggle: (path: string) => void;
  onAction: (paths: string[]) => void;
  actionLabel: string;
  actionGlyph: string;
}) {
  return (
    <ul className="tree">
      {nodes.map((node) => {
        const pad = 8 + depth * 14;
        if (node.kind === "dir") {
          const key = `${scope}:${node.path}`;
          const open = !collapsed.has(key);
          return (
            <li key={node.path}>
              <div className="tree-row" style={{ paddingLeft: pad }}>
                <button type="button" className="twist" aria-expanded={open} onClick={() => onToggle(key)}>
                  <Chevron open={open} />
                  <span>{node.name}</span>
                </button>
                <button
                  type="button"
                  className="stage-action"
                  disabled={busy}
                  aria-label={`${actionLabel} ${node.name}`}
                  onClick={() => onAction(filePaths(node))}
                >
                  {actionGlyph}
                </button>
              </div>
              {open ? (
                <TreeNodes
                  nodes={node.children}
                  depth={depth + 1}
                  side={side}
                  scope={scope}
                  collapsed={collapsed}
                  busy={busy}
                  onToggle={onToggle}
                  onAction={onAction}
                  actionLabel={actionLabel}
                  actionGlyph={actionGlyph}
                />
              ) : null}
            </li>
          );
        }
        const letter = statusLetter(node.change.code, side);
        return (
          <li key={`${side}:${node.path}`}>
            <div className="tree-row file" style={{ paddingLeft: pad + 16 }}>
              <span title={node.path}>{node.name}</span>
              <button
                type="button"
                className="stage-action"
                disabled={busy}
                aria-label={`${actionLabel} ${node.name}`}
                onClick={() => onAction([node.path])}
              >
                {actionGlyph}
              </button>
              <code className={statusTone(letter)}>{letter}</code>
            </div>
          </li>
        );
      })}
    </ul>
  );
}

function Chevron({ open }: { open: boolean }) {
  return (
    <svg className={open ? "chevron open" : "chevron"} viewBox="0 0 16 16" aria-hidden="true">
      <path d="M6 4.5 10 8l-4 3.5" />
    </svg>
  );
}
