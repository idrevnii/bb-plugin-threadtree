# bb-plugin-threadtree

Sidebar thread list as a **collapsible tree**: parent threads on top, their
children folded underneath — including the hidden workers an orchestration
spawns, which bb's own sidebar never shows.

```
▸ оркестратор логика молока                    1
▾ Сгенерировать полный багбаунти отчет
    Рассчитать время прибытия поезда        (hidden)
    Compute 17 times 23                     (hidden)
    Compute 17 times 23                     (hidden, failed)
```

## Why a plugin needs a backend for this

`bb thread spawn --visibility hidden` (and any child that inherits a hidden
parent) creates a thread bb's own sidebar deliberately filters out. Since
plugin SDK 0.5 the host list handed to `experimental_useSidebarThreads()`
carries those threads too, flagged `isHidden`; older hosts left them out
entirely.

So the plugin is two halves:

- **`server.ts`** — one read-only RPC listing every child and hidden thread
  through `bb.sdk.threads.list({ includeHidden: true })`, plus a realtime ping
  on the lifecycle events those threads emit. It is the fallback for anything
  the host list does not carry.
- **`src/`** — the sidebar list, merging those rows into bb's own live list.
  The host list stays authoritative for everything it covers (pins, unread,
  resolved status, titles), so the tree keeps updating at bb's cadence; the
  RPC only adds rows the host cannot see.

## Enabling it

Registering the slot does **not** take over the sidebar. Pick it under
**Settings → Appearance → Sidebar** (per client; bb falls back to its built-in
list if this plugin is disabled or crashes).

```sh
bb plugin install .
bb plugin dev        # watch loop while editing
```

## Behavior worth knowing

- **Opening a thread the host list lacks** goes through `toThread`, not the
  host's `open`, which silently ignores ids absent from its sidebar list.
- **Projects** stay available above the tree, including projects with no
  threads. Click one to open it, or use the folder-plus button to add a local
  folder as a project.
- **Right-click** gives bb's own actions (split, rename, read, pin, archive,
  delete) on every thread the host list carries. Rows only the RPC knows get
  no menu: those actions reject ids the host does not know.
- **Collapsed parents** carry their subtree: the glyph shows the most urgent
  state anywhere below (failed › needs input › working › unread), and the
  badge reads `done/total` while workers are still going — the plain count
  once they are all done, with the breakdown in its tooltip.
- **Filter chips** under the project header narrow the list to threads that
  need input, failed, or are working (several chips mean "any of these").
  A chip only appears while something is in that state, and the choice is
  not remembered. **Hide finished workers** (in the sort menu) drops hidden
  workers with nothing left to say and *is* remembered per client.
- **Age** — every row shows how long ago its subtree last moved (`5m`, `3h`,
  `4d`), the same number the "by activity" sort reads.
- **Rename** by double-click, `F2`, or the context menu; Enter or blur saves,
  Escape cancels. Hidden workers rename through the SDK, since bb's own
  rename only knows its own list.
- **Pinned threads** follow bb's pin order in both sort modes. Drag one up or
  down to reorder (a sideways drag is still bb's drag-to-split), or use
  `Alt+↑` / `Alt+↓` or **Move up / Move down** in the context menu. Reordering
  is off while a filter is on.
- **Hover** a row for a moment to see the thread's last reply without
  opening it (mouse only).
- **Keyboard** — bb's numbered jumps and `thread.next` / `thread.previous`
  work on every row, hidden ones included, because the host clicks the row
  element rather than opening by id.
- **Auto-archive** is off by default. Pick an idle period under **Tools →
  Thread tree** and an hourly sweep archives root threads nobody has touched
  (written to or opened) since then — skipping pinned threads, running work,
  and anything waiting on input. Children archive with their parent, so a
  root is only swept when its whole subtree is idle. The **Auto-archive
  preview** below the setting shows how many threads each period would take
  on its next sweep, and lists them. Run
  `bb plugin reload threadtree` after changing it (or set it from the CLI:
  `bb plugin config threadtree set autoArchiveAfter "1 week"`).
- A parent unfolds itself when the thread you are viewing is inside it, or
  when the sidebar search matches something it contains. Expansion is
  remembered per client in `localStorage`.

## Development

```sh
npm run typecheck
npm test
npm run build
```

`src/tree.test.ts` covers the rules (merging, nesting, orphans, sorting,
pin order, search and filters, subtree summaries, ages, flattening);
`src/autoArchive.test.ts` the sweep and its preview; `src/ThreadTree.test.tsx`
mounts the real slots (sidebar list and settings preview) through the
official `@get-bb/plugin-sdk/testing/app` harness, which also validates the
registration with the host's own rules. Run `bb plugin types` after a bb
upgrade to repin `@get-bb/plugin-sdk` to the running version.
