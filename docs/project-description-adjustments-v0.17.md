# Performance Improvements

Improve rendering and interaction performance where practical, especially for large version graphs.

### Connector Rendering

Currently, connectors between versions are rendered as individual elements for each connection.

Replace this with a more efficient representation where possible:

- Use **one shared rendering element for all connectors within a lane**, rather than one element per connection.
- Prefer a single SVG path or equivalent consolidated rendering element per lane.
- The consolidated element must still support all required connector geometry, including:
  - straight connectors;
  - bent connectors;
  - connector symbols;
  - different connector lengths.
- Preserve the existing visual appearance and routing behavior.

This should also fix the current bug where **long connector lines are not rendered correctly when their start or end points are outside the current viewport**.

Connector rendering must therefore be based on the complete lane geometry rather than only on currently visible version elements.

### General Performance

Investigate and improve other obvious performance bottlenecks where practical, including:

- unnecessary full-graph re-rendering;
- repeated layout calculations;
- unnecessary DOM/SVG element creation;
- repeated connector calculations;
- expensive operations during dragging;
- expensive operations during zooming/panning;
- unnecessary reactive state updates.

Prefer targeted optimizations over a large architectural rewrite.

### TODO

After the connector optimization, create a small prioritized TODO list of additional performance improvements that could be investigated later.