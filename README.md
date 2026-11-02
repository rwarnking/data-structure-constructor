# Canopy

Canopy is a versioned tree editor with an infinite-pan history graph, nested treemap views, branch comparison, subtree editing, and cycle-safe drag operations.

The retractable sidebar contains workspace status, editing actions, comparison, graph navigation, and shared-session controls. Each version has an independent, scrollbar-free treemap canvas rendered with D3. Treemaps keep their manually assigned positions, and each canvas fits its contents the first time it is opened. The mouse wheel zooms the full version graph, including when the pointer is over a version canvas. Use Shift + the mouse wheel to zoom only that version canvas and Shift + left-drag to pan it. Drag treemaps freely across the version canvas; a valid entry target previews the attachment, which is committed on release. Dragging onto the canvas background moves or detaches the subtree.

## Shared sessions

Enter the same room name on each client and choose **Host** on one client and **Join** on the others, or open a copied invite link to join automatically. All connected peers can edit and create branches, including from the root version. WebRTC carries shared state between peers; PeerJS's public signaling service is used to establish connections. The host browser must remain open and connected for the room to remain available. Concurrent changes to different versions merge; simultaneous changes to the same version use deterministic last-writer-wins conflict resolution. Each browser retains a local copy in browser storage.

## Run locally

```sh
npm install
npm run dev
```

The Vite UI runs at `http://127.0.0.1:5173`. During development, the accompanying workspace API saves its snapshot to `data/workspace.json`; the deployed static app uses browser storage and does not require that API.

For a production build, run `npm run build` followed by `npm start`. The production server serves the built UI and the same workspace API on port `4173`.

## GitHub Pages

The workflow in `.github/workflows/deploy.yml` builds and deploys the static site to GitHub Pages on pushes to `main` and on manual runs. The build automatically uses the repository subpath (or the domain root for a `*.github.io` repository). Enable **GitHub Actions** as the Pages deployment source in the repository settings.