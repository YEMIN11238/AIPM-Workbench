# Painted animation runtime

This runtime retains the full painted-animation template from `tuzhechen2005/opus-video-skills` at `59744a69c7b916cfbe4c4ec84006b0c2f5e2fde1`. Its lockfile pins p5 2.3.3, p5.brush 2.2.3 and Puppeteer Core 25.11.0. Dependencies were installed with `npm ci --ignore-scripts`; the host does not run upstream setup, update or publication scripts.

`preparePaintedProject` copies the complete template, engine modules, drawing guide and model sheets into each owned project. It vendors the actual p5 and p5.brush browser distributions and their licenses; drawing does not use image-generation services or remote fonts. System fonts are available for explicit text overlays. The original renderer remains in the copied template; standalone execution requires its declared Node dependencies and a browser, while the workbench uses the existing managed Lemo renderer.

The adapted project changes only dimensions, optional studio controls and the renderer bridge. `window.render(t)` redraws the original p5.brush scene and composites its real output canvas; `READY`, `DUR`, `EV` and `TEXTS` supply the workbench protocol. A retained starter hash distinguishes an initialized project from authored scenes. Existing authored pages are never overwritten. An explicitly replaceable Lemo starter is backed up before its root page changes.

The two-point ink-stroke compatibility correction follows `jumpersun/framecraft-skills` at `734a9093fecf1589cd5be51fa5ee62e9c37584dd`: a two-point `inkLine` uses the straight-segment spline path. Runtime and project metadata retain that patch source.

Frame complexity must be measured on the actual GPU. Watercolor fills may take seconds per frame. Runtime readiness and a successful technical smoke do not assert aesthetic approval or model-quality parity.
