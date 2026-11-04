# Canopy

Canopy is a versioned tree editor with an infinite-pan history graph, nested treemap views, branch comparison, subtree editing, cycle-safe drag operations, and shared-session presence.

The retractable sidebar contains workspace status, editing actions, comparison, graph navigation, and shared-session controls. Each version has an independent, scrollbar-free treemap canvas. Nested entries use a balanced two-dimensional layout; top-level treemaps avoid overlap, preserve their positions where possible, and zoom out when a layout expands. The mouse wheel zooms the full version graph, including when the pointer is over a version canvas. Use Shift + the mouse wheel to zoom only that version canvas and Shift + left-drag to pan it. Click an entry to select it; Shift-click adds or removes entries in a multi-selection. Descriptions appear after hovering over an entry for two seconds. Drag entries over another entry to preview an attachment, or move them to free space to move or detach them; invalid drops are canceled. Click the active-version card in the sidebar to center it. Use **Alt + click** or the **Ping** control to mark a position for collaborators, and toggle dark mode in the sidebar.

Centering a version and fitting the graph are animated. Copying an entry between branches creates a connection arrow between the source and destination versions; double-click the arrow to navigate to the other version. At low graph zoom, versions switch to a read-only summary showing the action and entry/treemap counts.

## Shared sessions

Enter the same room name on each client and choose **Host** on one client and **Join** on the others, or open a copied invite link to join automatically. All connected peers can edit and create branches, including from the root version. WebRTC carries shared edits and temporary user presence between peers; PeerJS's public signaling service is used to establish connections. Each participant has an independent active version and selection, highlighted using a stable user color. The host browser must remain open and connected for the room to remain available. Concurrent changes to different versions merge; simultaneous changes to the same version use deterministic last-writer-wins conflict resolution. Each browser retains a local copy in browser storage.

## Run locally

```sh
npm install
npm run dev
```

The Vite UI runs at `http://127.0.0.1:5173`. During development, the accompanying workspace API saves its snapshot to `data/workspace.json`; the deployed static app uses browser storage and does not require that API.

For a production build, run `npm run build` followed by `npm start`. The production server serves the built UI and the same workspace API on port `4173`.

## GitHub Pages

The workflow in `.github/workflows/deploy.yml` builds and deploys the static site to GitHub Pages on pushes to `main` and on manual runs. The build automatically uses the repository subpath (or the domain root for a `*.github.io` repository). Enable **GitHub Actions** as the Pages deployment source in the repository settings.