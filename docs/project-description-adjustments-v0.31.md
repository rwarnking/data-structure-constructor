# Adjustments

- **Treemap tooltip in LOD 2**
  - When hovering over a version in LOD 2, the treemap tooltip should **not overlap the version from which the treemap originates**.
  - Position the tooltip so that the origin version remains visible and unobstructed.

- **Zooming mode 3: active version positioning**
  - In zooming mode 3, the **active version should always be centered**.
  - Currently, the active version is sometimes off-center, particularly when the version graph contains only a few branches.
  - Check the centering/layout calculation for cases with a small number of branches and ensure that the active version is positioned at the intended center of the viewport.
  - The zoom level seems to be correct, only the viewing positions seems to be off.

- **Minimum treemap size for deeply nested hierarchies**
  - In some cases, the third depth level of a treemap is rendered only as a very thin line because the available space becomes too small.
  - Ensure that every treemap node has a **minimum size of 30 × 30 px**.
  - This should apply to nested nodes as well, so that deeper levels remain visibly distinguishable.
  - Example hierarchy:
    `a[b,c[d[e]]]`
  - In this example, `e` should still have at least a 30 × 30 px area rather than collapsing into a line.
  - If the available space is insufficient to satisfy the minimum size, adjust the parent dimensions accordingly rather than rendering the child below the minimum size.

# Adjustments 2

- **Zoom level 4 → zoom level 3**
  - When switching from **zoom level 4 (fit all versions)** to **zoom level 3 (fit height)**, the **active version must remain visible and centered**.
  - It is acceptable for the active version to be off-screen when the user manually pans or zooms.
  - However, when the viewport changes automatically as a result of switching between zoom levels, the active version should always be used as the **centering reference**.

- **Version tooltip positioning**
  - The version tooltips that contain the **preview of the treemaps** still have a positioning issue when the corresponding version card is far to the right of the viewport.
  - In these cases, the tooltip is currently positioned so that it **overlaps the version card**.
  - If there is insufficient space to display the tooltip on the default side, position it on the **opposite side of the version card** instead.
  - The tooltip should always remain fully within the viewport and should not obscure the version card it belongs to.