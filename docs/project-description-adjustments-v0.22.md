# Performance investigations

1. Profile large treemaps and consider culling offscreen tiles and labels inside each version, while retaining drag, selection, and connector behavior.
2. Reduce the quadratic candidate generation and sorting for large groups of duplicate entry values, preserving their current connection choices.
3. Profile graph panning with many versions and copy links; consider a spatial index to avoid scanning every connection on each camera update.
4. Profile persistence and collaboration with large histories; investigate incremental serialization or updates without weakening conflict resolution.
5. Can the rendering be speed up by culling.
6. Look at the outline and dropshadow of connectors and check whether this can be optimized.
