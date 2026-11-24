# Performance improvement opportunities

These opportunities are based on the current implementation. Their impact will
vary with room size and hierarchy shape; profiling representative large rooms
would help prioritize follow-up work.

| Priority | Opportunity | Why it may help | Considerations |
| --- | --- | --- | --- |
| High | Avoid rebuilding and merging descendant maps in `flattenNodes` and `flattenPaths` ([tree.ts](../src/utils/tree.ts)). | Both helpers were creating and copying a new map at every recursive level. Deep trees therefore incurred repeated allocations and map-entry copies during comparisons, history changes, and hierarchy editing. They now populate one map in depth-first order. | Full path strings still grow with depth, and the traversal remains recursive. |
| High | Reduce the search cost in nested child layout ([treemap.ts](../src/utils/treemap.ts), `childLayouts`). | Uniform-sized siblings now score each possible column count in constant time and construct the selected grid once, avoiding repeated scans for common wide groups. | Heterogeneous child sizes still use exhaustive per-candidate scans to preserve layout quality. |
| Medium | Compute default positions in linear passes ([treemap.ts](../src/utils/treemap.ts), `defaultPositionsWithCache`). | Root dimensions, row/column maxima, and offsets are now computed in linear passes, avoiding per-column filters and repeated prefix sums. | The square-ish grid and root ordering are unchanged. |
| Medium | Reuse expensive tile layout results across repeated map operations ([treemap.ts](../src/utils/treemap.ts), `tilesForForest` and `tileForNode`). | Some operations lay out every tile again to find a single node or derive post-drag geometry. Large hierarchies can make these interactions expensive. | Cache invalidation must account for tree data, positions, ordering, and mutation; measure before adding persistent caching. |
| Medium | Reduce per-tile label measurement and component work ([TileLabel.vue](../src/components/TileLabel.vue), [VersionCard.vue](../src/components/VersionCard.vue)). | Label wrapping measures text and may hyphenate long words. Visible-tile virtualization already limits normal card rendering, but overview previews and frequent viewport changes can still repeat work. | Any cache key must include label, dimensions, and child status; avoid caching stale measurements or increasing memory without bounds. |
| Medium | Avoid serializing the entire room state for routine change detection ([useCollaboration.ts](../src/composables/useCollaboration.ts)). | The collaboration watcher builds JSON snapshots of the room state, potentially multiple times as versions grow. | Serialization currently supports reliable change detection; replace only with a correct, tested mutation/revision mechanism. |

The map rendering intentionally filters tiles to the visible canvas in
`VersionCard.vue`; preserving that virtualization is important when working on
treemap rendering.
