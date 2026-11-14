# Version Layout, Bulk Operations, and Merge/Split

## 2. Version Layout and Navigation

### 2.3 Version Window Dimensions

Make the dimensions of version windows responsive to the available browser viewport, excluding the sidebar.

- Version windows should use the available viewport efficiently.
- Version windows should use the **same aspect ratio as the available browser viewport**.
- The layout must adapt when the browser window is resized.
- Recalculate the version-window dimensions dynamically when the browser viewport changes.
- Resizing the browser must **not** change the contents, hierarchy, or internal layout of any version. Only the available viewport and resulting version-window dimensions may change.
- All version windows should use consistent dimensions whenever possible.
- Always subtract the sidebar width from the viewport width when calculating the viewport even if it is retracted and not visible.

### Suggested Behavior

Version-window dimensions should be derived from the available viewport rather than fixed pixel dimensions.

For example:

- **Wide viewport:** version windows may become wider.
- **Narrow viewport:** version windows become proportionally narrower, while respecting a minimum readable width.
- **Very tall/narrow or very short/wide viewport:** constrain the dimension that would otherwise become excessive.
- If the available viewport becomes too small to maintain the preferred dimensions, prioritize keeping version windows usable rather than enforcing the aspect ratio exactly.

---

# 3. Bulk Operations

Allow users to perform multiple entry operations as a **single version change**.

## 3.1 Bulk Add

Extend the existing Add Entry dialog to support adding multiple entries at once.

- The dialog initially contains one entry row.
- Provide a **`+` button** to add additional entry rows.
- Each row must provide the same fields and validation as the existing single-entry creation.
- Users can add and remove rows before confirming.
- Empty or invalid rows must be handled consistently with the existing entry-validation behavior.
- Confirming multiple entries must create **one new version containing all additions**.
- Do **not** create one version per entry.

For example:

```text
Version 3
    ↓
[add A, add B, add C]
    ↓
Version 4
```

not:

```text
Version 3
    ↓ add A
Version 4
    ↓ add B
Version 5
    ↓ add C
Version 6
```

## 3.2 Bulk Delete

Allow multiple selected entries to be deleted as one operation.

- Users must be able to select multiple entries simultaneously.
- Extend the existing selection mechanism rather than introducing a separate selection system where possible.
- Deleting multiple selected entries must create **one new version containing all deletions**.
- Do **not** create one version per deleted entry.
- The deletion must respect the existing rules for deleting entries with children.

For example:

```text
Version 3
    ↓
[delete A, B, C]
    ↓
Version 4
```

not:

```text
Version 3
    ↓ delete A
Version 4
    ↓ delete B
Version 5
    ↓ delete C
Version 6
```

### Bulk Operation Consistency

- Bulk add and bulk delete are **atomic version operations**.
- If the operation is canceled or validation fails, **no new version is created**.
- The Interaction Log records the complete bulk operation as **one action**, rather than logging each individual change separately.
- Canceling an operation cancels the complete operation.
- All changes belonging to one bulk operation must be committed together.

---

# 5. Merge and Split Operations

Implement merge and split operations for treemap entries while preserving a valid hierarchy.

## 5.1 Merge Entries

Allow multiple selected entries to be merged into a single entry.

- Merge is available only when **at least two entries are selected**.
- The merge action should be available through the appropriate context/action menu.
- The resulting entry replaces all selected entries.
- The user should be prompted for the resulting entry's value/name and any other required information, using the existing entry editor where appropriate.
- All children of all selected entries must be preserved.
- The children of the selected entries become children of the resulting entry.
- Children that were already descendants of another selected entry must not be duplicated.
- Preserve the existing descendant hierarchy wherever possible.
- The resulting hierarchy must contain no cycles or invalid parent relationships.
- The resulting entry inherits the parent of the **highest selected entry** in the hierarchy.
- If the selected entries have different parents, the parent of the highest selected entry becomes the parent of the resulting entry.
- If the selected entries are siblings, their common parent remains the parent of the resulting entry.
- Merging must create **one new version**.
- The original version remains unchanged.

### Merge Edge Cases

#### Selected entries are siblings

The common parent remains unchanged.

Example:

```text
Parent
├── A
├── B
└── C
```

Merging A and B produces:

```text
Parent
├── M
└── C
```

All children previously belonging to A or B become children of M.

#### Selected entries have different parents

The resulting entry uses the parent of the **highest selected entry**.

All selected entries' children are transferred to the resulting entry.

#### One selected entry is an ancestor of another

The resulting entry replaces the highest selected entry and therefore uses its original parent.

Children belonging to the selected entries are transferred to the resulting entry.

The operation must avoid creating a cycle. In particular, the resulting entry must not become its own ancestor or descendant.

#### Selected entries have overlapping descendants

Shared or overlapping descendants must not be duplicated.

Each resulting entry must have a single valid parent, and the final hierarchy must remain acyclic.

### General Merge Validity

After the merge:

- Every resulting entry has at most one parent.
- No entry is its own ancestor or descendant.
- No cycles exist.
- No child is duplicated because of the merge.
- All non-selected entries remain unchanged except where their parent relationship must change as a direct consequence of the merge.

---

## 5.2 Split Entries

Allow a single entry to be split into multiple new entries.

- Split is available through the appropriate entry context menu.
- Opening Split displays a dedicated dialog.
- The dialog allows the user to define the **value/name and description** of each resulting entry.
- Users can add and remove result-entry rows before confirming.
- At least **two** resulting entries must be defined.
- The user must be able to assign each existing child of the original entry to exactly one of the newly created entries.
- Child assignments must be visible and editable within the Split dialog.
- Every existing child must have exactly one destination before the split can be confirmed.
- Children remain unchanged except for their new parent.
- The new entries inherit the original entry's parent.
- The original entry is replaced by the newly created entries.
- The split must create **one new version**.
- Canceling the dialog leaves the current version unchanged.

### Split Edge Cases

Handle explicitly:

- **Entry with no children:** simply create the requested number of new entries.
- **Entry with many children:** allow each child to be assigned manually to one of the resulting entries.
- **Duplicate values/names:** allowed; existing duplicate-value behavior applies.
- **Canceling:** no changes and no new version are created.
- **Invalid or incomplete assignments:** the split cannot be confirmed until every child has exactly one valid destination.
- **One resulting entry with no children:** allowed.
- **All children assigned to the same resulting entry:** allowed.
- **Resulting entries with different numbers of children:** allowed.

### Split Validity

After the split:

- Every resulting entry has the same parent as the original entry.
- Every original child has exactly one new parent.
- No children are lost or duplicated.
- No cycles are introduced.
- The original entry no longer exists in the new version.
- All other entries and relationships remain unchanged.