# Pipeline sample provenance

Source: https://github.com/samtuberr/geometry-dash

Revision: `27a94f5d7c048e03f4b016fe9cd7305cee5bf750`

The manifest, indexed mesh JSON, and segment JSON were copied from `assignment/`. `predictions.json` was generated, without modifications to the upstream code, by:

```bash
uv run python -m fitpipeline assignment/data predictions.json -q
```

Pipeline report: `43 segments: cone 1, cylinder 5, plane 33, sphere 1, torus 1, unresolved 2`. All 41 accepted primitive estimates have `fitted` status. Both unresolved entries retain `failed` attempts and residual summaries. The pipeline took about 2.8 seconds in the development environment; this is a sample run, not a viewer performance benchmark.

The fixture source describes these meshes as procedural, non-customer geometry. The UI labels the included dataset as a real pipeline sample. STL companions are omitted from the built-in sample because indexed JSON already preserves the original facets; standalone STL import is available for user files.
