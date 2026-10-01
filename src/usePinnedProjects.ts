import { useCallback, useEffect, useState } from "react";
import { useRealtime, useRpc } from "@bb/plugin-sdk/app";
import type { rpcContract } from "../server";

/**
 * Which projects sit at the top, read from the plugin's own storage rather
 * than localStorage: pinning is an ordering decision, not a fold, so it should
 * follow the user from laptop to phone. The backend publishes on every change,
 * so other open sidebars reorder without a reload.
 */
export function usePinnedProjects() {
  const rpc = useRpc<typeof rpcContract>();
  const [pinned, setPinned] = useState<ReadonlySet<string>>(() => new Set());

  const load = useCallback(() => {
    // A failed read leaves the last known pins alone; the next signal retries.
    void rpc
      .call("getPinnedProjects")
      .then((result) => setPinned(new Set(result.projectIds)))
      .catch(() => {});
  }, [rpc]);

  useEffect(load, [load]);
  // The literal, not the backend's constant: importing a value from
  // server.ts would pull the whole backend into the frontend bundle.
  useRealtime("pins", load);

  const toggle = useCallback(
    (projectId: string) => {
      const next = new Set(pinned);
      const isPinned = !next.delete(projectId);
      if (isPinned) next.add(projectId);
      // Optimistic: the row moves on click, and a rejected write is repaired
      // by re-reading what the backend actually stored.
      setPinned(next);
      void rpc
        .call("setProjectPinned", { projectId, pinned: isPinned })
        .then((result) => setPinned(new Set(result.projectIds)))
        .catch(load);
    },
    [pinned, rpc, load],
  );

  return { pinned, toggle };
}
