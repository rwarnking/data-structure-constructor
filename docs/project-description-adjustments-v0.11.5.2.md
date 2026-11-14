### Merge Branch Lane Ordering

The placement of the merge result depends on whether the target version is the latest version of its branch.

#### Target is the latest version

If the target version is the **latest version of its branch**, the merge result is added as the next version **within the target branch**. No new branch lane is created, and the existing branch ordering remains unchanged.

#### Target is not the latest version

If the target version is **not the latest version of its branch**, the merge result starts a **new merge branch**. This merge branch must occupy its **own complete branch lane**.

The merge version must **not** be placed physically between two existing branch lanes or inserted into the middle of an existing branch. Instead, the branch ordering must be adjusted so that the new merge branch occupies the lane **directly between the two source branches**.

For example, before the merge:

```text
Line 1:  Branch A  ───────────── A
Line 2:  Branch B  ───────────── B
```

After merging A and B, where B is not the latest version of its branch:

```text
Line 1:  Branch A  ───────────── A
Line 2:  Merge    ───────────── M
Line 3:  Branch B  ───────────── B
```

The ordering rules are:

- The **first source branch** remains in its original relative position.
- The **second source branch** moves down by one lane.
- The new **merge branch** occupies the complete lane directly between the two source branches.
- The merge version is placed within that merge branch and is therefore aligned with its lane.
- The merge result is **never inserted between versions/cards within an existing branch**.
- All existing branches below the second source branch shift down as necessary to make room for the new lane.
- The relative ordering of all **unrelated branches** must be preserved.
- The new merge branch behaves like any other branch for subsequent branching and version creation.

### Merge Connector Positioning

- one of the two connectors starts to far to the left
- the connector should be centered horizontally between both versions
- this should be identical to the normal branch connector
- The connector path should be **centered horizontally within the available space between the source version and the merge version**.

use the color of the source branch for the connector to the merged version