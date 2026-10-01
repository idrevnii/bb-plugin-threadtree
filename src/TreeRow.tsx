import {
  useEffect,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type PointerEvent as ReactPointerEvent,
} from "react";
import {
  experimental_useSidebarThreadActions as useSidebarThreadActions,
  experimental_useSidebarThreadSplit as useSidebarThreadSplit,
  useBbNavigate,
  useSdk,
} from "@get-bb/plugin-sdk/app";
import { Icon } from "@/src/components/ui/icon";
import { cn } from "@/src/lib/utils";
import { RowMenu } from "./RowMenu";
import { useRowPreview } from "./RowPreview";
import {
  formatAge,
  worstStatus,
  type FlatRow,
  type RowStatus,
  type SubtreeSummary,
} from "./tree";

/** Indent per level. Deep trees stop indenting so titles keep their width. */
const INDENT_PX = 12;
const ROOT_INDENT_PX = 12;
const MAX_INDENT_DEPTH = 6;

/** What a pinned root needs to be reordered, by drag, keyboard, or menu. */
export interface PinControls {
  /** The pinned roots of this row's project, in their current order. */
  order: readonly string[];
  index: number;
  /** Where the drop line goes while another pin is dragged over this one. */
  dropEdge: "before" | "after" | null;
  isDragging: boolean;
  onPointerDown: (event: ReactPointerEvent<HTMLElement>) => void;
  /** True once right after a drag, so the click that ends it does not open. */
  consumeDragClick: () => boolean;
  onMove: (toIndex: number) => void;
}

export function TreeRow({
  row,
  isActive,
  nestedUnderProject,
  now,
  summary,
  activity,
  previewEnabled,
  pin,
  onNavigate,
  onToggle,
  onHiddenRenamed,
}: {
  row: FlatRow;
  isActive: boolean;
  nestedUnderProject: boolean;
  /** Clock for the age column; ticks in the parent so rows stay in step. */
  now: number;
  /**
   * Every descendant, filtered out or not: a parent's progress should not
   * jump because a view filter hid its finished workers.
   */
  summary: SubtreeSummary | null;
  /** Latest activity in the subtree — the same number the sort reads. */
  activity: number;
  previewEnabled: boolean;
  pin: PinControls | null;
  onNavigate: () => void;
  onToggle: (threadId: string) => void;
  /** The tree's own listing has to refetch to pick up a hidden rename. */
  onHiddenRenamed: () => void;
}) {
  const { node, depth, isExpanded } = row;
  const thread = node.thread;
  const actions = useSidebarThreadActions();
  const navigate = useBbNavigate();
  const sdk = useSdk();
  // Safe on every row: the hook returns empty props where splits are
  // unavailable, which is what a hidden thread gets.
  const { splitProps } = useSidebarThreadSplit(thread.id);
  const hasChildren = node.children.length > 0;
  const isCollapsedParent = hasChildren && !isExpanded;
  const descendantCount = summary?.total ?? 0;

  const [isRenaming, setIsRenaming] = useState(false);
  // Shown from the moment the rename is sent until the list catches up.
  const [pendingTitle, setPendingTitle] = useState<string | null>(null);
  useEffect(() => {
    setPendingTitle(null);
  }, [thread.title]);
  const title = pendingTitle ?? thread.title;

  const { anchorProps, preview } = useRowPreview({
    threadId: thread.id,
    title,
    updatedAt: thread.updatedAt,
    enabled: previewEnabled && !isRenaming && !pin?.isDragging,
  });

  const open = (): void => {
    if (thread.host) {
      actions.open(thread.id);
    } else {
      // The host's `open` silently ignores ids absent from its sidebar list,
      // and every hidden thread is absent from it. `toThread` resolves the
      // owning project through the SDK, so it works for any live thread.
      navigate.toThread(thread.id);
    }
    onNavigate();
  };

  const rename = (next: string): void => {
    setIsRenaming(false);
    const trimmed = next.trim();
    if (!trimmed || trimmed === thread.title) return;
    setPendingTitle(trimmed);
    // The host's silent rename where it knows the thread; hidden workers are
    // not in its list, so they go straight through the SDK.
    const request = thread.host
      ? actions.rename(thread.id, trimmed)
      : sdk.threads
          .update({ threadId: thread.id, title: trimmed })
          .then(onHiddenRenamed);
    request.catch(() => setPendingTitle(null));
  };

  const onKeyDown = (event: ReactKeyboardEvent<HTMLElement>): void => {
    if (event.key === "F2") {
      event.preventDefault();
      setIsRenaming(true);
    } else if (pin && event.altKey && event.key === "ArrowUp") {
      event.preventDefault();
      pin.onMove(pin.index - 1);
    } else if (pin && event.altKey && event.key === "ArrowDown") {
      event.preventDefault();
      pin.onMove(pin.index + 1);
    }
  };

  // A collapsed parent speaks for what it hides: a failed or waiting worker
  // three levels down must not need unfolding to be noticed.
  const childStatus = isCollapsedParent && summary ? summary.worst : "none";
  const glyphStatus = worstStatus(thread.status, childStatus);
  const glyphFromChildren = glyphStatus !== thread.status;

  const rowBody = (
    <div
      {...(pin ? { "data-pin-row": thread.id } : {})}
      onPointerDown={pin?.onPointerDown}
      className={cn(
        "relative flex items-center rounded-md",
        isActive ? "bg-sidebar-accent" : "hover:bg-sidebar-accent/60",
        pin?.isDragging && "opacity-50",
      )}
      style={{
        paddingLeft:
          (nestedUnderProject ? ROOT_INDENT_PX : 0) +
          Math.min(depth, MAX_INDENT_DEPTH) * INDENT_PX,
      }}
    >
      {pin?.dropEdge ? (
        <span
          aria-hidden
          className={cn(
            "pointer-events-none absolute inset-x-1 h-0.5 rounded-full bg-primary",
            pin.dropEdge === "before" ? "-top-px" : "-bottom-px",
          )}
        />
      ) : null}
      {hasChildren ? (
        <button
          type="button"
          // Toggling is not navigation: keep it off the row's click path so
          // expanding a parent never moves the user off their thread.
          onClick={(event) => {
            event.stopPropagation();
            onToggle(thread.id);
          }}
          aria-label={`${isExpanded ? "Collapse" : "Expand"} ${descendantCount} child threads`}
          aria-expanded={isExpanded}
          className="flex size-5 shrink-0 items-center justify-center rounded text-muted-foreground/70 hover:bg-sidebar-accent hover:text-foreground"
        >
          <Icon
            name="ChevronRight"
            className={cn(
              "size-3.5 transition-transform",
              isExpanded && "rotate-90",
            )}
          />
        </button>
      ) : (
        // Keeps every title on the same left edge, chevron or not.
        <span className="size-5 shrink-0" aria-hidden />
      )}

      {isRenaming ? (
        <RenameField
          initial={title}
          onCommit={rename}
          onCancel={() => setIsRenaming(false)}
        />
      ) : (
        <a
          role="treeitem"
          aria-level={depth + 1}
          aria-selected={isActive}
          {...(hasChildren ? { "aria-expanded": isExpanded } : {})}
          // bb's numbered jumps and thread.next/previous find rows by these
          // attributes and then click the element, so a hidden row carrying
          // them navigates through this row's own handler.
          data-sidebar-thread-shortcut-target=""
          data-sidebar-thread-id={thread.id}
          // The host's own URL where it knows the thread, so copy-link and
          // open-in-new-window land on the same route bb's list uses.
          href={
            thread.host?.href ??
            `/projects/${thread.projectId}/threads/${thread.id}`
          }
          // A native link drag would cancel the pointer drag that reorders pins.
          {...(pin ? { draggable: false } : {})}
          onClick={(event) => {
            event.preventDefault();
            if (pin?.consumeDragClick()) return;
            open();
          }}
          onDoubleClick={(event) => {
            event.preventDefault();
            setIsRenaming(true);
          }}
          onKeyDown={onKeyDown}
          {...splitProps}
          {...anchorProps}
          onPointerDown={(event) => {
            splitProps.onPointerDown?.(event);
            anchorProps.onPointerDown();
          }}
          className={cn(
            "flex min-w-0 flex-1 cursor-pointer items-center gap-1.5 rounded-md py-1 pl-1 pr-1.5 text-base no-underline",
            isActive ? "text-foreground" : "text-muted-foreground",
            "hover:text-foreground",
          )}
        >
          <span
            data-thread-title=""
            className={cn(
              "min-w-0 flex-1 truncate",
              thread.host?.isUnread && "font-medium text-foreground",
            )}
          >
            {title}
          </span>

          {thread.isHidden ? (
            <Icon
              name="EyeOff"
              aria-label="Hidden from bb's sidebar"
              className="size-3.5 shrink-0 text-muted-foreground/50"
            />
          ) : null}

          {/* A collapsed parent says how much it is hiding; expanded, the
              children speak for themselves and the count would be noise. */}
          {isCollapsedParent && summary ? <Progress summary={summary} /> : null}

          <time
            dateTime={new Date(activity).toISOString()}
            title={new Date(activity).toLocaleString()}
            className="shrink-0 text-xs tabular-nums text-muted-foreground/60"
          >
            {formatAge(activity, now)}
          </time>

          <StatusGlyph status={glyphStatus} fromChildren={glyphFromChildren} />
        </a>
      )}
    </div>
  );

  return (
    <li role="none">
      {thread.host ? (
        <RowMenu
          thread={thread.host}
          onNavigate={onNavigate}
          onRename={() => setIsRenaming(true)}
          onMove={
            pin
              ? {
                  up: pin.index > 0 ? () => pin.onMove(pin.index - 1) : null,
                  down:
                    pin.index < pin.order.length - 1
                      ? () => pin.onMove(pin.index + 1)
                      : null,
                }
              : null
          }
        >
          {rowBody}
        </RowMenu>
      ) : (
        rowBody
      )}
      {preview}
    </li>
  );
}

/**
 * "4/7" while an orchestration is still going, the plain count once it is
 * done — the full breakdown is in the tooltip.
 */
function Progress({ summary }: { summary: SubtreeSummary }) {
  const parts = [
    `${summary.done} done`,
    summary.working > 0 ? `${summary.working} working` : null,
    summary.needsInput > 0 ? `${summary.needsInput} need input` : null,
    summary.failed > 0 ? `${summary.failed} failed` : null,
  ].filter((part): part is string => part !== null);
  const isDone = summary.done === summary.total;
  return (
    <span
      title={parts.join(" · ")}
      aria-label={`${summary.total} child threads: ${parts.join(", ")}`}
      className={cn(
        "shrink-0 rounded-full bg-muted px-1.5 text-xs tabular-nums",
        summary.failed > 0 ? "text-destructive" : "text-muted-foreground",
      )}
    >
      {isDone ? summary.total : `${summary.done}/${summary.total}`}
    </span>
  );
}

/** Enter or blur saves, Escape gives up; an empty title is no rename. */
function RenameField({
  initial,
  onCommit,
  onCancel,
}: {
  initial: string;
  onCommit: (title: string) => void;
  onCancel: () => void;
}) {
  const [value, setValue] = useState(initial);
  // Enter saves and then unmounts the field, which blurs it: save once.
  const finished = useRef(false);
  const finish = (commit: boolean): void => {
    if (finished.current) return;
    finished.current = true;
    if (commit) onCommit(value);
    else onCancel();
  };
  return (
    <input
      autoFocus
      aria-label="Thread title"
      value={value}
      onChange={(event) => setValue(event.target.value)}
      onFocus={(event) => event.currentTarget.select()}
      onKeyDown={(event) => {
        if (event.key === "Enter") {
          event.preventDefault();
          finish(true);
        } else if (event.key === "Escape") {
          event.preventDefault();
          finish(false);
        }
      }}
      onBlur={() => finish(true)}
      className="mr-1.5 min-w-0 flex-1 rounded-md border border-sidebar-ring bg-background px-1 py-0.5 text-base text-foreground outline-none"
    />
  );
}

const CHILD_STATUS_LABELS: Partial<Record<RowStatus, string>> = {
  failed: "A child thread failed",
  "needs-input": "A child thread needs user input",
  working: "Child threads working",
  unread: "A child thread is unread",
};

/** bb's own shapes, so both lists read the same in one window. */
function StatusGlyph({
  status,
  fromChildren,
}: {
  status: RowStatus;
  /** Rolled up from a collapsed subtree rather than the row's own state. */
  fromChildren: boolean;
}) {
  const shared = "size-4 shrink-0";
  const label = (own: string): string =>
    (fromChildren ? CHILD_STATUS_LABELS[status] : undefined) ?? own;
  switch (status) {
    case "failed":
      return (
        <Icon
          name="CircleX"
          aria-label={label("Thread failed")}
          className={cn(shared, "text-destructive")}
        />
      );
    case "needs-input":
      return (
        <Icon
          name="CircleQuestion"
          aria-label={label("Thread needs user input")}
          className={cn(shared, "text-muted-foreground/75")}
        />
      );
    case "working":
      return (
        <Icon
          name="Loading"
          aria-label={label("Thread working")}
          className={cn(shared, "animate-spin text-muted-foreground/50")}
        />
      );
    case "unread":
      // The notification dot, boxed to the size of every other glyph so it
      // lands on the same trailing column.
      return (
        <span
          aria-label={label("Unread thread")}
          className={cn("flex items-center justify-center", shared)}
        >
          <span className="size-[5px] rounded-full bg-primary" />
        </span>
      );
    default:
      return null;
  }
}
