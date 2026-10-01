// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { loadPluginApp, renderSlot } from "@get-bb/plugin-sdk/testing/app";
// The installed package's type, not the tsconfig-mapped one: renderSlot is
// typed against it, and the two can differ by a patch release.
import type { PluginSidebarThread } from "@get-bb/plugin-sdk";
import type { ChildThread } from "../server";

Object.defineProperty(window, "matchMedia", {
  writable: true,
  value: (query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: () => {},
    removeListener: () => {},
    addEventListener: () => {},
    removeEventListener: () => {},
    dispatchEvent: () => false,
  }),
});

Object.defineProperty(window, "PointerEvent", {
  writable: true,
  value: MouseEvent,
});

// The thunk matters: app.tsx binds the plugin runtime at module load, so the
// test runtime has to be installed before the import runs.
const app = await loadPluginApp(() => import("../app"));

afterEach(() => {
  cleanup();
  // Expansion persists per client, so without this each test would inherit
  // whatever the previous one unfolded.
  window.localStorage.clear();
});

function hostThread(
  overrides: Partial<PluginSidebarThread> & { id: string },
): PluginSidebarThread {
  return {
    projectId: "proj_1",
    title: overrides.id,
    titleFallback: null,
    parentThreadId: null,
    lifecycleOwnerThreadId: null,
    sourceThreadId: null,
    sectionId: null,
    originKind: null,
    originPluginId: null,
    providerId: "claude-code",
    status: "idle",
    runtimeStatus: "idle",
    queuedWork: "none",
    hasPendingInteraction: false,
    activity: {
      workflows: 0,
      backgroundAgents: 0,
      backgroundCommands: 0,
      planMode: 0,
      goals: 0,
    },
    indicator: "none",
    indicatorLabel: null,
    isUnread: false,
    isPinned: false,
    pinnedAt: null,
    pinSortKey: null,
    isArchived: false,
    archivedAt: null,
    environment: null,
    host: null,
    createdAt: 1_000,
    updatedAt: 1_000,
    lastReadAt: null,
    latestAttentionAt: 0,
    href: `/projects/${overrides.projectId ?? "proj_1"}/threads/${overrides.id}`,
    isHidden: false,
    ...overrides,
    // Follows `title` the way bb derives it, unless a test sets it itself.
    displayTitle: overrides.displayTitle ?? overrides.title ?? overrides.id,
  };
}

const HIDDEN_WORKER: ChildThread = {
  id: "thr_worker",
  projectId: "proj_1",
  parentThreadId: "thr_parent",
  title: "Set up the VPS",
  titleFallback: null,
  isHidden: true,
  isWorking: true,
  isFailed: false,
  needsInput: false,
  createdAt: 2_000,
  updatedAt: 2_000,
};

function render(
  options: {
    children?: ChildThread[];
    activeThreadId?: string | null;
    searchQuery?: string;
    personalProject?: boolean;
    threads?: PluginSidebarThread[];
    projects?: { id: string; name: string; isPersonal: boolean }[];
    pinnedProjects?: string[];
  } = {},
) {
  let pinnedProjects = options.pinnedProjects ?? [];
  const registration = app.threadLists[0]!;
  return renderSlot(
    registration,
    {
      activeThreadId: options.activeThreadId ?? null,
      activeProjectId: "proj_1",
      isCompactViewport: false,
      onNavigate: () => {},
      searchQuery: options.searchQuery ?? "",
    },
    {
      rpc: {
        listChildren: () => ({
          children: options.children ?? [HIDDEN_WORKER],
        }),
        listProjectHosts: () => ({
          hosts: [
            { id: "host_1", name: "Workstation", status: "connected" },
          ],
        }),
        listProjectDirectories: (input: unknown) => {
          const { path } = input as { path: string | null };
          return path
            ? { directory: path, parent: "/work", entries: [] }
            : {
                directory: "/work",
                parent: "/",
                entries: [
                  {
                    kind: "directory" as const,
                    name: "new-project",
                    path: "/work/new-project",
                  },
                ],
              };
        },
        createProjectDirectory: () => ({ ok: true as const }),
        createProject: () => ({ projectId: "proj_new" }),
        removeProject: () => ({ ok: true as const }),
        // Pins live in the backend's storage; the fake keeps them per render
        // so a remount reads back what the previous one wrote, as bb would.
        getPinnedProjects: () => ({ projectIds: [...pinnedProjects] }),
        setProjectPinned: (input: unknown) => {
          const { projectId, pinned } = input as {
            projectId: string;
            pinned: boolean;
          };
          pinnedProjects = pinnedProjects.filter((id) => id !== projectId);
          if (pinned) pinnedProjects.push(projectId);
          return { projectIds: [...pinnedProjects] };
        },
      },
      sidebarThreads: {
        status: "ready",
        threads: options.threads ?? [
          hostThread({ id: "thr_parent", title: "Orchestrator" }),
        ],
        projects: (options.projects ?? [
          {
            id: "proj_1",
            name: options.personalProject ? "Personal" : "Project",
            isPersonal: options.personalProject ?? false,
          },
        ]).map((project) => ({
          ...project,
          href: `/projects/${project.id}`,
          settingsHref: `/projects/${project.id}/settings`,
        })),
      },
    },
  );
}

describe("the thread tree slot", () => {
  it("registers as a sidebar thread list", () => {
    // Validated with the host's own registration rules by loadPluginApp.
    expect(app.threadLists).toHaveLength(1);
    expect(app.threadLists[0]?.id).toBe("tree");
  });

  it("labels the personal project as Chats", async () => {
    const slot = render({ personalProject: true });

    await slot.findByText("Chats");
    expect(slot.queryByText("Personal")).toBeNull();
    expect(
      (await slot.findByText("Orchestrator")).closest("div")?.style.paddingLeft,
    ).toBe("0px");
  });

  it("opens a project from the project list", async () => {
    const slot = render();

    const projectButton = await slot.findByRole("button", {
      name: "Open Project",
    });
    const projectRow = projectButton.parentElement;
    const projectActions = (
      await slot.findByRole("button", { name: "Project actions" })
    ).parentElement;

    expect(projectRow?.className).toContain("group/project");
    expect(projectActions?.className).toContain(
      "group-hover/project:opacity-100",
    );
    expect(projectRow?.classList.contains("bg-sidebar-accent")).toBe(true);
    projectButton.click();

    expect(slot.inspection.navigateCalls).toContainEqual(
      expect.objectContaining({ method: "toProject", projectId: "proj_1" }),
    );
  });

  it("highlights only the thread when a thread is open", async () => {
    const slot = render({ activeThreadId: "thr_parent" });

    const projectRow = (
      await slot.findByRole("button", { name: "Open Project" })
    ).parentElement;
    const threadRow = (await slot.findByText("Orchestrator")).closest("div");

    expect(projectRow?.classList.contains("bg-sidebar-accent")).toBe(false);
    expect(threadRow?.classList.contains("bg-sidebar-accent")).toBe(true);
  });

  it("collapses and expands a project", async () => {
    const slot = render();

    await slot.findByText("Orchestrator");
    fireEvent.click(
      await slot.findByRole("button", { name: "Collapse Project" }),
    );

    expect(slot.queryByText("Orchestrator")).toBeNull();
    fireEvent.click(
      await slot.findByRole("button", { name: "Expand Project" }),
    );
    await slot.findByText("Orchestrator");
  });

  it("starts a new thread with the project preselected", async () => {
    const slot = render();

    fireEvent.click(
      await slot.findByRole("button", { name: "New thread in Project" }),
    );

    expect(slot.inspection.sidebarActionCalls).toContainEqual({
      method: "openNewThread",
      options: { projectId: "proj_1", focusPrompt: true },
    });
  });

  it("pins a project to the top and marks it", async () => {
    const options = {
      threads: [
        hostThread({ id: "thr_a", projectId: "proj_1", updatedAt: 2_000 }),
        hostThread({ id: "thr_b", projectId: "proj_2", updatedAt: 1_000 }),
      ],
      projects: [
        { id: "proj_1", name: "Busy", isPersonal: false },
        { id: "proj_2", name: "Quiet", isPersonal: false },
      ],
    };
    const slot = render(options);

    // Skipping the "Projects" controls header, which is a section too.
    const sectionsOf = (container: HTMLElement) =>
      Array.from(container.querySelectorAll("section[aria-label]"))
        .map((node) => node.getAttribute("aria-label"))
        .filter((label) => label !== "Projects");
    const sections = () => sectionsOf(slot.container);
    // Activity order puts the busier project first until something is pinned.
    expect(sections()).toEqual(["Busy", "Quiet"]);

    fireEvent.pointerDown(
      await slot.findByRole("button", { name: "Quiet actions" }),
      { button: 0 },
    );
    fireEvent.click(await screen.findByRole("menuitem", { name: "Pin" }));

    await waitFor(() => expect(sections()).toEqual(["Quiet", "Busy"]));
    expect(slot.getAllByLabelText("Pinned")).toHaveLength(1);
    // Written to the backend, not to this browser: that is what makes the
    // order the same on the next device.
    expect(slot.inspection.rpcCalls).toContainEqual(
      expect.objectContaining({
        method: "setProjectPinned",
        input: { projectId: "proj_2", pinned: true },
      }),
    );
  });

  it("follows a pin made in another view", async () => {
    const store: string[] = [];
    const slot = render({
      pinnedProjects: store,
      threads: [
        hostThread({ id: "thr_a", projectId: "proj_1", updatedAt: 2_000 }),
        hostThread({ id: "thr_b", projectId: "proj_2", updatedAt: 1_000 }),
      ],
      projects: [
        { id: "proj_1", name: "Busy", isPersonal: false },
        { id: "proj_2", name: "Quiet", isPersonal: false },
      ],
    });
    const sections = () =>
      Array.from(slot.container.querySelectorAll("section[aria-label]"))
        .map((node) => node.getAttribute("aria-label"))
        .filter((label) => label !== "Projects");

    await waitFor(() => expect(sections()).toEqual(["Busy", "Quiet"]));

    // The other device's write, then the backend's broadcast.
    store.push("proj_2");
    await slot.behavior.emitRealtime("pins", {});

    await waitFor(() => expect(sections()).toEqual(["Quiet", "Busy"]));
  });

  it("removes a project only after confirmation", async () => {
    const slot = render();

    fireEvent.pointerDown(
      await slot.findByRole("button", { name: "Project actions" }),
      { button: 0 },
    );
    fireEvent.click(await screen.findByRole("menuitem", { name: "Remove" }));

    const dialog = await screen.findByRole("alertdialog", {
      name: "Remove project?",
    });
    expect(slot.inspection.rpcCalls).not.toContainEqual(
      expect.objectContaining({ method: "removeProject" }),
    );
    fireEvent.click(
      within(dialog).getByRole("button", { name: "Remove project" }),
    );

    await waitFor(() => {
      expect(slot.inspection.rpcCalls).toContainEqual(
        expect.objectContaining({
          method: "removeProject",
          input: { projectId: "proj_1" },
        }),
      );
    });
  });

  it("creates a project from a folder and opens it", async () => {
    const slot = render();

    (await slot.findByRole("button", { name: "New project" })).click();
    const dialog = await screen.findByRole("dialog", { name: "Add project" });
    fireEvent.click(
      await within(dialog).findByRole("button", { name: "new-project" }),
    );
    await within(dialog).findByText("Project name:");
    fireEvent.click(
      within(dialog).getByRole("button", { name: "Add project" }),
    );

    await waitFor(() => {
      expect(slot.inspection.rpcCalls).toContainEqual(
        expect.objectContaining({
          method: "createProject",
          input: { hostId: "host_1", path: "/work/new-project" },
        }),
      );
      expect(slot.inspection.navigateCalls).toContainEqual(
        expect.objectContaining({ method: "toProject", projectId: "proj_new" }),
      );
    });
  });

  it("shows a parent collapsed, with its hidden worker behind a chevron", async () => {
    const slot = render();

    await slot.findByText("Orchestrator");
    // Collapsed by default: the worker is counted, not listed.
    expect(slot.queryByText("Set up the VPS")).toBeNull();
    await slot.findByRole("button", { name: "Expand 1 child threads" });
  });

  it("keeps Chats at the bottom, however the projects above it are sorted", async () => {
    const slot = render({
      children: [],
      projects: [
        { id: "proj_personal", name: "Personal", isPersonal: true },
        { id: "proj_1", name: "Zulu", isPersonal: false },
        { id: "proj_2", name: "Alpha", isPersonal: false },
      ],
      threads: [
        // The freshest thread of all lives in Chats: neither mode may lift it.
        hostThread({
          id: "thr_chat",
          projectId: "proj_personal",
          title: "Loose chat",
          updatedAt: 9_000,
        }),
        hostThread({ id: "thr_z", projectId: "proj_1", title: "Zed work" }),
        hostThread({
          id: "thr_a",
          projectId: "proj_2",
          title: "Alpha work",
          updatedAt: 5_000,
        }),
      ],
    });

    const sections = () =>
      slot.getAllByRole("tree").map((tree) => tree.getAttribute("aria-label"));
    await waitFor(() => expect(sections()).toEqual(["Alpha", "Zulu", "Chats"]));

    fireEvent.pointerDown(
      await slot.findByRole("button", { name: "Sort by activity" }),
    );
    fireEvent.click(
      await screen.findByRole("menuitem", { name: "Sort by name" }),
    );

    await waitFor(() => expect(sections()).toEqual(["Alpha", "Zulu", "Chats"]));
  });

  it("reorders the list when the sort mode changes, and remembers the choice", async () => {
    const slot = render({
      children: [],
      threads: [
        hostThread({ id: "thr_a", title: "Alpha", updatedAt: 10 }),
        hostThread({ id: "thr_z", title: "Zulu", updatedAt: 900 }),
      ],
    });

    const titles = () =>
      slot.getAllByRole("treeitem").map((row) => row.textContent);
    await waitFor(() => expect(titles()).toEqual(["Zulu", "Alpha"]));

    fireEvent.pointerDown(
      await slot.findByRole("button", { name: "Sort by activity" }),
    );
    fireEvent.click(
      await screen.findByRole("menuitem", { name: "Sort by name" }),
    );

    await waitFor(() => expect(titles()).toEqual(["Alpha", "Zulu"]));
    expect(window.localStorage.getItem("bb-plugin-threadtree.sort-mode")).toBe(
      "name",
    );
  });

  it("reveals the hidden worker when the parent is expanded", async () => {
    const slot = render();

    const parent = await slot.findByText("Orchestrator");
    expect(parent.closest("div")?.style.paddingLeft).toBe("12px");
    const chevron = await slot.findByRole("button", {
      name: "Expand 1 child threads",
    });
    chevron.click();

    const worker = await slot.findByText("Set up the VPS");
    expect(worker).not.toBeNull();
    expect(worker.closest("div")?.style.paddingLeft).toBe("24px");
  });

  it("opens a hidden worker through toThread, since the host list has no such id", async () => {
    const slot = render();

    (await slot.findByRole("button", { name: "Expand 1 child threads" })).click();
    (await slot.findByText("Set up the VPS")).click();

    expect(slot.inspection.navigateCalls).toContainEqual(
      expect.objectContaining({ method: "toThread", threadId: "thr_worker" }),
    );
    // The host action would have silently done nothing for a hidden id.
    expect(slot.inspection.sidebarActionCalls).toHaveLength(0);
  });

  it("opens an ordinary thread through the host action", async () => {
    const slot = render();

    (await slot.findByText("Orchestrator")).click();

    expect(slot.inspection.sidebarActionCalls).toContainEqual(
      expect.objectContaining({ method: "open", threadId: "thr_parent" }),
    );
  });

  it("auto-expands the parent of the thread being viewed", async () => {
    const slot = render({ activeThreadId: "thr_worker" });

    // No click: a worker you are looking at must not be folded away.
    await slot.findByText("Set up the VPS");
  });

  it("keeps a parent whose hidden child matches the sidebar search", async () => {
    const slot = render({ searchQuery: "vps" });

    await slot.findByText("Orchestrator");
    await slot.findByText("Set up the VPS");
  });

  it("refetches children when the backend signals a lifecycle change", async () => {
    const slot = render({ children: [] });

    await slot.findByText("Orchestrator");
    const before = slot.inspection.rpcCalls.length;

    await slot.behavior.emitRealtime("tree", {});
    await new Promise((resolve) => setTimeout(resolve, 400));

    expect(slot.inspection.rpcCalls.length).toBeGreaterThan(before);
  });
});
