# Canopy

Canopy is a versioned tree editor with an infinite-pan history graph, nested treemap views, branch comparison, subtree editing, cycle-safe drag operations, and shared-session presence.

The retractable sidebar contains workspace status, editing actions, comparison, graph navigation, and shared-session controls. In a shared room, the collaborator list shows each user's color, animal name, and active version; click a collaborator to focus their version without changing your own active version. The **Interaction Log** keeps the ten most recent shared actions, with navigable references to existing entries, versions, and ping locations. Each version has an independent, scrollbar-free treemap canvas. Nested entries use a balanced two-dimensional layout; top-level treemaps avoid overlap, preserve their positions where possible, and zoom out when a layout expands. The mouse wheel zooms the full version graph. Shift + the mouse wheel zooms a version canvas; Shift + left-drag pans it. Dragging empty space in a focused version pans the graph without Shift. Click an entry to select it; Shift-click adds or removes entries in a multi-selection. Right-click entries and versions for contextual actions; right-click empty canvas space for current-canvas actions. Entry deletion can keep children attached to their former parent, delete the whole subtree (with confirmation), or detach children as free entries. Entry editors focus the value field automatically. Descriptions appear after hovering over an entry for two seconds. Within each version, entries with exactly matching values are connected by non-interactive lines, with one connection per relationship and no arrowheads. Dragging starts after a small pointer movement, selects the entry, keeps a dashed outline at its original position, and previews the unchanged-size subtree above other entries without reflowing its former parent. Hover, selection, and drop-target states change the entry fill. Entries have white outlines; a colored outline marks entries added, modified, or changed in hierarchy or order relative to the version's parent, including merge and split results. Treemap positioning alone does not mark entries as changed. Drag over a valid entry to preview attachment; moving a nested entry outside its parent previews a detach. Child layout remains automatic rather than being manually reordered by dragging. Invalid and outside drops are canceled, and any zoom-out needed to show a preview is retained. Double-click a version header, click the active-version card in the sidebar, or press **F** to focus it. Use **Alt + click** or the **Ping** control to mark a position for collaborators, and toggle dark mode in the sidebar settings.

The entry editor uses a scrollable, one-line-per-entry table for adding multiple entries in one operation; all rows are validated before one new version is created. Select multiple entries to delete them together while choosing whether to keep, remove, or detach their children. Use **Merge entries** to combine a selection into one entry while preserving its descendants, or **Split entry** to replace one entry with multiple entries and assign each direct child to a result. Version cards resize with the browser viewport while preserving their contents and hierarchy.

Single-click a version to activate it without moving the graph; double-click its header, overview, or empty canvas to activate and focus it at any zoom level. Double-clicking an entry still opens its editor. Compare and merge start with the active version selected first (as the merge source). Deselect it in the selection panel to choose another; single-click a version to pick it for the operation.

Focusing a version and fitting the graph are animated. New cards animate into place before their terminal arrows appear. Curved branch and merge connectors appear above straight connectors. Action symbols are shown in destination version headers, not on connectors. Copying an entry creates a dashed connector directly between the source and copied entries; click it once to activate and focus the version at the opposite end. The connector follows both entries through layout and viewport changes, and disappears when either linked version or entry is removed. When adding an entry to an empty branch, the new version automatically centers all elements. At low graph zoom, versions switch to a read-only summary showing the action, tag, and entry/treemap counts. The empty root is labeled “Root: Empty” and uses this summary at all zoom levels.

Open a version's **three-dots** menu to focus the version, center and fit all of its treemaps, or pack them into a compact, overlap-free layout that accounts for both canvas dimensions. **Compare** opens a viewport-sized, linked side-by-side view that distinguishes additions, removals, edits, and hierarchy or position changes. Press **M** or choose **Merge** to open a viewport-sized merge view with an interactive result treemap, a depth-first entry list, and a source-change summary. Pick or omit entries, adjust result parents, or reorganize the preview; these controls stay synchronized, and **Reset** restores the initial preview without changing either source version. With no choices, versions are combined by entry identity; new merge versions are compacted automatically. Merges preserve both histories, add normal midpoint-routed connectors from both source versions to the result, and place the result one step after the later source. A merge continues the target's lane if it is the latest version on its branch; otherwise it continues the source's lane if possible. Only when neither is latest does it start a new lane.

Older merges that unnecessarily used a separate lane are reflowed where safe; their existing version numbers remain unchanged.

Use **F** to focus the active version; the toolbar also offers neighborhood, fit height, and fit all navigation modes. **+** and **−** step through these presets in order: fit all, fit height, neighborhood, focus. After manually panning or zooming, the shortcuts continue from the last preset used. Preset views adjust when the available canvas changes size. Use the **arrow keys** to move to the previous or next version on the current history path, or to the closest version on the branch above or below. **Ping** (or **P**) toggles Ping Mode; click the canvas to place a ping, and press **P** or **Esc** to exit. Canvas drags continue to pan without placing a ping.

Press **Ctrl/⌘+F** outside a text field to search versions by identifier parts, tag title, or tag description. Select a result to activate and focus it. The three most recent submitted or selected queries are stored locally and are not shared. Press **Esc** to close search.

Use **Ctrl/⌘+drag** from empty space in an editable version to box-select intersecting entries; add Shift to extend the current selection. Drag a selected entry to move the selected subtrees together. A context menu's **Add parent** action wraps the selection in one new entry, attached to the first selected entry's former parent.

**Add child** creates an independent child with the entered value under each selected entry in one version. A version's menu can add, edit, or remove its tag; hover its indicator for the title and description. Tags belong to individual versions, remain on those versions when branching, and synchronize with the room. Open **All tags** in settings to navigate the room's tagged versions.

The circled exclamation button opens an interactive tutorial; it can be skipped or restarted. Its steps are defined in `src/content/tutorial.json`, including optional lists, images, UI highlights, click completion conditions, and demonstration actions. Keyboard mappings and action icons are centralized in `src/config/hotkeys.ts` and `src/config/icons.ts`. Core light and dark theme colors are configured in `src/config/theme.css`.

Lane-edge arrows pan to the first or last non-root version in that lane without changing the active version. Their color matches the destination version, and the active version's lane is outlined. Their width stays fixed and their height follows the visible portion of the lane.

Use **Ctrl/⌘+A** to select all entries in the active version, **Ctrl/⌘+C** to copy selected subtrees, and **Ctrl/⌘+V** to paste them. **Ctrl/⌘+X** prepares selected subtrees for cutting: paste into a different version to create a copy there and a separate deletion version from the original source. Selected descendants of another selected entry are included once. Text fields retain their normal shortcuts. **Ctrl/⌘+O** also focuses the active version, and **Ctrl/⌘+N** opens the new-entry editor.

Version numbers normally have the form `step.branch.subbranch`. Each original branch starts at subbranch `001`; only a new fork increases it. If numbers collide, for example after simultaneous edits or reuse of a deleted version's step, a fourth part counts from `1` to distinguish them. Independently created versions can temporarily have the same number, and displayed suffixes may change as peers synchronize. Numbers deleted after this update remain reserved. Numbers are independent of visual lanes, and existing rooms are migrated when loaded.

## Rooms and shared sessions

At startup, Canopy opens the last locally saved room, or creates one if needed, and automatically hosts or joins it. **Change Room** lets you switch between saved rooms, create an empty room, or delete an inactive room after confirmation. **Copy Invite** copies a link that opens the same room for collaborators. Each room keeps its own versions, entries, interaction log, collaboration metadata, and copied-entry clipboard in browser storage. The root must be empty; imports and saved rooms with root entries are rejected without changing their data. The current user appears in the Collaborators list and local actions are recorded in the Interaction Log even when no other users are connected.

The sidebar settings menu contains the theme toggle and data import/export. Exports are self-contained JSON objects with `format: "canopy-dataset"`, `version: 1`, the room name, its graph `state`, and recent `interactions`. Imports validate the file and create a separate local-only room; name collisions receive `_1`, `_2`, and so on. Imported rooms do not connect to a shared room or provide an invite, including after reload.

All connected peers can edit and create branches, including from the root version. WebRTC carries shared edits and temporary user presence between peers; PeerJS's public signaling service is used to establish connections. The host assigns unique collaborator names within the room. Each participant has an independent active version and selection, highlighted using a stable user color. When a peer creates a version, participants viewing its parent follow the new version; participants viewing other versions stay where they are. The host browser must remain open and connected for the room to remain available. Concurrent changes to different versions merge; simultaneous changes to the same version use deterministic last-writer-wins conflict resolution.

## Run locally

```sh
npm install
npm run dev
```

The application entry point is `src/App.vue`, with workspace composition in
`src/views/` and UI in `src/components/`. The `src/composables/` directory
contains the workspace's history, hierarchy editing, graph, comparison, and
collaboration controllers. Room persistence is in `src/services/`, shared types
are in `src/types/`, and tree, layout, and validation helpers are in `src/utils/`.
Peer connectivity is implemented in `src/collaboration.ts`.

The Vite UI runs at `http://127.0.0.1:5173`. Room state is persisted in browser storage in both development and deployed builds; the local workspace API is not used for room data.

For a production build, run `npm run build` followed by `npm start`. The production server serves the built UI and the same workspace API on port `4173`.

## Tests

Install the browser once with `npx playwright install chromium`, then run
`npm test` for both unit and browser integration tests. Run `npm run test:unit`
or `npm run test:ui` separately, and `npm run typecheck` for a non-incremental
type-check. The browser suite starts its own Vite and PeerJS signaling servers
on ports 19100 and 19101; it uses real local WebRTC connections without relying
on the public signaling service. Each test uses isolated browser storage.

## GitHub Pages

The workflow in `.github/workflows/deploy.yml` builds and deploys the static site to GitHub Pages on pushes to `main` and on manual runs. The build automatically uses the repository subpath (or the domain root for a `*.github.io` repository). Enable **GitHub Actions** as the Pages deployment source in the repository settings.