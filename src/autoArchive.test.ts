import { describe, expect, it } from "vitest";
import { AUTO_ARCHIVE_DELAYS, shouldAutoArchive, staleRoots } from "./autoArchive";

const IDLE = {
  parentThreadId: null,
  pinnedAt: null,
  updatedAt: 0,
  lastReadAt: null,
  hasPendingInteraction: false,
  runtime: { displayStatus: "idle" },
  activity: { activeWorkflowCount: 0, activeGoalCount: 0 },
};

describe("shouldAutoArchive", () => {
  it("archives a stale idle root thread", () => {
    expect(shouldAutoArchive(IDLE, 0)).toBe(true);
  });

  it("keeps anything touched after the cutoff", () => {
    expect(shouldAutoArchive({ ...IDLE, updatedAt: 1 }, 0)).toBe(false);
    expect(shouldAutoArchive({ ...IDLE, lastReadAt: 1 }, 0)).toBe(false);
  });

  it("keeps children, pins, busy work and pending input", () => {
    expect(shouldAutoArchive({ ...IDLE, parentThreadId: "p" }, 0)).toBe(false);
    expect(shouldAutoArchive({ ...IDLE, pinnedAt: 1 }, 0)).toBe(false);
    expect(shouldAutoArchive({ ...IDLE, hasPendingInteraction: true }, 0)).toBe(false);
    expect(
      shouldAutoArchive({ ...IDLE, runtime: { displayStatus: "active" } }, 0),
    ).toBe(false);
    expect(
      shouldAutoArchive(
        { ...IDLE, activity: { ...IDLE.activity, activeGoalCount: 1 } },
        0,
      ),
    ).toBe(false);
  });

  it("has a disabled default option", () => {
    expect(AUTO_ARCHIVE_DELAYS.Off).toBe(0);
    expect(Object.keys(AUTO_ARCHIVE_DELAYS)[0]).toBe("Off");
  });
});

describe("staleRoots", () => {
  const thread = (id: string, parentThreadId: string | null = null) => ({
    ...IDLE,
    id,
    parentThreadId,
  });
  const ids = (threads: { id: string }[]) => threads.map((t) => t.id);

  it("archives only roots, letting the cascade take their children", () => {
    expect(ids(staleRoots([thread("p"), thread("c", "p")], 0))).toEqual(["p"]);
  });

  it("keeps an idle parent whose descendant is busy or recently touched", () => {
    const busy = { ...thread("w", "c"), runtime: { displayStatus: "active" } };
    expect(staleRoots([thread("p"), thread("c", "p"), busy], 0)).toEqual([]);
    const fresh = { ...thread("c", "p"), updatedAt: 1 };
    expect(staleRoots([thread("p"), fresh], 0)).toEqual([]);
    const pinned = { ...thread("c", "p"), pinnedAt: 1 };
    expect(staleRoots([thread("p"), pinned], 0)).toEqual([]);
  });

  it("treats a child whose parent is gone as a root", () => {
    expect(ids(staleRoots([thread("c", "archived")], 0))).toEqual(["c"]);
  });

  it("survives a parent cycle", () => {
    expect(staleRoots([thread("a", "b"), thread("b", "a")], 0)).toEqual([]);
  });
});
