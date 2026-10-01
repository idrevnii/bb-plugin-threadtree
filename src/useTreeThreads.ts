import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  experimental_useSidebarThreads as useSidebarThreads,
  useRealtime,
  useRpc,
} from "@get-bb/plugin-sdk/app";
import type { ChildThread, rpcContract } from "../server";
import { mergeThreads } from "./tree";

/** A busy orchestration emits bursts of lifecycle events; coalesce them. */
const REFETCH_DEBOUNCE_MS = 250;

/**
 * bb's live sidebar list, merged with the hidden children only the backend can
 * see. The host hook stays the source of truth for everything it covers, so
 * pins, unread state, and indicators keep updating at bb's own cadence even
 * while the child listing is between refetches.
 */
export function useTreeThreads() {
  const { status, threads: hostThreads, projects } = useSidebarThreads();
  const rpc = useRpc<typeof rpcContract>();
  const [children, setChildren] = useState<ChildThread[]>([]);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const latestRequest = useRef(0);

  const refetch = useCallback(() => {
    if (timer.current !== null) clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      // A failed refetch keeps the last good tree: the sidebar must not blank
      // out because one call lost the network. The next signal retries.
      // A slow response must not overwrite a newer one that already landed.
      const request = ++latestRequest.current;
      void rpc
        .call("listChildren")
        .then((result) => {
          if (request === latestRequest.current) setChildren(result.children);
        })
        .catch(() => {});
    }, REFETCH_DEBOUNCE_MS);
  }, [rpc]);

  useEffect(() => () => {
    if (timer.current !== null) clearTimeout(timer.current);
  }, []);

  // The backend publishes on every lifecycle transition, which is what makes a
  // spawned worker appear without a reload.
  useRealtime("tree", refetch);

  // Covers the first load, and any change to bb's own list — a new thread
  // there may well be the visible half of a spawn whose hidden child is not
  // in `children` yet.
  const hostIds = hostThreads.map((thread) => thread.id).join(",");
  useEffect(() => {
    refetch();
  }, [hostIds, refetch]);

  const threads = useMemo(
    () => mergeThreads(hostThreads, children),
    [hostThreads, children],
  );

  return { status, threads, projects };
}
