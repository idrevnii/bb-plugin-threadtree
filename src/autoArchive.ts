// Auto-archive rules, kept pure so they are testable without a live bb.

/** Setting label → idle time before a thread is archived. `0` disables it. */
export const AUTO_ARCHIVE_DELAYS: Record<string, number> = {
  Off: 0,
  "1 day": 86_400_000,
  "3 days": 3 * 86_400_000,
  "1 week": 7 * 86_400_000,
  "2 weeks": 14 * 86_400_000,
  "1 month": 30 * 86_400_000,
};

/** bb's own "the runtime is busy" rule, so glyphs agree across both lists. */
const RUNNING = new Set([
  "active",
  "starting",
  "stopping",
  "provisioning",
  "host-reconnecting",
]);

/** Runtime busy, or any background work running. */
export function isBusy(thread: {
  runtime: { displayStatus: string };
  activity: Record<string, number>;
}): boolean {
  return (
    RUNNING.has(thread.runtime.displayStatus) ||
    Object.values(thread.activity).some((count) => count > 0)
  );
}

interface SweepThread {
  id: string;
  parentThreadId: string | null;
  pinnedAt: number | null;
  updatedAt: number;
  lastReadAt: number | null;
  hasPendingInteraction: boolean;
  runtime: { displayStatus: string };
  activity: Record<string, number>;
}

/** The one thread on its own: unpinned, quiet, and untouched since `cutoff`. */
function isIdleSince(thread: Omit<SweepThread, "id">, cutoff: number): boolean {
  if (thread.pinnedAt !== null) return false;
  if (thread.hasPendingInteraction || isBusy(thread)) return false;
  // Reading a thread counts as touching it — bumping only `updatedAt` would
  // archive whatever the user has been sitting in without typing.
  return Math.max(thread.updatedAt, thread.lastReadAt ?? 0) <= cutoff;
}

export function shouldAutoArchive(
  thread: Omit<SweepThread, "id">,
  /** Threads untouched at or before this timestamp are stale. */
  cutoff: number,
): boolean {
  // Children ride along: archiving a parent cascades over its whole subtree,
  // so sweeping them separately would tear live orchestrations apart.
  if (thread.parentThreadId !== null) return false;
  return isIdleSince(thread, cutoff);
}

/**
 * The roots the sweep should archive. Because archiving cascades, a root only
 * qualifies when its whole subtree is idle: a parent nobody has typed in for a
 * week can still own a worker that is running right now. A thread whose
 * parent is already gone (archived, deleted) counts as a root, or it would
 * never be swept at all.
 */
export function staleRoots<T extends SweepThread>(
  threads: readonly T[],
  cutoff: number,
): T[] {
  const byId = new Map(threads.map((thread) => [thread.id, thread]));
  const children = new Map<string, T[]>();
  const roots: T[] = [];
  for (const thread of threads) {
    const parentId = thread.parentThreadId;
    if (parentId !== null && byId.has(parentId)) {
      const siblings = children.get(parentId);
      if (siblings) siblings.push(thread);
      else children.set(parentId, [thread]);
    } else {
      roots.push(thread);
    }
  }
  const subtreeIdle = (thread: T, seen: Set<string>): boolean => {
    if (seen.has(thread.id)) return true;
    seen.add(thread.id);
    return (
      isIdleSince(thread, cutoff) &&
      (children.get(thread.id) ?? []).every((child) => subtreeIdle(child, seen))
    );
  };
  return roots.filter((root) => subtreeIdle(root, new Set()));
}
