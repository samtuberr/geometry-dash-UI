# geometrydash-ui — UI page plan

This repository is a separate viewer for the output of the geometry project described in `README.md`. The product imports existing meshes, segment assignments and predictions, then helps a person understand and inspect them. Classification, segmentation and primitive fitting stay in the upstream project.

## Design direction

Use a light, clean scientific dashboard: a pale gray application background, white panels, slate text, thin borders and restrained teal accents. Give geometry the most space. Use a readable sans-serif for navigation and a monospace font for coordinates, IDs and parameters.

Take inspiration from [92181/model-viewer](https://github.com/92181/model-viewer) and its [Tellurium demo](https://798.pages.dev/viewer/): a large model canvas, a scene list with visibility controls, a compact toolbar, a ground grid and contextual controls. Adapt the scene list into a mesh/segment browser and add an evidence panel. Keep camera rotation separate from changing source geometry. The reference includes modeling tools; this UI needs viewing and inspection only.

`design/index.html` is a clickable design prototype of the five screens below. All mesh shapes, predictions and numerical values in it are illustrative. Its SVG previews demonstrate composition, selection and overlay controls; real STL loading and 3D camera controls are part of the implementation plan, not implemented in this layout prototype. The supplied files contain no actual dataset or predictions to connect yet.

## Pages and navigation

| Page | Route | Purpose | Main action |
| --- | --- | --- | --- |
| Overview | `/` | Understand an imported dataset and find results needing review | Open a mesh in Inspector |
| 3D Inspector | `/meshes/:meshId?segment=:segmentId` | Inspect the original shape, individual segments and fitted surfaces | Select a segment and examine its evidence |
| Results | `/results` | Review and filter every prediction across meshes | Open a result in Inspector |
| Import | `/import` | Connect output files to their source geometry | Validate and open a dataset |
| Geometry Guide | `/guide` | Explain what the viewer displays | Learn a concept and return to inspection |

Keep four primary navigation items: Overview, Inspector, Results and Geometry Guide. Import is a visible header action. Do not create a separate page for each primitive or segment: use a persistent detail panel inside Inspector. Preserve the selected mesh, segment, camera and filters while navigating.

### 1. Overview

**Layout:** page title and dataset selector; four compact summary cards; mesh cards; a small review queue.

- Summary: mesh count, segment count, prediction coverage and fit-status distribution. The README's 10 meshes, 43 segments and 19,860 triangles describe its original fixtures, not hard-coded application limits.
- Each mesh card has a static thumbnail, mesh ID, triangle/segment counts and classification summary. Generate thumbnails once after loading, rather than running a live WebGL scene in every card.
- Review queue lists unresolved segments, partial/failed fits and missing predictions separately. Confidence is a value supplied by the upstream method, not measured classification accuracy.
- Filters for mesh ID, primitive type and review category. Clicking a card opens its mesh; clicking a queue item opens its exact segment.
- Empty state: “Open geometry results” with Import and an optional clearly labeled sample dataset. No simulated analysis progress.

### 2. 3D Inspector — the primary screen

**Desktop layout:** 240 px mesh/segment panel, flexible central canvas, 300–340 px inspection panel. Toolbar sits above the canvas; a narrow status strip sits below it. Panels can collapse for a larger model view.

**Left panel:** mesh selector; searchable segment list; segment ID, color, classification and fit badge; visibility checkbox for each segment; isolate selected segment and show all actions. Selection and visibility are distinct controls. A click on the mesh selects the same segment as a click on the list. Dimming other segments retains context; isolation hides them.

**Canvas:** original mesh in a neutral material or segment colors; subtle grid; orientation gizmo; selection outline. Controls include zoom in/out, fit model, fit selection, reset view, front/top/right/isometric presets and fullscreen. Left drag rotates the camera, wheel/pinch zooms, and right drag/two-finger drag pans. A click selects; a drag must not accidentally select. Auto-rotation is off initially. View controls never modify fitted parameters or vertex coordinates.

**Right panel:** tabs for Summary, Parameters and Diagnostics. Summary shows `(mesh_id, segment_id)`, `kind`, `primitive_type`, confidence, reason, fit status and notes exactly as imported. Parameters uses a type-specific readable layout with a raw JSON fallback. Unknown parameter conventions remain visible but cannot drive an overlay until their meaning is configured. Display partial estimates as partial; retain a failed fitting attempt even if the final classification is unresolved.

**Overlay checkboxes:**

| Overlay | Initial state | Scope and behavior |
| --- | --- | --- |
| Segment colors | On when assignments exist | Stable colors by segment; separate selector can color by predicted primitive type |
| Wireframe | Off | Selected segment first; whole-mesh option only on request |
| PCA axes | Off | Three arrows at the selected segment's sample centroid |
| Normal at cursor | Off | One arrow for the hovered original triangle; numerical unit vector in tooltip |
| Fitted primitive | Off | One selected fit, shown with a translucent surface or line outline |
| Bounding box | Off | Selected segment bounds; optional whole-model bounds |
| Ground grid | On | Low-contrast orientation aid; independent of model units |

**Hover interaction:** with inspection enabled, wait roughly 100 ms after the pointer settles, highlight one triangle and show a small tooltip: original triangle ID, segment ID, source-coordinate hit position, face normal `(nx, ny, nz)` and area. If PCA diagnostics exist, include PC1 direction and a link to all three axes in the panel. Hover over a PCA arrow to see its vector and eigenvalue. Do not imply that every triangle has its own PCA. Click pins the inspected triangle; Escape clears it. Hide transient hover while orbiting and keep the tooltip inside the canvas bounds. On touch, tap selects and exposes the same values in the panel.

**Geometry accuracy:** compute the unit face normal as `cross(B−A, C−A) / ||cross(B−A, C−A)||`; the tutorial's cross-product formula alone gives an unnormalized vector. Triangle area is half that cross-product magnitude. Mark a degenerate triangle's normal as unavailable. A winding-derived normal is not guaranteed to point outward on an arbitrary imported mesh. Use a face normal for triangle inspection even if the display uses smooth vertex normals.

**PCA meaning:** prefer optional diagnostics from the upstream project. Explicitly distinguish position PCA from normal-distribution PCA; they have different meanings. Label eigenvectors, eigenvalues, sample type, weighting and coordinate frame. Eigenvector signs can flip and nearly equal eigenvalues make axes ambiguous. PCA arrows are explanatory diagnostics, not automatically a fitted cylinder/cone axis or evidence that a classification is correct. If diagnostics are absent, disable the checkbox with “PCA diagnostics unavailable.” A later optional local PCA helper may run once per selected segment in a worker and must be labeled as viewer-derived.

**Fit overlays:** planes need an explicit display extent; cylinders, cones and spheres may represent only a partial surface; tori need orientation and both radii. Bound visual patches using the segment's extent and label them as visualization extents, not reconstructed trimming boundaries. Do not invent missing axes, centers or radii. Enable partial overlays only when the supplied estimates are sufficient, label their status, and show failure notes rather than fabricating a surface.

### 3. Results

**Layout:** coverage summary; search/filter bar; sortable table; selected-row details; Open in Inspector action.

- Columns: mesh ID, segment ID, classification, confidence, fit status, residual summary when available and reason preview.
- Filters: primitive type, unresolved, fit status, missing prediction and confidence range. Missing rows represent absent output, not an unresolved classification.
- Keep classification and fit status separate. `primitive` and `unresolved` are classification kinds; `fitted`, `partial`, `failed` and `not_applicable` are fit statuses.
- A failed/partial fitting attempt may remain attached to a final unresolved result. Conversely, `not_applicable` is valid only when no primitive is selected.
- A residual cell must include its measure, units and sample basis when supplied. Do not compare errors across methods, scales or units without compatible metadata. Missing errors show “Not supplied,” never zero. Dataset accuracy cannot be calculated without ground truth.
- Download original `predictions.json` unchanged and optionally export the filtered table as CSV. Screenshot export belongs in Inspector. Editing/reclassifying predictions is outside the first version.

### 4. Import

**Layout:** simple file drop area and file picker; file roles; validation summary; Open dataset button.

Support two clear paths:

1. **STL preview:** one binary or ASCII `.stl` gives rotate/zoom/pan and geometric triangle inspection. It supplies neither reliable segment IDs nor classification, fit parameters, PCA or units. These controls explain which companion files are missing.
2. **Results bundle:** `manifest.json` when available, mesh folders with `mesh.json` and/or `mesh.stl`, `segments.json` or `triangle_segments.csv`, and `predictions.json`; optional diagnostics. Select multiple files or a directory, with a standard file-picker fallback. ZIP import can follow later rather than becoming an initial dependency.

Prefer indexed `mesh.json` for the segmented view because the README guarantees original facet order. Resolve segment assignments by original triangle index and predictions by `(mesh_id, segment_id)`, never by filename guesses or row position. Preserve an explicit render-face-to-original-triangle map if render buffers are grouped or reordered. STL plus assignments must have a verified facet mapping; matching counts alone is insufficient. Until verified, allow neutral STL viewing but block colored segments and result-to-triangle inspection for that mesh.

Validate parse errors, finite coordinates, valid vertex indices, triangle assignment lengths, referenced mesh/segment IDs, duplicate predictions, confidence in `[0,1]`, enum values and classification/fit-status consistency. Show actionable errors with filenames and record IDs. Missing predictions or optional metadata do not prevent basic viewing; count and label them. No filesystem path traversal when resolving a manifest.

The README references `DATA_FORMAT.md` and suggested parameter conventions, but that file is absent from this repository. The first implementation needs either that document or representative outputs before finalizing the adapter and overlay parameter mapping. Keep raw parameter JSON available in the meantime.

### 5. Geometry Guide

Adapt `GEOMETRY_CONCEPTS.html` into concise illustrated cards: Vertex → Triangle → Mesh → Segment, then face normal and area. Add separate explanations for the five supported primitive types, PCA and classification versus fitting. Explain that a triangle is planar even when its segment approximates a curved surface. A cube is a mesh, not one of the supported primitive surface types.

Use inline help beside PCA, confidence, normal and residual labels, with “Learn more” opening the relevant guide anchor. Guide illustrations can be lightweight SVGs; they do not need a live 3D canvas. The supplied tutorial is Hebrew; preserve it as a reference and keep the initial UI English with a later Hebrew/RTL option if needed. Keep vectors and coordinates left-to-right in either language.

## Data boundary

```text
Separate geometry project
  ├─ original mesh + supplied segment mapping
  ├─ predictions.json
  └─ optional diagnostics / units / error metadata
                 ↓ import and validate
UI adapter → mesh/segment/result store → pages + one 3D viewer
```

Required prediction fields come from `README.md`. Suggested optional diagnostics are a separate, versioned file or adapter payload; do not silently change the upstream prediction schema. A useful diagnostics record is keyed by `(mesh_id, segment_id)` and contains PCA domain, centroid, eigenvectors/eigenvalues, sample/weighting descriptions, coordinate frame and residual metadata if available. Keep unknown optional fields in the raw view.

STL coordinates have no guaranteed unit label. Show “model units” until explicit metadata provides units. Positions, vectors, fitted parameters and area use the source coordinate frame; camera transformations and any display-centering offset must be accounted for when reporting values. Normals are dimensionless, lengths use model units and areas use squared model units.

## Rendering and usability budget

- Use one active WebGL canvas in Inspector; cache Overview thumbnails. A simple material, a few lights and no continuous decorative animation provide visual clarity.
- Build buffered mesh geometry, not one scene object per triangle. Preserve original IDs when regrouping faces. Cache derived triangle data and overlays; reuse one hover marker/normal arrow.
- Render on changes to the camera, selection, overlays or canvas size. With damping enabled, request frames until motion settles, then stop. Cap device pixel ratio, initially at 1.5–2, as a configurable visual-quality setting.
- Raycast only the active visible mesh while the pointer is in the canvas, at a bounded rate (initially up to 20–30 Hz). Suspend hover work during camera drag. Add a spatial index only if profiling shows a need; it is not necessary to choose that complexity before measuring.
- PCA uses three arrows. Normals default to one hovered arrow. If a sampled-normal mode is later added, use a strict cap, such as 128 arrows on the selected segment.
- Disable unavailable diagnostics with a reason. Clear stale highlights on mesh changes. Dispose old GPU buffers/materials, revoke file URLs and cancel obsolete loading requests.
- Initial performance targets: responsive selection, roughly 60 fps while orbiting on a typical desktop, and no perpetual render loop while idle. These are targets to measure against representative meshes, not measured claims about this prototype.
- At tablet widths collapse both side panels into drawers. On phones use a full-width canvas with Segments/Details tabs below it, and tap inspection. Keep visible zoom and reset buttons.
- Use labeled checkboxes, keyboard focus, accessible contrast and textual badges in addition to colors. Supply list/table access to every segment, and panel-based access to values that also appear on hover. Respect reduced-motion preferences.

## Implementation sequence

1. **Design approval:** review the five-screen prototype, information hierarchy and missing parameter schema with the actual upstream outputs.
2. **Viewer foundation:** build the shell and import adapters; validate both STL encodings; add real orbit/zoom/pan/reset; preserve triangle mappings. A suitable small stack is TypeScript + React + Vite with Three.js; no server is required for local-file review.
3. **Results connection:** show existing segments and predictions, synchronized selection, visibility, Summary/Parameters panels and Results filters. Verify duplicate/missing-record handling and original JSON export.
4. **Inspection polish:** face normal/area hover, optional PCA diagnostics, selected-fit overlay, camera presets, cached thumbnails and screenshot export.
5. **Validation:** verify picking IDs after regrouping, source-frame vector readouts, missing/partial/failed fits, unfamiliar parameters, metadata mismatches, large-file responsiveness, keyboard and touch interaction. Measure performance before adding acceleration structures.

Keep comparison between runs, clipping planes, residual heatmaps, dense normal fields, ZIP import and editing tools for a later version. A residual heatmap requires per-sample/per-face error data; a single summary residual cannot produce it faithfully.

## Technical references

- [Three.js STLLoader](https://threejs.org/docs/pages/STLLoader.html): binary/ASCII STL input; returns non-indexed buffer geometry.
- [Three.js OrbitControls](https://threejs.org/docs/pages/OrbitControls.html): camera orbit, zoom and pan.
- [Three.js Raycaster](https://threejs.org/docs/pages/Raycaster.html): pointer intersections for inspection and selection.
- Local product requirements: `README.md`; concept explanations: `GEOMETRY_CONCEPTS.html`.

To review the prototype, run `python3 -m http.server 5173` from this directory and open `http://localhost:5173/design/`. It has no build step or external dependencies.

Prototype validation completed: all five page routes; segment selection and isolation; overlay state changes and unavailable-data handling; parameter tabs; Results search; and layouts at desktop and phone widths. No horizontal page overflow remained after fixing the mobile Results table. JavaScript syntax and local asset links were checked. This validates the design interactions only; STL loading, real picking, camera rotation and rendering performance still require the viewer implementation.
