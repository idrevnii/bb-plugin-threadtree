// The tree: merging, nesting, searching, flattening. Pure functions over
// plain data, so the rules are testable without mounting a sidebar.
import type { PluginSidebarThread } from "@get-bb/plugin-sdk/app";
import type { ChildThread } from "../server";

/**
 * The four states a row can draw. bb resolves twelve indicator kinds; the
 * extra ones all mean "something is running", so they collapse here rather
 * than in the component.
 */
export type RowStatus = "failed" | "needs-input" | "working" | "unread" | "none";

export interface TreeThread {
  id: string;
  projectId: string;
  parentThreadId: string | null;
  title: string;
  createdAt: number;
  /** Last touched, epoch ms. The "by activity" sort key. */
  updatedAt: number;
  isHidden: boolean;
  status: RowStatus;
  /**
   * The host row, when bb's own sidebar knows this thread. Null for hidden
   * workers — and that null is load-bearing: the host's thread actions ignore
   * or reject ids absent from its list, so a null here means the row has to
   * navigate with `toThread` and gets no host action menu.
   */
  host: PluginSidebarThread | null;
}

export interface TreeNode {
  thread: TreeThread;
  children: TreeNode[];
}

function displayTitle(thread: {
  title: string | null;
  titleFallback: string | null;
}): string {
  return (
    thread.title?.trim() || thread.titleFallback?.trim() || "Untitled thread"
  );
}

function hostStatus(thread: PluginSidebarThread): RowStatus {
  switch (thread.indicator) {
    case "unread-error":
    case "queued-failed":
      return "failed";
    case "waiting-for-input":
      return "needs-input";
    case "runtime":
    case "workflow":
    case "background-agent":
    case "background-command":
    case "plan-mode":
    case "goal":
    case "working-draft":
    case "queued-waiting":
      return "working";
    case "unread-success":
      return "unread";
    default:
      // Includes kinds bb ships after this was written.
      return "none";
  }
}

/**
 * Host rows win on collision: bb's list carries live pins, unread state, and
 * the resolved indicator, none of which the raw SDK row has. The RPC only
 * contributes what the host cannot see — hidden threads.
 */
export function mergeThreads(
  hostThreads: readonly PluginSidebarThread[],
  children: readonly ChildThread[],
): Map<string, TreeThread> {
  const merged = new Map<string, TreeThread>();
  for (const thread of hostThreads) {
    merged.set(thread.id, {
      id: thread.id,
      projectId: thread.projectId,
      parentThreadId: thread.parentThreadId,
      // bb's own resolved title, with `@thread:` mentions turned into names.
      title: thread.displayTitle.trim() || displayTitle(thread),
      createdAt: thread.createdAt,
      updatedAt: thread.updatedAt,
      isHidden: thread.isHidden,
      status: hostStatus(thread),
      host: thread,
    });
  }
  for (const child of children) {
    if (merged.has(child.id)) continue;
    merged.set(child.id, {
      id: child.id,
      projectId: child.projectId,
      parentThreadId: child.parentThreadId,
      title: displayTitle(child),
      createdAt: child.createdAt,
      updatedAt: child.updatedAt,
      isHidden: child.isHidden,
      status: child.needsInput
        ? "needs-input"
        : child.isWorking
          ? "working"
          : child.isFailed
            ? "failed"
            : "none",
      host: null,
    });
  }
  return merged;
}

/**
 * How the list is ordered. "activity" is bb's own reading of the sidebar —
 * what moved most recently floats up; "name" turns it into a stable A→Z
 * directory, which is what you want when you are looking for a thread you
 * already know the name of.
 */
export type SortMode = "activity" | "name";

export const DEFAULT_SORT_MODE: SortMode = "activity";

export function isSortMode(value: unknown): value is SortMode {
  return value === "activity" || value === "name";
}

/**
 * A node's activity is the latest activity anywhere beneath it: a parent whose
 * only movement is a worker three levels down is still an active thread, and
 * sinking it would bury the running work with it.
 */
function subtreeActivity(node: TreeNode, cache: Map<string, number>): number {
  const cached = cache.get(node.thread.id);
  if (cached !== undefined) return cached;
  let latest = node.thread.updatedAt;
  for (const child of node.children) {
    latest = Math.max(latest, subtreeActivity(child, cache));
  }
  cache.set(node.thread.id, latest);
  return latest;
}

/** The activity of a whole bucket of roots — used to order project sections. */
export function latestActivity(nodes: readonly TreeNode[]): number {
  const cache = new Map<string, number>();
  let latest = 0;
  for (const node of nodes) latest = Math.max(latest, subtreeActivity(node, cache));
  return latest;
}

export function compareTitles(left: string, right: string): number {
  return left.localeCompare(right, undefined, {
    sensitivity: "base",
    numeric: true,
  });
}

/**
 * Roots, each with its children attached.
 *
 * A thread becomes a root when it has no parent, or when its parent is not on
 * screen — archived, deleted, or in a project bb did not return. That orphan
 * rule matters: dropping it would make the thread unreachable from the sidebar
 * entirely.
 */
export function buildForest(
  threads: ReadonlyMap<string, TreeThread>,
  sortMode: SortMode = DEFAULT_SORT_MODE,
  /**
   * The pin order of a drop the host has not confirmed yet, so a dragged row
   * stays where it was put instead of snapping back for a round trip.
   */
  pinOverride?: readonly string[],
): TreeNode[] {
  const nodes = new Map<string, TreeNode>();
  for (const thread of threads.values()) {
    nodes.set(thread.id, { thread, children: [] });
  }

  const roots: TreeNode[] = [];
  for (const node of nodes.values()) {
    const parentId = node.thread.parentThreadId;
    const parent = parentId === null ? undefined : nodes.get(parentId);
    if (parent) parent.children.push(node);
    else roots.push(node);
  }

  // Children first: a parent's activity is read from its subtree, so the
  // subtree has to be assembled before anything above it can be ordered.
  const activity = new Map<string, number>();
  const byActivity = (left: TreeNode, right: TreeNode): number =>
    subtreeActivity(right, activity) - subtreeActivity(left, activity) ||
    right.thread.createdAt - left.thread.createdAt;
  const byName = (left: TreeNode, right: TreeNode): number =>
    compareTitles(left.thread.title, right.thread.title) ||
    left.thread.createdAt - right.thread.createdAt;

  for (const node of nodes.values()) {
    // By name, children read A→Z like their parents. By activity, the busiest
    // worker rises — otherwise the row you are waiting on sits at the bottom
    // of a long spawn list.
    node.children.sort(sortMode === "name" ? byName : byActivity);
  }
  // Pinned stays first in both modes, in the user's own drag order: that is
  // their ordering, and a sort choice is not a request to undo it.
  roots.sort((left, right) => {
    const leftHost = left.thread.host;
    const rightHost = right.thread.host;
    const leftPinned = leftHost?.isPinned ?? false;
    const rightPinned = rightHost?.isPinned ?? false;
    if (leftPinned !== rightPinned) return Number(rightPinned) - Number(leftPinned);
    if (leftPinned && leftHost && rightHost) return comparePins(leftHost, rightHost);
    return sortMode === "name" ? byName(left, right) : byActivity(left, right);
  });
  if (pinOverride) applyPinOverride(roots, pinOverride);
  return roots;
}

/**
 * Re-deal the overridden pins into the slots they already hold, in the
 * override's order. A pass of its own rather than a comparator rule: mixing
 * override ranks with sort keys would not be a consistent ordering.
 */
function applyPinOverride(roots: TreeNode[], order: readonly string[]): void {
  const pinned = new Set(
    roots.filter((node) => node.thread.host?.isPinned).map((node) => node.thread.id),
  );
  const wanted = order.filter((id) => pinned.has(id));
  const wantedSet = new Set(wanted);
  const byId = new Map(roots.map((node) => [node.thread.id, node]));
  let next = 0;
  roots.forEach((node, slot) => {
    if (wantedSet.has(node.thread.id)) roots[slot] = byId.get(wanted[next++]!)!;
  });
}

type PinFields = Pick<
  PluginSidebarThread,
  "id" | "pinSortKey" | "pinnedAt" | "createdAt"
>;

/**
 * bb's own pin order: reordered pins by their key, then pins never dragged,
 * newest pin first.
 */
export function comparePins(left: PinFields, right: PinFields): number {
  if (left.pinSortKey !== null && right.pinSortKey !== null) {
    if (left.pinSortKey !== right.pinSortKey) {
      return left.pinSortKey < right.pinSortKey ? -1 : 1;
    }
  } else if (left.pinSortKey !== null || right.pinSortKey !== null) {
    return left.pinSortKey !== null ? -1 : 1;
  }
  return (
    (right.pinnedAt ?? 0) - (left.pinnedAt ?? 0) ||
    right.createdAt - left.createdAt ||
    (left.id < right.id ? -1 : left.id > right.id ? 1 : 0)
  );
}

/**
 * Moving one pin to `toIndex` within `order`: the new order, plus the
 * neighbours bb's `reorderPinned` keys the moved thread between.
 */
export function movePin(
  order: readonly string[],
  threadId: string,
  toIndex: number,
): {
  order: string[];
  previousThreadId: string | null;
  nextThreadId: string | null;
} | null {
  const from = order.indexOf(threadId);
  if (from === -1) return null;
  const target = Math.max(0, Math.min(order.length - 1, toIndex));
  if (target === from) return null;
  const next = order.filter((id) => id !== threadId);
  next.splice(target, 0, threadId);
  return {
    order: next,
    previousThreadId: next[target - 1] ?? null,
    nextThreadId: next[target + 1] ?? null,
  };
}

export function countDescendants(node: TreeNode): number {
  return node.children.reduce(
    (total, child) => total + 1 + countDescendants(child),
    0,
  );
}

/** Which state wins when several rows speak through one glyph. */
const STATUS_RANK: Record<RowStatus, number> = {
  none: 0,
  unread: 1,
  working: 2,
  "needs-input": 3,
  failed: 4,
};

export function worstStatus(left: RowStatus, right: RowStatus): RowStatus {
  return STATUS_RANK[right] > STATUS_RANK[left] ? right : left;
}

/** What a collapsed parent is hiding, counted over every descendant. */
export interface SubtreeSummary {
  total: number;
  /** Neither running, waiting on the user, nor failed. */
  done: number;
  working: number;
  needsInput: number;
  failed: number;
  /** The most urgent state anywhere below, for the parent's glyph. */
  worst: RowStatus;
}

/** A node's descendants summarized, and the latest activity in its subtree. */
export interface NodeStats {
  summary: SubtreeSummary;
  /** The same number the "by activity" sort reads. */
  activity: number;
}

/** {@link NodeStats} for every node, in one post-order walk. */
export function forestStats(forest: readonly TreeNode[]): Map<string, NodeStats> {
  const stats = new Map<string, NodeStats>();
  const visit = (node: TreeNode): NodeStats => {
    const summary: SubtreeSummary = {
      total: 0,
      done: 0,
      working: 0,
      needsInput: 0,
      failed: 0,
      worst: "none",
    };
    let activity = node.thread.updatedAt;
    for (const child of node.children) {
      const below = visit(child).summary;
      const status = child.thread.status;
      summary.total += 1 + below.total;
      summary.done += below.done;
      summary.working += below.working + Number(status === "working");
      summary.needsInput += below.needsInput + Number(status === "needs-input");
      summary.failed += below.failed + Number(status === "failed");
      if (status !== "working" && status !== "needs-input" && status !== "failed") {
        summary.done += 1;
      }
      summary.worst = worstStatus(worstStatus(summary.worst, status), below.worst);
      activity = Math.max(activity, stats.get(child.thread.id)!.activity);
    }
    const result = { summary, activity };
    stats.set(node.thread.id, result);
    return result;
  };
  for (const node of forest) visit(node);
  return stats;
}

/** The statuses the filter chips can narrow the list to. */
export type StatusFilter = "needs-input" | "failed" | "working";

export const STATUS_FILTERS: readonly StatusFilter[] = [
  "needs-input",
  "failed",
  "working",
];

/** How many threads currently sit in each filterable status. */
export function countStatuses(
  threads: Iterable<TreeThread>,
): Record<StatusFilter, number> {
  const counts: Record<StatusFilter, number> = {
    "needs-input": 0,
    failed: 0,
    working: 0,
  };
  for (const thread of threads) {
    if (thread.status in counts) counts[thread.status as StatusFilter] += 1;
  }
  return counts;
}

/**
 * A hidden worker with nothing left to say: not running, not waiting, not
 * failed, nothing unread. Orchestrations leave dozens of these behind.
 */
export function isFinishedWorker(thread: TreeThread): boolean {
  return thread.isHidden && thread.status === "none";
}

/** "now", "5m", "3h", "4d", "2w", "6mo", "1y": the age of a timestamp. */
export function formatAge(timestamp: number, now: number): string {
  const minutes = Math.floor(Math.max(0, now - timestamp) / 60_000);
  if (minutes < 1) return "now";
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d`;
  if (days < 30) return `${Math.floor(days / 7)}w`;
  if (days < 365) return `${Math.floor(days / 30)}mo`;
  return `${Math.floor(days / 365)}y`;
}

/**
 * Keep a node when it matches, or when anything beneath it does — a filter
 * that dropped a matching worker because its parent did not match would hide
 * the very thread the user was looking for. Ancestors of a match are reported
 * so the caller can unfold them.
 */
export function pruneForest(
  forest: readonly TreeNode[],
  matches: (thread: TreeThread) => boolean,
): { forest: TreeNode[]; matchedAncestors: Set<string> } {
  const matchedAncestors = new Set<string>();
  const keep = (node: TreeNode): TreeNode | null => {
    const children = node.children
      .map(keep)
      .filter((child): child is TreeNode => child !== null);
    if (children.length > 0) matchedAncestors.add(node.thread.id);
    if (children.length === 0 && !matches(node.thread)) return null;
    return { thread: node.thread, children };
  };
  return {
    forest: forest.map(keep).filter((node): node is TreeNode => node !== null),
    matchedAncestors,
  };
}

/** {@link pruneForest} by title. */
export function filterForest(
  forest: readonly TreeNode[],
  query: string,
): { forest: TreeNode[]; matchedAncestors: Set<string> } {
  const normalized = query.trim().toLowerCase();
  if (normalized.length === 0) {
    return { forest: [...forest], matchedAncestors: new Set() };
  }
  return pruneForest(forest, (thread) =>
    thread.title.toLowerCase().includes(normalized),
  );
}

/** The ancestors above a thread, so the row you are viewing is never folded. */
export function ancestorIds(
  threads: ReadonlyMap<string, TreeThread>,
  threadId: string | null,
): string[] {
  const chain: string[] = [];
  const seen = new Set<string>();
  let current = threadId === null ? null : threads.get(threadId)?.parentThreadId;
  while (current != null && !seen.has(current)) {
    chain.push(current);
    seen.add(current);
    current = threads.get(current)?.parentThreadId;
  }
  return chain;
}

export interface FlatRow {
  node: TreeNode;
  depth: number;
  isExpanded: boolean;
}

/** Depth-first walk of everything currently on screen. */
export function flattenForest(
  forest: readonly TreeNode[],
  expandedIds: ReadonlySet<string>,
): FlatRow[] {
  const rows: FlatRow[] = [];
  const walk = (node: TreeNode, depth: number): void => {
    const isExpanded =
      node.children.length > 0 && expandedIds.has(node.thread.id);
    rows.push({ node, depth, isExpanded });
    if (isExpanded) {
      for (const child of node.children) walk(child, depth + 1);
    }
  };
  for (const node of forest) walk(node, 0);
  return rows;
}
