# Interaction Logging and Replay

## Interaction Logging

- Add an **“Export Interaction Log”** action to the Settings menu.
- Record all meaningful user interactions performed during a session, including:
  - creating, editing, moving, deleting, attaching, detaching, merging, and splitting entries
  - creating and modifying versions and branches
  - zooming and panning
  - selection and navigation
  - searching
  - button clicks
  - hotkeys
  - other interactions that affect the application state or viewport
- Each interaction should record:
  - the **user** who performed it
  - the **interaction type/action**
  - the relevant parameters required to reproduce the interaction
  - the **input timestamp** — when the user initiated the interaction
  - the **change timestamp** — when the resulting change was committed
  - the **input method**, distinguishing between hotkeys, mouse interactions, and UI buttons
  - the cursor position when it is relevant to reproducing the interaction
- Record `Ctrl+Z` and `Ctrl+Y` explicitly.
- Do not record continuous cursor movement as individual events.
- During replay, interpolate cursor movement between the cursor positions of consecutive interactions.
- Preserve user identities so that interactions from different users can be distinguished and replayed correctly.

## Interaction Log Storage

- Keep the complete interaction log **in memory only for the lifetime of the browser session**.
- Do **not** store the interaction log in `localStorage`.
- Only the existing room data should be persisted in `localStorage`.
- Closing the browser session should discard the interaction log unless it has been explicitly exported.
- Exported logs must be **self-contained** and contain everything required for replay and analysis.

## Export and Replay

- Add a **“Replay Interaction Log”** action to the Settings menu where a interaction log file can be uploaded.
- When replay is started:
  - automatically create a new empty room named **“Interaction Log Replay”**
  - replay all interactions in chronological order
  - apply each interaction as if it had been performed by the corresponding user
  - preserve the original user identities
- Add a **playback-speed control** to the settings menu, that is only shown when in the interaction log file replay mode.
- Playback speed should scale the time between interactions while preserving their relative temporal order.
- Replay both state-changing and relevant viewport interactions, including:
  - zooming
  - panning
  - navigation
  - selection
  - other interactions necessary to reproduce the observed session
- Interpolate cursor movement between recorded interaction positions rather than replaying continuous mouse-movement events.
- Provide controls to:
  - **Play/Pause**
  - **Jump to beginning** — reset the replay to the initial empty state
  - **Jump to end** — apply all remaining interactions immediately
  - optionally step forward/backward through individual interactions

## Interaction Log Viewer

The compact sidebar log and the complete interaction log are separate concepts.

- The sidebar should display only the **10 most recent meaningful actions**.
- Do not display every low-level interaction, such as individual zoom or pan events.
- Display meaningful events such as:
  - user joining/logging in
  - user leaving/logging out
  - creating a new version by adding, deleting, merging, or splitting entries
  - pinging a location
  - other significant state-changing actions (especially those that are already present)
- Do not change the visuals and interactions of the log viewer component.
- The sidebar log should update continuously as new meaningful actions occur.

# Interaction Log Analysis

Add a **Analyze Interaction Log** action to the Settings menu, that only is shown when in the interaction log file replay mode.

It should open a window similar to the merge view. The analysis view should provide an overview of how the room was used rather than simply displaying the raw event list.

### Basic Statistics

Include at least:

- total number of interactions
- number of interactions per action type
- number of interactions per user
- number of state-changing vs. viewport interactions
- session duration
- number of versions created
- number of branches created
- number of undo/redo operations
- number of interactions performed via hotkeys vs. UI/mouse

### Temporal Analysis

Show how interaction behavior changes over time, for example:

- interaction frequency over the course of the session
- activity per user over time
- distribution of actions over time
- periods of high and low activity
- time spent between consecutive actions

### User Comparison

Show how different users contributed to the session:

- number of actions per user
- action types used by each user
- versions/branches created by each user
- relative activity over time
- collaboration patterns, such as users working simultaneously or sequentially

### Action Sequences

Analyze which actions commonly occur after one another.

For example:

- `Add → Edit`
- `Create Version → Add`
- `Move → Attach`
- `Undo → Redo`
- `Ping → Navigate`

Display frequently occurring action transitions as a simple sequence visualization or transition diagram.

### Input vs. Change Time

Use the recorded input and change timestamps to distinguish:

- time between initiating an interaction and its resulting change
- interactions that produced immediate changes
- interactions that took longer to complete
- potentially interrupted or canceled interactions

### Navigation and Viewport Behavior

Summarize how users explored the visualization:

- zoom activity
- panning activity
- navigation between versions/timelines
- frequently visited versions
- frequently revisited areas
- changes in viewport position over time

### Potential Additional Views

If possible, add further visualizations such as:

- **action timeline** showing significant actions and users
    - for example showing when and by whom branches were created
- **user × action matrix** showing which users performed which actions and how often
- **version activity map** showing which versions received the most interaction
- **interaction flow diagram** showing common sequences of actions
- **heatmap of viewport activity** showing where users spent time interacting
- **collaboration timeline** showing overlapping activity between users if there is any

The analysis should prioritize **interpretable patterns of interaction** over simply displaying as many statistics as possible. All visualizations should be derived from the same underlying interaction log and allow the user to inspect the corresponding raw interactions where appropriate.
