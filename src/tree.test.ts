import { describe, expect, it } from "vitest";
import type { PluginSidebarThread } from "@bb/plugin-sdk/app";
import type { ChildThread } from "../server";
import {
  ancestorIds,
  buildForest,
  countDescendants,
  filterForest,
  flattenForest,
  latestActivity,
  mergeThreads,
} from "./tree";

function hostThread(
  overrides: Partial<PluginSidebarThread> & { id: string },
): PluginSidebarThread {
  return {
    projectId: "proj_1",
    title: overrides.id,
    titleFallback: null,
    parentThreadId: null,
    sectionId: null,
    originKind: null,
    originPluginId: null,
    providerId: "claude-code",
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
    isArchived: false,
    environment: null,
    host: null,
    createdAt: 1_000,
    updatedAt: overrides.createdAt ?? 1_000,
    lastReadAt: null,
    latestAttentionAt: 0,
    ...overrides,
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
