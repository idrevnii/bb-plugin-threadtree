import { useCallback, useEffect, useMemo, useState } from "react";
import {
  experimental_useSidebarThreadActions as useSidebarThreadActions,
  useBbNavigate,
  useRpc,
  useSdk,
  type PluginSidebarProject,
  type PluginSidebarThread,
  type PluginThreadListProps,
} from "@get-bb/plugin-sdk/app";
import { Icon } from "@/src/components/ui/icon";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/src/components/ui/alert-dialog";
import { Button } from "@/src/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/src/components/ui/dropdown-menu";
import type { ProjectHost, rpcContract } from "../server";
import { ProjectPathDialog } from "./ProjectPathDialog";
import { TreeRow, type PinControls } from "./TreeRow";
import { usePinDrag, type PinDragState } from "./usePinDrag";
import { usePinnedProjects } from "./usePinnedProjects";
import { useTreeThreads } from "./useTreeThreads";
import {
  loadCollapsedProjects,
  loadExpanded,
  loadHideFinished,
  loadSortMode,
  saveCollapsedProjects,
  saveExpanded,
  saveHideFinished,
  saveSortMode,
} from "./expansion";
import {
  ancestorIds,
  buildForest,
  comparePins,
  compareTitles,
  countStatuses,
  filterForest,
  flattenForest,
  forestStats,
  isFinishedWorker,
  latestActivity,
  movePin,
  pruneForest,
  STATUS_FILTERS,
  type FlatRow,
  type SortMode,
  type StatusFilter,
  type TreeNode,
} from "./tree";

/** The age column only shows minutes, so a minute is fine enough. */
const CLOCK_TICK_MS = 60_000;

function useNow(): number {
  const [now, setNow] = useState(Date.now);
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), CLOCK_TICK_MS);
    return () => clearInterval(timer);
  }, []);
  return now;
}

/**
 * The sidebar's scrolling list, as a tree.
 *
 * The host keeps owning the New-thread button, the search field, the plugin
 * nav rows, and the footer; this fills the scroll area between them, and
 * filters by the host's own `searchQuery` rather than shipping a second
 * search box.
 */
export function ThreadTree({
  activeThreadId,
  activeProjectId,
  isCompactViewport,
  onNavigate,
  searchQuery,
}: PluginThreadListProps) {
  const { status, threads, projects, refetch } = useTreeThreads();
  const navigate = useBbNavigate();
  const sdk = useSdk();
  const now = useNow();
  const [expanded, setExpanded] = useState<Set<string>>(loadExpanded);
  const [collapsedProjects, setCollapsedProjects] = useState<Set<string>>(
    loadCollapsedProjects,
  );
  const { pinned: pinnedProjects, toggle: togglePinProject } =
    usePinnedProjects();
  const [sortMode, setSortMode] = useState<SortMode>(loadSortMode);
  // Not remembered: a status filter left on would greet the next session
  // with a list that looks like threads went missing.
  const [statusFilter, setStatusFilter] = useState<ReadonlySet<StatusFilter>>(
    () => new Set(),
  );
  const [hideFinished, setHideFinished] = useState(loadHideFinished);
  const [pinOverride, setPinOverride] = useState<readonly string[] | null>(null);
  const [pinError, setPinError] = useState<string | null>(null);

  const toggleStatusFilter = useCallback((filter: StatusFilter) => {
    setStatusFilter((current) => {
      const next = new Set(current);
      if (!next.delete(filter)) next.add(filter);
      return next;
    });
  }, []);

  const changeHideFinished = useCallback((hide: boolean) => {
    setHideFinished(hide);
    saveHideFinished(hide);
  }, []);

  const movePinned = useCallback(
    (order: readonly string[], threadId: string, toIndex: number) => {
      const move = movePin(order, threadId, toIndex);
      if (!move) return;
      setPinError(null);
      setPinOverride(move.order);
      sdk.threads
        .reorderPinned({
          threadId,
          previousThreadId: move.previousThreadId,
          nextThreadId: move.nextThreadId,
        })
        .catch(() => {
          setPinOverride(null);
          setPinError("Could not reorder pinned threads.");
        });
    },
    [sdk],
  );
  const pinDrag = usePinDrag(movePinned);

  // The override only bridges the round trip: once bb's own pin order agrees
  // with the drop, the host list is the truth again.
  useEffect(() => {
    if (!pinOverride) return;
    const pins = pinOverride
      .map((id) => threads.get(id)?.host)
      .filter((host): host is PluginSidebarThread => host?.isPinned === true);
    const hostOrder = [...pins].sort(comparePins).map((host) => host.id);
    const wanted = pins.map((host) => host.id);
    if (hostOrder.join("\n") === wanted.join("\n")) setPinOverride(null);
  }, [threads, pinOverride]);

  const changeSort = useCallback((mode: SortMode) => {
    setSortMode(mode);
    saveSortMode(mode);
  }, []);

  const toggle = useCallback((threadId: string) => {
    setExpanded((current) => {
      const next = new Set(current);
      if (!next.delete(threadId)) next.add(threadId);
      saveExpanded(next);
      return next;
    });
  }, []);

  const toggleProject = useCallback((projectId: string) => {
    setCollapsedProjects((current) => {
      const next = new Set(current);
      if (!next.delete(projectId)) next.add(projectId);
      saveCollapsedProjects(next);
      return next;
    });
  }, []);

  const fullForest = useMemo(
    () => buildForest(threads, sortMode, pinOverride ?? undefined),
    [threads, sortMode, pinOverride],
  );
  // From the unfiltered tree, so hiding finished workers does not make a
  // parent's progress look further behind than it is.
  const stats = useMemo(() => forestStats(fullForest), [fullForest]);
  const statusCounts = useMemo(() => countStatuses(threads.values()), [threads]);
  const isFiltering = searchQuery.trim() !== "" || statusFilter.size > 0;

  const { forest, matchedAncestors } = useMemo(() => {
    // Hiding finished workers is a standing view preference, not a search:
    // it unfolds nothing.
    const visible = hideFinished
      ? pruneForest(fullForest, (thread) => !isFinishedWorker(thread)).forest
      : fullForest;
    const searched = filterForest(visible, searchQuery);
    if (statusFilter.size === 0) return searched;
    const filtered = pruneForest(searched.forest, (thread) =>
      statusFilter.has(thread.status as StatusFilter),
    );
    return {
      forest: filtered.forest,
      matchedAncestors: new Set([
        ...searched.matchedAncestors,
        ...filtered.matchedAncestors,
      ]),
    };
  }, [fullForest, hideFinished, searchQuery, statusFilter]);

  // A parent is opened for you when the thread you are viewing lives inside
  // it, or when the search matched something it contains — otherwise the row
  // you are after stays folded away behind a chevron.
  const effectiveExpanded = useMemo(() => {
    const ids = new Set(expanded);
    for (const id of ancestorIds(threads, activeThreadId)) ids.add(id);
    for (const id of matchedAncestors) ids.add(id);
    return ids;
  }, [expanded, matchedAncestors, threads, activeThreadId]);

  const groups = useMemo(
    () =>
      groupByProject(
        forest,
        projects,
        !isFiltering,
        sortMode,
        pinnedProjects,
      ),
    [forest, projects, isFiltering, sortMode, pinnedProjects],
  );

  if (status === "loading") return null;
  if (status === "error") {
    return (
      <p
        role="status"
        className="px-2 py-6 text-center text-xs text-muted-foreground"
      >
        Could not load threads.
      </p>
    );
  }

  return (
    <div className="min-h-0 flex-1 overflow-y-auto px-1.5 pb-2">
      {!searchQuery.trim() ? (
        <ProjectControls
          sortMode={sortMode}
          onSortChange={changeSort}
          hideFinished={hideFinished}
          onHideFinishedChange={changeHideFinished}
          onOpen={(projectId) => {
            navigate.toProject(projectId);
            onNavigate();
          }}
        />
      ) : null}
      <FilterChips
        counts={statusCounts}
        active={statusFilter}
        onToggle={toggleStatusFilter}
      />
      {pinError ? (
        <p role="alert" className="px-2 pb-1 text-xs text-destructive">
          {pinError}
        </p>
      ) : null}

      {groups.length === 0 ? (
        <p
          role="status"
          className="px-2 py-6 text-center text-xs text-muted-foreground"
        >
          {statusFilter.size > 0
            ? "No matching threads"
            : searchQuery.trim()
              ? "No threads found"
              : "No threads yet"}
        </p>
      ) : null}
      {groups.map((group) => {
        const project = group.project;
        const name = project?.isPersonal ? "Chats" : (project?.name ?? "Threads");
        const isProjectCollapsed =
          project != null &&
          !project.isPersonal &&
          collapsedProjects.has(project.id) &&
          !isFiltering;
        // Reordering a filtered list would key pins against neighbours the
        // user cannot see.
        const pinOrder = isFiltering
          ? []
          : group.roots
              .filter((root) => root.thread.host?.isPinned)
              .map((root) => root.thread.id);
        return (
          <section key={group.projectId} aria-label={name}>
            {project && !project.isPersonal ? (
              <ProjectHeader
                project={project}
                isActive={
                  activeThreadId === null && activeProjectId === project.id
                }
                isCollapsed={isProjectCollapsed}
                isPinned={pinnedProjects.has(project.id)}
                onToggle={() => toggleProject(project.id)}
                onTogglePin={() => togglePinProject(project.id)}
                onNavigate={onNavigate}
              />
            ) : groups.length > 1 || project?.isPersonal ? (
              <h2 className="flex items-center gap-2 px-1.5 pb-1 pt-3">
                <span className="truncate text-sm font-medium text-muted-foreground/70">
                  {name}
                </span>
                <span className="h-px flex-1 bg-sidebar-border" />
              </h2>
            ) : null}
            {!isProjectCollapsed ? (
              <ul
                role="tree"
                aria-label={name}
                className="flex flex-col gap-px"
              >
                {flattenForest(group.roots, effectiveExpanded).map((row) => {
                  const rowStats = stats.get(row.node.thread.id);
                  return (
                    <TreeRow
                      key={row.node.thread.id}
                      row={row}
                      isActive={row.node.thread.id === activeThreadId}
                      nestedUnderProject={project != null && !project.isPersonal}
                      now={now}
                      summary={rowStats?.summary ?? null}
                      activity={rowStats?.activity ?? row.node.thread.updatedAt}
                      previewEnabled={!isCompactViewport && pinDrag.drag === null}
                      pin={pinControls(row, pinOrder, pinDrag.drag, {
                        begin: pinDrag.begin,
                        consumeDragClick: pinDrag.consumeDragClick,
                        move: movePinned,
                      })}
                      onNavigate={onNavigate}
                      onToggle={toggle}
                      onHiddenRenamed={refetch}
                    />
                  );
                })}
              </ul>
            ) : null}
          </section>
        );
      })}
    </div>
  );
}

/** Reorder controls for a pinned root, when its project has pins to swap. */
function pinControls(
  row: FlatRow,
  order: readonly string[],
  drag: PinDragState | null,
  handlers: {
    begin: ReturnType<typeof usePinDrag>["begin"];
    consumeDragClick: () => boolean;
    move: (order: readonly string[], threadId: string, toIndex: number) => void;
  },
): PinControls | null {
  const threadId = row.node.thread.id;
  const index = row.depth === 0 ? order.indexOf(threadId) : -1;
  if (index === -1 || order.length < 2) return null;
  let dropEdge: PinControls["dropEdge"] = null;
  if (drag) {
    const from = order.indexOf(drag.threadId);
    // Dropping a row next to itself moves nothing; draw no line for it.
    const moves = drag.insertion !== from && drag.insertion !== from + 1;
    if (moves && drag.insertion === index) dropEdge = "before";
    else if (moves && drag.insertion === order.length && index === order.length - 1) {
      dropEdge = "after";
    }
  }
  return {
    order,
    index,
    dropEdge,
    isDragging: drag?.threadId === threadId,
    onPointerDown: (event) => handlers.begin(event, threadId, order),
    consumeDragClick: handlers.consumeDragClick,
    onMove: (toIndex) => handlers.move(order, threadId, toIndex),
  };
}

const FILTER_LABELS: Record<StatusFilter, string> = {
  "needs-input": "Needs input",
  failed: "Failed",
  working: "Working",
};

/**
 * One chip per status that something is in right now (or that is switched
 * on), so the row stays out of the way while nothing needs attention.
 * Several chips together mean "any of these".
 */
function FilterChips({
  counts,
  active,
  onToggle,
}: {
  counts: Record<StatusFilter, number>;
  active: ReadonlySet<StatusFilter>;
  onToggle: (filter: StatusFilter) => void;
}) {
  const visible = STATUS_FILTERS.filter(
    (filter) => counts[filter] > 0 || active.has(filter),
  );
  if (visible.length === 0) return null;
  return (
    <div
      role="group"
      aria-label="Filter threads"
      className="flex flex-wrap gap-1 px-1.5 pb-2"
    >
      {visible.map((filter) => {
        const isActive = active.has(filter);
        return (
          <button
            key={filter}
            type="button"
            aria-pressed={isActive}
            onClick={() => onToggle(filter)}
            className={`flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs ${
              isActive
                ? "border-primary bg-primary text-primary-foreground"
                : "border-sidebar-border text-muted-foreground hover:bg-sidebar-accent hover:text-foreground"
            }`}
          >
            {FILTER_LABELS[filter]}
            <span className="tabular-nums opacity-70">{counts[filter]}</span>
          </button>
        );
      })}
    </div>
  );
}

function ProjectHeader({
  project,
  isActive,
  isCollapsed,
  isPinned,
  onToggle,
  onTogglePin,
  onNavigate,
}: {
  project: PluginSidebarProject;
  isActive: boolean;
  isCollapsed: boolean;
  isPinned: boolean;
  onToggle: () => void;
  onTogglePin: () => void;
  onNavigate: () => void;
}) {
  const rpc = useRpc<typeof rpcContract>();
  const navigate = useBbNavigate();
  const threadActions = useSidebarThreadActions();
  const [removeOpen, setRemoveOpen] = useState(false);
  const [removing, setRemoving] = useState(false);
  const [removeError, setRemoveError] = useState<string | null>(null);

  const removeProject = async () => {
    if (removing) return;
    setRemoving(true);
    setRemoveError(null);
    try {
      await rpc.call("removeProject", { projectId: project.id });
      setRemoveOpen(false);
      if (isActive) {
        navigate.toCompose();
        onNavigate();
      }
    } catch {
      setRemoveError("Could not remove project.");
    } finally {
      setRemoving(false);
    }
  };

  return (
    <>
      <div
        className={`group/project flex min-w-0 items-center rounded-md py-0.5 hover:bg-sidebar-accent hover:text-foreground ${
          isActive
            ? "bg-sidebar-accent text-foreground"
            : "text-muted-foreground"
        }`}
      >
        <button
          type="button"
          onClick={onToggle}
          aria-label={`${isCollapsed ? "Expand" : "Collapse"} ${project.name}`}
          aria-expanded={!isCollapsed}
          className="flex size-7 shrink-0 items-center justify-center rounded-md hover:text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-sidebar-ring"
        >
          <Icon
            name="ChevronRight"
            className={`size-4 transition-transform ${
              isCollapsed ? "" : "rotate-90"
            }`}
          />
        </button>
        <button
          type="button"
          onClick={() => {
            navigate.toProject(project.id);
            onNavigate();
          }}
          aria-label={`Open ${project.name}`}
          className="flex min-w-0 flex-1 items-center gap-2 py-1 text-left text-base focus-visible:outline-none"
        >
          <Icon name="Folder" className="size-4 shrink-0" />
          <span className="truncate">{project.name}</span>
          {isPinned ? (
            <Icon
              name="Pin"
              aria-label="Pinned"
              className="size-3.5 shrink-0 text-muted-foreground"
            />
          ) : null}
        </button>
        <div className="flex shrink-0 items-center opacity-0 transition-opacity group-hover/project:opacity-100 group-focus-within/project:opacity-100">
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                aria-label={`${project.name} actions`}
                className="size-7 rounded-md p-0 text-muted-foreground hover:bg-transparent hover:text-foreground"
              >
                <Icon name="MoreHorizontal" className="size-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onSelect={onTogglePin}>
                <Icon name={isPinned ? "PinOff" : "Pin"} aria-hidden="true" />
                {isPinned ? "Unpin" : "Pin"}
              </DropdownMenuItem>
              <DropdownMenuItem
                variant="destructive"
                onSelect={() => {
                  setRemoveError(null);
                  setRemoveOpen(true);
                }}
              >
                <Icon name="Trash2" aria-hidden="true" />
                Remove
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            aria-label={`New thread in ${project.name}`}
            onClick={() => {
              threadActions.openNewThread({
                projectId: project.id,
                focusPrompt: true,
              });
              onNavigate();
            }}
            className="size-7 rounded-md p-0 text-muted-foreground hover:bg-transparent hover:text-foreground"
          >
            <Icon name="MessageSquarePlus" className="size-4" />
          </Button>
        </div>
      </div>

      <AlertDialog open={removeOpen} onOpenChange={setRemoveOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Remove project?</AlertDialogTitle>
            <AlertDialogDescription>
              Remove &quot;{project.name}&quot; and all of its threads? This
              cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          {removeError ? (
            <p role="alert" className="text-sm text-destructive">
              {removeError}
            </p>
          ) : null}
          <AlertDialogFooter>
            <AlertDialogCancel disabled={removing}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              disabled={removing}
              onClick={(event) => {
                event.preventDefault();
                void removeProject();
              }}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {removing ? "Removing…" : "Remove project"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}

/** Roots bucketed by project, each bucket keeping the incoming order. */
interface ProjectGroup {
  projectId: string;
  project: PluginSidebarProject | null;
  roots: TreeNode[];
}

function groupByProject(
  forest: readonly TreeNode[],
  projects: readonly PluginSidebarProject[],
  includeEmptyProjects: boolean,
  sortMode: SortMode,
  pinnedProjects: ReadonlySet<string>,
): ProjectGroup[] {
  const groups = new Map<string, TreeNode[]>();
  for (const node of forest) {
    const roots = groups.get(node.thread.projectId);
    if (roots) roots.push(node);
    else groups.set(node.thread.projectId, [node]);
  }
  const result: ProjectGroup[] = [];
  for (const project of projects) {
    const roots = groups.get(project.id) ?? [];
    if (roots.length > 0 || (includeEmptyProjects && !project.isPersonal)) {
      result.push({ projectId: project.id, project, roots });
    }
    groups.delete(project.id);
  }
  for (const [projectId, roots] of groups) {
    result.push({ projectId, project: null, roots });
  }
  return sortGroups(result, sortMode, pinnedProjects);
}

/**
 * Section order. Pinned projects come first — the user's own ordering, which a
 * sort choice is not a request to undo. The personal project ("Chats") is a
 * catch-all rather than a project, so it stays at the bottom in both modes —
 * sorting reorders the real projects above it and never lifts loose chats over
 * them.
 */
function sortGroups(
  groups: readonly ProjectGroup[],
  sortMode: SortMode,
  pinnedProjects: ReadonlySet<string>,
): ProjectGroup[] {
  const rank = (group: ProjectGroup): number =>
    group.project?.isPersonal ? 2 : pinnedProjects.has(group.projectId) ? 0 : 1;
  return [...groups].sort((left, right) => {
    const byKind = rank(left) - rank(right);
    if (byKind !== 0) return byKind;
    if (sortMode === "name") {
      // Unknown projects have no name to sort by; keep them last.
      if (left.project === null || right.project === null) {
        return Number(left.project === null) - Number(right.project === null);
      }
      return compareTitles(left.project.name, right.project.name);
    }
    return latestActivity(right.roots) - latestActivity(left.roots);
  });
}

const SORT_LABELS: Record<SortMode, string> = {
  activity: "Activity",
  name: "Name",
};

/** The ordering picker. Lives next to the section header it reorders. */
function SortMenu({
  sortMode,
  onSortChange,
  hideFinished,
  onHideFinishedChange,
}: {
  sortMode: SortMode;
  onSortChange: (mode: SortMode) => void;
  hideFinished: boolean;
  onHideFinishedChange: (hide: boolean) => void;
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          aria-label={`Sort by ${SORT_LABELS[sortMode].toLowerCase()}`}
          title={`Sort by ${SORT_LABELS[sortMode].toLowerCase()}`}
          className="flex size-6 items-center justify-center rounded-md text-muted-foreground hover:bg-sidebar-accent hover:text-foreground"
        >
          <Icon name="ArrowUpDown" className="size-4" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        {(["activity", "name"] as const).map((mode) => (
          <DropdownMenuItem key={mode} onSelect={() => onSortChange(mode)}>
            <Icon
              name="Check"
              aria-hidden="true"
              className={sortMode === mode ? "" : "opacity-0"}
            />
            Sort by {SORT_LABELS[mode].toLowerCase()}
          </DropdownMenuItem>
        ))}
        <DropdownMenuSeparator />
        <DropdownMenuItem onSelect={() => onHideFinishedChange(!hideFinished)}>
          <Icon
            name="Check"
            aria-hidden="true"
            className={hideFinished ? "" : "opacity-0"}
          />
          Hide finished workers
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function ProjectControls({
  sortMode,
  onSortChange,
  hideFinished,
  onHideFinishedChange,
  onOpen,
}: {
  sortMode: SortMode;
  onSortChange: (mode: SortMode) => void;
  hideFinished: boolean;
  onHideFinishedChange: (hide: boolean) => void;
  onOpen: (projectId: string) => void;
}) {
  const rpc = useRpc<typeof rpcContract>();
  const [formOpen, setFormOpen] = useState(false);
  const [hosts, setHosts] = useState<ProjectHost[]>([]);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const openForm = async () => {
    setFormOpen(true);
    setError(null);
    if (hosts.length > 0) return;
    try {
      const result = await rpc.call("listProjectHosts");
      setHosts(result.hosts);
    } catch {
      setError("Could not load machines.");
    }
  };

  const create = async (hostId: string, path: string) => {
    if (pending) return;
    setPending(true);
    setError(null);
    try {
      const result = await rpc.call("createProject", { hostId, path });
      setFormOpen(false);
      onOpen(result.projectId);
    } catch {
      setError("Could not create project. Check the folder path.");
    } finally {
      setPending(false);
    }
  };

  return (
    <section aria-label="Projects" className="pb-2">
      <div className="flex items-center gap-0.5 px-1.5 pb-1 pt-1">
        <h2 className="flex-1 text-sm font-medium text-muted-foreground/70">
          Projects
        </h2>
        <SortMenu
          sortMode={sortMode}
          onSortChange={onSortChange}
          hideFinished={hideFinished}
          onHideFinishedChange={onHideFinishedChange}
        />
        <button
          type="button"
          onClick={() => void openForm()}
          aria-label="New project"
          title="New project"
          className="flex size-6 items-center justify-center rounded-md text-muted-foreground hover:bg-sidebar-accent hover:text-foreground"
        >
          <Icon name="FolderPlus" className="size-4" />
        </button>
      </div>
      <ProjectPathDialog
        open={formOpen}
        pending={pending}
        hosts={hosts}
        error={error}
        onOpenChange={setFormOpen}
        onSubmit={(hostId, path) => void create(hostId, path)}
      />
      {error && !formOpen ? (
        <p role="alert" className="px-2 text-xs text-destructive">
          {error}
        </p>
      ) : null}
    </section>
  );
}
