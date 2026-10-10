// How the rest of bb steers the tree from the keyboard.
//
// Palette commands are registered once, without hooks, so they cannot reach
// the mounted tree's state; they post to it through this module-level
// channel instead, and hide while no tree is mounted (another sidebar list is
// picked). Other plugins use the window event below, which needs no import.

export type TreeCommand =
  | { kind: "collapse-all" }
  | { kind: "expand-all" }
  /** Fold every project except this one (or the one in view). */
  | { kind: "focus-project"; projectId: string | null }
  | { kind: "toggle-pin-project"; projectId: string | null }
  | { kind: "toggle-hide-finished" };

type Listener = (command: TreeCommand) => void;

const listeners = new Set<Listener>();

export function onTreeCommand(listener: Listener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function isTreeMounted(): boolean {
  return listeners.size > 0;
}

export function sendTreeCommand(command: TreeCommand): void {
  for (const listener of listeners) listener(command);
}

/**
 * `window.dispatchEvent(new CustomEvent("bb-threadtree:reveal", { detail:
 * { projectId } }))` unfolds that project and scrolls it into view. It is for
 * jumps the route cannot describe: bb's new-thread screen names no project,
 * so a plugin that opens it for a project says so here.
 */
export const REVEAL_EVENT = "bb-threadtree:reveal";

export function parseReveal(detail: unknown): { projectId: string } | null {
  if (typeof detail !== "object" || detail === null) return null;
  const { projectId } = detail as { projectId?: unknown };
  return typeof projectId === "string" && projectId !== "" ? { projectId } : null;
}
