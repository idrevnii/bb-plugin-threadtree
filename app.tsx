// bb-plugin-threadtree — frontend.
//
// Replaces the sidebar's thread list with a tree: parent threads at the top
// level, their children folded underneath, including the hidden workers a
// `bb thread spawn` orchestration creates — which bb's own sidebar filters out
// of its bootstrap query entirely.
//
// This is bb's one exclusive slot, so registering it does NOT take the
// sidebar: the built-in list stays the default until the user picks this one
// under Settings → Appearance → Sidebar. The New-thread button, the search
// field, the plugin nav rows, and the footer stay host-rendered.
import { definePluginApp } from "@get-bb/plugin-sdk/app";
import { ThreadTree } from "./src/ThreadTree";

export default definePluginApp((app) => {
  app.slots.experimental_threadList({
    id: "tree",
    title: "Thread tree",
    description:
      "Parent threads with their children nested and collapsible, hidden orchestration workers included.",
    component: ThreadTree,
  });
});
