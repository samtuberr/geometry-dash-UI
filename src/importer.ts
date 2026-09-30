import { STLLoader } from 'three/addons/loaders/STLLoader.js';
import { boundsOf } from './geometry';
import { palette, predictionKey, primitiveTypes } from './types';
import type { Dataset, ImportResult, InputFile, MeshData, Prediction, Segment } from './types';

const decoder = new TextDecoder();
const object = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
function assert(test: unknown, message: string): asserts test { if (!test) throw new Error(message); }
const integer = (n: unknown): n is number => typeof n === 'number' && Number.isSafeInteger(n) && n >= 0;
function finiteTree(v: unknown): boolean { if (typeof v === 'number') return Number.isFinite(v); if (Array.isArray(v)) return v.every(finiteTree); if (object(v)) return Object.values(v).every(finiteTree); return true; }
function safePath(path: string) { const p = path.replace(/\\/g, '/'); assert(!p.startsWith('/') && !p.split('/').includes('..'), `Unsafe file path: ${path}`); return p.replace(/^\.\//, ''); }
function readJson(file: InputFile): unknown { try { return JSON.parse(decoder.decode(file.buffer)); } catch { throw new Error(`${file.path}: invalid JSON. Check commas, brackets, and number values.`); } }
function indexedMesh(file: InputFile) {
  const data = readJson(file); assert(object(data) && Array.isArray(data.vertices) && Array.isArray(data.triangles), `${file.path}: expected vertices and triangles arrays.`);
  const vertices = data.vertices as unknown[], triangles = data.triangles as unknown[];
  assert(vertices.length > 0 && triangles.length > 0, `${file.path}: geometry is empty.`);
  vertices.forEach((v, i) => assert(Array.isArray(v) && v.length === 3 && v.every(n => typeof n === 'number' && Number.isFinite(n)), `${file.path}: vertex ${i} must contain three finite coordinates.`));
  const positions = new Float64Array(triangles.length * 9);
  triangles.forEach((tri, i) => {
    assert(Array.isArray(tri) && tri.length === 3 && tri.every(n => integer(n) && n < vertices.length), `${file.path}: triangle ${i} has an invalid vertex index.`);
    tri.forEach((v: number, corner: number) => positions.set(vertices[v] as number[], i * 9 + corner * 3));
  });
  return { positions, vertexCount: vertices.length };
}
export function parseStl(file: InputFile) {
  assert(file.buffer.byteLength >= 15, `${file.path}: STL is empty or truncated.`);
  const bytes = file.buffer.byteLength;
  const count = bytes >= 84 ? new DataView(file.buffer).getUint32(80, true) : 0;
  const binary = count > 0 && 84 + count * 50 === bytes;
  if (!binary) {
    const text = decoder.decode(file.buffer);
    assert(/^\s*solid\b/i.test(text), `${file.path}: invalid binary or ASCII STL header / facet count.`);
    const facets = [...text.matchAll(/facet\s+normal\s+[^\n\r]+[\s\S]*?endfacet/gi)];
    const starts = text.match(/\bfacet\s+normal\b/gi)?.length ?? 0;
    assert(facets.length > 0 && facets.length === starts && facets.every(f => (f[0].match(/\bvertex\s/gi)?.length ?? 0) === 3), `${file.path}: ASCII STL has incomplete facets; each facet needs three vertices and endfacet.`);
    // Keep ASCII source coordinates at double precision; GPU buffers are separate.
    const numberPattern = /^[+-]?(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?$/i;
    const positions = new Float64Array(facets.length * 9);
    facets.forEach((facet, i) => {
      const vertices = [...facet[0].matchAll(/\bvertex\s+([^\r\n]+)/gi)];
      vertices.forEach((vertex, j) => {
        const cells = vertex[1].trim().split(/\s+/);
        assert(cells.length === 3 && cells.every(v => numberPattern.test(v) && Number.isFinite(Number(v))), `${file.path}: facet ${i} contains an invalid vertex.`);
        positions.set(cells.map(Number), i * 9 + j * 3);
      });
    });
    return { positions, vertexCount: facets.length * 3 };
  }
  let geometry;
  try { geometry = new STLLoader().parse(file.buffer); } catch { throw new Error(`${file.path}: could not decode STL facets.`); }
  try {
    const attribute = geometry.getAttribute('position');
    assert(attribute && attribute.count > 0 && attribute.count % 3 === 0, `${file.path}: no complete STL triangles found.`);
    const positions = new Float64Array(attribute.array);
    assert(positions.every(Number.isFinite), `${file.path}: STL contains invalid or non-finite coordinates.`);
    return { positions, vertexCount: attribute.count };
  } finally { geometry.dispose(); }
}
function assignments(file: InputFile, count: number): number[] {
  let ids: unknown[];
  if (file.path.endsWith('.csv')) {
    const lines = decoder.decode(file.buffer).trim().split(/\r?\n/);
    assert(lines[0]?.replace(/\s/g, '').replace(/^\uFEFF/, '') === 'triangle_id,segment_id', `${file.path}: CSV header must be triangle_id,segment_id.`);
    ids = new Array(count); const seen = new Set<number>();
    lines.slice(1).filter(s => s.trim()).forEach((line, row) => {
      const cells = line.split(',').map(s => s.trim()); const [tri, seg] = cells.map(Number);
      assert(cells.length === 2 && cells.every(s => /^\d+$/.test(s)) && integer(tri) && tri < count && integer(seg) && !seen.has(tri), `${file.path}: invalid or duplicate triangle ID at CSV row ${row + 2}.`);
      ids[tri] = seg; seen.add(tri);
    });
    assert(seen.size === count, `${file.path}: CSV must assign all ${count} original triangles.`);
  } else { const data = readJson(file); assert(object(data) && Array.isArray(data.triangle_segment_ids), `${file.path}: expected triangle_segment_ids.`); ids = data.triangle_segment_ids; }
  assert(ids.length === count, `${file.path}: ${ids.length} assignments for ${count} triangles. Use the original mesh mapping.`);
  ids.forEach((id, i) => assert(integer(id), `${file.path}: triangle ${i} has an invalid segment ID.`));
  return ids as number[];
}
export function validatePredictions(value: unknown, filename = 'predictions.json'): Prediction[] {
  assert(object(value) && Array.isArray(value.predictions), `${filename}: expected a predictions array.`);
  const seen = new Set<string>();
  value.predictions.forEach((p: unknown, i: number) => {
    assert(object(p), `${filename}: record ${i} must be an object.`);
    const at = `${filename}: ${p.mesh_id ?? `record ${i}`} / segment ${p.segment_id ?? '?'}`;
    assert(typeof p.mesh_id === 'string' && p.mesh_id.length > 0 && integer(p.segment_id), `${at}: mesh_id and a nonnegative integer segment_id are required.`);
    const key = predictionKey(p.mesh_id, p.segment_id); assert(!seen.has(key), `${at}: duplicate prediction.`); seen.add(key);
    assert(p.kind === 'primitive' || p.kind === 'unresolved', `${at}: kind must be primitive or unresolved.`);
    assert(p.kind === 'primitive' ? primitiveTypes.includes(p.primitive_type as never) : p.primitive_type === null, `${at}: primitive_type is inconsistent with kind.`);
    assert(typeof p.confidence === 'number' && Number.isFinite(p.confidence) && p.confidence >= 0 && p.confidence <= 1, `${at}: confidence must be finite and between 0 and 1.`);
    assert(typeof p.reason === 'string' && p.reason.trim(), `${at}: a decision reason is required.`);
    assert(object(p.fit) && ['fitted', 'partial', 'failed', 'not_applicable'].includes(p.fit.status as string), `${at}: invalid fit status.`);
    assert(!(p.kind === 'primitive' && p.fit.status === 'not_applicable'), `${at}: a primitive requires a fitting attempt.`);
    assert(p.fit.parameters === null || object(p.fit.parameters), `${at}: parameters must be an object or null.`);
    assert(typeof p.fit.notes === 'string', `${at}: fit notes are required.`);
    assert(finiteTree(p), `${at}: non-finite value found.`);
  });
  return value.predictions as Prediction[];
}
export function attachPredictions(meshes: MeshData[], predictions: Prediction[]) {
  const lookup = new Map(predictions.map(p => [predictionKey(p.mesh_id, p.segment_id), p]));
  return meshes.map(m => ({ ...m, segments: m.segments.map(s => ({ ...s, prediction: lookup.get(predictionKey(m.id, s.id)) })) }));
}
export function importFiles(inputs: InputFile[], base?: Dataset): ImportResult {
  const warnings: string[] = [];
  try {
    assert(inputs.length > 0, 'Choose an STL or a folder containing mesh.json and results.');
    const files = inputs.map(f => ({ ...f, path: safePath(f.path) }));
    const map = new Map(files.map(f => [f.path, f])); assert(map.size === files.length, 'Duplicate file paths. Choose the project directory to preserve mesh folders.');
    const byName = (name: string) => files.filter(f => f.path.split('/').at(-1) === name);
    const pf = byName('predictions.json'); assert(pf.length <= 1, 'Choose one predictions.json per dataset.');
    const originalPredictions = pf[0] ? new TextDecoder('utf-8', { ignoreBOM: true }).decode(pf[0].buffer) : null;
    const predictions = pf[0] ? validatePredictions(readJson(pf[0]), pf[0].path) : [];
    const mf = byName('manifest.json'); assert(mf.length <= 1, 'Choose one manifest.json per dataset.');
    const manifest = mf[0] ? readJson(mf[0]) : null;
    if (mf[0]) assert(object(manifest) && Array.isArray(manifest.meshes), `${mf[0].path}: expected a meshes array.`);
    const manifestRoot = mf[0]?.path.slice(0, -'manifest.json'.length) ?? '';
    const entries = object(manifest) ? manifest.meshes as Record<string, unknown>[] : [];
    const groups: { id: string; json?: InputFile; stl?: InputFile; labels?: InputFile; csv?: InputFile; meta?: Record<string, unknown> }[] = [];
    if (entries.length) {
      const seen = new Set<string>();
      entries.forEach((meta, i) => {
        assert(object(meta) && typeof meta.mesh_id === 'string' && meta.mesh_id && typeof meta.directory === 'string', `manifest.json: mesh ${i} needs mesh_id and directory.`);
        assert(!seen.has(meta.mesh_id), `manifest.json: duplicate mesh_id ${meta.mesh_id}.`); seen.add(meta.mesh_id);
        const dir = safePath(meta.directory).replace(/\/$/, ''); const path = `${manifestRoot}${dir}/`;
        const json = map.get(path + 'mesh.json'), stl = map.get(path + 'mesh.stl');
        assert(json || stl, `manifest.json: ${meta.mesh_id} geometry missing at ${path}. Choose the entire assignment folder.`);
        groups.push({ id: meta.mesh_id, json, stl, labels: map.get(path + 'segments.json'), csv: map.get(path + 'triangle_segments.csv'), meta });
      });
      if (object(manifest) && manifest.mesh_count !== undefined) assert(manifest.mesh_count === groups.length, 'manifest.json: mesh_count does not match its meshes array.');
    } else {
      const jsonFiles = byName('mesh.json');
      const dirs = new Set(jsonFiles.map(f => f.path.slice(0, -'mesh.json'.length)));
      files.filter(f => /\.stl$/i.test(f.path)).forEach(f => dirs.add(f.path.slice(0, f.path.lastIndexOf('/') + 1)));
      dirs.forEach(dir => {
        const json = map.get(dir + 'mesh.json'); const stls = files.filter(f => f.path.startsWith(dir) && !f.path.slice(dir.length).includes('/') && /\.stl$/i.test(f.path));
        assert(!(json && stls.length > 1), `${dir}: multiple STL files alongside mesh.json; use a manifest to disambiguate.`);
        const items = json ? [{ json, stl: stls[0] }] : stls.map(stl => ({ json: undefined, stl }));
        items.forEach(({ json, stl }) => {
          const predictionIds = [...new Set(predictions.map(p => p.mesh_id))];
          const folderName = dir.replace(/\/$/, '').split('/').at(-1) || undefined;
          const id = stls.length > 1 ? stl!.path.split('/').at(-1)!.replace(/\.stl$/i, '') : folderName ?? (json && predictionIds.length === 1 ? predictionIds[0] : stl?.path.split('/').at(-1)!.replace(/\.stl$/i, '') ?? 'mesh');
          assert(!(json && !folderName && predictionIds.length > 1), 'Flat mesh.json cannot be matched to multiple mesh IDs. Choose the containing directory.');
          groups.push({ id, json, stl, labels: stls.length <= 1 ? map.get(dir + 'segments.json') : undefined, csv: stls.length <= 1 ? map.get(dir + 'triangle_segments.csv') : undefined });
        });
      });
    }
    let meshes: MeshData[];
    if (!groups.length) { assert(base && pf.length === 1, 'No geometry found. Choose an STL, mesh.json, or import predictions after opening its source dataset.'); meshes = base.meshes; }
    else {
      const ids = new Set<string>();
      meshes = groups.map(g => {
        assert(!ids.has(g.id), `Duplicate mesh ID ${g.id}. Use separate mesh folders or a manifest.`); ids.add(g.id);
        const parsed = g.json ? indexedMesh(g.json) : parseStl(g.stl!);
        const count = parsed.positions.length / 9;
        if (g.meta?.triangle_count !== undefined) assert(g.meta.triangle_count === count, `${g.id}: triangle count differs from manifest.`);
        if (g.json && g.meta?.vertex_count !== undefined) assert(g.meta.vertex_count === parsed.vertexCount, `${g.id}: vertex count differs from manifest.`);
        const labels = g.labels ? assignments(g.labels, count) : g.csv ? assignments(g.csv, count) : null;
        if (g.labels && g.csv) { const csv = assignments(g.csv, count); assert(labels?.every((v, i) => v === csv[i]), `${g.id}: JSON and CSV segment assignments disagree.`); }
        let mappingVerified = Boolean(g.json);
        if (g.json && g.stl) {
          const stl = parseStl(g.stl); const scale = parsed.positions.reduce((maximum, v) => Math.max(maximum, Math.abs(v)), 1);
          assert(stl.positions.length === parsed.positions.length && stl.positions.every((v, i) => Math.abs(v - parsed.positions[i]) <= scale * 2e-6), `${g.id}: STL facet order or coordinates differ from mesh.json. Import the matching original files.`);
        }
        // A raw STL does not establish which facet order its external assignment file used.
        if (labels && !mappingVerified) warnings.push(`${g.id}: STL facet mapping is unverified. Import its matching mesh.json to enable segment colors and result picking.`);
        if (!labels) { mappingVerified = false; warnings.push(`${g.id}: no segment assignments. Geometry preview is available; classifications cannot be attached to triangles.`); }
        const segmentMap = new Map<number, number[]>();
        if (labels) labels.forEach((id, tri) => { if (!segmentMap.has(id)) segmentMap.set(id, []); segmentMap.get(id)!.push(tri); });
        const segments: Segment[] = [...segmentMap].sort(([a], [b]) => a - b).map(([id, triangles], i) => ({ id, triangles, color: palette[i % palette.length] }));
        if (g.meta?.segment_count !== undefined && labels) assert(g.meta.segment_count === segments.length, `${g.id}: segment count differs from manifest.`);
        if (object(g.meta?.segment_triangle_counts) && labels) segments.forEach(s => assert((g.meta!.segment_triangle_counts as Record<string, unknown>)[s.id] === s.triangles.length, `${g.id}: segment ${s.id} triangle count differs from manifest.`));
        const units = typeof g.meta?.units === 'string' ? g.meta.units : object(manifest) && typeof manifest.units === 'string' ? manifest.units : 'model units';
        return { id: g.id, name: g.id, ...parsed, triangleCount: count, segments, segmented: Boolean(labels), mappingVerified, bounds: boundsOf(parsed.positions), units, source: g.json ? 'mesh.json' : 'STL' };
      });
    }
    predictions.forEach(p => {
      const mesh = meshes.find(m => m.id === p.mesh_id); assert(mesh, `predictions.json: unknown mesh_id ${p.mesh_id}. Import its source geometry.`);
      assert(mesh.segments.some(s => s.id === p.segment_id), `predictions.json: ${p.mesh_id} / segment ${p.segment_id} is absent from segment assignments.`);
    });
    const missing = meshes.reduce((n, m) => n + m.segments.filter(s => !predictions.some(p => p.mesh_id === m.id && p.segment_id === s.id)).length, 0);
    if (missing) warnings.push(`${missing} segment${missing === 1 ? '' : 's'} without predictions. Missing results remain visible.`);
    const dataset: Dataset = { name: !groups.length ? base!.name : manifestRoot.replace(/\/$/, '').split('/').at(-1) || (meshes.length === 1 ? meshes[0].id : 'Imported dataset'), meshes: attachPredictions(meshes, predictions), predictions, originalPredictions, sample: false, warnings };
    return { dataset, errors: [], warnings, files: inputs.length };
  } catch (error) { return { errors: [error instanceof Error ? error.message : 'Unable to read these files.'], warnings, files: inputs.length }; }
}
