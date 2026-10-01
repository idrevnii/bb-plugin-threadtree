import { useCallback, useEffect, useState } from "react";
import { useBbNavigate, useRpc, useSettings } from "@get-bb/plugin-sdk/app";
import type { ArchiveCandidate, rpcContract } from "../server";
import { AUTO_ARCHIVE_DELAYS, archivedBy } from "./autoArchive";
import { formatAge } from "./tree";

const DELAY_OPTIONS = Object.entries(AUTO_ARCHIVE_DELAYS).filter(
  ([, delay]) => delay > 0,
);
/** What the list shows while auto-archive is off. */
const DEFAULT_VIEWED = "1 week";

type Preview = { now: number; candidates: ArchiveCandidate[] };

/**
 * Under the auto-archive setting: how many threads each idle period would
 * take on its next sweep, and which ones. Picking a delay blind is how a
 * sidebar loses a month of threads in one hour.
 */
export function AutoArchivePreview() {
  const rpc = useRpc<typeof rpcContract>();
  const navigate = useBbNavigate();
  const { values } = useSettings();
  const selected =
    typeof values?.autoArchiveAfter === "string" ? values.autoArchiveAfter : "Off";
  const selectedDelay = AUTO_ARCHIVE_DELAYS[selected] ?? 0;
  const [preview, setPreview] = useState<Preview | null>(null);
  const [error, setError] = useState(false);
  const [viewed, setViewed] = useState<string | null>(null);
  // Follows the setting until the user picks a period to look at.
  const shown = viewed ?? (selectedDelay > 0 ? selected : DEFAULT_VIEWED);

  const load = useCallback(() => {
    setError(false);
    rpc
      .call("previewAutoArchive")
      .then(setPreview)
      .catch(() => setError(true));
  }, [rpc]);

  useEffect(load, [load]);

  if (error) {
    return (
      <p role="alert" className="text-sm text-destructive">
        Could not load the auto-archive preview.{" "}
        <button type="button" onClick={load} className="underline">
          Retry
        </button>
      </p>
    );
  }
  if (!preview) {
    return <p className="text-sm text-muted-foreground">Loading preview…</p>;
  }

  const shownThreads = archivedBy(
    preview.candidates,
    preview.now,
    AUTO_ARCHIVE_DELAYS[shown] ?? 0,
  );
  const workerCount = (threads: readonly ArchiveCandidate[]): number =>
    threads.reduce((total, thread) => total + thread.threadCount - 1, 0);

  return (
    <div className="flex flex-col gap-3 text-sm">
      <p className="text-muted-foreground">
        {selectedDelay > 0
          ? `Set to “${selected}”: the next hourly sweep archives the threads below.`
          : "Auto-archive is off. This is what each setting would archive on its first sweep."}
      </p>

      <div role="radiogroup" aria-label="Idle period to preview" className="flex flex-wrap gap-1.5">
        {DELAY_OPTIONS.map(([label, delay]) => {
          const count = archivedBy(preview.candidates, preview.now, delay).length;
          const isShown = label === shown;
          return (
            <button
              key={label}
              type="button"
              role="radio"
              aria-checked={isShown}
              onClick={() => setViewed(label)}
              className={`rounded-full border px-2.5 py-0.5 text-xs ${
                isShown
                  ? "border-primary bg-primary text-primary-foreground"
                  : "border-border text-muted-foreground hover:bg-accent hover:text-foreground"
              }`}
            >
              {label}
              {label === selected ? " (current)" : ""}
              <span className="ml-1 tabular-nums opacity-70">{count}</span>
            </button>
          );
        })}
      </div>

      <div className="flex items-center gap-2">
        <h3 className="font-medium">
          {shownThreads.length === 0
            ? `Nothing idle for ${shown}`
            : `${shownThreads.length} thread${shownThreads.length === 1 ? "" : "s"} idle for ${shown}`}
          {workerCount(shownThreads) > 0
            ? `, plus ${workerCount(shownThreads)} child thread${workerCount(shownThreads) === 1 ? "" : "s"}`
            : ""}
        </h3>
        <button
          type="button"
          onClick={load}
          className="ml-auto text-xs text-muted-foreground underline hover:text-foreground"
        >
          Refresh
        </button>
      </div>

      {shownThreads.length > 0 ? (
        <ul aria-label={`Archived after ${shown}`} className="flex max-h-80 flex-col overflow-y-auto rounded-md border border-border">
          {shownThreads.map((thread) => (
            <li key={thread.id} className="border-b border-border last:border-b-0">
              <a
                href={`/projects/${thread.projectId}/threads/${thread.id}`}
                onClick={(event) => {
                  event.preventDefault();
                  navigate.toThread(thread.id);
                }}
                className="flex items-center gap-2 px-3 py-1.5 no-underline hover:bg-accent"
              >
                <span className="min-w-0 flex-1 truncate">{thread.title}</span>
                {thread.threadCount > 1 ? (
                  <span className="shrink-0 text-xs text-muted-foreground">
                    +{thread.threadCount - 1}
                  </span>
                ) : null}
                {thread.projectName ? (
                  <span className="max-w-32 shrink-0 truncate text-xs text-muted-foreground">
                    {thread.projectName}
                  </span>
                ) : null}
                <span
                  title={new Date(thread.lastTouchedAt).toLocaleString()}
                  className="w-10 shrink-0 text-right text-xs tabular-nums text-muted-foreground"
                >
                  {formatAge(thread.lastTouchedAt, preview.now)}
                </span>
              </a>
            </li>
          ))}
        </ul>
      ) : null}

      <p className="text-xs text-muted-foreground">
        Pinned threads, running work, and threads waiting on input are never
        archived; a thread only goes when nothing beneath it is active either.
      </p>
    </div>
  );
}
