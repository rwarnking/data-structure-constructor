# Treemap Interaction and Editing

Implement the following changes to treemap entry interaction and dragging behavior.

## 1. Duplicate Value Indication

Within a single version, visually connect entries that have exactly the same value.

- Draw a connection arrow between entries with identical values.
- Only compare entries within the same version. There should be no cross-version connections.
- The connection must not obscure entry labels or interfere with selection, dragging, or other interactions.
- Update the connections whenever an entry is:
  - renamed,
  - added,
  - deleted,
  - moved,
  - attached to another entry, or
  - detached from its parent.
- If more than two entries have the same value, connect all entries belonging to that group.

## 2. Dragging and Overlap Behavior

Refine dragging so that moving, attaching, and detaching entries is predictable and the final result always matches the visual preview.

### General dragging

- A small pointer-movement threshold should be required before a click becomes a drag. This prevents accidental dragging when selecting an entry.
- While dragging, keep a dashed outline at the entry's original position so the original location remains visible.
- The dragged entry/subtree should follow the pointer.
- The entire subtree must move together when a non-leaf entry is dragged.
- Temporary overlap with other entries is allowed while dragging.
- The dragged entry should be rendered above other entries while it is being dragged.

### Dragging onto an entry

- When the dragged entry is over another valid entry, show a clear attach/drop preview.
- Releasing over the target attaches the dragged entry as a child of that target.
- The preview must show the same hierarchy and resulting position that will be produced by the drop.
- The dragged subtree must not be attached to itself.
- If the dragged entry is dropped onto one of its own descendants (child, grandchild, etc.), do not show an attach preview and do not allow the attachment. Treat the interaction as a normal move instead.
- Prevent any operation that would create a hierarchy cycle.

### Dragging onto empty space

- When dragging over empty space without overlap, show a move preview at the resulting position.
- Releasing there moves the entry while preserving its current parent relationship.
- If moving a child outside the bounds of its current parent constitutes a detach according to the existing hierarchy rules, show the corresponding detach preview and detach it on release.

### Dragging onto occupied space without attaching

- If the pointer is over occupied space but the target is not a valid attachment target, do **not** automatically attach the entry.
- Show the dragged entry above the existing entries temporarily.
- Do not rearrange or modify the other entries during the drag.
- If the resulting position would overlap existing entries, releasing should cancel the move and restore the entry to its original position and hierarchy.
- The original dashed outline should remain visible throughout the drag so this cancellation behavior is clear.

### Canceling a drag

- If the pointer is released outside the current version, cancel the operation.
- Restore the dragged entry/subtree to its original position and hierarchy.
- No changes should be committed to the data structure.

### Preview consistency

The visual preview during dragging must accurately represent what will happen on release:

- Attach preview → release attaches.
- Move preview → release moves.
- Detach preview → release detaches.
- Invalid/cancel preview → release restores the original state.

Do not perform a different layout or hierarchy operation after release than the one indicated by the preview.


## 1. Duplicate Value Indication

- Show a connection indicator between entries with identical values.
- If a duplicate entry is also a child of another duplicate entry, show only **one indicator** for that relationship; do not create multiple overlapping indicators.
- Do **not** use arrowheads. The indicator should be a simple connection line.
- The indicator must not obscure entry labels or interfere with selection, dragging, or other interactions.
- Update the indicators whenever entries are added, deleted, renamed, moved, attached, or detached.
