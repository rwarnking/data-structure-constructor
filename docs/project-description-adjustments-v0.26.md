# Adjustments

- **Zoom-level hotkeys**
  - `+` and `-` should switch between the predefined zoom levels `1`, `2`, `3`, and `4` (focus, fit height, ...).
  - Add these controls to the tool sidebar.
  - Show the zoom-level controls **only when the sidebar is collapsed**.

- **Compare/Merge View**
  - In the compare/merge view: Check for and eliminate any differences in font, text sizing compared to the version view treemaps.
  - `Shift + mouse wheel` should zoom the treemap.
  - `Shift + mouse drag` should pan the treemap.
  - `Shift + A` should reset the treemap to its default zoom level.

- **Sounds**
  - Increase the volume of the existing ping sound.
  - Add the following sounds from the provided/public sound files:
    - `click-with-big-reverb-28848-01.mp3` — play when the left mouse button is clicked on an entry in the merge/compare view.
    - `bing-298405.mp3` — play when an entry is added, merged, or split.
    - `happy-pop-2-185287.mp3` — play when a new branch is created.
    - Do **not** play `bing-298405.mp3` when already playing `happy-pop-2-185287.mp3` for a branch-creation action.
    - `obacht.mp3` — always play when an error occurs.
    - `ui-sound-off-270300.mp3` — play when sound is turned off.
    - `ui-sound-on-270295.mp3` — play when sound is turned on.
    - `droplets-in-a-cave-6785-01.mp3` — play when an entry is moved or deleted.
  - Keep sound playback centralized so that each action triggers the appropriate sound exactly once.

- **Sound Settings**
  - Add a volume control to the settings panel.
  - Add a mute/unmute button to the settings panel.
  - The volume setting should affect all application sounds consistently.

- **Search**
  - Show the search action in the collapsed tool sidebar as well.

- **Branching**
  - Add a branching on/off toggle to the settings panel.
  - This setting should disable or enable branching for all versions.
  - If branching is disabled, all actions that would result in a new version can only be done on the last version of a branch. For example add entry, delete entry, ...

# Collapsed Left Sidebar

When the left sidebar is collapsed, it should still provide access to the following information and actions:

- **Change Room**
  - Show a compact icon/button that opens the **Change Room** menu.

- **Users**
  - Show the icons/avatars of all users currently in the room.
  - Make each user icon clickable.
  - Clicking a user should navigate to the **active version of that user**.

- **Flexible spacing**
  - Use an invisible vertical filler when necessary to position the elements appropriately.
  - The filler must not be visually noticeable or interfere with interaction.

- **Interaction Log**
  - Show a compact version of the interaction log.
  - Display only the action icon/symbol (e.g. add, merge, split, ping).
  - Make each action icon clickable.
  - Clicking an action should navigate to the **origin of that action**.
  - Color each action icon using the color of the user who performed the action.
  - Keep the compact log space-efficient so that it remains usable even when the sidebar is narrow.

# Tests

- Add tests where it seems appropriate