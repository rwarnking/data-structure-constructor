# Add Entry Dialog, Version Comparison, and Merge View

## Add Entry Dialog

Improve the Add Entry dialog to use a **tabular layout**.

- Each entry is represented by exactly one row.
- The table has at least two columns:
  - **Name / Value**
  - **Description**
- Each row contains the same input fields and validation currently used for creating an entry.
- Provide controls to:
  - add a new row;
  - remove an existing row.
- The dialog must therefore support adding multiple entries in one operation.
- The first row should be present by default.
- Removing a row must not affect the values of any other row.
- Validation should be performed for all rows before the operation can be confirmed.
- Confirming the dialog creates **one new version containing all entries defined in the dialog**.
- The window should be scrollable when to many entries are in it
- Each row should be one line

---

# Version Comparison View

### Window Size

- The Version Comparison view must use the **complete available browser area**, excluding the sidebar and padding.
- This must remain true even when the sidebar is collapsed/retracted.
- The comparison view should therefore dynamically adapt to the current browser viewport.
- Resizing the browser must update the comparison-view dimensions accordingly.
- Collapsing the sidebar should not change the size of the comparisson view.
- draw above the hotbar

### Connector Symbols

- Symbols displayed on version connectors must always be **horizontally aligned**.
- The symbol must remain horizontally oriented regardless of the connector's routing or vertical position.
- Connector routing may contain vertical segments, but the symbol itself must not rotate or become vertically oriented.

---

# Merge View

Redesign the Merge View so that it provides a direct visual preview of the resulting hierarchy while still allowing the user to resolve merge decisions interactively.

## Overall Layout

The Merge View should use the **same overall window dimensions as the Version Comparison view**.

The layout should be:

```text
┌──────────────────────────────────────────────────────┐
│                                      │ List of       │
│                                      │ changes       │
│              Resulting               │               │
│               Treemap                │               │
│                                      │               │
├──────────────────────────────────────┤               │
│                                      │               │
│          Entry Selection List        │               │
│                                      │               │
└──────────────────────────────────────┴───────────────┘
```

More specifically:

- **Top/left:** resulting treemap.
- **Bottom/left:** entry selection list.
- **Right:** list of changes between the source versions.
- Above the change list, display the **number of different entries**.
- The change-list column should be only as wide as necessary for its text to fit comfortably; it should not consume excessive space.

## Resulting Treemap

The resulting treemap must show the **actual hierarchy that would be produced by the current merge settings**.

The preview must update immediately when merge settings change.

The resulting treemap is interactive:

- **Left-click an entry** to toggle whether that entry is **omitted or picked** for the merge.
- Entries can be **dragged using the normal hierarchy interaction behavior**.
- Add a visual indication that an entry is omitted or picked
- Normal attachment operations must be available during dragging.
- The user must be able to freely reorganize the preview hierarchy.
- Changes made through the treemap must update the corresponding Entry Selection List
- The preview should therefore behave like a normal editable treemap while remaining a preview of the eventual merge result.
- The preview must always represent the hierarchy that would be created if the user confirmed the merge with the current settings.

### Reset

Provide a **Reset** button.

- Reset restores the Merge View to the initial state calculated from the two source versions.
- All user changes to entry selection/omission, parent assignments, and hierarchy organization are discarded.
- The resulting treemap and entry list must immediately return to the initial merge state.
- Reset must not modify the actual source versions.

---

# Entry Selection List

The entry list is displayed **below the resulting treemap**.

It represents all entries considered during the merge and provides controls for deciding which entries should appear in the result.

By default everything is picked.

## Entry Ordering

Entries must be ordered by their hierarchy, similar to a **depth-first traversal**:

1. First, show all entries that exist **only in Source 1**, ordered by hierarchy.
2. Then, show all entries that exist **only in Source 2**, ordered by hierarchy.
3. Finally, show all entries that exist in both sources, ordered by hierarchy.

Within each group:

- Parents appear before their children.
- Children of the same parent appear consecutively.
- Descendants remain grouped underneath their respective parent.
- The ordering should follow a depth-first/tree-traversal-like order rather than alphabetical ordering.

For example:

```text
Parent A
    Child A1
    Child A2
        Child A2.1
    Child A3
Parent B
    Child B1
```

The same hierarchy-based ordering should be used consistently in all three groups.

## Entry List Columns

Each source column displays all parents and the entry itself:

```text
Parent(optional) / Parent(optional) / Parent(optional) / Entry
```

with:

- the parents displayed as normal text;
- the entry value displayed in **bold**.

The result column contains everything required to control the merge result on **one line**:

```text
[Pick] [Omit] [Parent(s) ▼] Entry Value
```

Specifically:

- **Pick button:** add/include the entry in the resulting hierarchy.
- **Omit button:** remove/exclude the entry from the resulting hierarchy.
- **Parent dropdown:** allow the user to choose a parent-hierarchy for the resulting entry. Show the complete path. Set the original parent as active.
- **Entry value:** display the entry's value.

The controls must remain on a single line for each entry.

### Pick and Omit

- **Pick** adds/selects the entry for inclusion in the resulting hierarchy.
- **Omit** removes/excludes the entry from the resulting hierarchy.
- The current state must be visually apparent.
- Selecting or omitting an entry must immediately update the resulting treemap.
- Parent selection in the result column must also immediately update the resulting treemap.
- The same entry must not be included more than once in the resulting hierarchy.

---

# Change Summary

Display a summary of the differences between the two source versions in the **right-hand column**.

At the top of this column, show:

```text
N different entries
```

where `N` is the number of entries that differ between the two source versions.

Below this, list the changes using concise descriptions such as:

```text
Removed Hallo!
Added Research
Modified Example
```

The change list should:

- remain visible while the user edits the merge result;
- describe differences between the **original source versions**, not changes made by the user inside the Merge View;
- use the existing visual language for added, removed, modified, and other change types where applicable;
- be wide enough for the change descriptions to fit without unnecessary wrapping;
- not take more horizontal space than necessary.

The change summary is informational and does not itself determine the merge result.

---

# Merge Preview Consistency

All three components must remain synchronized:

- Changing Pick/Omit in the entry list updates the resulting treemap.
- Changing an entry's parent updates the resulting treemap.
- Reorganizing an entry through drag-and-drop updates the corresponding result hierarchy.
- Clicking an entry in the treemap updates its selection/omission state.
- Reset restores both the list and the resulting treemap to the initial merge state.
- The change summary remains based on the original source versions and does not change as the user edits the merge result.

The Merge View must therefore provide a **live, interactive preview of the actual hierarchy that will be created**, rather than merely displaying a static comparison of the two source versions.