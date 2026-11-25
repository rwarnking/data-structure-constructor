Check for missing tests

Rename the application. The name is HIVERSE not DSC or data structure constructor.

When the resolution changes and automatically execute "focus active version". check if it problematic for performance if the function is called repeatedly during continuos resizing. if so add a pause or another saveguard, to not slow the application to much.

Call "center all elements" on all versions on resize, but also protect against lag.


# Treemap layout rules

## Every entry has an independent minimum size
- Every node, including both internal nodes and leaves, must satisfy a minimum width and minimum height.
- The minimum height should be equal or bigger then the text height.
- The minimum width should be equal or bigger then 8 letters in witdh

## Parents are sized from their descendants
- The parent's rectangle must completely contain its children, including the spacing/padding between them.
- Thus, adding descendants can increase the size required by the parent and, recursively, by its ancestors.

## Parents are completely filled by their descendants
- Once a parent's rectangle has been determined, its children should collectively occupy the parent's available interior area.
- Do not leave arbitrary unused regions inside a parent.
- Small gaps are allowed only where required for padding, borders, or the layout algorithm.

## Leaves should have approximately equal area
- Leaves should have similar areas whenever the hierarchy permits this.
- The preferred target is therefore an approximately equal-area layout rather than an area encoding based on hierarchy depth or node count.
- Differences in leaf area are acceptable when necessary to satisfy minimum dimensions, preserve the hierarchy, or produce a usable aspect ratio.

## Minimum-size constraints take priority over equal-area optimization
- If equal-sized leaves would produce a rectangle below the minimum width or height, the leaf must be enlarged.
- The resulting additional space should be propagated to its ancestors rather than causing the leaf to become smaller.
- This means that leaf areas may differ when necessary.

## Avoid extreme aspect ratios
- Try achieving a similar aspect ratio as the version window itself has.
- Among layouts satisfying the minimum-size constraints, prefer rectangles with moderate aspect ratios.
- A layout should not create a very long, thin region simply because one entry has fewer descendants.
- This is particularly important for entries directly below the root: a small subtree should become a small but usable rectangle, not a vertical or horizontal strip.


How about the following:

use squarify and if a node (leave or parent) does not match the minimum size, try 2 different aspect ratios with squarify.
The chosen aspect ratios should maximise the chance of getting a better result.
also calculate the scale value for these solutions. if no version satisfies the minimum size, use the one that has the lowest scale value. apply it but cap it at 1.5x. if that does not solve the minimum requirement, then we accept that.

How the layout works now
All of it is in treemap.ts. The grid code still runs, but only to give the starting root size.

Minimums, derived from the label font sizes:
Leaf: 198 wide (8 letters at 36 px plus padding) and 106 high.
Parent: 177 wide (at 32 px) and 60 high.
Attempt order, all at scale 1:
First, squarify with the d3 default (golden) ratio at the version aspect (1.155).
Second and third, squarify with ratio 1 at two of the candidate aspects 0.8, 1.0 and 1.5. The candidate closest to the version aspect is dropped, so with today's 1.155 that is 1.0 and the tries use 0.8 and 1.5. It recalculates if the version aspect changes.
If none fit, I compute the scale each attempt needs and apply the smallest one, capped at 1.5. Violations beyond the cap are accepted.
The version window aspect is unchanged. The root can have a different aspect.
Shared size. outerDimensions and the tile positions come from the same cached result, so cards, collision handling and drag all see the same size.