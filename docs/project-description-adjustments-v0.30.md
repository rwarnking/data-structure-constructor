# Adjustments

- **Tooltip**
  - Fix the bug where two tooltips are displayed simultaneously over a treemap node.
  - Ensure that only one tooltip can be visible for an entry at a time.

- **New Entry Dialog**
  - After clicking **“Add another entry”**, automatically focus the **Name** input field so the next entry can be entered immediately.

- **Ping Position**
  - Fix the bug where pings are displayed at the wrong position for other users.
  - Pings should appear at the same logical location regardless of differences in:
    - browser window size
    - viewport dimensions
    - aspect ratio
    - zoom level
  - Do not rely on absolute screen coordinates. Use coordinates relative to the relevant version/viewport so that the position can be correctly transformed for each user's view.
  - Verify that pings remain correctly positioned when users have differently sized browser windows.

- **Selection After Editing**
  - Automatically select all entries immediately after they are added.
  - When an entry is edited, keep that entry selected after the edit is committed.

## Delete Actions

### Right-Click Context Menu

#### Single leaf entry

- Show **“Delete entry”** in the Context Menu.
- Selecting it should immediately delete the entry.

#### Single parent entry

Show the following three options in the Context Menu:

- **Delete selected entry, keep children**
- **Delete selected entry and its children**
- **Delete selected entry, detach children**

#### Multiple selected entries

- Do not show **“Delete entry”**.
- Show **“Delete entries”** instead.
- Only open the **Delete Selected Entries** dialog if at least one selected entry has a child that is **not also selected**.
- If all children of all selected entries are also selected, delete all selected entries immediately without opening the dialog.

### Tool Sidebar

Rename **“Delete node”** to **“Delete entry”**.

#### Single leaf entry

- Delete the entry immediately.

#### Single parent entry

- Open the **Delete Selected Entries** dialog.
- Let the user choose how the children should be handled.

#### Multiple selected entries

- Only open the **Delete Selected Entries** dialog if at least one selected entry has a child that is not also selected.
- If every child of every selected entry is also selected, delete all selected entries immediately.

## Copy, Paste, and Cut

- **“Add copied entry”** should be available in the version-view context menu whenever a copy operation has been performed with `Ctrl+C`, regardless of whether an entry is currently selected.
- When pasting:
  - If one or more entries are selected, append the copied structure to **each selected entry**.
  - If no entry is selected, insert the copied structure as a **floating entry**.
- Rename **“Copy entry and subtree”** to **“Copy entry and children”**.
- Use the same terminology consistently in the tool sidebar for **Copy**, **Paste**, and **Cut** actions.

## Choose Two Versions Dialog

- The **“Choose Two Versions”** dialog used for **Compare** and **Merge** must not cover or overlap the tool sidebar.
- Position or size the dialog so that the tool sidebar remains fully accessible and visible while the dialog is open.

# Tests

- Add tests where appropriate.