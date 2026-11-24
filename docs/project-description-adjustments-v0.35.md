## 13. Room management and reconnection

Make room management robust against host changes and temporary network failures.

### 13.1 Host leaves

When the current host leaves:
- The room must remain active.
- Another currently connected peer must become the new host.
- All other peers should remain connected to the same room.
- The room state must not be lost.
- There should be no requirement for users to manually create or join a new room.

Use a deterministic host-election strategy so that different peers cannot independently select different hosts.

### 13.2 Temporary disconnection

When a client disconnects unexpectedly, for example because of a temporary loss of internet connectivity:
- Keep the client in a **reconnecting state** rather than immediately treating the user as having intentionally left.
- Attempt to reconnect to the existing room.
- If reconnection succeeds, restore the client's room connection/state normally.
- If the room no longer exists, transition to an appropriate "room no longer available" state and inform the user.
- Avoid creating a new room automatically unless this is already an explicit part of the application's design.

Intended lifecycle:

1. Client is connected.
2. Client temporarily loses connection → reconnecting.
3. Client reconnects → resume room.
4. Room has been closed/destroyed → notify client that the room no longer exists.
5. User explicitly leaves → do not automatically reconnect.

Implement the behavior consistently.
If the connection is lost and can not be resumed, warn the user.

### Tests
Add tests if not present for:
- host leaving,
- deterministic host election,
- another peer becoming host,
- remaining peers staying connected,
- temporary client disconnection,
- successful reconnection,
- room no longer existing,
- explicit room leave not triggering automatic reconnection.

---

## 14. Minimum width of treemap entries

Treemap entries should use the same minimum width as free-floating leaf entries.
Avoid duplicating the value in multiple places if possible; use a shared constant/configuration.

---

## 15. Exportable interaction log: UI dialog interactions

The exportable interaction log must contain all relevant UI dialog interactions required to reproduce a session.
Check if there is something missing, like the merge dialog and add it.

Include:
- opening/closing dialogs,
- confirming/cancelling actions,
- entering values,
- selecting options,
- adding entries through dialogs,
- other dialog actions that affect the resulting application state.

Only log interactions that are necessary to reproduce the user's actions/state; do not blindly log every DOM event.

### Replay
Every newly logged interaction must be replayable.

For each added interaction:
- define the interaction-log event type/data,
- implement recording,
- implement replay,
- ensure replay produces the same resulting application state.

### Tests
Add round-trip tests where practical:

`user interaction → exported log → replay → resulting state`

should produce the same state.

---

## 16. Fix lag when zooming inside a version

Zooming inside a version using **Shift + mouse wheel** currently appears laggy.
Identify wether that is the case and fix if possible.
Do not sacrifice correctness or synchronization merely to improve performance.

---

# 17. Testing

- add regression tests
- add tests for important edge cases and synchronization behavior
- keep existing tests unless their expected behavior is explicitly changed by these requirements

---

# 18 Import data

This does not seem to work anymore. Exporting the data works, but importing the same file does not.

---

# 19. Performance review

Inspect the application for performance issues.

Make improvements only where they are reasonably justified. **Do not rewrite working code solely for theoretical performance gains.**

Where a performance change is made, verify that it does not alter observable behavior.

---

# 20. Refactoring review

Once the implementation is working, inspect the modified areas for opportunities to simplify the code.

Prefer small, targeted refactorings that:
- remove duplication,
- make responsibilities clearer,
- reduce coupling,
- make future testing easier.
