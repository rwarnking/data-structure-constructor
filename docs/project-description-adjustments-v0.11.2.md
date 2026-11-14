# Version Layout and Initial Navigation

Implement the following change to version creation and initial viewport positioning.

## 1. Initial Zoom for New Branches

When a new empty branch is created:

- Automatically execute the same behavior as **Center All Elements** for the new version.

# Copy-Entry Connections

## 1. Connector Rendering

- Draw a dashed connector directly between the **source entry** and the **copied destination entry**.
- The connector must connect the actual entries, not their containing versions.
- The connector should remain correctly attached when either entry:
  - moves,
  - is rearranged,
  - changes hierarchy,
  - is moved between branches/versions, or
  - the viewport is zoomed or panned.
- Zooming or panning must not cause the connector to jump, distort, or change its relative attachment to either entry.
- The connector must be rendered above the version/background geometry so that it is not hidden behind version boxes or other background elements.

## 2. Connector Interaction

- Clicking a copy connector once should activate/focus the **opposite-end version**.
  - If the user clicks the connector from the source side, focus the version containing the copied entry.
  - If the user clicks it from the copied-entry side, focus the version containing the source entry.
- A single click is sufficient. **Do not require a double click.**
- Focusing the opposite version should use the existing smooth navigation/focus animation.
- Hovering over the connector should provide a clear visual indication that it is interactive.
- The hover state should only affect the connector's appearance and must not change the underlying hierarchy or selection.

## 3. Connector Lifecycle

- The connector represents the relationship between exactly one source entry and its copied entry.
- It should be created when an entry is copied.
- It should be removed if the copy relationship is explicitly removed or if either endpoint no longer exists.
- Do not create additional connectors merely because entries have identical values.
- Do not propagate the connector to other copies or related entries.

## 4. Interaction Safety

- Clicking or hovering a connector must not interfere with normal entry dragging or selection.
- The connector should have an appropriate, narrow interaction area so that it is clickable without unnecessarily blocking interactions with nearby entries.
- The connector must remain correctly positioned after any layout operation, including **Compact Layout** and other automatic rearrangements.