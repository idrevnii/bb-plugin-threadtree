import { describe, expect, it } from "vitest";
import {
  AUTO_ARCHIVE_DELAYS,
  archivedBy,
  shouldAutoArchive,
  staleRoots,
  sweepCandidates,
} from "./autoArchive";

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

describe("sweepCandidates", () => {
  const thread = (id: string, parentThreadId: string | null = null) => ({
    ...IDLE,
    id,
    parentThreadId,
  });

  it("dates a root by the latest touch anywhere beneath it", () => {
    const candidates = sweepCandidates([
      { ...thread("p"), updatedAt: 10 },
      { ...thread("c", "p"), lastReadAt: 50 },
      { ...thread("w", "c"), updatedAt: 30 },
    ]);
    expect(candidates.map(({ root, lastTouchedAt }) => [root.id, lastTouchedAt])).toEqual([
      ["p", 50],
    ]);
  });

  it("leaves out a root with anything pinned, busy or waiting below it", () => {
    const waiting = { ...thread("c", "p"), hasPendingInteraction: true };
    expect(sweepCandidates([thread("p"), waiting])).toEqual([]);
  });

  it("agrees with staleRoots at every cutoff", () => {
    const threads = [
      { ...thread("a"), updatedAt: 5 },
      { ...thread("b"), updatedAt: 20 },
      { ...thread("c", "b"), updatedAt: 40 },
    ];
    for (const cutoff of [0, 5, 19, 20, 39, 40, 100]) {
      const fromCandidates = sweepCandidates(threads)
        .filter((candidate) => candidate.lastTouchedAt <= cutoff)
        .map((candidate) => candidate.root.id);
      expect(staleRoots(threads, cutoff).map((t) => t.id)).toEqual(fromCandidates);
    }
  });
});

describe("archivedBy", () => {
  const day = AUTO_ARCHIVE_DELAYS["1 day"]!;
  const now = 10 * day;
  const candidates = [
    { id: "recent", lastTouchedAt: now - day / 2 },
    { id: "old", lastTouchedAt: now - 5 * day },
    { id: "older", lastTouchedAt: now - 9 * day },
  ];

  it("takes what is idle for at least the delay, oldest first", () => {
    expect(archivedBy(candidates, now, day).map((c) => c.id)).toEqual(["older", "old"]);
    expect(archivedBy(candidates, now, 7 * day).map((c) => c.id)).toEqual(["older"]);
  });

  it("takes nothing when off", () => {
    expect(archivedBy(candidates, now, 0)).toEqual([]);
  });
});
