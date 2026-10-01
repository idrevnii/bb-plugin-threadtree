import {
  experimental_useSidebarThreadActions as useSidebarThreadActions,
  experimental_useSidebarThreadSplit as useSidebarThreadSplit,
  useBbNavigate,
} from "@get-bb/plugin-sdk/app";
import { Icon } from "@/src/components/ui/icon";
import { cn } from "@/src/lib/utils";
import { RowMenu } from "./RowMenu";
import { countDescendants, type FlatRow, type RowStatus } from "./tree";

/** Indent per level. Deep trees stop indenting so titles keep their width. */
const INDENT_PX = 12;
const ROOT_INDENT_PX = 12;
const MAX_INDENT_DEPTH = 6;

export function TreeRow({
  row,
  isActive,
  nestedUnderProject,
  onNavigate,
  onToggle,
}: {
  row: FlatRow;
  isActive: boolean;
  nestedUnderProject: boolean;
  onNavigate: () => void;
  onToggle: (threadId: string) => void;
}) {
  const { node, depth, isExpanded } = row;
  const thread = node.thread;
  const actions = useSidebarThreadActions();
  const navigate = useBbNavigate();
  // Safe on every row: the hook returns empty props where splits are
  // unavailable, which is what a hidden thread gets.
  const { splitProps } = useSidebarThreadSplit(thread.id);
  const hasChildren = node.children.length > 0;
  const descendantCount = hasChildren ? countDescendants(node) : 0;

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

  const rowBody = (
    <div
      className={cn(
        "flex items-center rounded-md",
        isActive ? "bg-sidebar-accent" : "hover:bg-sidebar-accent/60",
      )}
      style={{
        paddingLeft:
          (nestedUnderProject ? ROOT_INDENT_PX : 0) +
          Math.min(depth, MAX_INDENT_DEPTH) * INDENT_PX,
      }}
    >
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
        onClick={(event) => {
          event.preventDefault();
          open();
        }}
        {...splitProps}
        className={cn(
          "flex min-w-0 flex-1 cursor-pointer items-center gap-1.5 rounded-md py-1 pl-1 pr-1.5 text-base no-underline",
          isActive ? "text-foreground" : "text-muted-foreground",
          "hover:text-foreground",
        )}
      >
        <span
          className={cn(
            "min-w-0 flex-1 truncate",
            thread.host?.isUnread && "font-medium text-foreground",
          )}
        >
          {thread.title}
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
        {hasChildren && !isExpanded ? (
          <span className="shrink-0 rounded-full bg-muted px-1.5 text-xs tabular-nums text-muted-foreground">
            {descendantCount}
          </span>
        ) : null}

        <StatusGlyph status={thread.status} />
      </a>
    </div>
  );

  return (
    <li role="none">
      {thread.host ? (
        <RowMenu thread={thread.host} onNavigate={onNavigate}>
          {rowBody}
        </RowMenu>
      ) : (
        rowBody
      )}
    </li>
  );
}

/** bb's own shapes, so both lists read the same in one window. */
function StatusGlyph({ status }: { status: RowStatus }) {
  const shared = "size-4 shrink-0";
  switch (status) {
    case "failed":
      return (
        <Icon
          name="CircleX"
          aria-label="Thread failed"
          className={cn(shared, "text-destructive")}
        />
      );
    case "needs-input":
      return (
        <Icon
          name="CircleQuestion"
          aria-label="Thread needs user input"
          className={cn(shared, "text-muted-foreground/75")}
        />
      );
    case "working":
      return (
        <Icon
          name="Loading"
          aria-label="Thread working"
          className={cn(shared, "animate-spin text-muted-foreground/50")}
        />
      );
    case "unread":
      // The notification dot, boxed to the size of every other glyph so it
      // lands on the same trailing column.
      return (
        <span
          aria-label="Unread thread"
          className={cn("flex items-center justify-center", shared)}
        >
          <span className="size-[5px] rounded-full bg-primary" />
        </span>
      );
    default:
      return null;
  }
}
