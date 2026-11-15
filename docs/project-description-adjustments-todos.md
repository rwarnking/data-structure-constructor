# List of Adjustments

## 3. Version Transitions and Animations

### 3.1 New Version Creation

- Add a transition animation when a new version is created.
- The animation should visually communicate the relationship between the previous version and the newly created version.
- Suggested animation:
  1. Create the new version window as an overlay on top of the previously modified version.
  2. Gradually move the new version window alongside the branch connection arrow.
  3. Extend the branch connection line during the animation until it reaches the new version's final position.
  4. Finish with the new version in its final position within the version graph.
- The animation should make the creation of a new version understandable without interrupting ongoing interaction.
- Ensure that the final layout is independent of the animation.

## 4. Version Comparison and Branch Operations

### 4.1 Highlight Version Differences

- Introduce a visual mechanism for identifying differences between two consecutive versions.
- Highlight the following changes:
  - Added entries.
  - Removed entries.
  - Modified entries (e.g., changed names or values).
  - Relocated entries (changed parent or hierarchy position).
  - Unchanged entries.
- Distinguish between structural changes (hierarchy changes) and content changes (value/name changes).
- The visualization should allow users to understand what changed without manually comparing both versions.
- Difference highlighting should be optional and toggleable.
- Use a consistent visual encoding for all difference types.

## 8. Misc

- add short paper comparisson graph as alternative visual (for comparisson but also in the timeline view)
- outline+dropshadow in darkmode

## 8

- copy entry connector line is sometimes changing on zoom

- two different toolbars depending on context (version tree view, or treemap view)

- commits

- recipes
- rollercoaster
- jobs
- farytales