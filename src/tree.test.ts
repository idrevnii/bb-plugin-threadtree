import { describe, expect, it } from "vitest";
import type { PluginSidebarThread } from "@get-bb/plugin-sdk/app";
import type { ChildThread } from "../server";
import {
  ancestorIds,
  buildForest,
  comparePins,
  countDescendants,
  countStatuses,
  filterForest,
  flattenForest,
  forestStats,
  formatAge,
  isFinishedWorker,
  latestActivity,
  mergeThreads,
  movePin,
  pruneForest,
} from "./tree";

function hostThread(
  overrides: Partial<PluginSidebarThread> & { id: string },
): PluginSidebarThread {
  return {
    projectId: "proj_1",
    title: overrides.id,
    titleFallback: null,
    parentThreadId: null,
    lifecycleOwnerThreadId: null,
    sourceThreadId: null,
    sectionId: null,
    originKind: null,
    originPluginId: null,
    providerId: "claude-code",
    status: "idle",
    runtimeStatus: "idle",
    queuedWork: "none",
    hasPendingInteraction: false,
    activity: {
      workflows: 0,
      backgroundAgents: 0,
      backgroundCommands: 0,
      planMode: 0,
      goals: 0,
    },
    indicator: "none",
    indicatorLabel: null,
    isUnread: false,
    isPinned: false,
    pinnedAt: null,
    pinSortKey: null,
    isArchived: false,
    archivedAt: null,
    environment: null,
    host: null,
    createdAt: 1_000,
    updatedAt: overrides.createdAt ?? 1_000,
    lastReadAt: null,
    latestAttentionAt: 0,
    href: `/projects/${overrides.projectId ?? "proj_1"}/threads/${overrides.id}`,
    isHidden: false,
    ...overrides,
    // Follows `title` the way bb derives it, unless a test sets it itself.
    displayTitle: overrides.displayTitle ?? overrides.title ?? overrides.id,
  };
}

function childThread(
  overrides: Partial<ChildThread> & { id: string; parentThreadId: string },
): ChildThread {
  return {
    projectId: "proj_1",
    title: overrides.id,
    titleFallback: null,
    isHidden: true,
    isWorking: false,
    isFailed: false,
    needsInput: false,
    createdAt: 2_000,
    // Untouched threads were last active when they were created.
    updatedAt: overrides.createdAt ?? 2_000,
    ...overrides,
  };
}

describe("mergeThreads", () => {
  it("adds the hidden children the host list cannot see", () => {
    const merged = mergeThreads(
      [hostThread({ id: "parent" })],
      [childThread({ id: "worker", parentThreadId: "parent" })],
    );
    expect([...merged.keys()]).toEqual(["parent", "worker"]);
    expect(merged.get("worker")?.isHidden).toBe(true);
    // No host row means the UI must navigate with toThread and skip the menu.
    expect(merged.get("worker")?.host).toBeNull();
  });

  it("keeps the host row when both sources carry a thread", () => {
    const merged = mergeThreads(
      [hostThread({ id: "fork", parentThreadId: "parent", indicator: "runtime" })],
      [
        childThread({
          id: "fork",
          parentThreadId: "parent",
          isHidden: false,
        }),
      ],
    );
    // The host row is the one with the resolved indicator; the SDK row is not.
    expect(merged.get("fork")?.status).toBe("working");
    expect(merged.get("fork")?.host).not.toBeNull();
  });

  it("takes the title and hidden flag from the host row", () => {
    const merged = mergeThreads(
      [
        hostThread({
          id: "worker",
          title: "Review @thread:thr_x",
          displayTitle: "Review Deploy fix",
          isHidden: true,
        }),
      ],
      [],
    );
    expect(merged.get("worker")?.title).toBe("Review Deploy fix");
    expect(merged.get("worker")?.isHidden).toBe(true);
  });

  it("maps queued-message indicators like bb's own list", () => {
    const status = (indicator: PluginSidebarThread["indicator"]) =>
      mergeThreads([hostThread({ id: "t", indicator })], []).get("t")?.status;
    expect(status("queued-failed")).toBe("failed");
    expect(status("queued-waiting")).toBe("working");
  });

  it("maps a child's state onto the row's four statuses", () => {
    const merged = mergeThreads(
      [],
      [
        childThread({ id: "a", parentThreadId: "p", needsInput: true }),
        childThread({ id: "b", parentThreadId: "p", isWorking: true }),
        childThread({ id: "c", parentThreadId: "p", isFailed: true }),
        childThread({ id: "d", parentThreadId: "p" }),
      ],
    );
    expect(merged.get("a")?.status).toBe("needs-input");
    expect(merged.get("b")?.status).toBe("working");
    expect(merged.get("c")?.status).toBe("failed");
    expect(merged.get("d")?.status).toBe("none");
  });
});

describe("buildForest", () => {
  it("nests a hidden worker, and a worker spawned by that worker", () => {
    const forest = buildForest(
      mergeThreads(
        [hostThread({ id: "parent" })],
        [
          childThread({ id: "worker", parentThreadId: "parent" }),
          childThread({ id: "grandchild", parentThreadId: "worker" }),
        ],
      ),
    );
    expect(forest).toHaveLength(1);
    expect(forest[0]?.children[0]?.thread.id).toBe("worker");
    expect(forest[0]?.children[0]?.children[0]?.thread.id).toBe("grandchild");
    expect(countDescendants(forest[0]!)).toBe(2);
  });

  it("promotes an orphan to a root instead of dropping it", () => {
    // The parent is archived or deleted, so neither source returned it.
    const forest = buildForest(
      mergeThreads([], [childThread({ id: "worker", parentThreadId: "gone" })]),
    );
    expect(forest.map((node) => node.thread.id)).toEqual(["worker"]);
  });

  it("sorts pinned roots first, then most recently active", () => {
    const forest = buildForest(
      mergeThreads(
        [
          hostThread({ id: "stale", createdAt: 1, updatedAt: 1 }),
          hostThread({ id: "recent", createdAt: 9, updatedAt: 50 }),
          hostThread({ id: "pinned", createdAt: 2, isPinned: true }),
        ],
        [
          childThread({ id: "second", parentThreadId: "recent", createdAt: 20 }),
          childThread({ id: "first", parentThreadId: "recent", createdAt: 10 }),
        ],
      ),
      "activity",
    );
    expect(forest.map((node) => node.thread.id)).toEqual([
      "pinned",
      "recent",
      "stale",
    ]);
    expect(forest[1]?.children.map((node) => node.thread.id)).toEqual([
      "second",
      "first",
    ]);
  });

  it("floats a parent whose only movement is a worker deep beneath it", () => {
    const forest = buildForest(
      mergeThreads(
        [
          hostThread({ id: "chatty", createdAt: 1, updatedAt: 100 }),
          hostThread({ id: "orchestrator", createdAt: 2, updatedAt: 3 }),
        ],
        [
          childThread({ id: "worker", parentThreadId: "orchestrator" }),
          childThread({
            id: "grandchild",
            parentThreadId: "worker",
            updatedAt: 900,
          }),
        ],
      ),
      "activity",
    );
    expect(forest.map((node) => node.thread.id)).toEqual([
      "orchestrator",
      "chatty",
    ]);
  });

  it("sorts roots and children A→Z by name, pins still first", () => {
    const forest = buildForest(
      mergeThreads(
        [
          hostThread({ id: "b", title: "Beta", updatedAt: 900 }),
          hostThread({ id: "a", title: "alpha", updatedAt: 1 }),
          hostThread({ id: "z", title: "Zeta", isPinned: true }),
        ],
        [
          childThread({ id: "c2", parentThreadId: "a", title: "Yak" }),
          childThread({ id: "c1", parentThreadId: "a", title: "Ant" }),
        ],
      ),
      "name",
    );
    expect(forest.map((node) => node.thread.id)).toEqual(["z", "a", "b"]);
    expect(forest[1]?.children.map((node) => node.thread.id)).toEqual([
      "c1",
      "c2",
    ]);
  });
});

describe("latestActivity", () => {
  it("reads the whole subtree, not just the roots", () => {
    const forest = buildForest(
      mergeThreads(
        [hostThread({ id: "root", updatedAt: 5 })],
        [childThread({ id: "worker", parentThreadId: "root", updatedAt: 77 })],
      ),
    );
    expect(latestActivity(forest)).toBe(77);
    expect(latestActivity([])).toBe(0);
  });
});

describe("filterForest", () => {
  it("keeps a parent whose child matches, and reports it for auto-expansion", () => {
    const forest = buildForest(
      mergeThreads(
        [hostThread({ id: "parent", title: "Orchestrator" })],
        [
          childThread({
            id: "worker",
            parentThreadId: "parent",
            title: "Set up the VPS",
          }),
        ],
      ),
    );
    const { forest: filtered, matchedAncestors } = filterForest(forest, "vps");
    expect(filtered[0]?.children.map((node) => node.thread.id)).toEqual([
      "worker",
    ]);
    // Without this the match would stay folded away behind a chevron.
    expect(matchedAncestors.has("parent")).toBe(true);
  });

  it("drops a subtree where nothing matches", () => {
    const forest = buildForest(
      mergeThreads([hostThread({ id: "parent", title: "Orchestrator" })], []),
    );
    expect(filterForest(forest, "nothing").forest).toHaveLength(0);
  });
});

describe("flattenForest", () => {
  it("hides descendants of a collapsed parent and shows them when expanded", () => {
    const forest = buildForest(
      mergeThreads(
        [hostThread({ id: "parent" })],
        [childThread({ id: "worker", parentThreadId: "parent" })],
      ),
    );
    expect(
      flattenForest(forest, new Set()).map((row) => row.node.thread.id),
    ).toEqual(["parent"]);

    const expanded = flattenForest(forest, new Set(["parent"]));
    expect(expanded.map((row) => row.node.thread.id)).toEqual([
      "parent",
      "worker",
    ]);
    expect(expanded[1]?.depth).toBe(1);
  });
});

describe("ancestorIds", () => {
  it("walks up from the active thread so its parents can be opened", () => {
    const threads = mergeThreads(
      [hostThread({ id: "parent" })],
      [
        childThread({ id: "worker", parentThreadId: "parent" }),
        childThread({ id: "grandchild", parentThreadId: "worker" }),
      ],
    );
    expect(ancestorIds(threads, "grandchild")).toEqual(["worker", "parent"]);
    expect(ancestorIds(threads, null)).toEqual([]);
  });
});

describe("forestStats", () => {
  const threads = mergeThreads(
    [hostThread({ id: "p", updatedAt: 100 })],
    [
      childThread({ id: "done", parentThreadId: "p", updatedAt: 300 }),
      childThread({ id: "busy", parentThreadId: "p", isWorking: true, updatedAt: 200 }),
      childThread({ id: "deep", parentThreadId: "busy", isFailed: true, updatedAt: 900 }),
      childThread({ id: "ask", parentThreadId: "p", needsInput: true, updatedAt: 200 }),
    ],
  );
  const stats = forestStats(buildForest(threads));

  it("counts every descendant by state", () => {
    expect(stats.get("p")?.summary).toEqual({
      total: 4,
      done: 1,
      working: 1,
      needsInput: 1,
      failed: 1,
      worst: "failed",
    });
    expect(stats.get("busy")?.summary).toMatchObject({ total: 1, failed: 1 });
    expect(stats.get("done")?.summary.total).toBe(0);
  });

  it("dates each node by the latest activity beneath it", () => {
    expect(stats.get("p")?.activity).toBe(900);
    expect(stats.get("done")?.activity).toBe(300);
  });

  it("ranks waiting on the user over running, and failure over both", () => {
    const waiting = forestStats(
      buildForest(
        mergeThreads(
          [hostThread({ id: "p" })],
          [
            childThread({ id: "a", parentThreadId: "p", isWorking: true }),
            childThread({ id: "b", parentThreadId: "p", needsInput: true }),
          ],
        ),
      ),
    );
    expect(waiting.get("p")?.summary.worst).toBe("needs-input");
  });
});

describe("pin order", () => {
  const pin = (id: string, pinSortKey: string | null, pinnedAt: number) =>
    hostThread({ id, isPinned: true, pinSortKey, pinnedAt });

  it("puts dragged pins first by key, then the rest newest pin first", () => {
    const pins = [pin("old", null, 1), pin("b", "b", 5), pin("new", null, 9), pin("a", "a", 2)];
    expect([...pins].sort(comparePins).map((p) => p.id)).toEqual(["a", "b", "new", "old"]);
  });

  it("orders pinned roots by pin order in both sort modes", () => {
    const threads = mergeThreads(
      [
        pin("first", "a", 1),
        pin("second", "b", 2),
        hostThread({ id: "loose", updatedAt: 99_999 }),
      ],
      [],
    );
    for (const mode of ["activity", "name"] as const) {
      expect(buildForest(threads, mode).map((n) => n.thread.id)).toEqual([
        "first",
        "second",
        "loose",
      ]);
    }
  });

  it("keeps an unconfirmed drop in place", () => {
    const threads = mergeThreads([pin("x", "a", 1), pin("y", "b", 2), pin("z", "c", 3)], []);
    expect(
      buildForest(threads, "activity", ["z", "x", "y"]).map((n) => n.thread.id),
    ).toEqual(["z", "x", "y"]);
  });
});

describe("movePin", () => {
  it("reports the new neighbours of the moved pin", () => {
    expect(movePin(["a", "b", "c"], "c", 0)).toEqual({
      order: ["c", "a", "b"],
      previousThreadId: null,
      nextThreadId: "a",
    });
    expect(movePin(["a", "b", "c"], "a", 1)).toEqual({
      order: ["b", "a", "c"],
      previousThreadId: "b",
      nextThreadId: "c",
    });
  });

  it("does nothing for a move that goes nowhere", () => {
    expect(movePin(["a", "b"], "a", 0)).toBeNull();
    expect(movePin(["a", "b"], "a", -1)).toBeNull();
    expect(movePin(["a", "b"], "missing", 0)).toBeNull();
  });
});

describe("view filters", () => {
  const threads = mergeThreads(
    [hostThread({ id: "p" }), hostThread({ id: "q" })],
    [
      childThread({ id: "finished", parentThreadId: "p" }),
      childThread({ id: "running", parentThreadId: "p", isWorking: true }),
      childThread({ id: "spent", parentThreadId: "q" }),
    ],
  );

  it("drops finished hidden workers but keeps everything else", () => {
    const { forest } = pruneForest(buildForest(threads), (t) => !isFinishedWorker(t));
    expect(forest.map((n) => [n.thread.id, n.children.map((c) => c.thread.id)])).toEqual([
      ["p", ["running"]],
      ["q", []],
    ]);
  });

  it("keeps the ancestors of a status match, and reports them to unfold", () => {
    const { forest, matchedAncestors } = pruneForest(
      buildForest(threads),
      (t) => t.status === "working",
    );
    expect(forest.map((n) => n.thread.id)).toEqual(["p"]);
    expect([...matchedAncestors]).toEqual(["p"]);
  });

  it("counts threads per filterable status", () => {
    expect(countStatuses(threads.values())).toEqual({
      "needs-input": 0,
      failed: 0,
      working: 1,
    });
  });
});

describe("formatAge", () => {
  const minute = 60_000;
  it.each([
    [0, "now"],
    [5 * minute, "5m"],
    [3 * 60 * minute, "3h"],
    [4 * 24 * 60 * minute, "4d"],
    [15 * 24 * 60 * minute, "2w"],
    [70 * 24 * 60 * minute, "2mo"],
    [400 * 24 * 60 * minute, "1y"],
  ])("%i ms ago reads %s", (age, label) => {
    expect(formatAge(1_000_000_000 - age, 1_000_000_000)).toBe(label);
  });

  it("never reads a clock skew as negative", () => {
    expect(formatAge(2_000, 1_000)).toBe("now");
  });
});
