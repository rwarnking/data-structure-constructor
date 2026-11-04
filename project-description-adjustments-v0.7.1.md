## 1 Treemap

### Drag-and-Drop Rules

1. General Drag Behaviour

- An entry can be dragged by clicking and holding anywhere inside its visible area.
- A drag starts only after the cursor has moved beyond a small threshold (e.g. 5–8 px). This prevents accidental dragging when selecting an entry.
- Until the threshold is reached, the interaction is treated as a click.
- While dragging, show a preview of the entry at its prospective position. The preview must accurately reflect the resulting hierarchy and layout.
- The original entry remains visible in a subdued state until the operation is committed.
- The operation is only committed on release. Releasing outside a valid target or in an invalid position cancels the operation and restores the original layout.

2. Moving an Entry

- Move within the same parent: Drag an entry to an empty area inside its current parent. Nothing happens. The entry remains a child of the same parent.
- Move a top-level entry: Drag a top-level entry to an empty area within the version window. It remains a top-level entry.
- Moving an entry must not change its parent or affect its descendants.
- The system must prevent entries from overlapping. If the target position is occupied, neighbouring entries are moved out of the way to make room.
- The layout should change as little as possible: preserve the relative positions and sizes of unaffected entries wherever possible.

3. Attaching an Entry (Changing Its Parent)

- Drag an entry onto another entry to make it a child of that entry.
- The target entry must be a valid parent (i.e. the operation must not create a cycle by attaching an entry to itself or one of its descendants).
- The dragged entry becomes a child of the target, and the target expands or rearranges to accommodate it.
- The target parent must fully contain all its children, including the required padding.
- The dragged entry's descendants remain attached to it; the entire subtree is moved.
- To distinguish attaching from moving, the system should only interpret a drop as an attachment when the cursor is released inside the target entry's interior, not merely when the dragged entry overlaps its boundary.
- Show a clear visual indication of the prospective parent, such as highlighting its outline.

4. Detaching an Entry

- Drag a child entry outside the boundaries of its current parent and release it in an available area of the version window.
- The entry becomes a top-level entry, retaining its descendants.
- The new position is determined by the drop location, subject to the non-overlap and layout rules.
- If the cursor is released outside the version window, the operation is cancelled.
- An entry cannot be detached by dragging it into the padding area of its parent; it must be released outside the parent's actual boundary.

5. Moving an Entry Between Parents

- Drag a child entry out of its current parent and release it inside another valid parent.
- The entry becomes a child of the new parent.
- The same cycle-prevention and containment rules apply as for attaching.
- The old parent resizes or rearranges to account for the removed child.

6. Resizing and Layout During Dragging

- Parent entries must always fully contain their children, with consistent padding on all sides.
- Resizing a parent must resize or rearrange its children as necessary to preserve containment and prevent overlap.
- If a change causes entries to overlap, the system must automatically move the affected entries out of the way.
- Prefer moving the smallest possible number of entries and minimizing the total displacement.
- Unaffected entries should retain their relative positions and sizes wherever possible.
- All layout changes must be previewed during dragging, so the user can see the actual result before releasing the cursor.
- When elements are not visible in the canvas anymore due to layout changes the view should zoom out accordingly.

### Treemap Layout Rules

- All treemaps (outer treemap rectangles only) within a version must have the same aspect ratio as the version window.
- This aspect ratio must be maintained when treemaps are changed, preventing them from growing in only one dimension.
- Treemaps within the same version must never overlap.
- When a treemap changes size or position and would overlap another treemap, the system must automatically move the affected treemaps to available space.
- Prefer the smallest necessary displacement and preserve the existing relative arrangement of treemaps.
- Treemap layout must remain within the version window. If there is insufficient space, the view should zoom out rather than allowing treemaps to overlap.
- Each parent must fully wrap its children, with consistent internal padding. Children must never extend beyond the parent's boundaries.
- A parent must have sufficient space for its own minimum size, the padding, and all its descendants.
- Treemap children should populate the parent in both dimensions - children should not just be placed besides each other.