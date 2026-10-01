// Which parents are open, remembered across reloads.
//
// Per client and purely presentational, so it lives in localStorage rather
// than in the plugin's database: expanding a row on a laptop should not
// re-arrange the sidebar on a phone looking at the same bb.
import { DEFAULT_SORT_MODE, isSortMode, type SortMode } from "./tree";

const STORAGE_KEY = "bb-plugin-threadtree.expanded";
const COLLAPSED_PROJECTS_KEY = "bb-plugin-threadtree.collapsed-projects";
const SORT_MODE_KEY = "bb-plugin-threadtree.sort-mode";
const HIDE_FINISHED_KEY = "bb-plugin-threadtree.hide-finished-workers";

function loadIds(key: string): Set<string> {
  try {
    const raw = window.localStorage.getItem(key);
    if (raw === null) return new Set();
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return new Set();
    return new Set(parsed.filter((id): id is string => typeof id === "string"));
  } catch {
    return new Set();
  }
}

function saveIds(key: string, ids: ReadonlySet<string>): void {
  try {
    window.localStorage.setItem(key, JSON.stringify([...ids]));
  } catch {
    // Presentation state may safely stop persisting when storage is blocked.
  }
}

export function loadExpanded(): Set<string> {
  return loadIds(STORAGE_KEY);
}

export function saveExpanded(expanded: ReadonlySet<string>): void {
  saveIds(STORAGE_KEY, expanded);
}

export function loadCollapsedProjects(): Set<string> {
  return loadIds(COLLAPSED_PROJECTS_KEY);
}

export function saveCollapsedProjects(collapsed: ReadonlySet<string>): void {
  saveIds(COLLAPSED_PROJECTS_KEY, collapsed);
}

/** The chosen ordering, remembered per client like the folds above. */
export function loadSortMode(): SortMode {
  try {
    const raw = window.localStorage.getItem(SORT_MODE_KEY);
    return isSortMode(raw) ? raw : DEFAULT_SORT_MODE;
  } catch {
    return DEFAULT_SORT_MODE;
  }
}

export function saveSortMode(mode: SortMode): void {
  try {
    window.localStorage.setItem(SORT_MODE_KEY, mode);
  } catch {
    // Same as the folds: losing the preference is better than breaking.
  }
}

/** Whether finished hidden workers are left out, remembered per client. */
export function loadHideFinished(): boolean {
  try {
    return window.localStorage.getItem(HIDE_FINISHED_KEY) === "true";
  } catch {
    return false;
  }
}

export function saveHideFinished(hide: boolean): void {
  try {
    window.localStorage.setItem(HIDE_FINISHED_KEY, String(hide));
  } catch {
    // A view preference; losing it is better than breaking.
  }
}
