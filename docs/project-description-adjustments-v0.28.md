# Adjustments

## Version Layout

### Moving Entries

- Dragging an entry onto itself must be treated as a **move operation**, not an attach operation.
- Dragging an entry onto one of its **descendants** must likewise be treated as a **move operation**, not an attach operation.
- In both cases, the entry should be moved from its current position to the new position rather than becoming a child of itself or one of its descendants.
- The drag interaction should remain active continuously while moving the entry from its original position to the new position.
- Only treat the operation as an **attach** when the dragged entry is dropped onto a valid target that is not the dragged entry itself and is not one of its descendants.
- Prevent overlap when an entry is attached to another. Overlap after manual dragging is fine, but when an entry needs more space move other entries out of the way.
- **Prevent overlap when attaching entries.**
  - Overlap caused by manual dragging is allowed.
  - When an entry is attached to another entry and the resulting treemap needs additional space, automatically move conflicting treemaps out of the way.
  - Do not resize or reposition unrelated treemaps unless necessary to resolve the conflict.

- **Move conflicting treemaps in the direction of expansion.**
  - Determine the direction in which the affected treemap expands.
  - Move only treemaps that overlap the newly expanded area and are on the corresponding side of the expanding treemap.
  - Preserve the relative positions of the moved treemaps.

- **Expansion downward:**
  - If a treemap expands downward, identify treemaps below it whose horizontal extent overlaps the expanding treemap.
  - Move those treemaps **downward** by the minimum distance required to resolve the overlap.
  - If moving one of these treemaps creates a conflict with another treemap, recursively apply the same rules to the affected treemap.

- **Expansion upward:**
  - If a treemap expands upward, identify treemaps above it whose horizontal extent overlaps the expanding treemap.
  - Move those treemaps **upward** by the minimum required distance.
  - Resolve any resulting conflicts recursively.

- **Expansion to the right:**
  - If a treemap expands to the right, identify treemaps to its right whose vertical extent overlaps the expanding treemap.
  - Move those treemaps **to the right** by the minimum required distance.
  - Resolve any resulting conflicts recursively.

- **Expansion to the left:**
  - If a treemap expands to the left, identify treemaps to its left whose vertical extent overlaps the expanding treemap.
  - Move those treemaps **to the left** by the minimum required distance.
  - Resolve any resulting conflicts recursively.

- A treemap should only push another treemap if their **projected bounding areas overlap** in the direction of expansion.
- When moving a group of treemaps, move the entire affected group together rather than changing their relative positions.
- Use the **minimum necessary displacement** to resolve each conflict.
- The conflict-resolution process must terminate and must not cause oscillating movements between treemaps.
- Have a failsave for that, allowing each treemap to be repositioned only once, afterwards overlaps are allowed.
- After automatic repositioning, manually created overlaps elsewhere in the version should remain unchanged.

### Overlapping Treemaps

- Allow treemaps within a version to **overlap spatially**.
- Overlapping treemaps must **not automatically displace, resize, or reflow each other**.
- Do not make overlapping treemaps transparent. Each treemap should retain its opacity.
- Existing attach/drop behavior must continue to work when treemaps overlap.
- The treemap currently under the cursor should remain the active interaction target, even when it overlaps another treemap.
- Ensure that hit testing uses the appropriate z-order so that the user can reliably interact with the intended treemap/entry.

### Indicating Overlap

- Give all treemaps a **dotted black outline** that are stacked on top of an other treemap.
- The lastly dragged entry should be on top, being the top most entry and overdrawing over others (this treemap would get a dotted outline after a drop).

### Automatic Version-View Zooming

- After an entry has been moved the version window should not shrink in any case, but the treemap view should zoom in as much as possible.
- Preserve the existing content visibility and provide a reasonable margin around the resulting treemap layout.
- Only zoom the treemap view when this does not unnecessarily hide or clip existing content.
- Do not zoom the treemap view during the drag operation; adjust it **after the move has been committed**.

## Search

- Remove the "search" button in the search menu
- save last made searches. A search should be saved, when the user has clicked on a result to look at it. Save the searched element and the result that was clicked on.

## Tests

- Add tests where it seems appropriate
