import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
} from "react";

/** Below this, a press is a click — the row opens instead of moving. */
const DRAG_THRESHOLD_PX = 4;

export interface PinDragState {
  threadId: string;
  /** Where the row would land: 0 is above the first pin, `n` below the last. */
  insertion: number;
}

/**
 * Drag-to-reorder for pinned rows, on pointer events rather than HTML drag:
 * bb's own drag-to-split listens on the same rows and only engages once the
 * pointer leaves the sidebar, so a vertical drag inside the list stays ours
 * and a sideways one is handed back to the host untouched.
 *
 * Rows mark themselves with `data-pin-row={threadId}` inside one `<ul>`; the
 * drop position is read from their live boxes, so nothing has to be measured
 * up front.
 */
export function usePinDrag(
  onDrop: (order: readonly string[], threadId: string, toIndex: number) => void,
) {
  const [drag, setDrag] = useState<PinDragState | null>(null);
  /** Set when a drag ends, so the click the browser sends after it is eaten. */
  const suppressClick = useRef(false);
  const cleanup = useRef<(() => void) | null>(null);

  useEffect(() => () => cleanup.current?.(), []);

  const begin = useCallback(
    (
      event: ReactPointerEvent<HTMLElement>,
      threadId: string,
      order: readonly string[],
    ) => {
      if (event.button !== 0 || event.pointerType === "touch") return;
      // The rename field and the fold chevron keep their own presses.
      if ((event.target as HTMLElement).closest("input, button")) return;
      const list = event.currentTarget.closest("ul");
      if (!list) return;
      cleanup.current?.();
      const startY = event.clientY;
      let active = false;
      let insertion: number | null = null;
      let previousUserSelect: string | null = null;

      const onMove = (move: PointerEvent): void => {
        if (!active) {
          if (Math.abs(move.clientY - startY) < DRAG_THRESHOLD_PX) return;
          active = true;
          // Otherwise the drag also paints a text selection down the list.
          window.getSelection()?.removeAllRanges();
          previousUserSelect = document.body.style.userSelect;
          document.body.style.userSelect = "none";
        }
        const box = list.getBoundingClientRect();
        if (move.clientX < box.left || move.clientX > box.right) {
          // Heading for the main area: that is a split, the host's gesture.
          insertion = null;
          setDrag(null);
          return;
        }
        const rows = new Map<string, DOMRect>();
        for (const row of Array.from(
          list.querySelectorAll<HTMLElement>("[data-pin-row]"),
        )) {
          rows.set(row.dataset.pinRow ?? "", row.getBoundingClientRect());
        }
        const index = order.findIndex((id) => {
          const rect = rows.get(id);
          return rect !== undefined && move.clientY < rect.top + rect.height / 2;
        });
        insertion = index === -1 ? order.length : index;
        setDrag({ threadId, insertion });
      };

      const stop = (): void => {
        window.removeEventListener("pointermove", onMove);
        window.removeEventListener("pointerup", onUp);
        window.removeEventListener("pointercancel", onCancel);
        if (previousUserSelect !== null) {
          document.body.style.userSelect = previousUserSelect;
        }
        cleanup.current = null;
        setDrag(null);
      };

      const onUp = (): void => {
        stop();
        if (!active) return;
        suppressClick.current = true;
        // The click, if any, is dispatched before timers run.
        setTimeout(() => {
          suppressClick.current = false;
        }, 0);
        if (insertion === null) return;
        const from = order.indexOf(threadId);
        onDrop(order, threadId, insertion > from ? insertion - 1 : insertion);
      };

      const onCancel = (): void => stop();

      window.addEventListener("pointermove", onMove);
      window.addEventListener("pointerup", onUp);
      window.addEventListener("pointercancel", onCancel);
      cleanup.current = stop;
    },
    [onDrop],
  );

  /** For the row's click handler: true once, right after a drag. */
  const consumeDragClick = useCallback((): boolean => {
    if (!suppressClick.current) return false;
    suppressClick.current = false;
    return true;
  }, []);

  return { drag, begin, consumeDragClick };
}
