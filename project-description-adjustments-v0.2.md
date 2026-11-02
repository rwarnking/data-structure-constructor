**# List of Adjustments**

- If the same change is made between versions, it should not create a new version.
- Enable scroll-wheel zoom interactions.
- Zoom buttons should keep the center of the current view fixed at the center of the screen.
- Allow for a greater zoom range. It should be possible to zoom in such that a version window fills the screen. It should be possible to zoom out such that everything is visible even if it is tiny, do not allow to zoom out further.
- Scale text to fill its surrounding box as much as possible, so that it remains readable even when zoomed out significantly.
- Make connecting lines thicker, with a minimum width of 10 pixels.
- Fix the ordering of branches.
- Add spacing between floating trees (treemaps).
- Redesign version views to contain only a header bar and the treemap view. Combine the branch number, version number, and step number into a single header, for example: **B1 | V3 | S4 | Action Title (34 Entries)**.
- Make height and width identical for all version boxes but the root.
- Make the first version view span the full height of the view so that it remains selectable even after scrolling down significantly.
- In a treemap, a parent should always enclose its children. Therefore, a child box must always be smaller than its parent box.
- scale text in treemap nodes to be big as possible while fitting in the box
- add a context menu entry for adding a copyed element (there is only "select for copy")
- clicking on an element in a treemap should automatically make this version active
- allow for an optional description text for every entry of the treemap, adjusting the creation dialog and adding the description (only) as a tooltip