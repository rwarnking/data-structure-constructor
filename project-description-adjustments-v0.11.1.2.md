
## 2. Dragging

Refine the dragging interaction so that selection, previews, hierarchy changes, and layout updates remain predictable throughout the entire drag operation.

### 2.1 Starting a Drag

- When a drag starts, the dragged entry should immediately become selected.
- Starting a drag must **not** create a new version. Dragging only modifies the current version when the drag is successfully completed.
- The dragged entry and its entire subtree move together.
- While dragging, the descendants of the dragged entry must **not** be highlighted as potential targets.

### 2.2 Original Position Indicator

- Keep a dashed outline at the dragged entry's original position for the entire duration of the drag.
- The original-position outline must remain visually distinct from the normal selection/highlight stroke.
- It must **always remain dashed**, regardless of what the dragged entry is currently hovering over.
- Hovering over another entry must not replace or change the original-position indicator.
- The dashed outline should have approximately the same stroke thickness as the normal entry border.
- By default, use a white/black stroke for the dashed outline, depending on the application's existing light/dark styling.
- When the corresponding entry is selected, use the user's collaboration color where appropriate.
- When the corresponding entry is hovered on, use the existing highlight color.
- If the original-position outline is partially covered by other geometry, preserve the intended visual distinction as far as possible. In particular, the outline must remain visible when the original entry is a child of another entry.
- set the stroke attribute to white/black by default and adjust it to the user color when selected and the hightlight color when highlighted
.tree-tile {
    stroke: ;
    transition: filter .12s;
}

### 2.3 Dragged Entry Appearance

- The dragged entry should remain visually distinct from the original-position indicator.
- The dragged entry should be rendered above other entries while it is being dragged.
- When the dragged entry is hovering over a valid target, highlight the **target**, not the descendants of the dragged entry.
- Dragging over an invalid target, including the dragged entry itself or any of its descendants, must not produce an attach preview.

### 2.4 Hierarchy and Parent Handling

- If the dragged entry currently has a parent, its existing parent-child relationship must remain unchanged until the drag is successfully completed.
- Do not resize the original parent merely because an entry is being dragged.
- Do not resize or otherwise modify the hierarchy of the original parent during the drag preview.
- If the drag is canceled, the original hierarchy and layout must be restored unchanged.
- If the entry is successfully detached or attached elsewhere, update the hierarchy and affected layouts only when the drop is committed.
- Dragging must never create a cycle. An entry cannot be attached to itself or to any of its descendants.

### 2.5 Layout During Dragging

- During the drag, use the **original dimensions of the dragged entry/subtree** when determining whether a potential drop position is valid.
- Do not continuously resize the dragged entry merely because its potential parent or target changes.
- The dragged object's size should be recalculated only after the drag operation has been successfully completed and the hierarchy has changed.
- The size of the original parent should likewise only be updated after the drag has been committed.
- This ensures that the user can reliably judge whether the dragged object fits before releasing it.

### 2.6 Parent/Child Ordering

- Entries that share a parent should be positioned automatically by the layout system.
- Their ordering and arrangement must not depend on manually positioning individual children.
- When children are added, removed, attached, or detached, the affected parent's layout should be recalculated automatically.
- Do not treat manual dragging as permanently fixing the relative ordering of siblings.
- Re-layout should preserve the existing hierarchy and avoid unnecessary changes to unaffected entries where possible.

### 2.7 Entry Layout and Aspect Ratio

When calculating the layout of an entry that contains children:

- Use the aspect ratio of the containing **version view** as the target aspect ratio for the child layout.
- Arrange the children efficiently in both dimensions rather than producing unnecessarily long rows or columns.
- After fitting the children, remove unnecessary empty space in either width or height.
- The resulting parent should therefore remain reasonably close to the version view's aspect ratio while being as compact as possible around its children.
- The parent must still provide the required padding around its children.
- Do not distort or shrink children below their minimum readable size merely to achieve the target aspect ratio.
- If the desired aspect ratio cannot be achieved without violating minimum sizes or hierarchy constraints, prioritize valid child sizes and hierarchy over the exact aspect ratio.

### 2.8 Preview and Zoom

- If evaluating a drag preview requires zooming the version view out so that the potential result can be displayed, allow the view to zoom out.
- Once the view has been zoomed out because of the drag preview, **do not automatically zoom it back in when the drag ends**.
- The resulting zoom level should therefore remain available after the operation is completed or canceled.
- Dragging must not unexpectedly change the user's viewport position except where necessary to keep the drag preview visible.
- Ignore version view padding at the borders during layout preview

### 2.9 Drop Result

The visual preview must accurately represent the operation that will occur on release:

- **Valid target:** release attaches the dragged subtree to that target.
- **Valid empty-space move:** release moves the subtree while preserving its parent relationship, unless the existing detach rules require a detach.
- **Valid detach:** release detaches the subtree according to the existing detach behavior.
- **Invalid target:** no attachment occurs.
- **Release outside the valid version/canvas:** cancel the operation and restore the original hierarchy and position.

After a successful drop:

1. Commit the hierarchy change.
2. Recalculate the affected parent/child layouts.
3. Recalculate the dragged object's size if necessary.
4. Resolve any resulting layout changes.
5. Update duplicate-value indicators and other dependent visualizations.


- allow only one entry to be highlighted always. The highlighted entry should be the one in which is merged.
- the dashed outline should signal the original position (source location)
- all outlines should have stroke-width: 3;
- highlight and selection stroke-width should scale with zoom level upto 15

when highlighting or hovering actually change the stroke of the entry. when zoomed in the outline should be 3px, when zoomed out it should be 10px, increase the thickness gradually