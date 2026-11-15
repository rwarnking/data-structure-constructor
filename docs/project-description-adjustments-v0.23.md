Please implement the following changes. Preserve the existing architecture and interaction behavior unless explicitly changed below. Prefer reusing existing components, composables, styles, and interaction logic rather than creating duplicate implementations. Implement tests where it makes sense.

# 1. LOD2

### 1.1 Tagged versions

When a version is tagged:

- The tag indicator in LOD2 should be hoverable.
- Hovering the tag indicator should show a tooltip containing:
  - the tag's short text/title
  - the tag's description
- The tooltip should behave consistently with the existing tag tooltip elsewhere in the application.
- Make sure the tooltip remains usable at different zoom levels.

### 1.2 Treemap preview

When hovering a version in LOD2:

- Show a preview of the version's treemap.
- Reuse the existing treemap rendering/data where possible.
- The preview should clearly correspond to the hovered version.
- It should not interfere with normal hover, selection, dragging, panning, or navigation.
- Hide the preview when the pointer leaves the version.
- Avoid expensive full-size graph/layout recomputation just to display the preview.

### 1.3 LOD2 version header

When the application is in LOD2:

- The header/top bar of each version window should use the **creation-indicator color** as its background.
- The header should contain **only**:
  - the version number
  - the dots menu
- Remove any other header content from the LOD2 header.

Both the version number and dots menu should be:

- As large as possible while still fitting comfortably inside the available header space.
- Clearly readable at LOD2.
- Properly aligned vertically and horizontally.
- Robust to different version-number lengths and viewport sizes.

The creation-indicator color should come from the centralized theme/color configuration introduced previously, not from a new hard-coded color.

---

# 2. Miscellaneous

### 2.1 Browser resize when not in centered version view

Currently, resizing the browser moves the view when the application is **not** in centered-version view.

Fix this behavior.

When the user has manually positioned/panned the graph:

- Browser resizing must not unexpectedly move the graph.
- Preserve the current graph position/transform as much as possible.
- Only the viewport dimensions should change.
- Do not automatically recenter the graph unless the current focus mode explicitly requires it.

If the application is in a focus/centered mode where the view is intentionally responsive to viewport changes, keep the existing intended behavior there.

Test this with:

- manual panning
- different zoom levels
- LOD changes
- browser resizing wider and narrower

### 2.2 Split-entry menu

When splitting an entry:

- The resulting split-entry menu/dialog should use the same visual structure and interaction style as the **Add Entry** menu.
- Keep the split-specific fields/actions, but make the two dialogs visually consistent.

### 2.3 Deleting a branch containing the active version

When a branch/section is deleted and the currently active version is inside the deleted section:

- Automatically select the **last version immediately before the deleted section** as the new active version.
- Do not leave the active version pointing to a deleted version or the root unless the previous version is the root.
- Update the view/focus appropriately after the active version changes.

Test this for:
- deleting a branch containing the active version
- deleting a branch where the active version is at the beginning
- deleting nested branches
- deleting a branch while other users are present

### 2.4 Bulk operation change titles

When bulk adding entries:

- Do not list every added entry in the version/change title.
- Instead use:

`bulk added N items`

where `N` is the number of added entries.

When bulk deleting entries:

- Similarly use:

`bulk deleted N items`

Do not generate a long title containing all individual entry names.

### 2.5 Entry tooltips

Reduce the delay before entry tooltips appear.

- Entries should show their tooltip noticeably faster when hovered.
- Keep a small delay to prevent accidental tooltips while moving across many entries.
- Use one centralized tooltip delay if possible rather than hard-coding different values throughout the application.
- Ensure this applies consistently to normal views and relevant LODs.

---

# 3. Merge View

Improve the layout and interaction of the Merge View.

### 3.1 Margins

Add space between the Merge View and:

- the left sidebar
- the right edge of the browser/window

The left and right margins should be identical.

Also make the overall margins of the Merge View consistent:

- left margin = right margin
- top margin = bottom margin where appropriate
- left margin = bottom margin where appropriate

However, specifically reduce the overall **top and bottom margins** compared with the current layout so more vertical space is available for the actual merge content.

The resulting layout should feel compact and symmetrical.

### 3.2 Hotbar

Do not show the hotbar when in Merge View.

### 3.3 Entry selection table

Fix the column alignment in the entry-selection table.

Currently, the two vertical lines separating the columns are not aligned between:

- the header row
- the content rows

The column boundaries must be identical throughout the table.

### 3.4 Compact treemap layout

At the beginning of the Merge View, use the **compact layout** for the treemaps.
Reuse the existing compact treemap layout implementation rather than creating a second layout algorithm.

### 3.5 Hover highlighting

When hovering entries in Merge View:

- Highlight entries in the same way as in the normal version view.
- Reuse the existing hover/highlight styling and behavior.
- Do not introduce a separate visual language for Merge View.

### 3.6 Drag preview

When dragging entries in Merge View:

- Show a preview of the resulting placement, similar to the normal version view.
- Reuse the existing drag-preview behavior where possible.
- The preview should update as the pointer moves.
- It should correctly indicate the target/placement before the drop.

---

# 4. Compare View

### 4.1 Header controls

Move the following controls into the Compare View header:

- `"N entries differ"`
- `"Hide difference highlights"` button

This is to free vertical space for the actual comparison.

The information/button should remain clearly visible and accessible, but should no longer consume a separate content row.

### 4.2 Layout

Use the same margin/layout rules as Merge View:

- identical left/right margins
- consistent margins
- reduced top/bottom margins
- compact use of available space

### 4.3 Hotbar

Hide the hotbar in Compare View as well.

---

# 5. Multiuser

Improve user identity handling within rooms.

## 5.1 Unique animal names

Users in the same room must never have identical display names.
Do **not** solve collisions by simply adding a numeric postfix such as:

- `Fox`
- `Fox 2`
- `Fox 3`

Instead, choose another unused animal name.
If a randomly selected animal name is already taken, choose another unused animal name.

Important:

- Uniqueness must be enforced **per room**.
- It must work when multiple users join at approximately the same time.
- It must also work when a user changes/reconnects.
- Do not rely solely on the local client to determine uniqueness.
- The room/session coordination mechanism should be authoritative enough to prevent simultaneous users from ending up with the same name.

If the available animal-name list becomes exhausted, numbering is allowed.
Keep the assigned name stable for the user's session if possible.

## 5.2 User colors

Assign each user a distinct color.

Requirements:

- Colors should be clearly distinguishable from each other.
- Avoid assigning nearly identical colors to two users in the same room.
- Consider color contrast against both light and dark mode.
- Avoid colors that are difficult to distinguish for common forms of color vision deficiency where practical.
- User colors should remain stable for the duration of the room/session.
- The color assignment should also be coordinated so simultaneous users do not receive the same color.

Use a predefined palette with sufficiently distinct colors rather than generating arbitrary random RGB values.
The palette should be centralized/configurable so it can easily be adjusted later.
When having to many users, having similar colors is fine.

## 5.3 Connecting to a room UI

Improve the UI for creating/joining rooms.
Current behavior should be extended with a clearer interface.

### Create room

Place a **Create Room** button directly beside the relevant room text/information.
Clicking it should create a new room and connect the user to it.

### Join room

Place a **Join Room** button beside the room input field.
The input should accept either:

1. A complete room URL, for example:

`http://127.0.0.1:5173/?room=Room+0e940bc9`

or

2. A room name directly, for example:

`Room 0e940bc9`

The application should automatically detect which form was supplied and extract the room identifier when a URL is pasted.
Invalid/empty input should result in an appropriate validation message.
Make the layout compact and consistent with the rest of the application's controls.

---

# 6. Tests

Add/update tests for all affected behavior.

### LOD2
- Tag tooltip appears on hover.
- Tooltip contains tag title and description.
- Treemap preview appears on version hover.
- Preview disappears when leaving the version.
- LOD2 header uses the creation-indicator color.
- LOD2 header contains only version number and dots menu.
- Header contents scale appropriately.

### Misc
- Manual graph position is preserved when resizing the browser outside centered/focus mode.
- Split menu visually/structurally matches Add Entry menu.
- Deleting a branch containing the active version selects the preceding valid version.
- Bulk add uses `bulk added N items`.
- Bulk delete uses `bulk deleted N items`.
- Entry tooltip appears with the reduced delay.

### Merge View
- Correct symmetric margins.
- Hotbar is hidden.
- Header/body table columns align.
- Compact treemap layout is used.
- Hover highlighting matches normal version view.
- Dragging produces a preview.

### Compare View
- Difference count is in the header.
- Hide-highlights control is in the header.
- Hotbar is hidden.
- Margins match Merge View.

### Multiuser
- Two users in the same room cannot receive the same animal name.
- Simultaneous joins cannot result in duplicate names.
- No numeric postfix is used as the collision solution.
- Users in the same room receive distinct colors.
- Colors are sufficiently distinguishable.
- Color assignment remains stable.
- Full room URL can be pasted into the join field.
- Room names can be entered directly.
- URL and room-name input both result in joining the correct room.
- Invalid room input is handled gracefully.

Prefer behavior/UI tests over implementation-detail tests.
