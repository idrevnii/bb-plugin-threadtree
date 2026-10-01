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
- **Right-click** gives bb's own actions (split, read, pin, archive, delete)
  on every thread the host list carries. Rows only the RPC knows get no menu:
  those actions reject ids the host does not know.
- **Keyboard** — bb's numbered jumps and `thread.next` / `thread.previous`
  work on every row, hidden ones included, because the host clicks the row
  element rather than opening by id.
- **Auto-archive** is off by default. Pick an idle period under **Tools →
  Thread tree** and an hourly sweep archives root threads nobody has touched
  (written to or opened) since then — skipping pinned threads, running work,
  and anything waiting on input. Children archive with their parent, so a
  root is only swept when its whole subtree is idle. Run
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
search, flattening); `src/ThreadTree.test.tsx` mounts the real slot through
the official `@get-bb/plugin-sdk/testing/app` harness, which also validates
the registration with the host's own rules. Run `bb plugin types` after a bb
upgrade to repin `@get-bb/plugin-sdk` to the running version.
