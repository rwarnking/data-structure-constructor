# Zooming, Interaction Fixes, and Performance

# Zooming and Navigation

## Lane Navigation

Add navigation buttons for each branch/version lane at both ends of the visible application area.

- Each lane has a **left navigation button** and a **right navigation button**.
- The buttons should be positioned at the left and right ends of the corresponding lane.
- The buttons remain associated with their lane while zooming and panning.
- The buttons should not change the underlying data or layout.

### Left Lane Button

Clicking the left button should automatically navigate to the **beginning of that branch**:

- Scroll/pan to the first version of the branch that is **not the root**.
- The target version should be brought into the appropriate visible position.
- Navigation should use the existing smooth navigation animation.
- Position it "attached"/besides the sidebar, moving them when the sidebar is retracted

### Right Lane Button

Clicking the right button should automatically navigate to the **end of that branch**:

- Scroll/pan to the last version currently belonging to that branch.
- The target version should be brought into the appropriate visible position.
- Navigation should use the existing smooth navigation animation.

### Button Dimensions

- Button **width must remain constant**, independent of zoom level.
- Button **height should scale with the current zoom level** so that it remains visually associated with the height of its lane.
- The button must remain usable at all supported zoom levels.

---

# Preset Zoom Settings

Provide four distinct preset zoom/navigation modes:

### 1. Focus on Version

Zoom and position the view so that the selected/active version is the primary focus.

- The version should be clearly readable.
- Use the existing Focus behavior and smooth navigation animation.

### 2. Focus on Neighborhood

Zoom and position the view so that the selected/active version and its surrounding versions/branches are visible.

### 3. Focus on Height

Scale the graph vertically so that the **complete height of all branch lanes** fits within the available browser viewport.

- All branches should be visible vertically.
- Horizontal content may extend beyond the viewport.
- Preserve the existing graph aspect ratio and relative positions.

### 4. Show Everything

Zoom and position the graph so that the **entire visible version graph** fits within the available browser viewport.

- All relevant branches and versions should be visible.
- Preserve the relative layout of the graph.
- Do not modify the underlying graph layout.

---

# Root Rendering and Sizing

The root currently only extends to the combined height of the version lanes. It must instead extend to the **full available browser height**.

- The root height should span the complete graph viewport, not merely the height occupied by the version lanes.
- The root height must update dynamically when the browser viewport changes.
- The root height must also update whenever changes to the graph alter the required layout.
- The root must remain visually connected to the complete version graph.

### Root Label

- The root label/text must be positioned relative to the **current viewing position**, not relative to the geometric center of the root element.
- As the user pans or zooms, the root label should remain centered within the currently visible viewport.
- The label should therefore remain visually centered even though the root itself may be much larger than the current viewport.

---

# Keyboard Shortcuts

Add the following keyboard shortcuts.

### Copy, Cut, and Paste

- **`Ctrl+C`** — copy the currently selected entry or entries.
- **`Ctrl+X`** — cut the currently selected entry or entries.
- **`Ctrl+V`** — paste the copied/cut entry or entries.
- Copy and cut must use the existing entry-copy semantics.
- Pasting must create the appropriate copied hierarchy without modifying the source.
- When multiple entries are selected, copy/cut/paste must operate on the complete selection.
- The shortcuts must not interfere with normal text editing inside input fields.
- When focus is inside an editable text field, the browser's normal copy/cut/paste behavior must remain unchanged.

### Select All

- **`Ctrl+A`** — select all entries in the currently active version.
- `Ctrl+A` must apply to the active version rather than selecting entries across the entire graph.
- When focus is inside a text input or textarea, preserve the browser's normal text-selection behavior instead.

### Center

- **`Ctrl+O`** — secondary hotkey for **Center/Focus**.
- It should perform the same action as the existing Center/Focus command.
- Preserve the existing `F` hotkey.

### New Entry

- **`Ctrl+N`** — secondary hotkey for **New Entry**.
- It should perform the same action as the existing New Entry command.
- The shortcut must operate on the currently active version/root according to the existing New Entry behavior.
- When focus is inside an editable text field, do not intercept the browser's normal behavior.

---

# Search

Add a graph search function that can be activated with **`Ctrl+F`**.

### Search Activation

- Pressing **`Ctrl+F`** opens the application's search interface.
- The browser's default page-search behavior must be prevented while the application search is active.
- When focus is inside an editable text field, preserve the normal browser/text-field behavior unless the search is explicitly invoked from outside the editor.

### Search Targets

The search should allow the user to search for a **specific version**.

- Search by the version's complete identifier.
- Have three input fields for the three version components. Have the dots preset in the UI between them.
- Show a list of matching versions.
- Only start searching which either of the three input fields contains something.
- Selecting a search result should focus the corresponding version.
- If the matching version is not currently visible, the graph should navigate to it using the existing smooth navigation behavior.

### Recent Searches

When the search interface is opened, show the **three most recently searched items**.

- Recent searches are stored **per user**.
- The three most recent searches should be ordered newest first.
- Repeating an existing search should move it to the top rather than creating a duplicate.
- Recent searches should persist between sessions using the existing local storage mechanism.
- Recent searches are user-specific and must not be shared with other collaborators.

---

# Version Numbering

Make version numbering **continuous and structurally meaningful**.

Each version identifier should consist of:

```text
step.branch.subbranch
```

with all components using leading zeros.

For example:

```text
1.01.001
```

### Components

- **Step number:** identifies the version's position in its branch/history.
- **Branch number:** identifies the branch.
- **Subbranch number:** identifies the subbranch within that branch.
- The step number must always use the configured leading-zero format.
- subbranch identifiers must also use leading zeros.
- The numbering must be displayed consistently throughout the application.

### Step Numbering

- Step numbers must be **continuous within a branch**.
- The first version of a branch starts at the appropriate initial step number.
- Each subsequent version increments the step number by one.
- Creating a version must not reuse an existing step number within the same branch.
- Branching from an existing version must follow the existing branch/version semantics while maintaining continuous numbering.

### Uniqueness

The complete version identifier must be **globally unique within the room**.

The implementation must explicitly verify whether the proposed:

```text
step.branch.subbranch
```

scheme can produce duplicate identifiers.

If the three components are not sufficient to guarantee uniqueness in all supported branching scenarios, extend the identifier scheme or adjust the numbering rules so that **two different versions can never receive the same identifier**.

In particular:

- Visual lane ordering must not affect the identifier.
- Moving a branch to another lane must not change its identifier.
- Creating a new branch or subbranch must not reuse an existing branch/subbranch identifier in a way that produces a duplicate.
- Version identifiers must remain stable after layout changes.
- The identifier must uniquely identify the version independently of its screen position.

### TODO

Before finalizing the implementation, verify with concrete branching scenarios whether `step.branch.subbranch` is sufficient to guarantee uniqueness.

For example, test cases should include:

- multiple branches from the same version;
- branches of branches;
- multiple subbranches from the same branch;
- merges;
- branching from an earlier version;
- repeated branching and merging;
- visually reordered branches.

If a duplicate is possible, resolve the numbering scheme before implementing it rather than adding a separate hidden identifier while displaying a potentially ambiguous version number.


----

- group entries feature, auto add to a new entry as parent
- import export data
- allow to box select
- allow to move the selection

- recipes
- rollercoaster
- jobs
- farytales