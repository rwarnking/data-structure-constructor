# Treemap Drag-and-Drop

Fix and improve the current drag-and-drop behavior in the treemap. It is currently almost impossible to attach a dragged entry to a child entry. The cause may be related to mouse movement speed, hit detection, selection state, or event propagation. Investigate the underlying cause rather than assuming a specific one.

- When dragging an entry over another entry, the **currently hovered entry must always be recognized as the drop target**.
- Dropping onto an entry must append the dragged entry **to the hovered entry**, not to its parent.
- Hit testing must identify the **deepest/most specific entry under the cursor**, rather than an ancestor element.
- Drop-target detection must remain reliable regardless of:
  - mouse movement speed
  - whether the parent or another entry is already selected
  - target size or position
  - nested parent/child relationships
- Provide clear visual feedback for the currently hovered drop target.

## Text Size

- Increase the text size of treemap entries.
- Do not stretch or distort text to fit the available space.
- Leaves may use a larger font size than parent entries.
- All leaf entries should use the **same font size**.
- All parent entries should use the **same font size**.
- Text in parent entries should not be split, use "..." instead.

## Detaching Entries

Improve dragging behavior for detaching entries from their current parent.

- Fix the issue observed in **Room `0e940bc9`, version `22.03.002`**, where dragging entry `a` out of its parent `c` to the right causes the drag operation to be canceled.
- A drag position is invalid only when the cursor **leaves the version window**.
- When an entry is dropped onto empty space within the version window, it must be **detached from its current parent** and placed at the drop location.
- This must work even when there is currently no free space at the drop location.
- The layout should automatically make room for the detached entry by moving/rearranging other entries as necessary.
- Do not cancel a valid detach operation simply because the current layout has no immediate free space.

## Viewport After Drag-and-Drop

After an entry has been successfully appended or detached:

- Adjust the version viewport so that **all content that was visible before the operation remains visible**.
- Preserve the previous view as much as possible while accommodating the new layout.
- Add a reasonable margin around the preserved content.
- Do not unnecessarily zoom out or reposition the entire view.

## Out-of-View Indicators

Add directional indicators to the version view when entries are outside the current viewport due to zooming or panning.

- Do **not** show an indicator for every out-of-view entry.
- Show at most **one indicator per direction**, for a maximum of 8 indicators:
  - up
  - up-right
  - right
  - down-right
  - down
  - down-left
  - left
  - up-left
- If multiple entries are outside the viewport in the same direction, combine them into a single directional indicator.
- Only show indicators for directions in which relevant content is actually outside the viewport.

## Testing

- Add tests where appropriate, with particular emphasis on treemap interaction behavior.
- Include tests for:
  - dragging onto nested child entries
  - correct drop-target detection
  - dragging at different mouse speeds
  - dragging with existing selections
  - appending to a hovered entry rather than its parent
  - detaching entries onto empty space
  - detaching when no immediate free space exists
  - dragging out of the version window
  - preserving the viewport after drag-and-drop
  - out-of-view directional indicators

- The Out-of-View Indicators should only be displayed when an entry is not at all visible (fully out of the canvas). Use only the arrow tip to indicate the direction. Color it back and do remove the circle around it.
- When an entry is detached via dragging, and the space is occupied, try to find the nearest empty spot. Also keep the entry as close to the parent as possible.
- Make the Lane Navigation button in which the current version of the "you" user is in 1,5x as wide (width). remove the colored outline.

Add entries in the tool-sidebar for these actions, but only show these when the sidebar is expanded, not in collapsed mode.
- double version click focusses version
- single version click sets version active
- single entry click selects entry
- shift entry click selects multiple entries