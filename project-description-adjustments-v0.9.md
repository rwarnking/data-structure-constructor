# List of Adjustments

## Versions

## 1. Version Layout and Navigation

### 1.1 Center All Elements

- Add a `Center All Elements` function to the version controls (three-dots menu).
- It should reposition all treemaps so that their **collective bounding box is centered** within the visible version canvas.
- Preserve the relative positions, sizes, and hierarchy of all elements.
- Automatically adjust the zoom level so that all treemaps fit within the viewport with a small, consistent padding.
- Use the **maximum zoom level at which all elements remain fully visible**.
- Do not modify the underlying treemap layout, hierarchy, or relative arrangement.

### 1.2 Compact Layout

- Add a separate `Compact Layout` function to the version controls (three-dots menu).
- It should rearrange all treemaps to **minimize unnecessary empty space** within the version canvas.
- Preserve the hierarchy and sizes of treemap entries.
- Prevent overlaps and maintain consistent spacing between treemaps.
- Unlike `Center All Elements`, this function may change the relative positions of treemaps.
- The resulting arrangement should be as compact as possible while keeping all entries readable and interactable.
- After rearranging the treemaps, center the resulting layout within the version canvas.

## 2. Version Transitions and Connections

### Copying Between Timelines

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

### Merge Branches

- Add the ability to merge two existing branches.
- A merge creates a **new version on the target branch** that combines the contents and changes from the selected source version and the target version.
- The original branches and all of their existing versions must remain unchanged.
- A merge must create explicit connections from **both source versions to the resulting merge version**, visually similar to a branch connection.
- A merge can be performed by simply combining the treemaps from both versions into the resulting version when there are no conflicts.
- Pressing `M` activates merge mode.
- Merge mode should work similarly to comparison mode:
  1. Activate merge mode.
  2. Select the target version.
  3. Select the source version.
  4. Open the comparison/merge view.
  5. Resolve conflicts or accept the combined result.
  6. Confirm the merge to create the new version.
- Any **version of a branch can be selected as the target** of a merge.
- If a version is selected as the target that is not the latest version of said branch a new branch is created with the result as the new version. Both origin branches should be connected via an connector line, visually similar to a branch connection.
- Any existing version of the source branch can be selected as the source of a merge.
- A merge must therefore be possible even if the source version is not the latest version of its branch.
- A merge operation must be **abortable at any point before confirmation** without modifying either branch.
- After a branch has been merged into another branch, the original branch remains active and can be continued with additional versions.
- The resulting merge version belongs to the target branch (unless the target was not the latest version of the branch).
- The merge must preserve the history of both branches through the two incoming connections.
- A version can be merged into other versions any number of times.

#### Merge Step Alignment

- Merge connections should align the source and target branches according to their **step count**.
- If the target branch has fewer steps than the source branch:
  - The newly created merge version on the target branch receives the next step number after the target branch's current last version.
  - The merge connection on the target side should span the corresponding missing steps until it reaches the source version.
- If the source branch has fewer steps than the target branch:
  - The merge version is still created as the next version of the target branch.
  - The merge connection from the source version should span the missing steps on the source side.
  - The connection may therefore extend beyond the source branch's current last version even though no intermediate source versions exist.
- The visual result should make the different branch lengths and the point of the merge immediately understandable.

### Comparison and Merge View

- Design a dedicated **comparison/merge view** that can be used both for inspecting differences and resolving merge conflicts.

#### Comparison Layout and Behavior

- **Shared layout:** Corresponding entries should occupy the same relative positions in both versions whenever possible.
- **Stable geometry:** Unchanged entries should remain in approximately the same position and size even when other entries have been added or removed.
- **Explicit differences:** Visually distinguish **added, removed, modified, relocated, and unchanged** entries.
- **Structural changes:** Explicitly indicate when an entry has changed its parent or position within the hierarchy.
- **Linked interaction:** Selecting an entry in one version should highlight its corresponding entry in the other version.
- **Missing counterparts:** If an entry exists in only one version, explicitly indicate its absence in the other version rather than silently rearranging the layout.
- **Consistent sizing:** Corresponding entries should have comparable sizes whenever possible.
- **Conflict resolution:** When two versions contain conflicting changes to the same entry or hierarchy, allow the user to explicitly choose which change should be retained or combine the changes where possible.
- The comparison view should make it possible to understand the relationship between both source versions and the resulting merged version before the merge is committed.
- Have the one version (source) on the left and the second on the right (target)
- The user must be able to **abort the merge** from the comparison/merge view without changing either source version.

## 5. Ping Mode

### Ping Activation

- Clicking `Ping` in the hotbar activates **Ping Mode**.
- While Ping Mode is active, every left mouse button click on the canvas triggers a ping.
- `Alt` is **not required** while Ping Mode is active.
- Pressing `P` activates Ping Mode as an alternative to clicking the hotbar button.
- When Ping Mode is active, provide a clear visual indication that the mode is enabled.
- Clicking the `Ping` hotbar button again disables Ping Mode.
- Pressing `P` again also disables Ping Mode.
- Disabling Ping Mode restores the normal left-click behavior.
- Ping Mode should not interfere with other explicitly defined interactions that require dragging or another mouse button.

## 6. Version Navigation

### Keyboard Navigation

- Add keyboard navigation for switching the active version.
- Use the **left and right arrow keys** to navigate between versions:
  - `←` activates the previous version when one is available.
  - `→` activates the next version when one is available.
- When navigating within a branch, the previous/next version means the immediately preceding/following version by step number.
- If there is no previous or next version on the current branch, continue navigation to a connected branch where a version with the **same step number** is available.
- For branch navigation:
  - down should move to the corresponding version at the same step on the below connected branch.
  - up should move to the corresponding version at the same step on the above connected branch.
- If multiple branches have a version at the same step, use the branch ordering already defined for the version graph.
- If no suitable version exists in the requested direction, do nothing.
- Activating a version through keyboard navigation should use the same smooth focus/zoom animation as activating a version through the mouse.
- The active version should remain clearly highlighted after keyboard navigation.