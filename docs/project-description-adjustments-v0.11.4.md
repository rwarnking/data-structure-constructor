# Collaborative User Sidebar

Implement the connected-user indicators in the sidebar and their navigation behavior.

## 1. Connected User List

Add a user name input field, such that the user name can be displayed in the interaction log. Automatically assign each user an animal as its name.

Add a user section to the sidebar showing all currently connected collaborators.

- Display one icon for each connected user.
- Use a simple circular/person-style icon.
- Each user must have a consistent, distinct collaboration color.
- Use the same user color throughout the application, including:
  - user icons,
  - usernames in the Interaction Log,
  - other existing collaboration indicators.

The list should update automatically when users join or leave.

## 2. User Icon Interaction

User icons should be clickable.

When clicking a user's icon:

- Determine that user's current active version.
- Smoothly focus the local viewport on that version using the existing **Focus** navigation behavior.
- Do not change the local user's active version merely by focusing another user's version.

If the selected user currently has no active version:

- Do nothing.
- Do not change the local viewport or selection.

## 3. Shared Active Version

The user's **active version** should be part of the shared collaboration state.

- Other connected users should be able to see which version each user is currently working in.
- Update the shared active-version state whenever a user changes their active version.
- Synchronize these changes with all connected users.
- A user's active version should remain available even when the user is not currently interacting with the canvas.

## 4. User Presence

When a user connects:

- Add them to the connected-user list.
- Assign/use their existing collaboration color.
- Synchronize their current active version.

When a user disconnects:

- Remove them from the connected-user list.
- Clean up any associated presence state.
- Do not modify the shared data structure or historical Interaction Log.

## 5. Interaction with the Rest of the UI

The user indicators should integrate with the existing collaboration UI without changing existing editing behavior.

In particular:

- Clicking a user icon should be a navigation action only.
- It must not switch branches or modify the data structure.
- It must not modify another user's active version.

The result should allow a collaborator to quickly see **who is currently connected, which color represents them, and where they are currently working**, and to navigate to that location with one click.

# Interaction Log

Implement a shared interaction log in the sidebar that records meaningful collaborative actions.

## 1. Log Location and Size

- Add an **Interaction Log** section at the bottom of the sidebar.
- Show the **10 most recent** relevant actions.
- Newest actions should appear on top.
- The log should update automatically as shared actions occur.
- The log should be compact enough to remain usable within the sidebar.

## 2. Actions to Log

Log meaningful actions that affect the shared data structure or collaborative state, including:

- Ping
- Version/branch creation
- Add entry
- Delete entry
- Rename entry
- Attach entry
- Detach entry
- Copy entry
- Merge versions

Only log actions that represent meaningful shared interaction.

Do **not** log purely local UI interactions such as:

- Opening or closing a context menu
- Selecting an entry locally
- Changing the local zoom level
- Panning the local viewport
- Opening/closing UI panels
- Changing location of an entry

## 3. User Identification

Each log entry should identify the user who performed the action.

- Display the username.
- Use that user's assigned collaboration color for the username.
- Keep the existing user-color assignment consistent with the rest of the application.

The log should make it immediately clear which collaborator performed each action.

## 4. Navigable References

Where possible, references in the interaction log should be clickable and navigate to the object involved in the action.

### Version References

If an action references a version:

- Make the version reference clickable.
- Clicking it should focus that version using the existing smooth Focus behavior.

### Entry References

If an action references an entry:

- Make the entry reference clickable.
- Clicking it should Focus the version containing the entry.

### Ping References

Ping actions should also be navigable.

- Clicking a ping reference should focus the location of the ping.
- The navigation should target the exact ping location, rather than merely focusing the containing version.

Use the existing smooth navigation behavior for these actions.

## 5. Deleted or Missing Objects

The interaction log represents historical actions, so entries should remain in the log even when the referenced object is later deleted.

- Do not remove historical log entries when their referenced entry/version is deleted.
- If the referenced object no longer exists, its reference should no longer be clickable.
- Clicking an unavailable reference should not produce an error.
- The remaining log information should still be displayed normally.

## 6. Multiplayer Synchronization

The interaction log should represent the shared collaborative history.

- Actions performed by other connected users should appear in the log.
- All users should receive the same shared action history.
- The identity of the user who performed each action must be preserved.
- Do not create duplicate log entries when an action is received through synchronization.

Local-only UI actions should remain local and must not be added to the shared interaction log.