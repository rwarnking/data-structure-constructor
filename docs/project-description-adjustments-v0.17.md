# Performance Improvements

Investigate the implementation for potential improvements in regard to rendering and interaction performance.
Search for improvements especially for many versions and big treemaps in these.

One potential improvement could the version connectors be.
Currently, connectors between versions are rendered as individual elements for each connection.
This might be replaceable with **one shared rendering element for all connectors within a lane**, rather than one element per connection.
The existing visual appearance and routing behavior should be preserved as well as all other current features.

There is also a bug where **long connector lines are not rendered correctly when their start or end points are outside the current viewport**.

Create a small prioritized TODO list of additional performance improvements that could be investigated further.

# bug

double clicking a version should always 1. set it active and 2. focus it. This should work at any zoom level. single click should only set the version active.