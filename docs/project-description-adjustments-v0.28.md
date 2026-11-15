# Adjustments

## Version Layout

### Moving Entries

- Dragging an entry onto itself must be treated as a **move operation**, not an attach operation.
- Dragging an entry onto one of its **descendants** must likewise be treated as a **move operation**, not an attach operation.
- In both cases, the entry should be moved from its current position to the new position rather than becoming a child of itself or one of its descendants.
- The drag interaction should remain active continuously while moving the entry from its original position to the new position.
- Only treat the operation as an **attach** when the dragged entry is dropped onto a valid target that is not the dragged entry itself and is not one of its descendants.

### Overlapping Treemaps

- Allow treemaps within a version to **overlap spatially**.
- Overlapping treemaps must **not automatically displace, resize, or reflow each other**.
- Do not make overlapping treemaps transparent. Each treemap should retain its normal appearance and opacity.
- Existing attach/drop behavior must continue to work when treemaps overlap.
- The treemap currently under the cursor should remain the active interaction target, even when it overlaps another treemap.
- Ensure that hit testing uses the appropriate z-order so that the user can reliably interact with the intended treemap/entry.

### Indicating Overlap

Because overlapping treemaps remain opaque, provide a clear visual indication of their stacking relationship without changing their opacity.
- Give the currently selected or interacted-with treemap a **dotted black outline**
- During dragging, highlight the treemap/entry that would receive the drop.

### Automatic Version-Window Resizing

- After an entry has been moved, automatically shrink the version window if the resulting layout allows it to be smaller.
- Only shrink the window when this does not unnecessarily hide or clip existing content.
- Preserve the existing content visibility and provide a reasonable margin around the resulting treemap layout.
- Do not resize the version window during the drag operation; adjust it **after the move has been committed**.

## Search

- Remove the "search" button in the search menu
- save last made searches. A search should be saved, when the user has clicked on a result to look at it. Save the searched element and the result that was clicked on.

## Tests