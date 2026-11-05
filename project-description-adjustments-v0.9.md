# List of Adjustments

## Versions

## 1. Version Layout and Navigation

### 1.1 Center All Elements

- Add a `Center All Elements` function to the version controls (three-dots menu).
- It should Reposition all treemaps so that their **collective bounding box is centered** within the visible version canvas.
- Preserve the relative positions, sizes, and hierarchy of all elements.
- Automatically adjust the zoom level so that all treemaps fit within the viewport with a small, consistent padding.
- Use the **maximum zoom level at which all elements remain fully visible**.
- Do not modify the underlying treemap layout, hierarchy, or relative arrangement.

### 1.2 Compact Layout

- Add a separate `Compact Layout` function to the version controls (three-dots menu).
- It should Rearrange all treemaps to **minimize unnecessary empty space** within the version canvas.
- Preserve the hierarchy and sizes of treemap entries.
- Prevent overlaps and maintain consistent spacing between treemaps.
- Unlike `Center All Elements`, this function may change the relative positions of treemaps.
- The resulting arrangement should be as compact as possible while keeping all entries readable and interactable.
- After rearranging the treemaps, center the resulting layout within the version canvas.

## 2. Version Transitions and Connections

### 2.1 Copying Between Timelines

- When an element is copied from one timeline/branch to another, add a **connection arrow** (`line + arrowhead`, visually similar to `-->`) between the source version and the destination version.
- The connection should indicate that the destination version contains an element copied from the source version.
- The connection should exist **only between these two directly related versions**.
- It must not automatically propagate to later versions created from either version.
- The connection must remain correctly positioned when either version is moved, rearranged, or affected by branching.
- Update the connection continuously when the position of either connected version changes.
- Double-clicking the connection arrow should activate and focus the version at the **opposite end of the connection**.
  - If the source version is active, double-clicking the arrow activates the destination version.
  - If the destination version is active, double-clicking the arrow activates the source version.
- Use the same smooth zoom/navigation animation as other version-navigation actions.

## 3. Version Comparison and Branch Operations

### 3.1 Merge Branches

- Add the ability to merge two existing versions.
- A merge creates a **new version** containing the combined result of the selected source and target versions.
- The original branches and all of their existing versions must remain unchanged.
- A merge must create explicit connections from **both source versions to the resulting merge version**, visually similar to a branch connection.
- If there are no conflicts, the merge can simply combine the treemaps from both versions into the resulting version.
- Pressing `M` activates merge mode.
- Merge mode should work similarly to comparison mode:
  1. Activate merge mode.
  2. Select the first version.
  3. Select the second version.
  4. Open the comparison/merge view.
  5. Resolve conflicts or accept the combined result.
  6. Confirm the merge to create the new version.
- The first selected version is treated as the **source** and the second as the **target**.
- **Any version can be selected as the target**, including a version that is not the latest version of its branch.
- If the selected target is the latest version of its branch, the merge result is added as the next version of that branch.
- If the selected target is **not** the latest version of its branch, the merge result must not be inserted into the existing branch history. Instead, create a **new branch originating from the selected target version**, with the merge result as its first new version.
- The new branch should be connected to the target version in the same way as other branch connections.
- The merge result should additionally have a connection to the selected source version.
- Any existing version of the source branch can be selected as the source.
- A merge must therefore be possible even if the source version is not the latest version of its branch.
- A merge operation must be **abortable at any point before confirmation** without modifying either source branch.
- After a branch has been merged into another branch, both original branches remain intact and can be continued independently.
- A version can be used as the source or target of **multiple merges**.
- Merging a version does not consume, remove, or otherwise modify the version that was merged.

### 3.2 Merge Step Alignment

- Merge connections should align the source and target branches according to their **step counts**.
- The merge result receives the next step number of the **target branch** when the target is the latest version of that branch.
- If the target is not the latest version, the merge result starts a new branch from that target version and receives the appropriate next step number for the new branch.
- When the source and target branches have different numbers of steps, the connection lines should visually span the missing steps rather than introducing artificial versions.
- If the target branch has fewer steps than the source branch:
  - The merge result is placed at the next step of the target branch.
  - The connection from the source version spans the corresponding difference in step positions.
- If the source branch has fewer steps than the target branch:
  - The merge result is still placed at the next step of the target branch.
  - The connection from the source version spans the missing steps on the source side.
  - The connection may therefore extend beyond the source branch's current last version even though no intermediate source versions exist.
- Do **not** create placeholder versions solely to align the branches.
- The visual result should make the different branch lengths and the point of the merge immediately understandable.

### 3.3 Comparison and Merge View

- Design a dedicated **comparison/merge view** that can be used both for inspecting differences and resolving merge conflicts.
- Display the **source version on the left** and the **target version on the right**.
- The resulting merged version should be shown as the result of the interaction, either as a preview or in a dedicated result area.

#### Comparison Layout and Behavior

- **Shared layout:** Corresponding entries should occupy the same relative positions in both versions whenever possible.
- **Stable geometry:** Unchanged entries should remain in approximately the same position and size even when other entries have been added or removed.
- **Explicit differences:** Visually distinguish **added, removed, modified, relocated, and unchanged** entries.
- **Structural changes:** Explicitly indicate when an entry has changed its parent or position within the hierarchy.
- **Linked interaction:** Selecting an entry in one version should highlight its corresponding entry in the other version.
- **Missing counterparts:** If an entry exists in only one version, explicitly indicate its absence in the other version rather than silently rearranging the layout.
- **Consistent sizing:** Corresponding entries should have comparable sizes whenever possible.
- **Conflict resolution:** When two versions contain conflicting changes to the same entry or hierarchy, allow the user to explicitly choose which change should be retained or combine the changes where possible.
- The comparison view should make it possible to understand the relationship between the two source versions and the resulting merged version before the merge is committed.
- The user must be able to **abort the merge** from the comparison/merge view without changing either source version.

## 4. Ping Mode

### 4.1 Ping Activation

- Clicking `Ping` in the hotbar activates **Ping Mode**.
- While Ping Mode is active, every left mouse button click on the canvas triggers a ping.
- `Alt` is **not required** while Ping Mode is active.
- Pressing `P` activates Ping Mode as an alternative to clicking the hotbar button.
- When Ping Mode is active, provide a clear visual indication that the mode is enabled.
- Clicking the `Ping` hotbar button again disables Ping Mode.
- Pressing `P` again also disables Ping Mode.
- Disabling Ping Mode restores the normal left-click behavior.
- Ping Mode should not interfere with dragging or other interactions that require holding the mouse button.

## 5. Version Navigation

### 5.1 Keyboard Navigation

- Add keyboard navigation for switching the active version.
- Use the **left and right arrow keys** to navigate along the current branch:
  - `←` activates the previous version when one is available.
  - `→` activates the next version when one is available.
- Within a branch, previous and next mean the immediately preceding and following versions by step number.
- Add **up/down arrow navigation** for switching between connected branches:
  - `↑` activates the corresponding version at the **same step number on the branch above**.
  - `↓` activates the corresponding version at the **same step number on the branch below**.
- If the corresponding branch does not contain a version at the current step number, activate the closest available version on that branch according to the existing branch layout.
- If multiple branches are available in the requested direction, use the branch ordering already defined for the version graph.
- If no suitable version exists in the requested direction, do nothing.
- Activating a version through keyboard navigation should use the same smooth focus/zoom animation as activating a version through the mouse.
- The active version should remain clearly highlighted after keyboard navigation.