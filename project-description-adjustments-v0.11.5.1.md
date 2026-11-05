# Merge Rendering and Merge View Scrolling

Implement the following changes to merge connections, merge-version numbering, and interaction/scrolling behavior in the Merge View.

## 1. Merge Connections

Connections between the two source versions and the resulting merge version must use the **same visual style and routing rules as normal version connectors**.

- Use exactly the same:
  - stroke thickness,
  - stroke color,
  - outline,
  - line style, and
  - visual treatment
  as existing version-to-version connectors.
- Merge connectors must be visually indistinguishable from normal version connectors. There should be no special merge-specific connector style.
- Do **not** use arrowheads.
- Both source versions must have a connector to the resulting merge version.
- The two connectors should make it clear that both source versions lead into the same merge result.

### Connector Geometry

Use the existing orthogonal version-connector geometry.

For each merge connector:

- Start at the **right side** of the source version.
- End at the **left side** of the merge version.
- The connector may use either:
  1. **one straight horizontal segment**, directly from source to destination, or
  2. **two 90-degree bends** with one vertical segment between them.

The two merge connectors must be routed so that they do not overlap each other unnecessarily.

**Important routing constraint:**

- If one merge connector is a straight horizontal segment, the other connector must use the two-bend form.
- Both connectors may use the two-bend form.
- Do not use two straight horizontal connectors if that would make the two connections visually indistinguishable or overlapping.

Reuse the existing connector-routing logic wherever possible rather than introducing a separate merge-specific routing system.

If the source and merge versions are separated by multiple step positions, the connector should simply span the required distance. Its visual style and routing rules must remain unchanged.

Do **not** create additional graph nodes or placeholder versions to make a connector visually continuous.

---

## 2. Merge Version Step Number

When creating a merge version, determine the step numbers of both source versions.

The merge result must receive:

**`max(source step, target step) + 1`**

For example:

- Source: step 4
- Target: step 7
- Merge result: step 8

If both source versions are at step 5:

- Merge result: step 6

The merge result is therefore always the **next step after the later of the two source versions**.

The step number must be determined from the actual source versions, not from their visual position in the graph.

---

## 3. Different Source Step Numbers

When the two source versions have different step numbers:

- Place the merge result at `max(source step, target step) + 1`.
- The connector from the earlier source must span the missing step positions directly.
- Do **not** create placeholder versions.
- Do **not** create empty intermediate nodes.
- Do **not** create additional graph elements solely for visual alignment.
- The only new graph version created by the merge operation should be the actual merge result.

The connector must therefore be able to span a longer distance while retaining exactly the same visual style and routing rules.

---

## 2. Merge View Scrolling and Interaction

The Merge View is a modal interaction area. While it is open, interaction with the underlying main view must be disabled.

### Merge View Interaction

While the Merge View is open:

- Mouse and pointer interactions within the Merge View must be handled exclusively by the Merge View.
- Interactions must not pass through to the underlying version graph.
- Clicking, dragging, or scrolling the Merge View must not select, drag, pan, zoom, or otherwise modify the underlying graph.
- The user must not be able to accidentally interact with entries or versions behind the Merge View.

### Merge View Scrolling

The Merge View contains its own scrollable content.

- When the pointer is over the Merge View's scrollable content, the mouse wheel should scroll that content.
- The wheel event must **not** simultaneously zoom the background version graph.
- If the merge content is taller than the available viewport, it must be possible to scroll through the complete content.
- Scrolling should behave like normal scrollable UI content rather than graph zooming.

### Background Graph

While the Merge View is open:

- Background graph zooming, panning, selection, dragging, and context menus must be disabled.
- Background keyboard shortcuts that modify or navigate the graph should not accidentally act on the underlying graph while the Merge View has focus, unless they are explicitly required by the Merge View itself.

When the Merge View is closed:

- Restore all normal graph interactions.
- Restore the existing graph zoom, pan, selection, dragging, and keyboard behavior without requiring a reload.

### Event Handling

Do not solve this merely by ignoring wheel events in the graph.

The Merge View should prevent **all relevant pointer events from reaching the underlying graph** while it is open, while still allowing its own controls and scrolling to work normally.