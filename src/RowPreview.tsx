import {
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";
import { useSdk } from "@get-bb/plugin-sdk/app";
import { usePortalScopeProps } from "@/src/lib/portal-scope";

/** Long enough that sweeping the pointer down the list opens nothing. */
export const PREVIEW_DELAY_MS = 500;
/** The card shows a glance, not the transcript. */
const PREVIEW_CHARS = 600;
const CARD_WIDTH_PX = 320;
const VIEWPORT_MARGIN_PX = 8;

/**
 * Last outputs by thread. Keyed on `updatedAt` as well, so hovering again
 * after a new turn fetches the new reply rather than the cached old one.
 */
const outputCache = new Map<string, { updatedAt: number; output: string | null }>();

type PreviewState =
  | { kind: "loading" }
  | { kind: "ready"; output: string | null }
  | { kind: "error" };

/**
 * A hover card with the thread's last reply, so checking what a worker said
 * does not cost opening it. Mouse only: a touch has no hover, and the long
 * press it would take is already the context menu.
 */
export function useRowPreview({
  threadId,
  title,
  updatedAt,
  enabled,
}: {
  threadId: string;
  title: string;
  updatedAt: number;
  enabled: boolean;
}): {
  anchorProps: {
    onPointerEnter: (event: ReactPointerEvent<HTMLElement>) => void;
    onPointerLeave: () => void;
    onPointerDown: () => void;
    "aria-describedby"?: string;
  };
  preview: ReactNode;
} {
  const sdk = useSdk();
  const id = useId();
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [anchor, setAnchor] = useState<DOMRect | null>(null);
  const [state, setState] = useState<PreviewState>({ kind: "loading" });

  const close = useCallback(() => {
    if (timer.current !== null) clearTimeout(timer.current);
    timer.current = null;
    setAnchor(null);
  }, []);

  useEffect(() => close, [close]);
  useEffect(() => {
    if (!enabled) close();
  }, [enabled, close]);

  const onPointerEnter = (event: ReactPointerEvent<HTMLElement>): void => {
    if (!enabled || event.pointerType === "touch") return;
    const element = event.currentTarget;
    if (timer.current !== null) clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      timer.current = null;
      setAnchor(element.getBoundingClientRect());
      const cached = outputCache.get(threadId);
      if (cached && cached.updatedAt === updatedAt) {
        setState({ kind: "ready", output: cached.output });
        return;
      }
      setState({ kind: "loading" });
      sdk.threads
        .output({ threadId })
        .then(({ output }) => {
          outputCache.set(threadId, { updatedAt, output });
          setState({ kind: "ready", output });
        })
        .catch(() => setState({ kind: "error" }));
    }, PREVIEW_DELAY_MS);
  };

  return {
    anchorProps: {
      onPointerEnter,
      onPointerLeave: close,
      // Clicking opens the thread itself; the card would only cover it.
      onPointerDown: close,
      ...(anchor ? { "aria-describedby": id } : {}),
    },
    preview: anchor ? (
      <PreviewCard id={id} title={title} anchor={anchor} state={state} />
    ) : null,
  };
}

function PreviewCard({
  id,
  title,
  anchor,
  state,
}: {
  id: string;
  title: string;
  anchor: DOMRect;
  state: PreviewState;
}) {
  const portalScope = usePortalScopeProps();
  const fitsRight =
    anchor.right + VIEWPORT_MARGIN_PX + CARD_WIDTH_PX <= window.innerWidth;
  const left = fitsRight
    ? anchor.right + VIEWPORT_MARGIN_PX
    : Math.max(VIEWPORT_MARGIN_PX, anchor.left);
  const top = fitsRight
    ? Math.max(VIEWPORT_MARGIN_PX, anchor.top)
    : anchor.bottom + VIEWPORT_MARGIN_PX;

  return createPortal(
    <div
      {...portalScope}
      id={id}
      role="tooltip"
      style={{ left, top, width: CARD_WIDTH_PX }}
      className="pointer-events-none fixed z-50 rounded-lg border border-border bg-popover p-3 text-popover-foreground shadow-md"
    >
      <p className="truncate text-sm font-medium">{title}</p>
      <p className="mt-1.5 line-clamp-6 whitespace-pre-line break-words text-xs text-muted-foreground">
        {previewText(state)}
      </p>
    </div>,
    document.body,
  );
}

function previewText(state: PreviewState): string {
  switch (state.kind) {
    case "loading":
      return "Loading…";
    case "error":
      return "Could not load the last reply.";
    case "ready": {
      const output = state.output?.trim();
      if (!output) return "No reply yet.";
      return output.length > PREVIEW_CHARS
        ? `${output.slice(0, PREVIEW_CHARS).trimEnd()}…`
        : output;
    }
  }
}
