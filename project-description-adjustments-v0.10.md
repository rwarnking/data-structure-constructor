# List of Adjustments

## Versions

## 1. Version Layout and Navigation

### 1.2 Compact Layout

- The compact layout should Rearrange all treemaps within the version canvas.
- The layout should optimize the arrangement in **both dimensions** rather than primarily arranging treemaps along a single axis.
- First, choose an arrangement that makes efficient use of the available space while respecting the **aspect ratio of the view**.
- Treemaps must not overlap.
- Preserve the hierarchy, and internal layout of individual treemaps.
- After rearranging the treemaps, center the resulting layout within the version canvas.

## 2. Version Transitions and Connections

### 2.1 Copying Between Timelines

- When an element is copied from one timeline/branch to another, add a **dashed connector** between the **source entry** and the **copied destination entry**.
- The connector must connect the actual entries, not the containing versions.
- The connector should indicate the direct relationship between these two entries.
- The connector should exist **only between these two specific entries in their respective versions**.
- It must not automatically propagate to later versions created from either version.
- The connector must remain correctly positioned when either version or either entry is moved, rearranged, or affected by branching.
- Update the connector continuously whenever the position of either connected entry changes.
- Double-clicking the connector should activate and center the version at the **opposite end of the connection**.
  - If the source version is active, double-clicking the connector activates and centers the destination version.
  - If the destination version is active, double-clicking the connector activates and centers the source version.
  - The change in active version should be the only thing happening
- Use the same smooth zoom/navigation animation as other version-navigation actions.

## 3. Version Comparison and Branch Operations

### 3.3 Merge View

- Design a dedicated **Merge View** that is separate from the normal Comparison View.
- The Merge View should allow users to:
  - inspect the differences between two versions,
  - select which elements to keep,
  - disregard elements,
  - resolve structural conflicts,
  - and construct the resulting merged version.

### Merge View Layout

- Display the **source version on the left** and the **target version on the right**.
- Display the **resulting merged version in the middle**.
- Display all treemaps and their entries **vertically** within each of the three areas.
- Ignore the spatial arrangement of treemaps in the original version.
  - The merge view should compare the **content and hierarchy**, not the positions of treemaps on the version canvas.
- Corresponding/identical elements should be aligned on the **same vertical level** on the left and right.
- Identical elements should be placed **toward the bottom** of the merge view.
- Elements that exist only on one side should be aligned with an **empty area on the opposite side**, clearly indicating that no corresponding element exists there.
- The layout should make it easy to distinguish:
  - elements present in both versions,
  - elements only present in the source,
  - elements only present in the target,

### Merge Interaction

- The **middle area** is used to control how elements from the source and target are incorporated into the resulting version.
- For each relevant element, the user should be able to:
  - select the source version's element,
  - select the target version's element,
  - keep/disregard either version's element,
  - or combine them where appropriate.
- It should be possible to select an entry and optionally specify a **parent or subtree** in which the entry should be placed in the resulting version.
- When an element is moved to a different subtree during the merge, the resulting hierarchy should reflect this explicitly.
- Changes made in the middle area should immediately update the preview of the resulting merged version.
- The resulting version should represent exactly the choices made in the middle area.

### Default Merge Behavior

- If the user confirms the merge **without making any additional choices**, combine the two versions as-is.
- In this default case, all treemaps from both versions are combined into the resulting version.
- Treemaps and their entries should not be merged merely because they occupy similar positions in the original versions.
- Identical elements should only be combined when they represent the same underlying entry.
- After the new merged version has been created, automatically apply the **Compact Layout** function to arrange the resulting treemaps.
- The Compact Layout should optimize the resulting arrangement in both dimensions while minimizing unnecessary empty space.
- The original source and target versions must remain unchanged.

## Hotfix

- Remove old merge preview.
- With the current setup it should be possible to always do a merge, but confiming is currently not possible.
- Remove "click an entry to hightlight its counterpart" text.

- **dashed connector** between the **source entry** and the **copied destination entry** is not between the entries, but the versions
- Double clicing it does not set the other version active but rather shows a box around the line.
