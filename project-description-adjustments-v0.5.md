# List of Adjustments

## Version Treemap

- Each version window can contain an arbitrary number of treemaps.
- A treemap can contain an arbitrary number of entries; a treemap may therefore consist of only a single leaf node.
- Treemaps can be freely positioned within the version canvas by dragging them.
- Treemaps should retain their manually assigned positions unless an explicit hierarchy change requires a layout update.
- Zooming the version canvas should be possible using **Shift + scroll wheel**.
- Panning the version canvas should be possible using **Shift + left mouse button**.
- No scrollbars should be visible.
- Each version canvas must maintain its own:
  - panning position
  - zoom level
- When opening a version for the first time, the canvas should automatically choose a zoom level and panning position that make all treemaps visible.
- After the user has manually changed the zoom or panning position, opening or modifying the version should not unexpectedly reset the view.
- Treemaps should have a minimum size to ensure that their contents remain readable and interactable.

## Treemap Dragging and Hierarchy

- Dragging a treemap freely within the canvas should only change its position.
- Dragging a treemap onto another treemap should make the dragged treemap a child of the target treemap.
- The complete dragged subtree should be moved when a treemap containing children is dragged.
- While dragging, show a preview of the resulting hierarchy.
- The preview should be stable and must not flicker when the pointer moves within the same drop target.
- Only the currently valid drop target should be highlighted.
- Dropping onto the canvas background should leave the hierarchy unchanged if the dragged treemap was already free-floating.
- If a treemap is currently attached to another treemap, dropping it onto the canvas background should detach it and make it a free-floating treemap.
- Invalid drops, such as dropping a treemap onto itself or one of its descendants, should be rejected and the treemap should return to its previous position.

## Positioning Newly Added Treemaps

- When a new treemap is created, it should be positioned automatically in the nearest available free space rather than simply being placed at a fixed coordinate.
- The automatic placement should **not rearrange existing treemaps**. Existing manually positioned elements should remain where the user placed them.
- The new treemap should be placed close to the element from which it was created, if such an origin exists.
- If there is no meaningful origin, place the new treemap near the center of the currently visible canvas area.

### Recommended placement strategy

1. **Determine the preferred position**
   - If the new treemap originates from an existing entry, use that entry as the anchor.
   - Otherwise, use the center of the current viewport as the anchor.

2. **Generate candidate positions around the anchor**
   - Try positions directly to the right of the anchor first.
   - If that space is occupied, try positions below, left, and above the anchor.
   - Continue outward in an expanding rectangular/spiral pattern.

3. **Check for overlap**
   - A candidate position is valid only if the new treemap does not overlap any existing treemap.
   - Maintain a small, consistent gap between treemaps.
   - Candidates that would place the treemap partly outside the current canvas bounds should trigger canvas expansion rather than moving existing elements.

4. **Choose the closest valid position**
   - Select the valid candidate with the smallest distance from the preferred position.
   - This produces a predictable layout while avoiding unnecessary movement of existing content.

5. **Expand the canvas if necessary**
   - If no suitable position exists within the current canvas, expand the canvas in the direction of the closest candidate.
   - The new treemap is then placed there.
   - Existing treemaps are never moved solely because a new treemap was added.

## Canvas Bounds

- An element can not be moved outside the window. Moving an element beyond the current bounds should NOT expand the canvas.
- The canvas should always retain a minimum amount of empty space around its outermost treemaps so that they can still be moved freely.