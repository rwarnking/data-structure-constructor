# List of Adjustments

# Tutorial, Tags, Configuration, and Additional Fixes

## Application Interaction Rules

Check whether these are consistent with the current implementation:

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
- when key arrows are used and an active version is centered, change the active version and center the new one

## 1. Interactive Tutorial / Story Mode

Add an interactive tutorial that introduces the most important functionality of the application.
The tutorial should guide new users through the application step by step rather than being a static help page.
Make the tutorial accessible via an circle with an ! in it at the top right, on which one can click

### Tutorial Content

The tutorial content must be defined **outside of the application logic**, preferably in a JSON file or another simple, structured data format.

The application should load and interpret the tutorial definition at runtime.

The content format should support at least:

- Tutorial steps.
- Titles/headings.
- Descriptive text.
- Images/illustrations.
- Ordered and unordered lists.
- Highlighting or pointing to specific UI elements.
- Instructions for user actions.
- Optional completion conditions.
- Optional actions that the tutorial can trigger or demonstrate.

Avoid hard-coding individual tutorial steps directly into Vue components.
You may add and use a library for this.

### Story Mode

Design the tutorial system so that it can later be used for a more general **story mode**.

For example, a story could contain:

1. Narrative text.
2. An image.
3. An explanation of a concept.
4. A task for the user to perform.
5. A condition that must be fulfilled before continuing.
6. The next story/tutorial step.

The implementation should therefore be a reusable content-driven system rather than a collection of hard-coded tutorial dialogs.

The tutorial should support:

- Next/previous navigation.
- Skipping or exiting the tutorial.
- Restarting the tutorial.
- Progress indication.
- Highlighting relevant UI elements where appropriate.

Do not over-engineer the initial content format. Keep the schema simple and extensible.

---

# 2. Version Tags

Allow users to attach a **tag** to any version.

Each version may have at most one tag.

A tag consists of:

- A short text/title.
- A longer description.

### Visual Indicator

A tagged version should display a recognizable symbol/indicator.

- The indicator must remain aligned with the version.
- Hovering over the indicator should display a tooltip containing the tag's short text and description.
- The indicator must work correctly when zooming, panning, resizing, and changing LOD.
- Untagged versions should not display the indicator.

### Tag Management

Users must be able to:

- Add a tag to a version.
- Edit an existing tag.
- Remove a tag.

Add "adding a tag" to the three dots menu and to the right click menu when in empty space of a version
The tag should remain part of the version's persistent data and should be preserved through:

- Branching.
- Import/export.
- Collaboration.
- Version comparison where appropriate.

---

# 3. Search Tags

Extend the existing search functionality to support tags in addition to version identifiers.

The search interface should allow users to search for:

- Version identifiers.
- Tag text.
- Tag descriptions.

Selecting a matching tagged version should navigate/focus the graph on that version using the existing smooth navigation behavior.

Search results should clearly indicate whether a match comes from:

- The version identifier.
- The tag title.
- The tag description.

---

# 4. Tag List

Add a way to display a list of **all tags currently present in the graph/room**.

Each tag entry should show:

- Tag title.
- Description.
- Associated version.

Selecting a tag should focus/navigate to the associated version.

The list should update automatically when tags are added, edited, or removed.

Tags must respect the current room/collaboration context and must not leak between independent rooms.

Make it accessible via the settings button in the sidebar.

---

# 5. Hotkey Configuration

Create a dedicated configuration file containing the mapping between **keyboard shortcuts and application actions**.

For example, conceptually:

```text
Ctrl+F → search
Delete → delete selected entries
Ctrl+C → copy
Ctrl+V → paste
...
```

The exact format should be easy to edit and understand.

The application should use this mapping rather than scattering hard-coded hotkey definitions throughout individual components.

Requirements:

- One central source of truth for hotkey/action mappings.
- Easy to add, remove, or change shortcuts.
- Keep the actual action implementation separate from the shortcut configuration.
- Ensure the configuration is used consistently across the application.
- Handle platform-specific shortcuts where necessary.

---

# 6. Symbol / Action Configuration

Create a dedicated configuration file containing the mapping between **symbols/icons and application actions**.

For example:

```text
merge → merge icon
add → add icon
delete → delete icon
copy → copy icon
...
```

Use this configuration wherever action symbols/icons are displayed instead of scattering icon definitions throughout the application.

Requirements:

- One central source of truth for action symbols.
- Easy to replace or adjust an icon.
- Keep icon configuration separate from action implementation.
- Use meaningful action identifiers rather than relying on icon names throughout the application.

Hotkeys and Symbols are allowed to be in the same file if it seems to be a good idea.

---

# 7. Connector Icons Between Root and First Version

Fix the positioning of the connector icons between the root and the first version.

The icons should Be positioned consistently with the other version connectors.

Add a regression test for the positioning logic if practical.

---

# 8. Add Child for Multiple Selection

Change the existing **Add Child** functionality so that it applies to **all currently selected entries**.

### Single Selection

If one entry is selected:

- Add a new child to that entry as before.

### Multiple Selection

If multiple entries are selected:

- Create the appropriate new child entry/entries according to the existing data model.
- Apply the operation to **all selected entries**.
- Preserve the existing entries and their relationships.
- Ensure the resulting hierarchy is valid.
- The operation should behave consistently with the existing multi-selection and bulk-operation semantics.

The implementation should not silently operate only on the last selected entry.

Add tests for both single-selection and multi-selection behavior.

---

# 9. Tests

Add automated tests for all new functionality and relevant regressions.

For example:

### Tutorial

- Loading tutorial content from the external configuration.
- Navigating between tutorial steps.
- Displaying text, lists, and images.
- Completing/skipping/restarting the tutorial.
- Tutorial actions or completion conditions where implemented.

### Tags

- Adding a tag.
- Editing a tag.
- Removing a tag.
- Displaying the tag indicator.
- Tooltip content.
- Searching by tag title.
- Searching by tag description.
- Listing all tags.
- Navigating to a tagged version.
- Tag persistence.
- Tag behavior across collaboration and import/export.

### Configuration

- Hotkey mappings are loaded and used correctly.
- Changing a mapping changes the corresponding shortcut behavior.
- Symbol/action mappings are resolved correctly.

### Selection

- Add Child with one selected entry.
- Add Child with multiple selected entries.
- Existing multi-selection behavior remains correct.

### Graph Rendering

- Root-to-first-version connector icons are positioned correctly.
- Positioning remains correct after zooming, panning, and resizing where practical.

Use UI/integration tests for behavior that depends on rendered UI, pointer interaction, keyboard interaction, tooltips, or navigation. Use unit tests for pure state transformations and configuration parsing.
