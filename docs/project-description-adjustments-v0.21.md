## 3. Version Transitions and Animations

### 3.1 New Version Creation

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

### 4.1 Highlight Version Differences

Instead of using the outline to highlight hover or currently selected entry use the fill color.
Then use the outline to identify differences between two consecutive versions.

- Highlight all entries that were:
  - Added
  - Modified
  - Relocated
  - Merged
  - resulting entries from a split

## 7. Performance

### Performance investigations

1. Profile large treemaps and consider culling offscreen tiles and labels inside each version, while retaining drag, selection, and connector behavior.
2. Reduce the quadratic candidate generation and sorting for large groups of duplicate entry values, preserving their current connection choices.
3. Profile graph panning with many versions and copy links; consider a spatial index to avoid scanning every connection on each camera update.
4. Profile persistence and collaboration with large histories; investigate incremental serialization or updates without weakening conflict resolution.
5. Can the rendering be speed up by culling.
6. outline+dropshadow of connectors