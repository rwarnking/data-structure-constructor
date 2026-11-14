**# List of Adjustments**

- Pruning a branch should automatically adjust the layout. The space previously occupied by the pruned branch should be filled by relocating the remaining branches.
- Branch sorting is currently not working and should be fixed. Sort by branching position, with most recent branching position being nearest to the main branch, and afterwards by lenght of branch, longest being nearest to the main branch.
- The longest branch should be centered and displayed as a straight line: **V1 → V2 → V3 → ...**
- The root should always span the full height of the canvas. The root should effectively have infinite height.
- Connecting lines should be approximately one-third of the height of the version boxes. Add a drop shadow to the connecting lines.
- Connecting lines should have no curvature while crossing other branch "lanes". Instead, the curvature should consist of two 90-degree bends: one at the beginning and one at the end. The curved sections should end once the line reaches the height of the corresponding version box.
- Add a border/outline to the connecting lines.
- **Treemap:** Add empty space around all elements within the version view so that elements can be moved toward the edges. If an element reaches the edge of the version view, the view should expand accordingly, effectively behaving like an infinite canvas. The canvas should only expand when an element is moved beyond its current boundaries. When an element is moved back, the canvas should shrink again to the smallest size that still contains all elements.
- **Treemap:** A single leaf node should have approximately the same size as a leaf node in a hierarchy containing two or three nodes. Its size should not increase or decrease simply because it is the only node.
- In a treemap, a parent should always enclose its children. Therefore, a child box must always be smaller than its parent.
- Remove divider lines between treemap entries; use only the enclosing/wrapping boxes to represent the hierarchy.
- A three-level treemap should not have the same overall size as a single leaf. A standalone leaf should have a size comparable to a leaf within a hierarchy, but the sizes do not need to be identical.
- Let LOD 2 start at the same zoom level at which LOD 3 currently starts, and let LOD 3 start at approximately 35% zoom. Adjust the font size for LOD 3 accordingly, since there is a lot of available space but relatively little text, which is largely fixed.