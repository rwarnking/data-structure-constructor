# List of Adjustments

## 1. Treemap Interaction and Editing

### 1.1 Tooltip

- When hovering over an entry in a treemap for **2 seconds**, show a tooltip if the entry has a non-empty description.
- The tooltip should disappear when the cursor leaves the entry.
- The tooltip should not appear for entries without a description.

### 1.2 Overlap

- Treemaps and their entries must not overlap during normal operation.
- **Temporary overlap is allowed while dragging an entry.**
- While dragging, the system should distinguish between:
  - **Valid append/attach preview:** the cursor is in a valid position for appending the dragged entry to another entry. Show the resulting hierarchy as a preview.
  - **Valid move preview:** the cursor is in an available position where the entry can be moved without changing its parent.
  - **Invalid/intermediate position:** the cursor is currently not in a valid drop position. The dragged entry may visually overlap other entries, but no structural change is previewed.
- If the mouse button is released while the cursor is in an invalid/intermediate position, **cancel the operation and return the entry to its original position and hierarchy**.
- The preview must accurately represent the final result that will be created when the entry is released.
- Treemaps must not overlap after an operation has been committed.
- If a treemap changes size because an entry was appended, removed, moved, or detached and this would cause an overlap with another treemap, automatically move the affected treemaps to available space.
- When moving treemaps out of the way, minimize the displacement of existing treemaps and preserve their relative arrangement where possible.
- Treemaps within a version must maintain the **same aspect ratio as the version window**.
- Treemaps must therefore grow or shrink proportionally rather than growing in only one dimension.
- Arrange children within a treemap across both horizontal and vertical dimensions, rather than placing them primarily along a single axis. The layout should make use of the available two-dimensional space while maintaining the required padding and hierarchy constraints.
- Arrange children in a balanced two-dimensional layout, avoiding excessively elongated arrangements. For example, 9 children should preferably be arranged approximately 3×3 rather than 9×1, with the number of rows and columns chosen to make efficient use of the available space.
- Treemaps must remain within the version window.
- If the available space is insufficient, **zoom out the version view automatically** rather than allowing treemaps to overlap
- The zoom level of the version view should be adjusted only as much as necessary to accommodate the content and some padding.

## 3. Version Transitions and Animations

### 3.1 Zoom-in Animation

- Double-clicking a version should trigger a smooth zoom-in animation.
- The same animation should be used by the **Center** button and its corresponding hotkey when centering on a selected version.
- The animation should be centered on the target version.
- The viewport should transition smoothly from its current position and zoom level to a position where the selected version is clearly visible and readable.
- Avoid sudden jumps in scale or position.
- The animation should interpolate both **position and zoom level**.
- Add a corresponding smooth animation for the **Fit All** action.
- Fit All should smoothly transition from the current viewport to the calculated viewport that shows all relevant versions and branches.
- If an animation is triggered while another animation is running, cancel the previous animation and smoothly transition toward the new target.

### 3.2 Copying Between Timelines

- When an element is copied from one timeline/branch to another, add a **connection arrow** between the source version and the destination version.
- The connection should visually indicate that the destination contains an element copied from the source.
- The connection should exist **only between the two directly related versions**.
- It must not automatically propagate to later versions created from either version.
- The connection must remain correctly positioned when either version is moved, zoomed, or rearranged due to branching.
- If the source or destination version is moved, the connection should update continuously to remain attached to the corresponding versions.
- Double-clicking the connection arrow should activate and focus the version at the **other end of the connection**.
  - If the source version is currently active, double-clicking the arrow activates the destination version.
  - If the destination version is currently active, double-clicking the arrow activates the source version.
- The transition to the other version should use the same smooth zoom/navigation animation defined in **3.1**.

### 3.3 LOD System

- The system should have **two levels of detail (LOD)**.
- **LOD 1 — Detailed View**
  - Read-only mode is disabled.
  - Show the treemaps and their entries in detail.
  - Allow all normal interactions, including selection, dragging, dropping, attaching, detaching, and previews.
- **LOD 2 — Abstract View**
  - Read-only mode is enabled.
  - Do not show the individual treemap entries in detail.
  - Show an abstraction of the version's content and the action that produced it.
  - Display:
    - Number of entries in the version, including both internal entries and leaves.
    - Number of individual treemaps.
    - The type of action compared with the previous version, e.g. **Add**, **Delete**, **Rename**, **Move**, **Attach**, **Detach**, or **Modify**.
    - A symbol representing the action.
    - A short textual action label, e.g. `add`, `del`, `rename`, `move`.
- Use a compact card-like representation containing the action indicator and statistics
- The action indicator should be visually prominent enough to identify the change at a glance.
- The exact layout should follow this general structure:
  - **Action indicator + action label** at the top.
  - **Entry count** and **treemap count** as compact statistics below it.
  - Keep the representation visually simple so it remains readable at low zoom levels.
- The switch between LOD 1 and LOD 2 should happen at the **current zoom threshold**, which is already considered appropriate.
- The transition between LODs must be immediate and deterministic at the threshold; there must be no intermediate state in which a version is visually displayed but its interactions are disabled.
- At any point in time, a version must be either:
  - **LOD 1:** fully rendered and interactive, or
  - **LOD 2:** abstracted and read-only.
- Do not render LOD 1 while the interaction is read-only
- When transitioning into LOD 1, all interactions should be available immediately.
- When transitioning into LOD 2, disable editing as soon as the abstraction becomes active.

## 5. Context Menus and General UI

### 5.1 Read-only Notification

- Move the read-only notification above the hotbar.
- Display it as a colored horizontal element with **exactly the same width as the hotbar**.
- The notification should be clearly visible without taking up unnecessary screen space.
- The notification should only be visible while the application is in read-only mode.
- It should disappear immediately when the application leaves read-only mode.

### 5.2 Interaction Documentation

- Add tooltips to hotbar elements.
- Each tooltip should describe:
  - What the function does.
  - The corresponding keyboard shortcut, if one exists.
- Tooltips should appear after a short hover delay rather than immediately.
- Tooltips should use consistent wording and formatting throughout the application.
- If a function has no keyboard shortcut, only display its description.

## 6. Multiuser and Collaboration

### 6.1 Ping Functionality

- Add **Alt + Click** as a shortcut for pinging.
- The ping should only be triggered when Alt is held while clicking the canvas/version.
- Replace the current single ripple with **three consecutive ripples**.
- The three ripples should appear with a short delay between them to create a clearly visible pulse effect.
- Increase the maximum ripple size to approximately **3× the current size**.
- Play a short sound when a ping is triggered.
- The sound should be generated/played locally by the application and does not require an external audio service.
- The sound should be short and unobtrusive.
- Browsers may block audio playback until the user has interacted with the page; the implementation should handle this gracefully and simply omit the sound if playback is unavailable.
- The visual ping should still work even if audio playback is blocked.
- Pinging must not change the active version or selection of other users.
- Other users should see the ping at the corresponding position, including the initiating user's color.