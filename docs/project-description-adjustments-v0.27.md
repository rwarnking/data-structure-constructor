# Adjustments

## Search Dialog

- Improve the **search dialog** to support searching across different entity types:
  - Add a header at the top labeled **“Search through”**.
  - Add a top-level **“All”** row that searches across all available entity types.
  - Add one row for each searchable entity type. Each row should contain:
    - a label identifying the entity being searched, e.g. `Versions:`, `Tag & Description`, `Actions`, `Entries & Description`
    - an input field for the search string
  - For all entity types **except Versions**, use a standard text input field.
  - For **Versions**, keep using the existing version-search input/mask.
  - The search interface should make it clear which entity type each input field applies to.
  - Show the results list below. Allow for clicking on the results, redirecting to the corresponding version.
  - Save last made searches.

## Sound

- play `bing-298405.mp3` when changing the volume in the volume control of the settings panel.
- play `droplets-in-a-cave-6785-01.mp3` when a branch is deleted.
- play `intro-sound-1-269293.mp3` when double clicking a version
- play `tick-single.mp3` when changing the active version using the arrow keys or the left mouse button (single click) or the Lane Navigation buttons
- play `tick-single.mp3` when clicking on something in the interaction logs (collapsed as well as expanded)
- play `intro-sound-1-269293.mp3` when clicking on a user icon to see their active version (collapsed as well as expanded)
- play `intro-sound-2-269294.mp3` when joining or changing a room
- play `ui-sound-off-270300.mp3` when lightmode is turned off.
- play `ui-sound-on-270295.mp3` when lightmode is turned on.
- play `ui-sound-off-270300.mp3` when branching is turned off.
- play `ui-sound-on-270295.mp3` when branching is turned on.
- play `click-with-big-reverb-28848-01.mp3` when omit is clicked in the merge/compare view.
- play `bing-298405.mp3` when pick is clicked in the merge/compare view.

## Misc

- Show the zoom-level controls (+,-) in the tool-sidebar always.

## Tests

- Add tests where it seems appropriate