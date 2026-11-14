# Zooming, Interaction Fixes, and Performance

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

- version focus should update on canvas resize

- recipes
- rollercoaster
- jobs
- farytales