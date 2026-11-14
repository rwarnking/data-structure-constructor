# List of Adjustments

- Use **PeerJS** to implement peer-to-peer communication between clients.
  - Use PeerJS for establishing and managing WebRTC peer connections.
  - All clients connected to the same application instance must have equal editing permissions.
  - There is no read-only peer: every connected peer must be able to modify the shared application state.
  - Changes made by any peer must be propagated to all other connected peers.
  - Peers must be able to modify existing versions, including modifying their treemap contents and other editable properties.
  - Peers must be able to create new versions and branches.
  - In particular, any peer must be able to create a new branch originating from the root.
  - Changes to the shared version/branch structure must be synchronized across all connected peers.
  - The shared state should remain consistent across peers when multiple peers make changes.
  - The communication layer should be kept separate from the application logic so that it can be replaced or extended later if necessary.
  - The number of peers can be bigger then 3

- Add the necessary configuration and deployment setup so that the application can run as a **static site on GitHub Pages**.
  - The application must be buildable into static files that can be served directly by GitHub Pages.
  - Do not require a traditional backend server for the frontend application to start or function.
  - Configure the project so that the generated build can be deployed automatically to GitHub Pages, preferably through a GitHub Actions workflow.
  - Ensure that routing and asset paths work correctly when the application is served from the GitHub Pages subpath rather than the domain root.
  - Ensure that PeerJS/WebRTC connections work correctly when the application is hosted on GitHub Pages.

- all other features should ramain unchanged