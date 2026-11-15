# Treemap Behavior

- **Do not reflow the treemap while dragging.** When an entry is dragged within a treemap, all other entries must retain their current position and size throughout the drag.
- The potential drop target may be visually highlighted during dragging, but its position and size must remain unchanged.
- Only apply the resulting layout change **after the user releases the dragged entry and the move is actually committed**.
- Avoid any intermediate layout recalculation that changes the geometry of unrelated entries during the drag operation.

# Treemap Display

- Each **version node** should have an aspect ratio that approximately matches the available canvas viewport:
  - available width = canvas width − both sidebar widths
  - available height = canvas height
- Use a **squarified treemap layout** for positioning entries.
- A treemap must use all available space within its version node; do not leave unnecessary internal whitespace.
- **Never stretch or distort the treemap contents** to force a target aspect ratio. Text and other visual elements must retain their natural proportions.
- Do not use a monospace font for treemap entries. Use a compact, space-efficient proportional font.
- **Text wrapping:**
  - Wrap text only at spaces or valid hyphenation points.
  - Never break words arbitrarily in the middle.
  - If a word must be hyphenated, display the hyphen at the appropriate position.
- **Long text:**
  - For text longer than approximately 30 characters, truncate it when the available entry space is insufficient.
  - Indicate truncation with `...`.
  - The complete text must be accessible on hover, e.g. through a tooltip.
- Keep text readable and avoid unnecessary font-size reductions just to fit text into an entry.

# Hotkeys and Actions

## General Rules

- Every action icon must be **visually unique** and clearly distinguishable from the other action icons.
- Hotkeys should be assigned consistently according to the action's **scope and high-level functionality**.
- Do not introduce alternative hotkeys for the actions listed below unless explicitly requested.
- Avoid conflicts between hotkeys that can occur in the same interaction context.

## Group 1 — Local Version Actions

These actions operate on the currently selected/local version.

| Action | Hotkey |
|---|---|
| Add new entry | `N` |
| Delete node | `Delete` |
| Add child | `A` |
| Group entries | `G` |
| Edit entry | `E` |
| Detach entry | `D` |
| Compare versions | `C` |
| Tag version | `T` |
| Merge entries | `M` |
| Split entries | `S` |
| Copy entry | `Ctrl+C` |
| Cut entry | `Ctrl+X` |
| Paste entry | `Ctrl+V` |

## Group 2 — Global Version Actions

These actions operate across versions/timelines.

| Action | Hotkey |
|---|---|
| Compare versions | `Shift+C` |
| Merge versions | `Shift+M` |

## Group 3 — Local Viewport Actions

These actions affect the viewport of the current/local version.

| Action | Hotkey |
|---|---|
| Compact layout | `Shift+L` |
| Center all elements | `Shift+A` |
| Box select | `Ctrl + mouse drag` |
| Zoom in/out | `Shift + mouse wheel` |
| Pan | `Shift + mouse drag` |

## Group 4 — Global Viewport Actions

These actions affect the overall application viewport/navigation.

| Action | Hotkey |
|---|---|
| Zoom in/out | `Mouse wheel` |
| Pan | `Mouse drag` |
| Focus version | `1` |
| Show neighborhood | `2` |
| Fit to height | `3` |
| Fit all | `4` |
| Previous version | `Left Arrow` |
| Next version | `Right Arrow` |
| Timeline above | `Up Arrow` |
| Timeline below | `Down Arrow` |
| First timeline | `Page Up` |
| Last timeline | `Page Down` |
| First entry in timeline | `Pos1` |
| Last entry in timeline | `End` |

## Group 5 — Communication Actions

| Action | Hotkey |
|---|---|
| Ping | `Alt + mouse click` |

# Hotkey Sidebar

Replace the current **bottom hotkey bar** with a **collapsible sidebar on the right side** of the application.

### Collapsed state

- Show only the action icons.
- Keep the sidebar narrow enough to minimize interference with the main canvas.
- Icons must remain recognizable without the action text.

### Expanded state

- Show, for each action:
  - the action icon
  - the action name
  - its assigned hotkey, if one exists
- Group actions according to the five high-level groups defined above.
- Clearly visually separate the groups.
- Preserve the same ordering within each group as specified above.
- Actions without a hotkey should still be displayed; simply omit the hotkey label.

### Interaction

- The sidebar must be collapsible/expandable without affecting the underlying application state.
- Expanding or collapsing the sidebar should update the available canvas area accordingly.
- Do not duplicate actions merely because they belong to different scopes. Each action should have one canonical representation in the appropriate group.

# Tests

Add tests for changes or new features where appropriate.

# Tool Sidebar

### Collapsed State

The following actions should **not be displayed** when the tool sidebar is collapsed:

- Copy
- Cut
- Paste
- Box select
- Version zoom
- Version pan
- Graph zoom
- Graph pan
- First timeline (`Page Up`)
- Last timeline (`Page Down`)
- First version/entry (`Home`)
- Last version/entry (`End`)
- Previous version (`Left Arrow`)
- Next version (`Right Arrow`)
- Timeline above (`Up Arrow`)
- Timeline below (`Down Arrow`)

These actions must still be available when the sidebar is expanded.

### Undo / Redo

Add:

- `Ctrl+Z` — undo the last change
- `Ctrl+Y` — redo the last undone change

Undo/redo should operate on **versions**:

- `Ctrl+Z` removes the most recently created version and restores the state before that version was created.
- Only **one undo step** is supported. It must not be possible to undo multiple versions.
- `Ctrl+Y` restores the single version that was undone.
- Only one redo step is supported.
- Creating a new version after an undo clears the redo state.
- Undo and redo controls should only be displayed when the sidebar is **expanded**.

### Search

Add a search action to the tool sidebar:

- `Ctrl+F` — open the search menu
- The search action should only be displayed when the sidebar is **expanded**.

### Sidebar Group Order

Move **Communication Actions** to the **top of the tool sidebar**, above all other action groups.