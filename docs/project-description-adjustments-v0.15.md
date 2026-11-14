## Final Architecture Review and Testing

Perform one final architecture and cleanup pass over the project, followed by a comprehensive testing pass.

### Architecture Review

Review the resulting project structure for:

- Duplicated logic that should be shared.
- Composables that have grown too large or contain multiple unrelated responsibilities.
- Components that still contain business/application logic that could be separated.
- Unnecessary dependencies between components and composables.
- Inconsistent naming or folder organization.
- Unused imports, variables, functions, or files left over from the refactoring.
- Circular or unnecessarily complicated dependencies.
- State that is unnecessarily duplicated.
- Opportunities to simplify the architecture without sacrificing clarity.

Keep the current approach of using reactive composables for shared state. **Do not introduce Pinia unless there is a concrete architectural reason that a composable cannot adequately handle the state.**

Do not perform another large-scale rewrite. Only make changes that clearly improve maintainability, separation of concerns, or consistency.

---

## Testing

Add and improve automated tests for the application, including **UI/integration tests**.

### Test Coverage

Cover the core functionality and interactions of the application, including:

- Creating, editing, and deleting entries.
- Creating versions and branches.
- Creating branches from existing versions.
- Moving, attaching, and detaching entries.
- Copying entries and maintaining copy connectors.
- Bulk add and bulk delete.
- Merge and split operations.
- Version comparison.
- Merge View interactions and result generation.
- Room creation, switching, persistence, and deletion.
- Clear All.
- LOD 1 / LOD 2 behavior
- Zooming, panning, Focus, Fit All, and lane navigation.
- Connector rendering and interaction.
- Collaborator and Interaction Log behavior.
- Relevant keyboard shortcuts.
- Two-way collaboration and synchronization between users/peers.

### UI / Integration Tests

UI tests must verify that controls actually produce the expected **visible and state changes**, rather than merely verifying that the controls exist.

Examples:

- Clicking **Add Entry** creates the expected version and visible entry.
- Editing an entry updates its displayed value and underlying state.
- Adding multiple rows creates all entries in the expected version.
- Dragging an entry to a valid target produces the expected hierarchy.
- Dragging an entry to an invalid location restores the original state.
- Copying an entry creates the expected copy and connector.
- Clicking a lane-navigation button moves the viewport to the expected position.
- Switching rooms loads the correct independent data.
- Room state persists when expected.
- LOD 2 disables the specified actions while still allowing the specified actions.
- Merge View interactions update the resulting treemap correctly.
- Keyboard shortcuts trigger the same behavior as their corresponding UI actions.
- Collaborative changes made by one peer become visible and correctly reflected on another peer.

### Test Organization

- Add tests for every major feature where practical.
- Keep unit tests focused on data/state transformations and interaction logic.
- Use UI/integration tests for behavior that depends on the rendered interface, pointer interaction, keyboard interaction, drag-and-drop, or viewport state.
- Prefer testing user-visible behavior over implementation details.
- Avoid tests that simply verify that a particular function or component was called when the resulting behavior can be tested instead.
- Reuse test helpers and fixtures where appropriate to avoid excessive duplication.
- Keep tests deterministic and independent from one another.
- Tests should run as part of the normal build/test workflow.
- Allow to tests to be easily executable

### Final Verification

After the architecture cleanup and test additions:

1. Run the build.
2. Run the type-check.
3. Run the complete automated test suite.
4. Run the UI/integration tests.
5. Perform relevant browser interaction checks, including collaboration.
