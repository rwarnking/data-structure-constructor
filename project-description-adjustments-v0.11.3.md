# Context Menus, Focus, and Entry Editor

Implement the following changes to context menus, the Focus action, and the entry editor.

## 1. Complete Context Menus

- Add a delete action to the entry context menu.
- When deleting a parent entry, provide the following three options:
  1. **Delete selected entry, keep children:** Remove the selected entry but retain its direct children by attaching them to its parent. Preserve their subtrees.
  2. **Delete selected entry and its children:** Remove the entire subtree, including all descendants.
  3. **Delete selected entry, detach children:** Remove the selected entry and turn its direct children into independent root entries (free-floating treemaps). Preserve their subtrees.
- For leaf entries, simply delete the selected entry without showing unnecessary additional options.
- Ask for confirmation before destructive operations that delete entire subtrees.

Review all existing context menus and make sure they provide all relevant actions for the object or state they were opened from.

- Every context menu should expose the relevant operations available for that object.
- Group actions logically and consistently across the application.
- Destructive actions should be visually distinguished and require confirmation where appropriate.
- Context menus should be contextual:
  - Entry menus should show actions relevant to the selected entry.
  - Version menus should show actions relevant to the selected version.
  - Empty canvas menus should show actions relevant to the current version/canvas.
  - Root menus should show actions relevant to the root.
- Do not expose actions that are invalid for the current state.

### Empty Version Canvas

Right-clicking on empty space inside a version should provide the same relevant actions as the version's three-dots menu, including:

- **Add Entry**
- **Focus**
- **Compact Layout**

Add other actions only if they are already available and relevant to the version.

### Root Context Menu

The root context menu should provide the appropriate option to add a new entry/version where applicable.

### Context Menu Closing

Fix the current context-menu behavior so that only an explicitly triggered context-menu action opens a context menu.

- Right-clicking an object opens its context menu.
- Clicking elsewhere closes the currently open context menu.
- Clicking another object should not accidentally cause a second context menu to appear.
- At most one context menu should be open at a time.
- Normal left-click interactions should remain unaffected.

---

## 2. Focus

Rename the existing **Center** action to **Focus** throughout the UI.

- Use **Focus** consistently in:
  - context menus,
  - version controls,
  - buttons,
  - tooltips,
  - keyboard shortcuts/help text.
- The keyboard shortcut for Focus is **F**.
- Pressing **F** should focus the currently active/selected version.
- Focus should smoothly center the selected/active version using the application's existing navigation animation.
- Focus must only change the viewport/camera.
- It must not modify:
  - entry positions,
  - entry sizes,
  - hierarchy,
  - version contents, or
  - branch structure.
- All ways of triggering Focus should use the same underlying implementation so that the behavior is consistent.

---

## 3. Entry Editor Autofocus

Fix the entry editor so that the value input is automatically focused whenever the editor is opened.

- When creating a new entry, the text input should receive focus automatically.
- The cursor should already be inside the input and ready for typing.
- This must also work when editing an existing entry.
- The current `autofocus` attribute alone is insufficient because the editor is conditionally rendered.
