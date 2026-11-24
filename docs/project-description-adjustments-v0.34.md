# Adjustments

Implement the following changes. **Preserve existing behavior unless explicitly changed below.** For each change, update or add automated tests where applicable.

- name the application HIVERSE

---

## 1. Pinging: use global/timeline coordinates

### Bug
Pings currently appear to use **screen-space coordinates** rather than coordinates in the shared/global timeline space.

- The ping location must remain correct regardless of:
  - browser/window size,
  - timeline pan,
  - timeline zoom,
  - per-version zoom/pan where applicable.
- Do not solve this by assuming that all clients have the same viewport dimensions.

### Replay
- Check the interaction-log replay implementation.
- Replay a ping using the same coordinate representation as a live ping.
- Replay must produce the same global location independent of the current viewport.

---

## 2. Stable version numbers for simultaneous peer edits

The test **`simultaneous peer edits keep distinct stable version numbers`** currently fails on github.

---

## 3. Sound

- Mute sound **by default** for every new session.

---

## 4. Zoom level: `focus neighbourhood - 2`

The behavior of zoom level 2 should be deterministic.

### Required behavior
When focusing a version with **`focus neighbourhood - 2`**:
- Always show:
  - the predecessor version,
  - the currently focused version,
  - the successor version if one exists.
- If there is no successor:
  - show only the predecessor and current version.
- The active version must remain active.
- Do not include additional versions merely because they happen to fit in the viewport.

### Edge cases
Handle:
- first version on a timeline,
- last version on a timeline,
- timeline containing only one version.

Add tests for all three cases if not present.

---

## 5. Zoom level: `fit height - 3`

Implement `fit height - 3` based on the **height of the complete branch structure**, not its width.

### Required behavior
- Determine the vertical extent of all branches.
- Zoom such that the complete branch height fits the available view height.
- Use as much horizontal space as necessary; **width is flexible**.
- The active version must be centered horizontally in the viewport.
- The zoom level should be calculated from the branch height and available viewport height.
- Do not let the width of the branch structure unnecessarily change the zoom level.

### Tests
Add tests if not present for:
- a single branch,
- multiple branches,
- branches with different heights,
- a focused version near the beginning,
- a focused version near the end.

---

## 6. Branching on/off must be room-wide

Check and fix the branching toggle.

### Required behavior
The branching setting is a **room-wide shared setting**.

If branching is disabled:
- no peer may create a branch;
- the branching UI/action must be disabled or unavailable for all peers;
- replay must also respect the setting.

If branching is enabled:
- all peers may branch again.

### Synchronization
- The setting must be synchronized between peers.
- A late-joining peer must receive the current branching state.
- Changing the setting must propagate to all connected peers.

### Replay
The replay interaction-log implementation should still work no matter the branching setting and whether someone changes it during creation.

### Tests
Add tests if not present covering:
1. branching enabled → branch succeeds;
2. branching disabled → branch is rejected;
3. disabling branching propagates to peers;
4. late joiners receive the correct setting;
5. re-enabling branching allows branching again.

---

## 7. "Go to end of lane" buttons

Change the symbol used by all **"go to end of lane"** buttons to:

`>>`

and analog for the other button.

---

## 8. Indicator for focused version

For **`focus active version - 1`**, add an indicator showing the position of the focused version within its timeline.

### Required behavior
The indicator must communicate whether:
- the focused version is the latest version on the timeline, or
- there are later versions.

Examples:
- latest version → indicate that it is the latest;
- 1 later version → indicate that 1 later version exists;
- 3 later versions → indicate that 3 later versions exist.

The indicator should update when:
- a new version is created,
- versions are deleted,
- the focused version changes,

Do not hard-code the value when entering focus mode; derive it from the current version graph.

---

## 9. Compact layout propagation

When a version is in **compact layout**:

### Required behavior
If a **new entry is added** to that version:
- the newly created next version should also use compact layout.

This propagation should only work for "add".

---

## 10. Limit maximum zoom

Limit zooming-in so that the maximum zoom level is the same as the maximum zoom reached when using:

**`focus active version - 1`**

Verify via tests.

---

## 11. Timeline panning while hovering over a version

### Bug
Panning the timeline does not work when the mouse is hovering over a version.

### Required behavior
- Timeline panning should work regardless of whether the pointer is currently over a version.
- Preserve existing interactions such as dragging entries and interacting with controls.

### Tests
Add an interaction test for panning while the pointer is over a version.

---

## 12. Copy/paste into an existing treemap

### Bug
When pasting/copying a structure into a version that already contains treemaps, the existing treemaps do not move out of the way.

### Required behavior
Copy/paste should use the **same placement/layout logic as appending a structure**.
Refactor the placement logic into a shared function if the current append and paste implementations duplicate this behavior.

### Tests
Add tests for:
- pasting into an empty version,
- pasting into a version containing one treemap,
- pasting into a version containing multiple treemaps,
- pasting where the available space is constrained,
- ensuring no unintended overlap remains.

---

- add regression tests
- add tests for important edge cases and synchronization behavior
- keep existing tests unless their expected behavior is explicitly changed by these requirements