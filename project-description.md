# Data Structure Constructor

## 1. Overview

The **Data Structure Constructor** is a web application for interactively creating and modifying hierarchical data structures while preserving their complete history.

The main interface is an **infinite canvas** that visualizes the history of modifications as a **version graph**. Each version of the data structure is represented by a **version node**. A modification to a version creates a new version node connected to the version from which it originated.

The resulting graph is similar to a Git commit graph: a version can have one successor in the current branch, but modifying an earlier version creates a new subbranch.

The system supports:

- sequential modification of a hierarchical data structure,
- creating multiple independent branches from the empty data structure,
- branching from any existing version,
- navigating through the version graph,
- copying data between branches,
- interactively manipulating the contents of individual versions,
- semantic zooming through different levels of detail,
- pruning branches and subbranches, and
- comparing different versions.

The initial version is an **empty data structure** and serves as the root of the version graph.

### 1.1 Data Structure

The architecture should ideally support different types of data structures, such as lists or hierarchical structures such as JSON-like trees.

For the current implementation, the data structure is a **tree**. Each entry contains a string value and is connected to its parent and children.

The data is visualized using treemaps.

The server only needs to save one instance of the datastructure. No accounts or other features for saving data are needed.

### 1.2 Technology Stack

- vue.js
- d3.js (treemap, ...)

---

# 2. Version Graph

## 2.1 Versions

Each node in the version graph represents one concrete version of the underlying data structure.

For example:

```text
Version 0 → Version 1 → Version 2 → Version 3

Empty       Leaf 1      Leaf 1,      Leaf 1
                        Leaf 2       └─ Leaf 2
```

Here:

- Version 0 contains the empty data structure.
- Version 1 contains `Leaf 1`.
- Version 2 additionally contains `Leaf 2`.
- Version 3 attaches `Leaf 2` as a child of `Leaf 1`.

Each version has a globally unique identifier.

In addition to its unique identifier, a version has a **step number**, describing its distance from the root. Step numbers are used to align versions from different branches.

## 2.2 Branches

A **branch** is a sequence of versions connected through successive modifications.

The root can have multiple independent branches. These are called **origin branches** because they originate directly from the empty root version.

An origin branch can itself be divided into multiple **subbranches** whenever an earlier version is modified.

For example:

```text
                         → V2a → V3a
                        /
Root → V1 → V2
             \
              → V2b → V3b
```

Here:

- `Root → V1 → V2` is an origin branch.
- `V2a → V3a` and `V2b → V3b` are subbranches originating from `V2`.

Multiple origin branches are also possible:

```text
              → V1a → V2a
             /
Root ───────
             \
              → V1b → V2b
```

Thus, the version graph can contain multiple independent origin branches, each of which can contain arbitrarily many levels of subbranches.

A new branch is created whenever a modification is made to a version that already has a later successor in the currently displayed history.

The graph therefore represents alternative histories of the data structure.

---

# 3. What Creates a New Version?

A distinction must be made between **visual manipulation** and **data-structure modification**.

### Changes that create a new version

A new version is created whenever the underlying data structure changes, including:

- creating a data entry,
- deleting a data entry,
- changing the value of a data entry,
- attaching a leaf to another entry,
- attaching a subtree to another entry,
- detaching a leaf,
- detaching a subtree,
- changing the parent of an entry, or
- moving an entry between hierarchical groups.

### Changes that do not create a new version

Purely visual changes do not create a new version. These include:

- panning,
- zooming,
- changing the viewport,
- repositioning an element within the version view without changing its hierarchical relationship.

Consequently, users can freely arrange the visual representation of a version without generating additional versions.

If a drag-and-drop operation changes the hierarchy, however, it creates a new version.

A preview is never part of the version history. Only the committed result becomes a version.

---

# 4. Version View

Each version contains an interactive **version view** representing its data structure.

The version view itself behaves as a canvas. It can contain:

1. **one main hierarchical treemap**, representing the main tree structure, and
2. **one separate treemap for every free-floating element**.

A free-floating element can be either:

- a leaf, or
- an entire subtree.

Consequently, a version may contain an arbitrary number of independent treemaps.

For example:

```text
Version View

┌─────────────────────────────┐
│ Main hierarchy              │
│                             │
│ ┌───────┐ ┌───────────────┐ │
│ │Leaf A │ │ Subtree B     │ │
│ └───────┘ └───────────────┘ │
│                             │
└─────────────────────────────┘

      ┌───────────┐
      │ Free Leaf │
      └───────────┘

             ┌──────────────┐
             │ Free Subtree │
             └──────────────┘
```

Each of these elements is visualized using a treemap.

The main hierarchy is therefore not the only treemap in a version. **Every independently positioned hierarchical element is represented as its own treemap.**

## 4.1 Spatial Positioning

The individual treemaps can be positioned freely within the version view.

Changing the position of a treemap does not change the underlying data structure and therefore does not create a new version.

Changing the relationship between treemaps does create a new version.

For example:

- moving a free-floating subtree to another location → **no new version**
- dragging a free-floating subtree onto a leaf → **new version**
- dragging a leaf out of its parent and making it free-floating → **new version**

---

# 5. Treemap Representation

The contents of every version are visualized using treemaps.

The main hierarchical structure is represented as one treemap.

A free-floating leaf or subtree is represented as another treemap.

The treemap representation should adapt to the amount and structure of data contained within it.

For example, a free-floating subtree containing:

```text
A
├── B
├── C
└── D
```

is represented as a single treemap containing `A`, `B`, `C`, and `D`.

The main hierarchy is represented in the same way.

This allows the visual representation to remain consistent regardless of whether an element is currently attached to the main hierarchy or floating independently.

---

# 6. Interactions

## 6.1 Creating Entries

The user can create a new data entry using:

**Right click → New**

The application prompts the user for the value of the new entry.

After confirmation:

1. the data structure is modified,
2. a new version is created,
3. the new version is added to the version graph, and
4. the view automatically transitions to the new version.

The newly created entry becomes part of the main hierarchy unless another behavior is explicitly selected.

## 6.2 Deleting Entries

The user can delete an entry using:

**Right click → Delete**

Deleting an entry creates a new version.

When deleting a non-leaf entry, the behavior is determined by a **preset deletion setting**.

The setting can define, for example:

- **Delete subtree:** the selected entry and its complete subtree are deleted.
- **Detach children:** the selected entry is deleted, while its children become free-floating elements.

The selected behavior is configured independently of the individual deletion operation.

## 6.3 Changing Values

The user can change the value of an entry using:

**Right click → Change**

Changing the value creates a new version.

---

# 7. Drag and Drop

Drag and drop is used both for **spatial positioning** and for **changing hierarchical relationships**.

The system must clearly distinguish between these two types of interaction.

## 7.1 Spatial Movement

A leaf or subtree can be dragged to an empty area within the version view.

This only changes the spatial position of its treemap.

It does **not** modify the underlying data structure and therefore does **not** create a new version.

The original version remains unchanged except for the visual position of the element within that version.

For example:

```text
Before:

┌───────────────┐
│ Main Tree     │
└───────────────┘

                  ┌──────────┐
                  │ Tree B   │
                  └──────────┘


After moving Tree B:

┌───────────────┐
│ Main Tree     │
└───────────────┘

        ┌──────────┐
        │ Tree B   │
        └──────────┘
```

No new version is created.

---

## 7.2 Structural Drag and Drop

Dragging a leaf or subtree onto another leaf or subtree is interpreted as an attempt to **change the hierarchy**.

This applies regardless of whether the source and target are currently part of the main hierarchy or are both free-floating.

For example:

```text
Before:

┌──────────┐       ┌──────────┐
│ Tree A   │       │ Tree B   │
└──────────┘       └──────────┘

             drag B onto A
                    ↓

┌──────────────────────────┐
│ Tree A                   │
│   └── Tree B             │
└──────────────────────────┘
```

The actual modification is **not committed immediately when dragging begins**.

Instead, the operation consists of three stages:

1. **Dragging**
2. **Preview**
3. **Commit**

---

## 7.3 Stage 1 — Dragging

When the user starts dragging an element:

- the selected leaf or subtree follows the pointer,
- the original data structure remains unchanged,
- no new version is created,
- the source element remains identifiable,
- potential targets can be detected as the element is moved.

The dragged element should be visually distinguished from the other elements.

The original position may be represented by a placeholder so that the user can clearly see which element is being moved.

---

## 7.4 Stage 2 — Structural Preview

When the dragged element is moved over a valid target, the target is **highlighted**.

At the same time, the application displays a **live preview of the resulting data structure**.

The preview should show how the version would look if the dragged element were attached to the highlighted target.

For example:

```text
Current structure:

┌───────────────┐       ┌───────────────┐
│ Tree A        │       │ Tree B        │
└───────────────┘       └───────────────┘


While dragging Tree B over Tree A:

┌────────────────────────────────┐
│ Tree A                         │
│                                │
│     ┌────────────────────┐     │
│     │ Tree B             │     │
│     └────────────────────┘     │
│                                │
└────────────────────────────────┘
             ↑
       highlighted target
```

The preview should be continuously updated as the pointer moves.

The purpose of the preview is to make the consequences of the structural modification clear **before the user commits it**.

The preview may therefore animate the expected restructuring of the treemap.

For example, when a free-floating subtree is dragged onto a leaf, the target leaf can expand or rearrange its treemap to show the position that the subtree would occupy after attachment.

The preview is temporary and does not alter the actual version.

---

## 7.5 Stage 3 — Commit

The structural modification is committed only when the user releases the dragged element over a valid target.

At that point:

1. the proposed structural modification is applied,
2. a new version is created,
3. the new version is connected to the current version in the version graph,
4. the new version becomes the active version,
5. the resulting data structure is displayed, and
6. the view transitions to the new version.

The original version remains unchanged.

For example:

```text
Before:

Version A
   │
   ├── Tree A
   └── Tree B


Drop Tree B onto Tree A:


Version A ─────────→ Version B
                       │
                       └── Tree A
                           └── Tree B
```

The transition to Version B should happen automatically after the drop.

---

## 7.6 Detaching Elements

The same interaction model applies when detaching an element from the hierarchy.

The user can drag an attached leaf or subtree away from its current parent.

While dragging:

- the original version remains unchanged,
- the potential new state is previewed,
- the element can be moved freely over the canvas.

When the element is released in an empty area, it becomes a **free-floating element**.

This constitutes a structural modification and therefore creates a new version.

For example:

```text
Before:

┌───────────────────────┐
│ Parent                │
│   └── Subtree         │
└───────────────────────┘


Drag Subtree away:


┌───────────────┐
│ Parent        │
└───────────────┘

                    ┌───────────────┐
                    │ Subtree       │
                    └───────────────┘
```

The resulting version therefore contains two separate treemaps.

---

## 7.7 Attaching Free-Floating Elements

Free-floating elements can be attached to one another.

For example:

```text
Before:

┌──────────────┐        ┌──────────────┐
│ Subtree A    │        │ Subtree B    │
└──────────────┘        └──────────────┘


Drag B onto A:


┌──────────────────────────┐
│ Subtree A               │
│   └── Subtree B         │
└──────────────────────────┘
```

This operation creates a new version.

The same mechanism applies to:

- leaf → leaf,
- leaf → subtree,
- subtree → leaf,
- subtree → subtree.

The resulting hierarchy is determined by the direction of the drag:

**dragged element → target element**

The dragged element becomes a child of the target element.

---

## 7.8 Moving an Already Attached Element

An already attached element can also be dragged onto another element.

For example:

```text
Before:

A
├── B
└── C


Drag B onto C:


A
└── C
    └── B
```

The preview should show the resulting hierarchy before the operation is committed.

Dropping B onto C changes B's parent and therefore creates a new version.

---

## 7.9 Preventing Invalid Hierarchies

The application must prevent operations that would produce an invalid hierarchy.

In particular, an element must not be allowed to become its own ancestor.

For example:

```text
A
└── B
    └── C
```

Dragging `A` onto `C` would create:

```text
A
└── B
    └── C
        └── A
```

which is invalid because it creates a cycle.

Such a target must therefore be treated as invalid:

- it is not highlighted as a valid target,
- no structural preview is shown,
- dropping the element does not modify the data structure.

---

## 7.10 Selection and Highlighting

The currently selected element should always be visually distinguishable.

During a drag operation, three different visual states should be distinguishable:

1. **Dragged element**
   The element currently being moved.

2. **Potential target**
   The element currently under the pointer and capable of receiving the dragged element.

3. **Preview result**
   The temporary representation of the hierarchy that would result from dropping the dragged element onto the target.

These states should remain visually distinct from the **active version** highlighting.

---

## 7.11 Interaction Summary

The complete interaction can therefore be summarized as:

```text
                    Start drag
                        │
                        ▼
                 ┌─────────────┐
                 │   Dragging  │
                 └──────┬──────┘
                        │
              ┌─────────┴─────────┐
              │                   │
        Empty space          Valid target
              │                   │
              ▼                   ▼
       Spatial movement       Preview
       No new version            │
                                 │
                          ┌──────┴──────┐
                          │             │
                       Cancel        Release
                          │             │
                          ▼             ▼
                    No modification  Commit
                                        │
                                        ▼
                                  Create version
                                        │
                                        ▼
                                  Activate version
```

The key rule is:

> **Dragging alone never creates a version. A version is created only when a structural change is committed.**

# 8. Copying Data Between Branches

Data can be copied from one version to another using the normal clipboard interaction:

**Ctrl+C → Ctrl+V**

The source version remains unchanged.

The copied data is inserted into the target version, creating a new version of the target branch.

## 8.1 Copying Leaves

When a leaf is copied, the leaf itself is copied.

The copied leaf is a **free-floating** leaf in the target version.

## 8.2 Copying Subtrees

When a subtree is copied, the **complete subtree is copied**, including all of its internal hierarchical relationships.

For example:

```text
Source:

A
├── B
├── C
└── D
```

becomes:

```text
Copied subtree:

A
├── B
├── C
└── D
```

The copied subtree is always inserted into the target version as a **free-floating subtree**.

It is not automatically attached to the target hierarchy.

The user can subsequently attach the subtree using drag and drop.

This ensures that copying data does not implicitly modify the hierarchy beyond adding the copied data.

## 8.3 Copying Across Branches

Copying between versions on different branches is represented visually by an **arched connection arrow** from the source entry to the corresponding copied entry.

The arrow is distinct from the ordinary version-history connections.

If the target version is an existing version, the paste operation creates a new version derived from that target version.

The new version therefore becomes part of the target version's branch structure.

---

# 9. Pruning Branches

The user should be able to **prune branches and subbranches** from the version graph.

Pruning removes a selected branch from the graph starting at a specified version.

For example:

```text
             → V3a → V4a
            /
V1 → V2
            \
             → V3b → V4b
```

Pruning the lower branch removes:

```text
V3b → V4b
```

while leaving:

```text
V1 → V2 → V3a → V4a
```

unchanged.

Pruning should remove the selected version and all versions that exist exclusively below it.

The root version cannot be pruned.

Pruning a branch that contains data referenced by cross-branch copy operations is not possible.

---

# 10. Automatic Navigation Between Versions

When a modification creates a new version, the newly created version becomes the **active version**.

The interface automatically transitions from the current version to the new version.

The version views should have consistent dimensions so that the transition can appear seamless.

The contents of the newly active version should remain approximately in the same screen position. The surrounding version graph changes around it.

This should make the creation of a new version feel like moving forward through the version graph rather than opening a completely different view.

---

# 11. Infinite Canvas and Version Graph Layout

The version graph is displayed on an infinite canvas.

The user can:

- pan,
- zoom,
- navigate between branches,
- focus on individual versions, and
- inspect neighboring versions.

New versions are placed to the right of their parent by default.

Versions at the same step number should be vertically aligned where possible.

The layout should prevent version views and connection lines from overlapping.

### Branch positioning

New origin branches are placed below existing origin branches.

If an existing origin branch subsequently creates additional subbranches, these subbranches are positioned close to their origin branch. Other origin branches are pushed downward as necessary so that their relative ordering remains stable.

Within an origin branch:

- the **main branch** is the longest/current continuation,
- subbranches are positioned around the main branch,
- subbranches are ordered according to their branching position,
- a subbranch originating later should generally be positioned closer to the main branch.

The main branch should visually form the primary horizontal sequence:

```text
V1 → V2 → V3 → V4 → ...
```

Subbranches extend above or below this sequence.

A connection line should never pass through a version view.

A button should allow the user to center the currently most advanced version.

The user cannot pan infinitely to the left because the root version defines the leftmost boundary of the version graph.

---

# 12. Level of Detail and Semantic Zoom

Because the version graph can become very large, the visualization uses **semantic zoom**.

The amount of information displayed within each version depends on the current zoom level.

## LOD 1 — Full Detail

The complete version is displayed.

- All treemaps are visible.
- Individual entries are visible.
- Hierarchical relationships are visible.
- Entry values are displayed.
- Interactions are enabled.
- Drag and drop is enabled.
- Context menus are enabled.

The text displayed inside each treemap element should adapt to the available size of the element.

The active version should remain large enough to interact with while retaining sufficient surrounding context to show its predecessor and neighboring branches.

## LOD 2 — Reduced Detail

Only part of the hierarchy is shown in detail.

The hierarchy is displayed up to a configurable depth. Below that depth, subtrees are aggregated.

Aggregated areas display information such as the number of contained elements.

Individual entries below the aggregation level are not displayed.

Interactions with individual entries are disabled.

## LOD 3 — Structural Overview

The version is represented only by a compact structural summary.

Possible information includes:

- total number of entries,
- number of hierarchy levels,
- number of subtrees,
- number of free-floating elements.

Interactions are disabled for all LODs except LOD 1.

The interface should clearly indicate whether the currently displayed version is interactive.

---

# 13. Active Version and Selection

At any point, exactly one version is the **active version**.

The active version is visually highlighted in the version graph.

Only the active version can be modified.

Within the active version, the currently selected entry should also be clearly highlighted.

Selection is particularly important during drag-and-drop operations because it identifies the target of a potential hierarchical modification.

The selected entry should remain visually distinguishable from the general active-version highlighting.

---

# 14. Visual Design

## 14.1 Root Version

The root version represents the empty data structure.

It should vertically occupy the available viewport and serve as the visual starting point of the version graph.

Its width should be identical to derived versions.

All subsequent versions should have consistent dimensions so that moving between versions does not require a change in scale.

## 14.2 Version Connections

Versions are connected by lines representing their parent-child relationship.

For a simple sequence:

```text
V1 ───── V2 ───── V3 ─────→
```

Only the connection after the last version of the currently represented branch should have an arrowhead.

The line should continue beyond the final version for approximately half the distance to the next potential version position, with the arrowhead at its end.

Branching connections should use smooth curves:

```text
                         ───── V3a ─────→
                        /
V1 ───────────── V2 ───
                        \
                         ───── V3b ─────→
```

The graph layout should prioritize readability and prevent lines from crossing version views.

## 14.3 Branch Colors

Each origin branch should have its own color.

Subbranches should retain the visual identity of their origin branch while being distinguishable from the main branch and from sibling subbranches.

Branch identifiers should also be displayed so that branch identity does not depend solely on color.

Multiple origin branches should remain visually distinct.

## 14.4 Cross-Branch Copying

A copy operation between versions is represented by an arched arrow:

```text
Source entry
     │
     │
     ╰──────────────────→ Copied entry
```

This arrow should use a visual encoding that is clearly distinguishable from version-history connections.

---

# 15. Version Comparison

The application should provide a mechanism for comparing two versions.

A **Compare** mode allows the user to select any two versions in the graph.

The comparison should identify:

- added entries,
- deleted entries,
- changed values,
- changed parent-child relationships,
- newly detached elements,
- newly attached elements, and
- other structural differences.

For example:

```text
Version A                 Version B

Leaf 1                    Leaf 1
└── Leaf 2                ├── Leaf 2
                          └── Leaf 3
```

The comparison should visually highlight the differences between the two versions.

Different types of changes should ideally have distinct visual encodings.

---

# 16. Data Model and Architecture

The implementation should separate at least three conceptual layers.

### 1. Version Graph

Responsible for:

- versions,
- parent-child relationships between versions,
- branches and subbranches,
- origin branches,
- step numbers,
- modification history,
- pruning.

### 2. Data Structure

Responsible for:

- entries,
- values,
- parent-child relationships,
- free-floating leaves,
- free-floating subtrees.

### 3. Visualization

Responsible for:

- treemap generation,
- spatial positions,
- version graph layout,
- zoom level,
- selection,
- highlighting,
- drag-and-drop previews,
- comparison visualization.

The data model should be independent of its visualization.

For the current implementation, the data structure is a tree and every hierarchical component is represented using a treemap.

Each version should conceptually contain or reference:

- its parent version,
- the modification that produced it,
- the resulting data structure,
- the spatial positions of the treemaps,
- the relationships between the main hierarchy and free-floating elements.

The architecture should make it possible to replace the underlying data structure or visualization method in the future without redesigning the version graph.

---

# 17. Important Interaction Principle

The central interaction principle is:

> **Spatial manipulation is reversible within a version; structural manipulation creates a new version.**

Moving, zooming, and arranging the visualization does not change the version history.

Creating, deleting, renaming, attaching, detaching, or otherwise modifying the underlying data structure creates a new version.

This distinction is fundamental to the application because it allows users to freely explore the visual layout while preserving a precise history of all structural changes.