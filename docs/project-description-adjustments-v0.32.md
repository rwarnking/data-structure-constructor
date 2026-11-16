# Adjustments

## Treemap entry text

- **Text wrapping in entries**
  - First, wrap text at **whitespace**, as is currently done.
  - If the text still does not fit within the available width, try breaking words at **syllable boundaries using hyphenation**.
  - If hyphenation is still insufficient, allow breaking at an **arbitrary character** as a last resort.

- **Text truncation in entries based on height**
  - If the available height is insufficient to display all wrapped lines, truncate the text and add `...` at the end of the **last visible line**.
  - If there is only enough space for **one line**, do **not** replace the entire line with `...`. Instead, show as many characters of the word as fit, without `...`.
  - The resulting text should never overflow the available width or height of the box.

## Rework Interaction Log

### Separate UI Log and Exportable Log
- Continue to distinguish between:
  1. The **interaction log used by the UI and stored in local storage**.
  2. The **exportable/importable interaction log** used for replay and analysis.
- The two logs can have different structures and purposes. Do not change the existing local-storage/UI logging behavior unless necessary.

### User-Based Interaction Recording
- The exportable interaction log should store interactions **separately for each user**.
- Each user's interaction sequence should be independently replayable.
- Clearly delimit each user's session, starting with **login** and ending with **logout**, if a logout event is present.
- Login and logout events should be recorded for identifying the session boundaries, but **must not be executed during replay**.

### Replay Behavior
- The goal of replay is to reproduce what a specific user actually experienced in the room.
- Replay should therefore execute the recorded actions on the room rather than merely displaying the logged events.
- For example, if the user created, moved, renamed, or deleted an entry, replaying the log should actually perform that action in the room.
- Record interactions with enough information to reproduce the resulting action reliably, rather than only storing UI events that cannot be replayed.
- Also record **menu interactions**, including opening menus and selecting menu actions where relevant.
- During replay, menus should be opened and interacted with as they were during the original session when those interactions are necessary to reproduce the user's actions.

### User Selection
- When playback starts, **select one user by default**.
- The reviewer should be able to change the user being followed directly from the replay toolbar.
- Replay should show the selected user's perspective and interaction sequence rather than attempting to reproduce all users simultaneously.
- It is **not necessary to display the actions of all users at the same time**. The primary goal is to let the reviewer see what the selected user saw and did.

### View State
- Record and replay the selected user's **view state**, including:
  - Zoom level.
  - Viewing/pan position.
- During replay, restore these values so that the reviewer sees the room from the user's perspective at each point in the interaction sequence.
- Track view-state changes as interactions where necessary to accurately reconstruct the user's perspective.

### Replay Toolbar
- Move all **replay interaction-log controls** into a toolbar at the **bottom of the screen**.
- The toolbar should be visible **only in the interaction-log replay room**.
- Use **symbols/icons** for the toolbar controls where appropriate rather than text-heavy buttons.
- Include at least:
  - Playback controls.
  - User-selection control.
  - Timeline/scrubber.
  - Button to open the Interaction-log analysis view.

### Timeline
- Add a **timeline slider** to the replay toolbar.
- The reviewer should be able to move the slider to a specific point in the recorded interaction sequence.
- Moving the timeline should update the room to the corresponding state at that point in time.
- The replay state should remain consistent when moving both forward and backward through the timeline.

### Interaction Tracking
- Review and update the interaction tracking throughout the application so that all interactions required for replay are captured.
- In particular, ensure that the log contains enough information to reconstruct:
  - Data/entry creation.
  - Entry movement or repositioning.
  - Entry deletion.
  - Other modifications to the hierarchy.
  - Menu opening and menu actions.
  - Zoom-level changes.
  - Pan/view-position changes.
  - Any other interaction that changes what the selected user sees or does.
- Prefer recording **semantic actions and their relevant parameters** over low-level implementation events where possible. The replay should reproduce the user's actual action, not merely simulate a click at a coordinate that may no longer be valid.

### Interaction-log analysis

- Keep the analysis view operational.
- The interaction log should contain the correct and sufficient data such that the analysis view can be used as before.

### Core Goal
The interaction log should allow a reviewer to select a user and **replay that user's session as faithfully as possible**, including both the actions they performed and the view they had while performing them.

## Tests

Add tests where appropriate.
