# geometrydash-ui

A browser UI for [samtuberr/geometry-dash](https://github.com/samtuberr/geometry-dash): STL preview, segmented mesh inspection, and review of primitive classification and fitting results. The original assignment is preserved in `README.md`; the earlier design prototype remains in `design/`.

## Run

Use Node.js 24, matching `.node-version` and the production build pipeline.

```bash
npm ci
npm run dev
```

Open the URL printed by Vite, normally `http://localhost:5173`. Vite chooses the next port when that port is occupied. Production: `npm run build`, then `npm run preview`. A static host needs an SPA fallback to `index.html` for `/meshes/...`, `/results`, `/import`, and `/guide`.

For the implemented production Terraform, GitHub Actions, monitoring and rollback, start with [Production setup and operations](PRODUCTION_SETUP.md). Supply your account details in a local copy of `infra/account.example.json`; cloud workflows remain disabled until you configure and enable them. Only production is active; dev/staging examples are commented out.

For step-by-step setup in Hebrew, open [מדריך ההקמה בעברית](PRODUCTION_SETUP_HE.html) in a browser. It includes the account fields, commands, expected results, troubleshooting, a local checklist and print/PDF support.

The [GCP DevOps deployment plan](GCP_DEPLOYMENT.md) describes the longer-term environment separation and multi-zone availability design.

For a complete Hebrew explanation, open [מדריך הפריסה בעברית](GCP_DEPLOYMENT_HE.html) in a browser. The standalone guide includes diagrams, a budget calculator, a release/rollback simulation, a glossary, and the embedded source document.

## Connect your pipeline

Generate results in the upstream repository:

```bash
uv run python -m fitpipeline assignment/data assignment/predictions.json
```

In geometrydash-ui, choose **Import geometry → Choose directory**, and select `assignment/`. This loads `manifest.json`, `data/mesh_XX/mesh.json`, `segments.json` (or `triangle_segments.csv`), and `predictions.json`. Selecting the whole upstream repository also works. Without a manifest, retain one folder per mesh; the folder name supplies the mesh ID. For a single mesh, a multiple-file selection also works. You can import `predictions.json` alone to attach output to the currently open, segmented dataset.

For standalone shape viewing, choose any binary or ASCII `.stl`. Orbit with left drag, zoom with the wheel or visible buttons, and pan with right drag or two fingers. Presets, fit selection, reset, fullscreen, and PNG export are in the viewport. Click a triangle to pin its inspection; Escape clears it. The triangle ID input makes original faces accessible without picking.

The results adapter follows the actual upstream conventions in [DATA_FORMAT.md](DATA_FORMAT.md): `point`/`normal`, `axis_point`/`axis_direction`/`radius`, `apex`/`axis_direction`/`half_angle_radians`, `center`/`radius`, and `center`/`axis_direction`/`major_radius`/`minor_radius`. Summary, Parameters, and Diagnostics show imported evidence, fit notes, and the pipeline’s vertex and normal residuals. Predictions download unchanged; CSV exports the filtered results.

## Geometry and import behavior

- Local files are read and validated in a browser worker. There is no upload server or runtime connection to GitHub. Files remain in memory and must be imported again after a page reload.
- Indexed JSON preserves the upstream original facet order. Render buffers keep a per-segment render-face-to-original-triangle map. Selecting a result and clicking its geometry use the same segment IDs.
- A standalone STL has no segment labels or reliable unit metadata. An STL with assignments alone stays neutral until its facet mapping can be verified with matching `mesh.json`; equal counts are insufficient. When both encodings are present, their original triangle corners are compared.
- Source coordinates remain separate from display centering. ASCII coordinates retain double precision; render buffers use centered single precision. Face normals are normalized winding normals, area is half the cross-product magnitude, and degenerate faces report no normal.
- Missing results remain missing. Failed unresolved attempts retain their notes and residuals. Unknown or incomplete parameters remain readable but cannot create a fabricated overlay. Fit patches use display extents, not recovered trimming boundaries.
- Units default to “model units.” An optional `units` string on a manifest or mesh manifest entry supplies the display label. PCA axes are unavailable because the current upstream predictions do not contain PCA diagnostics; no axes are invented.
- Overview thumbnails are static projections of the actual meshes. The Inspector owns one WebGL canvas and renders only after changes. Hover is debounced, selected overlays are reused, and old GPU resources are disposed. Visibility, camera, selection, detail tabs, and filters persist while navigating within the open dataset.

ZIP, PLY, automatic classification, and prediction editing are outside this viewer. Import the indexed JSON/CSV files that accompany the upstream STL/PLY dataset. The viewer consumes pipeline output and does not rerun the Python classifier.

## Included sample

`public/sample/` contains the upstream procedural fixtures: 10 meshes, 43 supplied segments, and 19,860 original triangles. Predictions were actually generated with the pipeline at revision `27a94f5d7c048e03f4b016fe9cd7305cee5bf750`; there are 41 fitted primitives and two unresolved classifications retaining failed attempts. The sample is labeled in the UI and opens automatically. It is not a set of fabricated display values. See [sample provenance](public/sample/PROVENANCE.md).

## Check

```bash
npm test
npm run build
npx playwright install --with-deps chromium
npm run test:e2e
```

Unit checks cover the real upstream dataset, STL encodings and precision, assignment/CSV identity, malformed inputs, facet-order mismatches, original JSON preservation, winding/area and degenerate triangles, transformed geometry, and all five overlay conventions. Browser checks exercise file and directory import, selection and picking, isolation and fit overlays, state preservation, exports, validation, and desktop/tablet/phone layouts.

Implemented with React, TypeScript, Vite, Three.js, and Lucide. Three.js supplies binary STL decoding, rendering, orbit controls, and raycasting; the UI, validation, adapters, source identity, inspection readouts, and fit visualizations are implemented here. Existing design documents and the Hebrew geometry tutorial are retained.
