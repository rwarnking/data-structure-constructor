# List of Adjustments

## 1. Treemap Interaction and Editing

### 1.5 Application Interaction Rules

Define and implement consistent mouse and keyboard interactions throughout the application.

**Version graph (outside version windows):**
- Single-click on a version: Select and activate the version.
- Double-click on a version: Activate it, then smoothly center and zoom into it (animated).
- Drag on empty canvas: Pan the overall version graph.
- Scroll on empty canvas: Zoom the overall version graph.

**Version canvas (inside a version window):**
- Single-click on an entry: Select the entry and activate its containing version.
- Single-click on an selected entry: Deselect the entry.
- Single-click on empty canvas: Clear the current entry selection.
- Double-click on an entry: Open the entry for editing.
- Double-click on an empty version canvas: Activate and focus its version.
- Drag an entry onto another valid entry: Attach it as a child of the target entry.
- Drag an attached entry onto empty canvas: Detach it and make it a free-floating treemap.
- Drag on empty canvas with **Shift + left mouse button**: Pan the version canvas.
- Scroll on the version canvas with **Shift + scroll wheel**: Zoom the version canvas.
- Regular scrolling inside a version canvas should not unexpectedly trigger zooming or panning of the version canvas.

**General interaction rules:**
- A click must not accidentally trigger a drag.
- A double-click must not trigger two independent single-click actions.
- Modifier-key interactions must take precedence over ordinary canvas interactions.
- All interactions should have consistent visual feedback and predictable results.
- key arrows can be used to change active version
- when key arrows are used and an active version is centered change the active version and center the new one

## 3. Version Transitions and Animations

### 3.1 New Version Creation !

- Add a transition animation when a new version is created.
- The animation should visually communicate the relationship between the previous version and the newly created version.
- Suggested animation:
  1. Create the new version window as an overlay on top of the previously modified version.
  2. Gradually move the new version window alongside the branch connection arrow.
  3. Extend the branch connection line during the animation until it reaches the new version's final position.
  4. Finish with the new version in its final position within the version graph.
- The animation should make the creation of a new version understandable without interrupting ongoing interaction.
- Ensure that the final layout is independent of the animation.

## 4. Version Comparison and Branch Operations

### 4.1 Highlight Version Differences !!

- Introduce a visual mechanism for identifying differences between two consecutive versions.
- Highlight the following changes:
  - Added entries.
  - Removed entries.
  - Modified entries (e.g., changed names or values).
  - Relocated entries (changed parent or hierarchy position).
  - Unchanged entries.
- Distinguish between structural changes (hierarchy changes) and content changes (value/name changes).
- The visualization should allow users to understand what changed without manually comparing both versions.
- Difference highlighting should be optional and toggleable.
- Use a consistent visual encoding for all difference types.

## 7. Performance

### 7.1 Viewport-based Rendering

- Only render elements that are currently visible within the viewport, including partially visible elements.
- Avoid rendering off-screen versions and treemap elements unnecessarily.
- Implement viewport-based rendering (virtualization/culling).
- Preserve the correct positions, dimensions, hierarchy, and application state of elements that are temporarily not rendered.
- Ensure that elements become visible immediately when they enter the viewport through panning or zooming.
- Account for animations and drag operations so that elements are not incorrectly removed from rendering while being interacted with.
- Use an appropriate visibility margin around the viewport to avoid visible pop-in during panning and zooming.

### 7.2 Further performance investigations

1. Profile large treemaps and consider culling offscreen tiles and labels inside each version, while retaining drag, selection, and connector behavior.
2. Reduce the quadratic candidate generation and sorting for large groups of duplicate entry values, preserving their current connection choices.
3. Profile graph panning with many versions and copy links; consider a spatial index to avoid scanning every connection on each camera update.
4. Profile persistence and collaboration with large histories; investigate incremental serialization or updates without weakening conflict resolution.

## 8. Misc

- add short paper comparisson graph as alternative visual (for comparisson but also in the timeline view)
- outline+dropshadow in darkmode

- branches are not straightly numbered

## 8

- copy entry connector line is sometimes changing on zoom