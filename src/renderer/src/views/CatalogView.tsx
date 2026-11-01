import { useEffect, useMemo, useState } from "react";
import { flexRender, type ExpandedState } from "@tanstack/react-table";
import {
  getCoreRowModel,
  getExpandedRowModel,
  useLegacyTable,
  type LegacyColumnDef
} from "@tanstack/react-table/legacy";
import {
  addFeature,
  addSubtask,
  addTask,
  compareItemsDescending,
  emptyCatalog,
  generateId,
  parseCatalog,
  setFeatureActive,
  setSubtaskActive,
  setSubtaskStatus,
  setTaskActive,
  subtaskProgress,
  taskProgress,
  WORK_STATUSES,
  type Catalog,
  type CommitType,
  type FeatureItem,
  type SequenceKey,
  type TaskItem,
  type WorkStatus
} from "@shared/catalog";
import { COMMIT_TYPES } from "@shared/commit-message";
import { ENV_RAIL, isTargetEnvironment, branchNames, type EnvironmentName, type Manifest } from "@shared/manifest";
import { workBranchName } from "@shared/work-branch";
import { Autocomplete } from "../Autocomplete";
import { IconClose } from "../icons";
import { useWorkspace } from "../workspace";

const PAGE_SIZE = 10;
type CreateKind = "feature" | "task" | "subtask";
type StatusFilter = "active" | "inactive" | "both";

interface Draft {
  id: string;
  name: string;
  description: string;
  featureId: string;
  taskId: string;
  commitType: CommitType;
}

interface WorkRow {
  id: string;
  kind: CreateKind;
  name: string;
  description: string;
  active: boolean;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
  workStatus: WorkStatus;
  commitType: string;
  done: number;
  total: number;
  featureId: string;
  taskId?: string;
  children?: WorkRow[];
}

const WORK_LABEL: Record<WorkStatus, string> = {
  todo: "To-do",
  "in-progress": "In progress",
  completed: "Completed"
};
const blankDraft: Draft = { id: "", name: "", description: "", featureId: "", taskId: "", commitType: "feat" };

function sequenceKey(kind: CreateKind): SequenceKey {
  return kind === "feature" ? "F" : kind === "task" ? "T" : "ST";
}
const FILTERS: { id: StatusFilter; label: string }[] = [
  { id: "active", label: "Active" },
  { id: "inactive", label: "Inactive" },
  { id: "both", label: "Both" }
];

export function CatalogView() {
  const { snapshot, busy, saveCatalog, listBranches, createWorkBranch } = useWorkspace();
  const catalog = readyCatalog(snapshot?.catalog?.data);
  const manifest = snapshot?.manifest.data;
  const catalogError = snapshot?.catalog?.error ?? "";
  const [environment, setEnvironment] = useState<EnvironmentName>("DEV");
  const [status, setStatus] = useState<StatusFilter>("active");
  const [query, setQuery] = useState("");
  const [page, setPage] = useState(0);
  const [menuOpen, setMenuOpen] = useState(false);
  const [createKind, setCreateKind] = useState<CreateKind | null>(null);
  const [draft, setDraft] = useState<Draft>(blankDraft);
  const [formError, setFormError] = useState("");
  const [pending, setPending] = useState<WorkRow | null>(null);
  const [createBranch, setCreateBranch] = useState(false);
  const [baseBranch, setBaseBranch] = useState("");
  const [branches, setBranches] = useState<string[]>([]);
  const dirty = (snapshot?.changes.length ?? 0) > 0;

  const needle = query.trim().toLowerCase();
  const visible = useMemo(
    () => featuresFor(catalog, environment, manifest).filter((feature) => matchesStatus(feature, status) && matchesQuery(feature, needle)),
    [catalog, environment, manifest, status, needle]
  );
  const pageCount = Math.max(1, Math.ceil(visible.length / PAGE_SIZE));
  const safePage = Math.min(page, pageCount - 1);
  const rows = useMemo(
    () => toRows(visible.slice(safePage * PAGE_SIZE, safePage * PAGE_SIZE + PAGE_SIZE), status, needle),
    [visible, safePage, status, needle]
  );
  const pageKey = rowSignature(rows);
  const [expandedKey, setExpandedKey] = useState(pageKey);
  const [expanded, setExpanded] = useState<ExpandedState>({});
  if (expandedKey !== pageKey) {
    setExpandedKey(pageKey);
    setExpanded({});
  }
  const from = visible.length === 0 ? 0 : safePage * PAGE_SIZE + 1;
  const to = Math.min(visible.length, safePage * PAGE_SIZE + PAGE_SIZE);

  const persist = async (next: Catalog, notice?: string) => {
    const saved = await saveCatalog(next, notice);
    if (saved) {
      setFormError("");
    }
    return saved;
  };

  const requestActiveChange = (row: WorkRow) => {
    if (row.active) {
      setPending(row);
      return;
    }
    void persist(withActive(catalog, row, true));
  };

  const columns = useMemo<LegacyColumnDef<WorkRow>[]>(() => [
    {
      id: "expander",
      header: "",
      cell: ({ row }) => row.getCanExpand() ? (
        <button type="button" className="icon-button" aria-label={row.getIsExpanded() ? "Collapse" : "Expand"} onClick={row.getToggleExpandedHandler()}>
          <Chevron expanded={row.getIsExpanded()} />
        </button>
      ) : <span className="expander-gap" />
    },
    {
      accessorKey: "id",
      header: "Id",
      cell: ({ row }) => (
        <span className="tree-id" style={{ paddingLeft: row.depth * 18 }}>
          <em>{labelFor(row.original.kind)}</em>
          <code>{row.original.id}</code>
        </span>
      )
    },
    { accessorKey: "name", header: "Name" },
    {
      id: "commitType",
      header: "Type",
      cell: ({ row }) => <span className="commit-type">{row.original.commitType || "—"}</span>
    },
    {
      accessorKey: "description",
      header: "Description",
      cell: ({ getValue }) => <span className="desc">{String(getValue() || "—")}</span>
    },
    {
      accessorKey: "createdBy",
      header: "Created by",
      cell: ({ getValue }) => <span className="desc">{String(getValue() || "—")}</span>
    },
    {
      accessorKey: "createdAt",
      header: "Created",
      cell: ({ getValue }) => <Stamp value={String(getValue() ?? "")} />
    },
    {
      accessorKey: "updatedAt",
      header: "Updated",
      cell: ({ getValue }) => <Stamp value={String(getValue() ?? "")} />
    },
    {
      id: "progress",
      header: "Progress",
      cell: ({ row }) => row.original.kind === "subtask" ? (
        <select
          className={`work-status is-${row.original.workStatus}`}
          value={row.original.workStatus}
          disabled={busy}
          aria-label={`Work status for ${row.original.id}`}
          onChange={(event) => {
            void persist(setSubtaskStatus(
              catalog,
              row.original.featureId,
              row.original.taskId ?? "",
              row.original.id,
              event.target.value as WorkStatus
            ));
          }}
        >
          {WORK_STATUSES.map((item) => (
            <option key={item} value={item}>{WORK_LABEL[item]}</option>
          ))}
        </select>
      ) : (
        <Progress done={row.original.done} total={row.original.total} unit={row.original.kind === "feature" ? "tasks" : "subtasks"} />
      )
    },
    {
      id: "actions",
      header: "Actions",
      cell: ({ row }) => (
        <span className="status-cell">
          <span className={row.original.active ? "badge is-active" : "badge is-inactive"}>
            {row.original.active ? "Active" : "Inactive"}
          </span>
          {row.original.kind === "subtask" ? null : (
            <button
              type="button"
              className="icon-button"
              disabled={busy || !row.original.active}
              aria-label={row.original.kind === "feature" ? `Add a task to ${row.original.id}` : `Add a subtask to ${row.original.id}`}
              onClick={() => {
                setMenuOpen(false);
                setFormError("");
                const kind = row.original.kind === "feature" ? "task" : "subtask";
                setDraft({
                  ...blankDraft,
                  id: generateId(sequenceKey(kind)),
                  featureId: row.original.featureId,
                  taskId: row.original.kind === "task" ? row.original.taskId ?? row.original.id : ""
                });
                setCreateBranch(false);
                setBaseBranch(snapshot?.branch && snapshot.branch !== "detached" ? snapshot.branch : "");
                setCreateKind(kind);
              }}
            >
              <IconPlus />
            </button>
          )}
          <button
            type="button"
            className="icon-button"
            disabled={busy}
            aria-label={row.original.active ? `Mark ${row.original.id} inactive` : `Reactivate ${row.original.id}`}
            onClick={() => requestActiveChange(row.original)}
          >
            {row.original.active ? <IconDeactivate /> : <IconReactivate />}
          </button>
        </span>
      )
    }
  ], [busy, catalog, snapshot?.branch]);

  const table = useLegacyTable({
    data: rows,
    columns,
    state: { expanded },
    autoResetExpanded: false,
    onExpandedChange: setExpanded,
    getSubRows: (row) => row.children,
    getCoreRowModel: getCoreRowModel(),
    getExpandedRowModel: getExpandedRowModel(),
    getRowId: (row) => row.id
  });

  useEffect(() => {
    if (!menuOpen) {
      return;
    }
    const close = () => setMenuOpen(false);
    document.addEventListener("pointerdown", close);
    return () => document.removeEventListener("pointerdown", close);
  }, [menuOpen]);

  const openCreate = (kind: CreateKind) => {
    setMenuOpen(false);
    setFormError("");
    setDraft({ ...blankDraft, id: generateId(sequenceKey(kind)) });
    setCreateBranch(false);
    setBaseBranch(snapshot?.branch && snapshot.branch !== "detached" ? snapshot.branch : "");
    setCreateKind(kind);
  };

  useEffect(() => {
    if (createKind !== "subtask") {
      return;
    }
    let cancel = false;
    void listBranches().then((next) => {
      if (cancel) {
        return;
      }
      const preferred = snapshot?.manifest.data ? ENV_RAIL.map((name) => branchNames(snapshot.manifest.data)[name]) : [];
      const ordered = next.length > 0 ? next : preferred;
      const currentBranch = snapshot?.branch && snapshot.branch !== "detached" ? snapshot.branch : "";
      const listed = currentBranch ? [currentBranch, ...ordered.filter((item) => item !== currentBranch)] : ordered;
      setBranches(listed);
      setBaseBranch((current) => current || currentBranch || listed[0] || "");
    });
    return () => {
      cancel = true;
    };
  }, [createKind, listBranches, snapshot?.branch, snapshot?.manifest.data]);

  const save = async () => {
    if (!createKind) {
      return;
    }
    const authored = { ...draft, createdBy: snapshot?.gitUser ?? "" };
    const next = createKind === "feature"
      ? addFeature(catalog, authored)
      : createKind === "task"
        ? addTask(catalog, draft.featureId, authored)
        : addSubtask(catalog, draft.featureId, draft.taskId, authored);
    if (!next.ok) {
      setFormError(next.error);
      return;
    }
    if (createKind === "subtask" && createBranch) {
      if (!baseBranch) {
        setFormError("Choose a base branch.");
        return;
      }
      if (dirty && snapshot?.branch !== baseBranch) {
        setFormError("Local changes are present. A branch cannot be created automatically.");
        return;
      }
      const branch = workBranchName(baseBranch, draft.featureId, draft.taskId, draft.id, draft.name);
      if (snapshot?.branch !== branch) {
        const failure = await createWorkBranch({ base: baseBranch, branch });
        if (failure) {
          setFormError(failure);
          return;
        }
      }
    }
    const saved = await persist(next.catalog, createKind === "subtask" && createBranch ? `Subtask saved on ${workBranchName(baseBranch, draft.featureId, draft.taskId, draft.id, draft.name)}.` : undefined);
    if (!saved) {
      return;
    }
    if (createKind === "feature" || (isTargetEnvironment(environment) && !manifest?.environments[environment].features[draft.featureId])) {
      setEnvironment("DEV");
      setPage(0);
    }
    setCreateKind(null);
    setDraft(blankDraft);
    setCreateBranch(false);
  };

  const emptyCopy = needle
    ? "No matches for that search."
    : status === "inactive"
    ? "No inactive items in this list."
    : environment === "DEV"
      ? "No active features yet."
      : `No ${status === "both" ? "" : "active "}features are on ${environment} yet.`;

  return (
    <section className="page">
      <header className="page-head catalog-head">
        <div>
          <p className="eyebrow">Catalog</p>
          <h1>Define features, tasks, and subtasks</h1>
          <p className="lede">
            Ids stay in the catalog. Mark an item inactive to hide it from commits. DEV lists every feature. QAS, UAT, and PROD list features already promoted there.
          </p>
        </div>
        <div className="catalog-tools">
          <label className="field">
            <span>Environment</span>
            <Autocomplete
              value={environment}
              allowEmpty={false}
              options={ENV_RAIL.map((name) => ({ value: name, label: name }))}
              onChange={(next) => {
                setEnvironment(next as EnvironmentName);
                setPage(0);
              }}
            />
          </label>
          <div className="status-filter" role="group" aria-label="Status">
            {FILTERS.map((item) => (
              <button
                key={item.id}
                type="button"
                aria-pressed={status === item.id}
                onClick={() => {
                  setStatus(item.id);
                  setPage(0);
                }}
              >
                {item.label}
              </button>
            ))}
          </div>
          <label className="field search-field">
            <span>Search</span>
            <input
              type="search"
              value={query}
              placeholder="Id, name, or description"
              onChange={(event) => {
                setQuery(event.target.value);
                setPage(0);
              }}
            />
          </label>
          <div className="create-menu" onPointerDown={(event) => event.stopPropagation()}>
            <button type="button" className="primary" disabled={busy} aria-expanded={menuOpen} onClick={() => setMenuOpen((open) => !open)}>
              Create
            </button>
            {menuOpen ? (
              <div className="create-popover" role="menu">
                <button type="button" role="menuitem" onClick={() => openCreate("feature")}>Feature</button>
                <button type="button" role="menuitem" onClick={() => openCreate("task")}>Task</button>
                <button type="button" role="menuitem" onClick={() => openCreate("subtask")}>Subtask</button>
              </div>
            ) : null}
          </div>
        </div>
      </header>
      {catalogError ? <p className="note">{catalogError}</p> : null}
      <div className="table-wrap">
        <table className="feature-table">
          <thead>
            {table.getHeaderGroups().map((group) => (
              <tr key={group.id}>
                {group.headers.map((header) => (
                  <th key={header.id}>
                    {header.isPlaceholder ? null : flexRender(header.column.columnDef.header, header.getContext())}
                  </th>
                ))}
              </tr>
            ))}
          </thead>
          <tbody>
            {table.getRowModel().rows.length === 0 ? (
              <tr>
                <td colSpan={columns.length} className="table-empty">{emptyCopy}</td>
              </tr>
            ) : table.getRowModel().rows.map((row) => (
              <tr key={row.id} className={row.original.active ? undefined : "is-inactive"} data-kind={row.original.kind}>
                {row.getVisibleCells().map((cell) => (
                  <td key={cell.id}>{flexRender(cell.column.columnDef.cell, cell.getContext())}</td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="pager">
        <span>{visible.length === 0 ? "0 features" : `${from}–${to} of ${visible.length}`}</span>
        <div>
          <button type="button" className="ghost" disabled={safePage === 0} onClick={() => setPage(safePage - 1)}>Previous</button>
          <button type="button" className="ghost" disabled={safePage >= pageCount - 1} onClick={() => setPage(safePage + 1)}>Next</button>
        </div>
      </div>
      {createKind ? (
        <CreateDialog
          kind={createKind}
          catalog={catalog}
          draft={draft}
          createdBy={snapshot?.gitUser ?? ""}
          busy={busy}
          error={formError}
          onDraft={setDraft}
          onClose={() => {
            setCreateKind(null);
            setCreateBranch(false);
          }}
          onSubmit={() => void save()}
          createBranch={createBranch}
          dirty={dirty}
          currentBranch={snapshot?.branch ?? ""}
          branches={branches}
          baseBranch={baseBranch}
          branchPreview={createKind === "subtask" && draft.featureId && draft.taskId && draft.id ? workBranchName(baseBranch || branches[0] || "dev", draft.featureId, draft.taskId, draft.id, draft.name) : ""}
          onCreateBranch={setCreateBranch}
          onBaseBranch={setBaseBranch}
        />
      ) : null}
      {pending ? (
        <div className="dialog-backdrop" onMouseDown={() => setPending(null)}>
          <div className="dialog" role="dialog" aria-modal="true" aria-label="Mark inactive" onMouseDown={(event) => event.stopPropagation()}>
            <header>
              <h2>Mark {pending.id} inactive?</h2>
            </header>
            <p>It stays in the catalog. Commits will no longer offer it until you reactivate it.</p>
            <div className="dialog-actions">
              <button type="button" className="ghost" onClick={() => setPending(null)}>Cancel</button>
              <button
                type="button"
                className="primary"
                disabled={busy}
                onClick={() => {
                  void persist(withActive(catalog, pending, false)).then((saved) => {
                    if (saved) {
                      setPending(null);
                    }
                  });
                }}
              >
                Mark inactive
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </section>
  );
}

function CreateDialog({
  kind,
  catalog,
  draft,
  createdBy,
  busy,
  error,
  onDraft,
  onClose,
  onSubmit,
  createBranch,
  dirty,
  currentBranch,
  branches,
  baseBranch,
  branchPreview,
  onCreateBranch,
  onBaseBranch
}: {
  kind: CreateKind;
  catalog: Catalog;
  draft: Draft;
  createdBy: string;
  busy: boolean;
  error: string;
  onDraft: (draft: Draft) => void;
  onClose: () => void;
  onSubmit: () => void;
  createBranch: boolean;
  dirty: boolean;
  currentBranch: string;
  branches: string[];
  baseBranch: string;
  branchPreview: string;
  onCreateBranch: (value: boolean) => void;
  onBaseBranch: (value: string) => void;
}) {
  const features = catalog.features.filter((item) => item.active);
  const feature = features.find((item) => item.id === draft.featureId);
  const tasks = feature?.tasks.filter((item) => item.active) ?? [];
  const title = kind === "feature" ? "New feature" : kind === "task" ? "New task" : "New subtask";
  return (
    <div className="dialog-backdrop" onMouseDown={onClose}>
      <form
        className="dialog"
        role="dialog"
        aria-modal="true"
        aria-label={title}
        onMouseDown={(event) => event.stopPropagation()}
        onSubmit={(event) => {
          event.preventDefault();
          onSubmit();
        }}
      >
        <header>
          <h2>{title}</h2>
          <button type="button" className="icon-button dialog-close" aria-label="Close" onClick={onClose}>
            <IconClose />
          </button>
        </header>
        <label className="field">
          <span>Id</span>
          <input value={draft.id} readOnly />
        </label>
        <label className="field">
          <span>Created by</span>
          <input value={createdBy} readOnly placeholder="Git user.name is not set" />
        </label>
        {kind !== "feature" ? (
          <label className="field">
            <span>Feature</span>
            <Autocomplete
              value={draft.featureId}
              placeholder="Select a feature"
              options={features.map((item) => ({ value: item.id, label: `${item.id} · ${item.name}` }))}
              onChange={(featureId) => onDraft({ ...draft, featureId, taskId: "" })}
            />
          </label>
        ) : null}
        {kind === "subtask" ? (
          <label className="field">
            <span>Task</span>
            <Autocomplete
              value={draft.taskId}
              placeholder={feature ? "Select a task" : "Select a feature first"}
              disabled={!feature || tasks.length === 0}
              options={tasks.map((item) => ({ value: item.id, label: `${item.id} · ${item.name}` }))}
              onChange={(taskId) => onDraft({ ...draft, taskId })}
            />
          </label>
        ) : null}
        {kind === "task" ? (
          <label className="field">
            <span>Type</span>
            <Autocomplete
              value={draft.commitType}
              allowEmpty={false}
              options={COMMIT_TYPES.map((item) => ({ value: item, label: item }))}
              onChange={(commitType) => onDraft({ ...draft, commitType: commitType as CommitType })}
            />
          </label>
        ) : null}
        <label className="field">
          <span>Name</span>
          <input value={draft.name} placeholder="Refunds" onChange={(event) => onDraft({ ...draft, name: event.target.value })} />
        </label>
        <label className="field">
          <span>Description</span>
          <textarea value={draft.description} placeholder="What this work covers" onChange={(event) => onDraft({ ...draft, description: event.target.value })} />
        </label>
        {error ? <small className="field-error">{error}</small> : null}
        {kind === "subtask" ? (
          <div className="branch-choice">
            <label className="check">
              <input
                type="checkbox"
                checked={createBranch}
                disabled={busy}
                onChange={(event) => onCreateBranch(event.target.checked)}
              />
              <span>Create a branch</span>
            </label>
            {dirty && baseBranch !== currentBranch ? <p className="note">Local changes are present. Stay on the current branch, or clear those changes before using another base.</p> : null}
            {createBranch ? (
              <label className="field">
                <span>Base branch</span>
                <Autocomplete
                  value={baseBranch}
                  allowEmpty={false}
                  placeholder={branches.length === 0 ? "No branches" : "Select a base branch"}
                  options={branches.map((item) => ({ value: item, label: item === currentBranch ? `${item} (current)` : item }))}
                  onChange={onBaseBranch}
                />
                {branchPreview ? <small>New branch {branchPreview}</small> : null}
              </label>
            ) : null}
          </div>
        ) : null}
        <div className="dialog-actions">
          <button type="button" className="ghost" onClick={onClose}>Cancel</button>
          <button type="submit" className="primary" disabled={busy}>Create {kind}</button>
        </div>
      </form>
    </div>
  );
}

function Chevron({ expanded }: { expanded: boolean }) {
  return (
    <svg viewBox="0 0 16 16" aria-hidden="true" className={expanded ? "chevron is-open" : "chevron"}>
      <path d="M6 3.5 10.5 8 6 12.5" />
    </svg>
  );
}

function IconPlus() {
  return (
    <svg viewBox="0 0 16 16" aria-hidden="true">
      <path d="M8 3.5v9M3.5 8h9" />
    </svg>
  );
}

function IconDeactivate() {
  return (
    <svg viewBox="0 0 16 16" aria-hidden="true">
      <circle cx="8" cy="8" r="5.25" />
      <path d="M4.75 11.25 11.25 4.75" />
    </svg>
  );
}

function IconReactivate() {
  return (
    <svg viewBox="0 0 16 16" aria-hidden="true">
      <path d="M3.5 8.25 6.5 11.25 12.5 4.75" />
    </svg>
  );
}

function rowSignature(items: WorkRow[]): string {
  return items.map((item) => `${item.id}:${item.active}:${rowSignature(item.children ?? [])}`).join(",");
}

function Progress({ done, total, unit }: { done: number; total: number; unit: string }) {
  const complete = total > 0 && done === total;
  const label = total === 0 ? `No ${unit}` : `${done} of ${total} ${unit} completed`;
  return <span className={complete ? "progress is-complete" : "progress"} title={label}>{done}/{total}</span>;
}

function Stamp({ value }: { value: string }) {
  return <time className="time" dateTime={value || undefined} title={value || undefined}>{formatStamp(value)}</time>;
}

function formatStamp(value: string): string {
  const time = Date.parse(value);
  if (!value || Number.isNaN(time)) {
    return "—";
  }
  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit"
  }).format(time);
}

function labelFor(kind: CreateKind): string {
  if (kind === "feature") {
    return "Feature";
  }
  return kind === "task" ? "Task" : "Subtask";
}

function withActive(catalog: Catalog, row: WorkRow, active: boolean): Catalog {
  if (row.kind === "feature") {
    return setFeatureActive(catalog, row.featureId, active);
  }
  if (row.kind === "task") {
    return setTaskActive(catalog, row.featureId, row.taskId ?? row.id, active);
  }
  return setSubtaskActive(catalog, row.featureId, row.taskId ?? "", row.id, active);
}

function matchesStatus(feature: FeatureItem, status: StatusFilter): boolean {
  if (status === "both") {
    return true;
  }
  if (status === "active") {
    return feature.active;
  }
  return !feature.active || feature.tasks.some((task) => !task.active || task.subtasks.some((subtask) => !subtask.active));
}

function matchesQuery(feature: FeatureItem, needle: string): boolean {
  if (!needle) {
    return true;
  }
  if (textHits(feature, needle)) {
    return true;
  }
  return feature.tasks.some((task) => textHits(task, needle) || task.subtasks.some((subtask) => textHits(subtask, needle)));
}

function textHits(item: { id: string; name: string; description: string; createdBy: string }, needle: string): boolean {
  return [item.id, item.name, item.description, item.createdBy].some((value) => value.toLowerCase().includes(needle));
}

function toRows(features: FeatureItem[], status: StatusFilter, needle: string): WorkRow[] {
  return features.map((feature) => {
    const featureHit = !needle || textHits(feature, needle);
    const tasks = childTasks(feature, status, needle, featureHit);
    return {
      id: feature.id,
      kind: "feature",
      name: feature.name,
      description: feature.description,
      active: feature.active,
      createdBy: feature.createdBy,
      createdAt: feature.createdAt,
      updatedAt: feature.updatedAt,
      workStatus: "todo",
      commitType: "",
      ...taskProgress(feature),
      featureId: feature.id,
      children: tasks.length > 0 ? tasks : undefined
    };
  });
}

function childTasks(feature: FeatureItem, status: StatusFilter, needle: string, featureHit: boolean): WorkRow[] {
  const tasks = [...feature.tasks].sort(compareItemsDescending);
  return tasks.flatMap((task) => {
    const taskHit = featureHit || !needle || textHits(task, needle);
    const subtasks = childSubtasks(feature, task, status, needle, taskHit);
    const include = (status === "both"
      || (status === "active" && feature.active && task.active)
      || (status === "inactive" && (!feature.active || !task.active || subtasks.length > 0)))
      && (taskHit || subtasks.length > 0);
    if (!include) {
      return [];
    }
    return [{
      id: task.id,
      kind: "task" as const,
      name: task.name,
      description: task.description,
      active: task.active,
      createdBy: task.createdBy,
      createdAt: task.createdAt,
      updatedAt: task.updatedAt,
      workStatus: "todo",
      commitType: task.commitType,
      ...subtaskProgress(task),
      featureId: feature.id,
      taskId: task.id,
      children: subtasks.length > 0 ? subtasks : undefined
    }];
  });
}

function childSubtasks(feature: FeatureItem, task: TaskItem, status: StatusFilter, needle: string, taskHit: boolean): WorkRow[] {
  const subtasks = [...task.subtasks].sort(compareItemsDescending);
  return subtasks.flatMap((subtask) => {
    const include = (status === "both"
      || (status === "active" && feature.active && task.active && subtask.active)
      || (status === "inactive" && (!feature.active || !task.active || !subtask.active)))
      && (taskHit || textHits(subtask, needle));
    if (!include) {
      return [];
    }
    return [{
      id: subtask.id,
      kind: "subtask" as const,
      name: subtask.name,
      description: subtask.description,
      active: subtask.active,
      createdBy: subtask.createdBy,
      createdAt: subtask.createdAt,
      updatedAt: subtask.updatedAt,
      workStatus: subtask.status,
      commitType: task.commitType,
      done: 0,
      total: 0,
      featureId: feature.id,
      taskId: task.id
    }];
  });
}

function featuresFor(catalog: Catalog, environment: EnvironmentName, manifest: Manifest | undefined): FeatureItem[] {
  const sorted = [...catalog.features].sort(compareItemsDescending);
  if (environment === "DEV" || !manifest || !isTargetEnvironment(environment)) {
    return sorted;
  }
  const recorded = manifest.environments[environment].features;
  return sorted.filter((feature) => Boolean(recorded[feature.id]));
}

function readyCatalog(data: Catalog | undefined): Catalog {
  if (!data) {
    return emptyCatalog();
  }
  if (data.sequences && Array.isArray(data.features)) {
    return parseCatalog(JSON.stringify(data));
  }
  try {
    return parseCatalog(JSON.stringify({ features: data.features ?? [] }));
  } catch {
    return emptyCatalog();
  }
}
