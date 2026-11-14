# Data and Room Management

### Room Startup and Switching

- On application startup, automatically join a room.
- If locally saved rooms exist, automatically open the **last room that was used**.
- If no room exists yet, automatically create a new room and join it.
- The application must therefore always have a valid current room after startup.
- When joining a room, automatically execute **Fit All** so that the room contents are immediately visible.

### Collaborators and Interaction Log

- The current user must always appear in the **Collaborators** list, even when they are the only user in the room.
- Indicate the current user by adding **`(you)`** after their name.
- The Interaction Log must work when there is only one user.
- Local actions that are normally recorded in the shared Interaction Log must still be recorded when performed by the only user.
- The current user automatically acts as the host when creating or joining a room on startup.
- Remove the **Host** button/action. Hosting should not require an explicit user action.

### Changing Rooms

- Display a **Change Room** button and a **Copy Invite** button.
- **Change Room** opens a room-selection interface showing all rooms currently saved locally.
- The user must be able to:
  - select an existing locally saved room;
  - create a new empty room.
- Selecting a room switches the application to that room and loads its associated data.
- The previously active room remains locally saved unless the user explicitly deletes it.
- After switching rooms, automatically execute **Fit All**.
- The **Copy Invite** button should copy the invitation information required for another user to join the current room.

### Local Room Management

- The Change Room interface must allow the user to **delete a locally saved room**.
- Deleting a room requires explicit confirmation.
- The confirmation must clearly identify the room that will be deleted and state that its locally stored data will be removed.
- Deleting a room must not affect any other locally saved room.
- The currently active room must not be deleted without first switching to another room or creating a replacement room.

### Room-Dependent Data Storage

- Keep the existing client-side storage mechanism, but make all application data **room-dependent**.
- Each room must have its own independent set of:
  - branches;
  - versions;
  - hierarchy/entry data;
  - associated room state.
- Data created or modified in one room must **never affect or appear in another room**.
- Switching rooms must load the complete state associated with the selected room.
- If a room has no previously stored data, initialize it with the default empty state.
- Persist changes automatically using the existing storage mechanism.
- Room-specific data must survive page reloads and browser restarts, subject to the persistence guarantees of the existing storage mechanism.
- Persist the identity of the last-used room so that it can be reopened automatically on the next startup.

---

# Miscellaneous Fixes and Changes

### Entry Selection and Hover

- The **active/selected entry outline takes precedence over the hover highlight**.
- When an entry is selected and hovered simultaneously, its selected/active outline must remain visible rather than being replaced or obscured by the hover styling.

### Treemap Dragging

- Fix treemap/entry dragging.
- The current implementation is broken compared with the behavior before the most recent change.
- Restore the previously working drag behavior while preserving the current drag/drop requirements, including move, attach, detach, cancellation, and preview behavior.

### Merge Connector Routing

Correct merge-version placement and connector routing according to these rules:

- If **both source versions are the latest versions of their respective branches**, add the merge version to the branch/lane of the source branch that is **higher up** in the branch layout.
- If **exactly one source version is the latest version of its branch**, add the merge version to that source version's existing branch/lane.
- If **neither source version is the latest version of its branch**, create a **new branch lane** for the merge result.
- In the last case, insert the new merge branch between the two source branches according to the existing merge branch-lane ordering rules.
- Do **not** create empty lanes.
- Do **not** create version that are not on a lane.
- The merge connectors must use the same positioning and routing behavior as normal branch connectors.
- Connectors must start and end at the correct horizontal positions of the connected versions and must not start unnecessarily far to the left or right.
- Reuse the existing normal branch-connector geometry and routing logic wherever possible.
- Do not introduce separate merge-specific connector geometry unless required by the merge topology.

### Connectors in General

- Add a **change symbol in the middle of each version connector** indicating what changed between the connected versions.
- The symbol must be positioned on the connector itself and remain centered when the connector geometry changes.
- The symbol must should be visible and on top of all branches behind it.
- The symbol should use the existing visual language for action/change symbols.
- The symbol must not interfere with connector interaction or version selection.
- The symbol must remain correctly positioned when the graph is zoomed or panned.

### GitHub Pages Build

Fix the GitHub Pages build error:

```text
src/App.vue(2034,52): error TS2554:
Expected 2-3 arguments, but got 4.
```

- Identify the actual API/function signature causing the error.
- Update the call site to use the correct number and types of arguments.
- Do not suppress or bypass the TypeScript error.
- Ensure the GitHub Pages build completes successfully after the fix.

### LOD 2 Merge and Split Symbols

- Update LOD 2 representations so that **merge** and **split** operations have their own recognizable symbols.
- The symbols should follow the existing LOD 2 visual language and remain readable at low detail.
- Merge and split symbols must clearly distinguish the two operation types from each other and from existing action symbols.

### Copied-Entry Connector Hover

- For connectors between copied entries, **only change the connector color on hover**.
- Use the same hover color that is used for entry hover states.
- Do not change the connector's thickness, position, dash pattern, opacity, geometry, or any other visual property on hover.
- The connector must otherwise remain visually unchanged.
- The connector must remain correctly attached to its endpoints when zooming or panning.

---

# Read-Only Mode / LOD 2

LOD 2 should reduce the level of detail without making the entire graph inaccessible.

### General Behavior

- Remove the warning/message above the hotbar indicating that read-only mode is active.
- LOD 2 must not prevent basic navigation or the creation of new entries.
- The root remains clickable in LOD 2.
- A version remains selectable in LOD 2.

### Actions Allowed in LOD 2

The following actions must remain available in LOD 2:

- Click the root.
- Create a new branch by selecting the root and adding a new entry.
- Select a version.
- Add a new entry to the selected version.
- Navigate between versions/branches using the existing navigation mechanisms.
- Use normal viewing/navigation functionality such as **Fit All** and **Focus**.
- Compare versions.

Adding an entry in LOD 2 must work in exactly the same way as adding an entry in the corresponding normal view and must create the appropriate new version or branch.

### Merge and Compare in LOD 2

- **Version comparison must remain available in LOD 2.**
- The user must be able to initiate a comparison from LOD 2.
- If comparison provides a subsequent **merge workflow**, the merge workflow itself remains available.
- LOD 2 must not disable the merge operation between versions.

This is distinct from **Merge Entries**, which refers to merging multiple entries within a hierarchy and remains disabled in LOD 2.

### Actions Disabled in LOD 2

The following entry-level modifying actions must be disabled while in LOD 2:

- Delete entry
- Merge entries
- Split entry
- Move entry
- Append/attach entry
- Disconnect/detach entry

Disabled actions must not execute accidentally through context menus, keyboard shortcuts, drag operations, or any other interaction path.

The restriction must apply consistently across all UI entry points. Hiding or disabling an action in one menu must not leave another way to perform the same action.

LOD 2 therefore remains **navigable, comparable, and capable of creating new entries**, while direct destructive or structural modifications to existing entries are disabled.