## 1 Treemap

### Treemap Layout Rules

- Treemaps within the same version must never overlap.
- When a treemap changes size or position and would overlap another treemap, the system must automatically move the affected treemaps to available space.
- Treemap layout must remain within the version window. If there is insufficient space, the view should zoom out rather than allowing treemaps to overlap.

## 2 Selection Feedback

- Make it immediately clear when a treemap entry is selected.
- Define explicit selection rules:
  - Clicking an entry selects it.
  - Clicking empty canvas space clears the current entry selection.
  - Selecting another entry replaces the previous selection unless multi-selection is enabled.
  - Selecting an entry automatically activates its containing version.
  - Selection should persist until another entry is selected or the selection is explicitly cleared.
- Allow for multi-selection
    - enabled when pressing shift and mouse button
    - highlight selected entries but in a different color then the first one
- Use an outline to highlight selected entries.
- Ensure that selection feedback is distinguishable from hover and drop-target highlighting:
  - **Selection:** Persistent outline in the user color (see 3.1).
  - **Hover:** Temporary outline entry in a dedicated color that is not part of the possible user colors.
  - **Drop target:** Temporary outline in the same color as hover.
- If multiple user have the same entry selected each user should see his own color as the highlight outline.
- These states must not overwrite each other or produce ambiguous visual feedback.
- When clicking on the active version box in the side bar, the currently active version should be centered.

## 3. Multiuser and Collaboration

### 3.1 User-specific Change Colors

- Assign each user a distinct color.
- Each version should indicate which user created the corresponding change/version by a colored visual accent, like an additional colored line
- Keep color assignments consistent throughout the session.
- Try to ensure that user colors remain distinguishable from selection, hover, drop-target, and difference-highlighting colors.

### 3.2 Independent Active Versions

- Each user must be able to have a different active version/window.
- Changing the active version for one user must not change the active version for other users.
- The active version and current selection of each user are indacted by a highlight (version outline).
- The highlight of the active version of each user is using the user color, to clearly indicate who has what active.
- If multiple user have the same version selected each user should see his own color as the highlight outline.

### 3.3 Ping Functionality

- Add a ping function that allows users to highlight a specific position for all other connected users.
- The highlight should be temporary and visually distinguishable
- Use a circular echo/ripple animation originating from the mouse position
- Use the initiating user's assigned color to display the ping.
- Pinging a version must not change the active version or selection of any users.

## 4 Version Activation

- As soon as a user starts dragging or clicking on an element within a specific version, that version should automatically become the active version.
- Activation should happen immediately when the interaction begins, not only after the element has been dropped or the interaction has finished.
- Activating a version should not affect the active version of other users in multiuser mode.

## 5 Misc

- Add a darkmode
