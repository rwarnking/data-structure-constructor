# List of Adjustments

## Branch Lines

- **Arrowheads**
  - Redesign the arrowheads so that they are visually consistent with the branch lines and do not look distorted or oversized.

- **Branch endings**
  - Do not render the end of a branch line as dashed.
  - Branch lines should have a consistent appearance from their origin to their endpoint.

- **Line styling**
  - Both the main branch and branching lines should have a border and drop shadow.
  - Branching lines should use the same visual treatment as the main branch.

- **Branches originating at the root**
  - A branch whose origin is the root should connect directly to the root with a straight AND horizontal line.
  - No bend or branching curve should be used in this case.

- **Branching curves**
  - When multiple branches leave a common branch, the branching curve should always be drawn on top of the other branch lines.
  - The inside of the branching curve should also be rounded/bent rather than forming a sharp corner.

## Root

- Remove the root header (`Root | V0 | S0 | ...`).
- Display only the empty-set symbol for the root's empty structure instead of the text `"Empty structure"`.
- Scale the empty-set symbol appropriately to the size of the root box.

## Branch Layout and Ordering

- Each branch should have its own horizontal lane. Multiple branches should never overlap in the same lane.
- Branches should be ordered vertically according to their branching position:
  1. Branches with the **most recent branching position** should be closest to the main branch.
  2. Among branches with the same branching position, the **longest branch** should be closest to the main branch.
  3. Shorter branches should be placed progressively farther away from the main branch.
- The ordering should remain stable unless a branch is added, removed, or its branching position changes.
- The longest/main branch should remain visually prominent and should form a straight sequence where possible.

## Treemap Interaction

### General principles

- Treemap interaction should distinguish between **moving an entry** and **changing the hierarchy**.
- Dragging an entry should never unexpectedly change its parent, reorder unrelated entries, or resize the surrounding hierarchy.
- A drag operation should only perform a hierarchy change when the user explicitly drops an entry onto another valid entry.
- A preview should not flicker, when a preview is shown it should be displayed consistently until the user moves the item onto space that is neither the preview nor the dragged on item

### Moving an entry

- **Drag within the same parent**
  - The dragged entry is repositioned within the available space.
  - Its parent and hierarchy remain unchanged.
  - Other entries should move out of the way rather than being unintentionally resized or displaced in unpredictable ways.

- **Drag into another entry**
  - If the dragged entry is released clearly inside another entry, that entry becomes the new parent.
  - The dragged entry, including its complete subtree, moves with it.
  - The target parent should be resized to accommodate the new child.

- **Drag outside all entries**
  - The hierarchy should not change.
  - The entry remains under its current parent and is positioned at the nearest valid location within that parent's area.

- **Drag onto a child or descendant**
  - Do not allow an entry to become a child of itself or one of its descendants.
  - The drop should be rejected and the entry should return to its previous position.

- **Drag without sufficient movement**
  - A click or very small movement should be treated as a selection rather than a drag.
  - Only movement beyond a small drag threshold should initiate repositioning.

### Moving a subtree

- Dragging a parent entry moves the **entire subtree** together.
- The relative positions and hierarchy of the subtree should remain unchanged during the drag.
- Dropping the subtree onto another valid entry makes the entire subtree a child of that entry.
- Dropping it outside another entry keeps the existing hierarchy unchanged.

### Drop feedback

- While dragging, clearly indicate the current potential drop target.
- Highlight the target only when the drop would result in a valid hierarchy.
- Invalid targets, such as descendants of the dragged entry, should provide clear visual feedback that they cannot be selected.
- The final layout should only be committed when the drag is released.

## Treemap Layout and Sizing

- A parent must always completely enclose all of its children.
- A child box must therefore always be smaller than its parent box.
- Do not use divider lines between entries. The hierarchy should be represented exclusively through nested/wrapping boxes.
- A three-level hierarchy should require more space than a single leaf node.
- A standalone leaf should have approximately the same **base size** as a leaf at the same hierarchy depth in a larger tree. Its size should not depend strongly on how many unrelated nodes exist elsewhere in the treemap.
- Parent sizes should be determined by the space required by their children, rather than by an arbitrary fixed size.
- Add a minimum padding between a parent boundary and its children so that nested levels remain visually distinguishable.

### Suggested sizing model

- Define a **minimum size for leaf nodes** based on the amount of information that needs to be displayed.
- Define a small fixed padding between hierarchy levels.
- A parent should have at least enough width and height to contain all of its children plus the required padding.
- If a parent contains only one child, do not shrink the parent to the exact size of that child; retain a minimum amount of surrounding space so that the parent remains visually identifiable.
- Deeper hierarchies should therefore naturally require more space than shallow ones.
- Avoid scaling every node proportionally to the total number of nodes. A leaf should remain readable and interactable even when it is part of a large hierarchy.

## Infinite Canvas

- The version view should behave as an **effectively infinite canvas**, but the actual rendered canvas should only be as large as necessary.
- The canvas should be defined by the bounding box of all elements plus a fixed amount of surrounding padding.
- There should always be empty space around the outermost elements so that they can be moved without immediately reaching the canvas boundary.
- When an element is moved beyond the current canvas boundary:
  - Expand the canvas in the required direction.
  - Preserve the element's position rather than snapping it back.
  - Update the canvas bounding box to include the element and the required padding.
- When an element is moved back toward the other elements:
  - Recalculate the bounding box.
  - Shrink the canvas if the previously required space is no longer needed.
  - Never shrink the canvas below the minimum padding around the content.
- The canvas should **not** continuously expand simply because the user pans or zooms. Canvas expansion should only be caused by content being moved beyond the current content bounds.
- The viewport/pan position should be independent of the canvas size so that expanding or shrinking the canvas does not unexpectedly move the user's view.

## View

### Dragging and navigation

- Enable dragging in both horizontal and vertical directions.
- Panning the view should not move or modify treemap entries.
- Panning should work by holding the left mouse button in all situations unless when the mouse is over a version view.
- Entry dragging should only begin when the pointer starts directly on an interactive treemap entry.
- Clearly distinguish canvas panning from entry dragging to prevent accidental movement of entries.

### LOD 3

- Adjust the font size of the `"Entries"` text so that it makes better use of the available space within the box.
- Display all three statistics vertically below each other.
- Left-align all three statistics.
- The layout should remain readable even when the amount of text is relatively small compared with the available box space.

## General UI

- Remove the `"Version History - Structure Graph"` title.
- Remove the top bar and move any necessary information and functionality into the side bar.
- Remove the bottom bar and move any necessary information and functionality into the side bar.
- Make the side bar retractable.
- Remove the center button and `+` button from the top-right corner.
- Remove the version number and branch ID from the top-right corner.
- Remove the step count and `"Infinite Canvas"` text from the bottom-right corner.