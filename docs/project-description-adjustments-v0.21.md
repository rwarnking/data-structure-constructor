## 1. Version Transitions and Animations

When a new version is created, the version card/window is currently animated into its final position. Keep this animation.

However, the connector arrow at the end of the transition currently appears before the version card/window has reached its final position.

Change the animation so that The arrow only becomes visible once the new version card/window has reached its final position.
Make sure this also works correctly at different zoom levels and when the graph is panned.

---

## 2. Version Comparison and Branch Operations

### 2.1 Highlight Version Differences

Change how entry highlighting works.

Currently, the outline is used to highlight hovered or selected entries. Instead:

- Use the **fill color** to indicate hover/selection.
- Do not use the outline for hover/selection.

The **outline should exclusively be used to show differences between two consecutive versions**.

When comparing consecutive versions, highlight all entries that were:

- Added
- Modified
- Relocated
- Merged
- Resulting entries from a split

The difference highlighting should be visually distinguishable from the normal selection/hover fill, but can use the same color regarless of what change it was.

Important:

- Preserve the underlying entry colors as much as possible.
- Make the difference outline work in both light and dark mode.
- Do not make the difference outline interfere with normal selection, hover, dragging, or other interactions.

---

## 2.2 Branch Continuation After Merge

Fix the branch/lane assignment logic for merges.

Check the Example:

- Version `15.01.009`
- Version `15.01.005`

When these two versions are merged, the resulting merged version should **continue the branch/lane of `15.01.005`**.
Currently, the merged version incorrectly receives its own new lane.
Add tests for this.

---

## 2.3 Connector Symbols

Remove the symbols/icons currently displayed on the connector lines completely.

Instead:

- Put the corresponding action symbol into the **title/header of the destination version**.
- The connector itself should contain no action symbol.
- The connector should continue to visually represent the relationship/transition only.
- Make sure the symbol remains correctly associated with the action that created the destination version.

This should apply consistently to all relevant version transitions, including normal changes, branches, merges, splits, etc.

---

## 4. LOD2 Version View

Rework the visual design of the version card in **LOD2**.

The goal is to make the available information as large and readable as possible.

### Top half

The top half of the version card should contain:

- The action symbol
- The change/action text

Layout:

- The **symbol should occupy the top-left quadrant** and be as large as reasonably possible.
- The **change text should be placed next to the symbol** and use the remaining space in the top half.
- Both should make maximum use of the available space.
- The symbol and text should remain readable at the intended LOD2 scale.

### Bottom half

The two remaining version-number components should be displayed below the symbol/change area.

- Make these numbers as large as reasonably possible.
- Use the available vertical space efficiently.
- Keep the relationship between the two numbers clear.

Do not unnecessarily reduce the font size to preserve the previous layout. LOD2 is specifically intended to provide a large, easily readable representation.

### Tagged versions

If the version has a tag:

- Display a **large tag symbol** prominently in the version view.
- The tag symbol should be visually obvious at LOD2.
- It should not obscure the version numbers or action information.
- Use the same visual identity as the tag indicator elsewhere in the application.

Make sure tagged and untagged versions both have a balanced layout.

---

## 4. Centralized Theme / Color Configuration

Create a dedicated configuration file containing the colors/styles used throughout the application.

The purpose is to make the visual design easy to modify and to make it possible to add additional themes/styles later.

At minimum, centralize the colors for:

- Light mode
- Dark mode
- Backgrounds
- Version cards
- Entries
- Selected/hovered entries
- Difference outlines
- Branch/connectors
- Text
- Secondary/muted text
- Tags
- Important UI states
- Any other colors currently hard-coded in CSS or JavaScript that are part of the application theme

Use semantic names rather than names tied to a specific visual color where practical, e.g.:

```js
light: {
  background: ...,
  surface: ...,
  text: ...,
  textMuted: ...,
  entry: ...,
  entrySelected: ...,
  differenceOutline: ...,
  connector: ...,
  tag: ...
}

dark: {
  ...
}
```

The exact structure is up to you, but it should provide:

- One central place to change colors.
- Clear separation between light and dark themes.
- Easy addition of future themes.
- No unnecessary duplication of color values throughout components/CSS.

Refactor existing hard-coded theme colors into this configuration where practical.

Do not turn every arbitrary CSS value into configuration. Focus on actual visual/theme properties.

---

## 5. Tests

Add or update automated tests for all affected behavior.

### Version creation animation
- New version is animated to its final position.
- Connector arrow is not shown prematurely.
- Connector appears after the version reaches its final position.

### Difference highlighting
- Added entries receive difference highlighting.
- Modified entries receive difference highlighting.
- Relocated entries receive difference highlighting.
- Merged entries receive difference highlighting.
- Split-result entries receive difference highlighting.
- Hover/selection uses fill rather than outline.
- Difference outlines do not interfere with selection/hover.

### Merge/lane behavior
- Merging two versions continues the correct existing branch.
- The merge does not unnecessarily create a new lane.
- No empty lane is introduced.
- Lane assignment is recomputed correctly after the merge.

### Connector symbols
- Connector lines no longer render action symbols.
- The corresponding action symbol appears in the destination version title/header.

### LOD2
- Action symbol and change text occupy the intended top-half layout.
- The symbol is positioned in the top-left area.
- Version numbers are displayed prominently below.
- Tagged versions display the large tag symbol.

### Theme configuration
- Light and dark theme values are loaded from the centralized configuration.
- Switching themes updates the relevant elements correctly.

Prefer behavior/UI tests over implementation-detail tests.

## Misc

increase the thickness out the outline indicating the currently selected version when zooming out.
also add an outline to the lane button (left+right) in which the currently selected version is.
make the background of the tutorial button semitransparent or white.
when selecting a version for a merge or selection, show the first selected version in the info box that says "select the first version, then the second".
also allow to deselect it there. Use the currently selected version as default first version.

remove zoom buttons (+ / -) from hotbar. map the hotkeys to the four presets "+" for zooming in, stepwise iterating through them. from "fit all" to "fit height" to "neighbourhood" to "focus", and "-" for zooming out.

regarding the root: instead of "Empty structure" call it "Root: Empty" and use the view of LOD2 in LOD1 also. Do not change how the non root version windows are displayed.