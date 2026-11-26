# Adjustments

## Bugs

1. Ping coordinates seem to be global but do not share correctly across different browser resolutions or aspect ratios (16:9 vs 24:9).
2. Latest Versions Indicator: seems to be misplaced on high resolution (can only read half the text). The box is allowed to scale depending on the browser resolution to fit in the space above the version.
3. On high aspect ratios (32:9) the padding left and right seems to be bigger then on 16:9
4. After loading an interaction log replay and exiting the replay mode (via the X Button) the browser gave the warning "TypeError: can't access property "nextSibling", e is null" on hovering over the second to last version of a branch. This error "TypeError: can't access property "emitsOptions", r is null" also occurred. It was not reproducable by loading the interaction log file again.
5. Rework the idea of calling "center all elements" on resize. This lead to discrepancies in how the treemaps are shown between different resolutions and aspect ratios. The layout of the treemaps should be identical for all users. Centering should look for everyone similar, the center of the bounding box of all treemaps should be in the center of each version for all users. The zoom setting per user may vary, such that the content is similarly zoomed for all users. maybe use a room sepecific zoom setting for each version that is combined with the users aspect ratio to get the user specific zoom setting.

The Cross-resolution pings with  normalized graph coordinates, still do not work completely. For example when pinging the version number of a version (in focus mode) the pings do not match positions across multiple users. Maybe add a test that pings the 4 corners of a version window and check for the second user.

Remove the "create a branch" warning again.

Call "center all elements" on resize again. the rest should stay the same.

The previous "latest version" indicator was better. Try to use that version, but keep the text visible.