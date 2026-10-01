import { useRef, type ReactNode } from "react";
import * as ContextMenu from "@radix-ui/react-context-menu";
import {
  experimental_useSidebarThreadActions as useSidebarThreadActions,
  type PluginSidebarThread,
} from "@get-bb/plugin-sdk/app";
import { cn } from "@/src/lib/utils";

/**
 * The right-click menu, for threads bb's own sidebar knows.
 *
 * Every item is one call on the host's actions, including `requestDelete`,
 * which opens bb's confirmation rather than deleting a subtree silently.
 * Hidden workers get no menu: those actions ignore or reject an id absent
 * from the host's list, so there is nothing honest to offer.
 */
export function RowMenu({
  thread,
  children,
  onNavigate,
  onRename,
  onMove,
}: {
  thread: PluginSidebarThread;
  children: ReactNode;
  onNavigate: () => void;
  /** Turns the row's title into an inline field. */
  onRename: () => void;
  /** Pin reordering for a pinned root; a null direction is at the edge. */
  onMove: { up: (() => void) | null; down: (() => void) | null } | null;
}) {
  const actions = useSidebarThreadActions();
  // Radix hands focus back to the row as the menu closes, which would blur
  // the rename field the moment it mounted; so it mounts after that instead.
  const renameRequested = useRef(false);

  return (
    <ContextMenu.Root>
      <ContextMenu.Trigger asChild>{children}</ContextMenu.Trigger>
      <ContextMenu.Portal>
        <ContextMenu.Content
          aria-label="Thread actions"
          onCloseAutoFocus={(event) => {
            if (!renameRequested.current) return;
            renameRequested.current = false;
            event.preventDefault();
            onRename();
          }}
          className="z-50 min-w-44 rounded-lg border border-border bg-popover p-1 text-popover-foreground shadow-md"
        >
          <Item
            onSelect={() => {
              actions.open(thread.id, { split: true });
              onNavigate();
            }}
          >
            Open in split
          </Item>
          <Item
            onSelect={() => {
              renameRequested.current = true;
            }}
          >
            Rename
          </Item>
          <Separator />
          <Item onSelect={() => void actions.setRead(thread.id, thread.isUnread)}>
            {thread.isUnread ? "Mark read" : "Mark unread"}
          </Item>
          <Item
            onSelect={() => void actions.setPinned(thread.id, !thread.isPinned)}
          >
            {thread.isPinned ? "Unpin" : "Pin"}
          </Item>
          {onMove?.up ? <Item onSelect={onMove.up}>Move up</Item> : null}
          {onMove?.down ? <Item onSelect={onMove.down}>Move down</Item> : null}
          <Separator />
          <Item onSelect={() => actions.archive(thread.id)}>Archive</Item>
          <Item destructive onSelect={() => actions.requestDelete(thread.id)}>
            Delete
          </Item>
        </ContextMenu.Content>
      </ContextMenu.Portal>
    </ContextMenu.Root>
  );
}

function Item({
  children,
  destructive = false,
  onSelect,
}: {
  children: ReactNode;
  destructive?: boolean;
  onSelect: () => void;
}) {
  return (
    <ContextMenu.Item
      onSelect={onSelect}
      className={cn(
        "cursor-pointer rounded-md px-2 py-1.5 text-sm outline-none",
        "data-[highlighted]:bg-accent data-[highlighted]:text-accent-foreground",
        destructive && "text-destructive",
      )}
    >
      {children}
    </ContextMenu.Item>
  );
}

function Separator() {
  return <ContextMenu.Separator className="my-1 h-px bg-border" />;
}
