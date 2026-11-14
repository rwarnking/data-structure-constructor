# Bugs and Required Fixes

Fix the following regressions and interaction/layout issues. Preserve all existing functionality. Add or update tests accordingly.

## 1. Restore Broken Version-Window Interactions

The following interaction previously worked correctly but is currently broken and must be restored:

- **Double-click interaction on version**

Restore these interactions without interfering with the newer version, branch, drag-and-drop, and merge interactions.

Ensure that:

- Panning the main view does not accidentally trigger selection, dragging, or other click actions.
- Zooming the main view does not accidentally trigger selection, dragging, or other pointer interactions.
- Double-click still triggers the appropriate existing action.
- Pointer interactions on entries, versions, connectors, and empty canvas areas remain distinguishable.

## 2. Version-Creator Indicator Positioning

Fix the positioning of the version-creator indicator:

```css
.version-card:not(.root-version)::before
```

The indicator must remain correctly aligned with its associated version regardless of viewport size or view transformation.

Requirements:

- Position the indicator relative to the version card/lane layout, not relative to browser-window dimensions.
- Resizing the browser window must not change the indicator's position relative to its version.
- Zooming must preserve the indicator's alignment with the version card.
- Panning must preserve the indicator's alignment with the version card.
- The indicator must remain correctly positioned when versions are moved between or rendered in different lanes.
- Do not use viewport-specific or hard-coded browser dimensions to determine its position.

## 3. Prevent Empty Lanes

Fix the branch/lane layout so that operations never create lanes that contain no versions.

### Merge

Merging must not create an additional empty lane.

For example (Room 0e940bc9), merging:

```text
v79-11be
v77-11be
```

into:

```text
v126-acbf
```

must not leave an empty lane underneath the lane containing `v126-acbf`.

After the merge, every rendered lane must correspond to an actual branch containing at least one version.

### Branching

Creating a new entry/version from an existing version must also not create an empty lane.

For example, branching from:

```text
v108-7766
```

must create only the required branch/version structure. It must not leave an empty lane as a side effect of the previous branch-layout calculation.

### General Rule

- Never render or retain a branch lane that contains no actual version.
- After every branch, merge, split, or version-creation operation, recompute lane assignments from the **current version graph**.
- Lane positions must be derived from the current branch graph, not from stale lane indices or previously rendered branches.
- Removing or merging a branch must also remove any now-unused lane.
- Lane assignment must remain stable when no structural change has occurred.

## 4. Automatically Follow Newly Created Versions

When a new version is created by one user while another user currently has the **same version active**, automatically move the other user's active view to the newly created version.

Requirements:

- Only users who currently have the version from which the new version was created active should automatically follow the new version.
- Users viewing another version must not be moved.
- The creator should naturally remain on the newly created version.
- The behavior must work correctly for collaborative changes received from another user.
- Do not unexpectedly change a user's active version when they are already viewing a different version.

## 5. Centered Version: Restore Direct Manipulation

When a version is centered/focused, the resulting view must still allow normal direct manipulation.

After centering a version:

- The user must be able to **drag/pan the view without holding Shift**.
- The user must be able to **zoom normally**.
- Centering must not lock or otherwise disable panning or zooming.
- Zooming in the centered version should zoom its content, while zooming outside of it should zoom the complete view (version tree).

## 6. Automatic Text Wrapping in Entries

Improve text layout inside entries so that text automatically wraps to make better use of the available entry area.

Requirements:

- Long entry text must wrap automatically instead of unnecessarily overflowing or being truncated.
- Wrapping should respect the available width and height of the entry.
- Short text should remain naturally positioned and readable.
- The implementation should adapt to dynamically changing entry sizes.
- Do not introduce unnecessary horizontal overflow.
- Preserve the existing visual style of entries.

## 7. Unique Collaborator Names per Room

Guarantee that every user in a room has a **unique collaborator name**.

Requirements:

- No two active users in the same room may have the same displayed collaborator name.
- Names must be checked against the users currently present in that room.
- If a requested/default name is already taken, automatically generate an available alternative.
- The uniqueness check must be performed when joining a room.
- Two users in different rooms may use the same name.
- Names should remain stable during a session.
- Joining/leaving users must not cause existing users' names to change unnecessarily.
- The solution must work correctly when multiple users join a room at approximately the same time.
- Do not rely solely on the client UI to enforce uniqueness; the collaborative room state must remain consistent.
