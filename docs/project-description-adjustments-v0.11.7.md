# Integration and Final Consistency Pass

Review the complete application after implementing Steps 1–7. The goal is to ensure that the new functionality works together correctly and that no existing interactions have been broken.

## 1. Interaction Consistency

Verify that the different interaction mechanisms have clear and non-conflicting behavior.

- Clicking an entry selects it.
- Double-clicking an entry opens the editor.
- Dragging an entry starts only after the configured movement threshold is exceeded.
- Right-clicking opens the appropriate context menu.
- Clicking elsewhere closes an open context menu.
- Clicking a copy connector focuses the opposite version.
- Clicking a user icon focuses that user's active version.
- Pressing **F** triggers Focus.
- Dragging and dropping an entry produces exactly the result shown by the drag preview.
- Invalid drag operations do not modify the hierarchy.

Make sure these interactions do not accidentally trigger one another.

## 2. Navigation and Viewport Behavior

Verify that all actions that move the viewport use the same navigation and animation system.

This includes:

- Focus
- Focusing a version from the Interaction Log
- Focusing an entry from the Interaction Log
- Focusing a ping
- Clicking a copy connector
- Clicking a collaborator's user icon
- Initial positioning when creating a new branch

All should provide consistent smooth navigation.

Viewport operations must not unintentionally modify the underlying data or layout.

## 3. Coordinate Systems and Zoom

Pay particular attention to elements that are rendered on top of the version graph.

Verify that:

- Entry positions remain correct while zooming and panning.
- Copy connectors remain attached to their endpoints.
- Duplicate-value connections remain attached to their endpoints.
- Drag previews remain aligned with the pointer.
- Focus/navigation does not cause connectors or overlays to jump.
- Elements rendered above version/background geometry still use the correct coordinate transformation.

Avoid introducing separate coordinate transformations for individual overlays unless required by the existing architecture.

## 4. Multiplayer Consistency

Test the application with at least two connected users.

Verify that:

- Shared data modifications are synchronized correctly.
- Interaction Log entries appear for actions performed by other users.
- Each action is logged exactly once.
- User colors remain consistent.
- Users joining and leaving update the sidebar correctly.
- Active versions are synchronized.
- Clicking another user's icon focuses their current active version.
- Local selection remains local.
- Local viewport/zoom/pan remains local unless explicitly changed by a navigation action.
- A user navigating locally does not unexpectedly change another user's viewport.

## 5. Layout and Automatic Rearrangement

Verify all automatic layout operations together with the new drag behavior.

In particular:

- Normal operation never leaves unintended overlaps.
- Temporary drag overlaps do not become permanent unless the operation is valid.
- Attachments correctly resize/rearrange their parent treemap.
- Detaching entries correctly updates the affected hierarchy.
- Compact Layout preserves the hierarchy and produces a valid non-overlapping layout.
- Focus does not change the layout.
- Copy connectors and duplicate-value connections remain correct after Compact Layout.
- Newly created branches are initially readable and correctly positioned.

## 6. Merge Integration

Verify that merge behavior remains consistent with the rest of the version graph.

Check that:

- Merge results use `max(source step, target step) + 1`.
- Merge connections use the same visual language as branch connections.
- No artificial intermediate versions are created.
- Merge connections remain correct when the graph is zoomed or panned.
- Merge View scrolling does not trigger background graph zoom.
- Scrolling outside the Merge View continues to work normally.
- Merge results interact correctly with Focus, navigation, and the Interaction Log.

## 7. Interaction Log Integration

Verify that every relevant shared action is logged exactly once.

Check the complete set of supported actions:

- Ping
- Version/branch creation
- Add
- Delete
- Rename
- Move
- Attach
- Detach
- Copy
- Merge

Verify that:

- Local-only UI interactions are not logged.
- Historical entries remain after referenced objects are deleted.
- Invalid references no longer navigate but do not cause errors.
- Clicking valid references performs the expected Focus/navigation behavior.
- Only the latest 10 entries are displayed.

## 8. Error and Edge-Case Testing

Test at least the following cases:

- Drag an entry onto itself.
- Drag an entry onto one of its descendants.
- Drag an entry outside the version and release.
- Drag an entry onto an occupied but invalid location.
- Cancel a drag.
- Rename an entry so that it becomes identical to another entry.
- Rename an entry so that it is no longer a duplicate.
- Delete one member of a duplicate-value group.
- Copy an entry and then move both endpoints.
- Delete one endpoint of a copy relationship.
- Compact Layout after creating copy relationships.
- Create a new branch from an empty state.
- Merge versions with equal and different step numbers.
- Scroll inside and outside the Merge View.
- Connect and disconnect multiple collaborators.
- Focus a collaborator who has no active version.
- Navigate to an Interaction Log entry whose referenced object was deleted.

No operation should produce console errors, invalid hierarchy states, or inconsistent visual state.

## 9. Cleanup

After functionality is verified:

- Remove obsolete implementations that are superseded by the new behavior.
- Avoid duplicated logic for Focus, navigation, coordinate transformations, or collaboration state.
- Reuse existing helper functions/components where appropriate.
- Remove temporary debugging output.
- Ensure event listeners are properly cleaned up when components are unmounted.
- Ensure multiplayer listeners/subscriptions do not accumulate when components are recreated.

The final implementation should be internally consistent rather than simply adding independent patches for each previous step.