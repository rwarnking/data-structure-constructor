# Zooming, Interaction, Search, and Performance

Implement the following features and fixes while preserving all existing functionality.

## 1. Preset Zoom and Navigation Modes

Provide four distinct preset zoom/navigation modes. All modes should use the existing smooth navigation/focus animation where appropriate.

### 1.1 Focus on Version

Zoom and position the view so that the selected/active version is the primary focus.

- The selected version should be clearly visible and readable.
- Use the existing Focus behavior and smooth navigation animation.
- Do not change the underlying graph layout.
- The resulting viewport should remain interactive: the user can still pan and zoom normally.

### 1.2 Focus on Neighborhood

Zoom and position the view so that the selected/active version and its surrounding versions and branches are visible.

- Include the relevant neighboring versions before and after the focused version.
- Include relevant connected branches where possible.
- Do not unnecessarily show the entire graph.
- Preserve the existing graph layout and relative positions.

### 1.3 Focus on Height

Scale and position the graph vertically so that the **complete height of all branch lanes** fits within the available browser viewport.

- All branch lanes must be visible vertically.
- Horizontal content may extend beyond the viewport.
- Preserve the graph's existing aspect ratio and relative positions.
- Do not modify or recompute the underlying graph layout merely to make it fit.
- The available viewport should account for UI elements such as the sidebar and other persistent controls.

### 1.4 Show Everything

Zoom and position the graph so that the **entire currently visible version graph** fits within the available browser viewport.

- All relevant branches and versions must be visible.
- Preserve the graph's relative layout.
- Do not modify the underlying graph layout.
- Account for the actual available canvas area rather than the full browser window.
- Avoid unnecessary empty space where possible.

### 1.5 Responsive Focus Behavior

Focus and zoom operations must respond correctly to changes in the available canvas size.

- When the browser window or canvas is resized, the current focused version must remain correctly positioned.
- If the application is currently focused on a version, recalculate the viewport as necessary after a resize.
- Do not unexpectedly reset the user's zoom or pan state when no focus mode requires recalculation.
- Test all focus modes at different browser resolutions and aspect ratios.

### 1.6 Focus Animation

- Test the intermediate animation states, because there might be something off.
- Avoid visible jumps, flickering, incorrect scaling, or temporarily incorrect positioning.
- The graph should remain correctly aligned throughout the animation.
- Interrupting an animation with a new pan, zoom, focus, or navigation action should not leave the viewport in an invalid state.

---

# 2. Search

Add a graph search function that can be activated with **`Ctrl+F`**.

## 2.1 Search Activation

- Pressing **`Ctrl+F`** opens the application's search interface.
- Prevent the browser's default page-search behavior when the application search is invoked.
- When focus is inside an editable text field, preserve the normal browser/text-field behavior unless the application search is explicitly invoked from outside the editor.
- The search interface should be dismissible using the existing UI conventions and `Escape`.

## 2.2 Search Targets

The search should allow users to search for a **specific version**.

- Search by the version's complete identifier.
- Provide **three separate input fields**, corresponding to the three components of the version identifier.
- Display the separating dots statically between the fields rather than requiring the user to enter them.
- Searching should begin only once at least one of the three fields contains a value.
- Show all matching versions in a result list.
- Matching should work when only part of the version identifier is specified.
- Selecting a result should focus the corresponding version.
- If the matching version is outside the currently visible viewport, navigate to it using the existing smooth focus/navigation behavior.
- The search should work across all branches and versions currently present in the graph.

## 2.3 Recent Searches

When the search interface is opened, show the **three most recently searched items**.

- Recent searches are stored **per user**.
- Store them using the existing local-storage mechanism.
- The three most recent searches are ordered newest first.
- Repeating an existing search moves it to the top instead of creating a duplicate.
- Limit the stored/reported recent searches to three.
- Recent searches must persist between sessions.
- Recent searches must never be shared with or synchronized to other collaborators.

---

# 3. Entry Context Menu: Add Parent

Add an **Add Parent** action to the existing right-click/context menu for entries.

### Single Selection

When one entry is selected:

- Add a new entry as its parent.
- The selected entry becomes a child of the newly created parent.
- Preserve the existing entry and its data.
- The new parent should follow the normal rules for creating and modifying entries.

### Multiple Selection

When multiple entries are selected:

- Add exactly one new entry.
- Make the new entry the parent of **all currently selected entries**.
- Preserve the existing hierarchy and entries otherwise.
- The selected entries should all become children of the newly created parent.
- The operation should behave like adding a new entry and then attaching all selected entries to it.
- Ensure that invalid selections or hierarchy constraints are handled consistently with the existing drag-and-drop rules.
- If the entries are already attached to something, attach the new entry to the previous parent.

---

# 4. Sidebar Settings Menu

Add a **cogwheel/settings button** to the sidebar.

Use this menu for application-wide settings and utility actions.

Move the existing **Dark/Light Mode** control into the cogwheel menu.

The settings menu should also provide:

- **Dark/Light mode**
- **Import data**
- **Export data**

Keep the sidebar itself uncluttered by moving these secondary controls into the settings menu.

---

# 5. Complete Data Import and Export

Add functionality to import and export the **complete application data** through the settings/cogwheel menu.

### Export

Export all data required to fully reconstruct the current application state, including where applicable:

- Versions and branches.
- Complete hierarchy/entry data.
- Version relationships.
- Copies and copy connectors.
- Merge/split information.
- Room-related data that belongs to the current dataset.
- Any other persistent application state necessary to reconstruct the graph.

The exported data should be self-contained and use a documented/stable format.

### Import

Allow the user to import a previously exported dataset.

- Restore the complete graph and hierarchy.
- Preserve version identifiers and relationships.
- Preserve copies, connectors, branches, and other relevant metadata.
- Validate imported data before replacing the current state.
- Do not partially overwrite the current state if the imported data is invalid.
- Clearly handle import errors.

Import/export should not unintentionally affect another collaborator's data or room state unless the imported data is explicitly applied to the shared room.

---

# 6. Box Selection

Add rectangular **box selection** to the version window.

- The user can click and drag on the empty area to create a rectangular selection box.
- Automatically select all entries whose selectable area is contained within or intersects the selection box, following the application's existing selection semantics.
- Clearly visualize the selection rectangle while dragging (dashed line).
- Existing selections should behave consistently with the application's current multi-selection behavior.
- Starting a click on an entry rather then empty space should trigger dragging that entry instead of the box select.
- Box selection must work at different zoom levels and after panning.

---

# 7. Move Multiple Selected Entries

Allow all currently selected entries to be moved as a group.

- Dragging one selected entry should move the entire current selection when multiple entries are selected.
- Preserve the relative positions/relationships of the selected entries during the movement.
- Apply the existing hierarchy/attachment rules consistently to the entire selection.
- If the target is invalid, restore all selected entries to their previous state.
- Do not accidentally move unselected entries.
- The operation should work with both manually selected entries and entries selected through box selection.
- Ensure that moving multiple entries does not create invalid hierarchy states or duplicate relationships.

---

# 8. Responsive Behavior and Resolution Testing

Review all zoom, focus, selection, and navigation behavior for different viewport sizes.

Test at multiple:

- Browser window sizes.
- Screen resolutions.
- Aspect ratios.
- Zoom levels.
- LOD levels.
- Numbers of branch lanes.
- Graph sizes.

Pay particular attention to:

- Focus positioning.
- Focus animation.
- Canvas resizing.
- Sidebar interaction.
- Box selection.
- Multi-entry movement.
- Connector positioning.
- Version-card positioning.
- Navigation controls.

The application should use the **actual available canvas dimensions** rather than assumptions about a particular browser or screen size.

---

Add tests for the new functionality and fixed bugs where practical.
