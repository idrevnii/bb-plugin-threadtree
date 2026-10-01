// bb-plugin-threadtree — backend.
//
// Why this exists at all: bb's sidebar bootstrap filters threads with
// `visibility = "visible"`, so `experimental_useSidebarThreads()` never sees a
// hidden thread. Orchestration workers are exactly those threads, so the tree
// has to source them here, through the one API where `includeHidden` exists.
//
// Thread actions stay host-owned. Project creation/removal live here because
// choosing a replacement list also replaces bb's project controls.
import { defineRpcContract, type BbPluginApi } from "@get-bb/plugin-sdk";
import { z } from "zod";
import { AUTO_ARCHIVE_DELAYS, isBusy, staleRoots } from "./src/autoArchive";

/** Frontend refetch signal; the payload carries nothing. */
export const TREE_CHANNEL = "tree";

/**
 * Pin changes, on their own channel: thread lifecycle noise would otherwise
 * make every view refetch a list that changes only when someone clicks Pin.
 */
export const PINS_CHANNEL = "pins";

/** Pinned project ids, in the plugin's KV so every device sees the same order. */
const PINNED_PROJECTS_KEY = "pinned-projects";

/**
 * Page size for walking the thread list. A single capped call would silently
 * drop whatever sorts past the cap — for the sweep, exactly the oldest threads
 * it exists to archive.
 */
const PAGE_SIZE = 500;

const projectHostSchema = z.object({
  id: z.string(),
  name: z.string(),
  status: z.enum(["connected", "disconnected"]),
});
export type ProjectHost = z.infer<typeof projectHostSchema>;

const projectDirectorySchema = z.object({
  directory: z.string(),
  parent: z.string().nullable(),
  entries: z.array(
    z.object({
      kind: z.enum(["file", "directory"]),
      name: z.string(),
      path: z.string(),
    }),
  ),
});
export type ProjectDirectory = z.infer<typeof projectDirectorySchema>;

/** A child thread reduced to what a sidebar row draws. */
const childThreadSchema = z.object({
  id: z.string(),
  projectId: z.string(),
  parentThreadId: z.string().nullable(),
  title: z.string().nullable(),
  titleFallback: z.string().nullable(),
  isHidden: z.boolean(),
  /** Runtime busy, or any background work running. */
  isWorking: z.boolean(),
  isFailed: z.boolean(),
  needsInput: z.boolean(),
  createdAt: z.number(),
  /** Last touched — the sort key behind "by activity". */
  updatedAt: z.number(),
});

export type ChildThread = z.infer<typeof childThreadSchema>;

export const rpcContract = defineRpcContract({
  /** Every non-archived child thread, at any depth, hidden ones included. */
  listChildren: {
    input: z.null(),
    output: z.object({ children: z.array(childThreadSchema) }),
  },
  listProjectHosts: {
    input: z.null(),
    output: z.object({ hosts: z.array(projectHostSchema) }),
  },
  listProjectDirectories: {
    input: z.object({ hostId: z.string(), path: z.string().nullable() }),
    output: projectDirectorySchema,
  },
  createProjectDirectory: {
    input: z.object({ hostId: z.string(), path: z.string() }),
    output: z.object({ ok: z.literal(true) }),
  },
  createProject: {
    input: z.object({ hostId: z.string(), path: z.string().min(1) }),
    output: z.object({ projectId: z.string() }),
  },
  removeProject: {
    input: z.object({ projectId: z.string() }),
    output: z.object({ ok: z.literal(true) }),
  },
  getPinnedProjects: {
    input: z.null(),
    output: z.object({ projectIds: z.array(z.string()) }),
  },
  setProjectPinned: {
    input: z.object({ projectId: z.string(), pinned: z.boolean() }),
    output: z.object({ projectIds: z.array(z.string()) }),
  },
});

function projectName(path: string): string {
  return path.replace(/[/\\]+$/, "").split(/[/\\]/).at(-1)?.trim() ?? "";
}

export default function plugin(bb: BbPluginApi) {
  /** Every non-archived thread, hidden ones included, across all pages. */
  const listAllThreads = async () => {
    const seen = new Map<string, Awaited<ReturnType<typeof bb.sdk.threads.list>>[number]>();
    for (let offset = 0; ; offset += PAGE_SIZE) {
      const page = await bb.sdk.threads.list({
        archived: false,
        includeHidden: true,
        limit: PAGE_SIZE,
        offset,
      });
      // Offset paging over a live list can repeat a row that shifted pages.
      for (const thread of page) seen.set(thread.id, thread);
      if (page.length < PAGE_SIZE) break;
    }
    return [...seen.values()];
  };

  const readPinnedProjects = async (): Promise<string[]> => {
    const stored = await bb.storage.kv.get<unknown>(PINNED_PROJECTS_KEY);
    return Array.isArray(stored)
      ? stored.filter((id): id is string => typeof id === "string")
      : [];
  };

  const settings = bb.settings.define({
    autoArchiveAfter: {
      type: "select",
      label: "Auto-archive idle threads",
      description:
        "Archive threads with no activity for this long. Pinned threads, " +
        "running work, and threads waiting on input are left alone.",
      options: Object.keys(AUTO_ARCHIVE_DELAYS),
      default: "Off",
    },
  });

  bb.rpc.register(rpcContract, {
    async listChildren() {
      // Not filtered by `hasParent`: a hidden thread spawned without a parent
      // link would otherwise be invisible everywhere — the host list drops it
      // for being hidden, and this call for being parentless. Anything else
      // visible is already in the host list and gets dropped on merge.
      const threads = await listAllThreads();
      return {
        children: threads
          .filter(
            (thread) =>
              thread.parentThreadId !== null || thread.visibility === "hidden",
          )
          .map((thread) => ({
            id: thread.id,
            projectId: thread.projectId,
            parentThreadId: thread.parentThreadId,
            title: thread.title,
            titleFallback: thread.titleFallback,
            isHidden: thread.visibility === "hidden",
            isWorking: isBusy(thread),
            isFailed: thread.status === "error",
            needsInput: thread.hasPendingInteraction,
            createdAt: thread.createdAt,
            updatedAt: thread.updatedAt,
          })),
      };
    },
    async listProjectHosts() {
      const hosts = await bb.sdk.hosts.list();
      return {
        hosts: hosts.map(({ id, name, status }) => ({ id, name, status })),
      };
    },
    async listProjectDirectories({ hostId, path }) {
      const listing = await bb.sdk.hosts.directory({
        hostId,
        ...(path ? { path } : {}),
      });
      return {
        directory: listing.directory,
        parent: listing.parent,
        entries: listing.entries.map(({ kind, name, path: entryPath }) => ({
          kind,
          name,
          path: entryPath,
        })),
      };
    },
    async createProjectDirectory({ hostId, path }) {
      await bb.sdk.files.mkdir({ hostId, path });
      return { ok: true as const };
    },
    async createProject({ hostId, path }) {
      const name = projectName(path);
      if (!name) throw new Error("Choose a project folder.");
      const project = await bb.sdk.projects.create({
        name,
        source: { type: "local_path", hostId, path },
      });
      return { projectId: project.id };
    },
    async removeProject({ projectId }) {
      await bb.sdk.projects.delete({ projectId });
      // Hidden threads of the project leave no trace in the host list, so the
      // tree would keep drawing them until some unrelated event refetched.
      bb.realtime.publish(TREE_CHANNEL, {});
      // A removed project cannot stay pinned, or its id lingers in KV forever.
      const projectIds = await readPinnedProjects();
      if (projectIds.includes(projectId)) {
        await bb.storage.kv.set(
          PINNED_PROJECTS_KEY,
          projectIds.filter((id) => id !== projectId),
        );
        bb.realtime.publish(PINS_CHANNEL, {});
      }
      return { ok: true as const };
    },
    async getPinnedProjects() {
      return { projectIds: await readPinnedProjects() };
    },
    async setProjectPinned({ projectId, pinned }) {
      const current = await readPinnedProjects();
      const projectIds = pinned
        ? [...current.filter((id) => id !== projectId), projectId]
        : current.filter((id) => id !== projectId);
      await bb.storage.kv.set(PINNED_PROJECTS_KEY, projectIds);
      // What makes the other open sidebars follow along.
      bb.realtime.publish(PINS_CHANNEL, {});
      return { projectIds };
    },
  });

  // Hourly is granular enough when the shortest delay is a day, and the sweep
  // only runs while the plugin is loaded — a disabled plugin archives nothing.
  bb.background.schedule("auto-archive", "7 * * * *", async () => {
    const delay = AUTO_ARCHIVE_DELAYS[(await settings.get()).autoArchiveAfter];
    if (!delay) return;
    const cutoff = Date.now() - delay;
    const stale = staleRoots(await listAllThreads(), cutoff);
    for (const thread of stale) {
      // One failure (deleted mid-sweep, say) must not strand the rest.
      try {
        await bb.sdk.threads.archive({ threadId: thread.id });
      } catch (error) {
        bb.log.warn(`auto-archive ${thread.id} failed: ${String(error)}`);
      }
    }
    if (stale.length) bb.log.info(`auto-archived ${stale.length} thread(s)`);
  });

  // Hidden threads emit ordinary lifecycle events even though they never reach
  // the sidebar's own realtime list, so this is how the tree learns a worker
  // started, finished, or failed. The frontend debounces, so publishing on
  // every transition is cheap.
  for (const event of [
    "thread.created",
    "thread.active",
    "thread.idle",
    "thread.failed",
    "thread.archived",
    "thread.deleted",
  ] as const) {
    bb.events.on(event, () => bb.realtime.publish(TREE_CHANNEL, {}));
  }
}
