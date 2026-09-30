import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { importFiles, parseStl, validatePredictions } from './importer';
import { triangleInfo } from './geometry';
import { createFitOverlay, overlayAvailability } from './fitOverlay';
import * as THREE from 'three';
import type { InputFile, Prediction } from './types';

const file = (path: string, value: unknown): InputFile => ({ path, buffer: new TextEncoder().encode(typeof value === 'string' ? value : JSON.stringify(value)).buffer as ArrayBuffer });
const read = (path: string): InputFile => { const b = readFileSync(new URL('../public/sample/' + path, import.meta.url)); return { path, buffer: b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer }; };
const mesh = { vertices: [[10, 20, 30], [12, 20, 30], [10, 23, 30], [10, 20, 35]], triangles: [[0, 1, 2], [0, 2, 3], [0, 1, 3]] };
const good: Prediction = { mesh_id: 'part', segment_id: 3, kind: 'primitive', primitive_type: 'plane', confidence: .9, reason: 'Planar geometry.', fit: { status: 'fitted', parameters: { point: [10, 20, 30], normal: [0, 0, 1] }, notes: 'Area-weighted plane fit.' } };
const indexed = () => [file('part/mesh.json', mesh), file('part/segments.json', { triangle_segment_ids: [3, 9, 3] })];
const ascii = `solid fixture\nfacet normal 0 0 1\nouter loop\nvertex 10.123456789 20 30\nvertex 12 20 30\nvertex 10 23 30\nendloop\nendfacet\nendsolid fixture`;
function binaryStl() { const buffer = new ArrayBuffer(134); const view = new DataView(buffer); view.setUint32(80, 1, true); [0, 0, 1, 10, 20, 30, 12, 20, 30, 10, 23, 30].forEach((value, i) => view.setFloat32(84 + i * 4, value, true)); return { path: 'part.stl', buffer }; }

describe('upstream data contract', () => {
  it('imports the real 10-mesh, 43-result pipeline dataset without assumptions about row order', () => {
    const manifest = JSON.parse(new TextDecoder().decode(read('manifest.json').buffer));
    const files = [read('manifest.json'), read('predictions.json'), ...manifest.meshes.flatMap((m: { directory: string }) => [read(m.directory + '/mesh.json'), read(m.directory + '/segments.json')])];
    const result = importFiles(files.reverse());
    expect(result.errors).toEqual([]); expect(result.warnings).toEqual([]); expect(result.dataset?.meshes).toHaveLength(10);
    expect(result.dataset?.predictions).toHaveLength(43); expect(result.dataset?.meshes.reduce((n, m) => n + m.triangleCount, 0)).toBe(19860);
    expect(result.dataset?.meshes.every(m => m.mappingVerified)).toBe(true);
    expect(result.dataset?.originalPredictions).toBe(new TextDecoder().decode(read('predictions.json').buffer));
    const cylinder = result.dataset!.meshes.find(m => m.id === 'mesh_02')!;
    expect(cylinder.segments[0].prediction?.primitive_type).toBe('cylinder');
    expect(cylinder.segments[0].prediction?.fit.parameters?.radius).toBeCloseTo(2);
    const unresolved = result.dataset!.predictions.find(p => p.mesh_id === 'mesh_09')!;
    expect(unresolved.kind).toBe('unresolved'); expect(unresolved.fit.status).toBe('failed'); expect(unresolved.fit.notes).toContain('Attempted');
  });
  it('keeps original IDs after segment grouping and represents missing records separately', () => {
    const result = importFiles([...indexed(), file('predictions.json', { predictions: [good] })]);
    expect(result.errors).toEqual([]); const m = result.dataset!.meshes[0];
    expect(m.segments.map(s => [s.id, s.triangles])).toEqual([[3, [0, 2]], [9, [1]]]);
    expect(m.segments[0].prediction).toEqual(good); expect(m.segments[1].prediction).toBeUndefined();
    expect(result.warnings.join(' ')).toContain('1 segment without predictions');
    expect(triangleInfo(m, 1).segmentId).toBe(9); expect(triangleInfo(m, 2).segmentId).toBe(3);
  });
  it('reads CSV by explicit triangle ID rather than row position', () => {
    const result = importFiles([indexed()[0], file('part/triangle_segments.csv', 'triangle_id,segment_id\n2,3\n0,3\n1,9')]);
    expect(result.errors).toEqual([]); expect(result.dataset!.meshes[0].segments[0].triangles).toEqual([0, 2]);
  });
  it('can attach predictions to a dataset already open', () => {
    const base = importFiles(indexed()).dataset!; const result = importFiles([file('predictions.json', { predictions: [good] })], base);
    expect(result.errors).toEqual([]); expect(result.dataset!.meshes[0].segments[0].prediction).toEqual(good);
    expect(base.meshes[0].segments[0].prediction).toBeUndefined();
  });
});

describe('STL and source geometry', () => {
  it('loads binary STL with the same facet coordinates', () => { const p = parseStl(binaryStl()); expect([...p.positions]).toEqual([10, 20, 30, 12, 20, 30, 10, 23, 30]); });
  it('gives a standalone STL a usable mesh ID and dataset name', () => { const result = importFiles([binaryStl()]); expect(result.dataset!.name).toBe('part'); expect(result.dataset!.meshes[0].id).toBe('part'); });
  it('recognizes a binary STL even when its header starts with solid', () => { const f = binaryStl(); new Uint8Array(f.buffer).set(new TextEncoder().encode('solid binary')); expect(parseStl(f).positions.length).toBe(9); });
  it('retains double precision and source coordinates for ASCII STL', () => { const p = parseStl(file('part.stl', ascii)); expect(p.positions[0]).toBe(10.123456789); expect(p.positions.length).toBe(9); });
  it('rejects malformed/truncated STL rather than showing partial geometry', () => {
    expect(() => parseStl(file('bad.stl', ascii.replace('endfacet', '')))).toThrow('incomplete facets');
    expect(() => parseStl(file('bad.stl', ascii.replace('12 20 30', '12x 20 30')))).toThrow('invalid vertex');
    const truncated = binaryStl(); truncated.buffer = truncated.buffer.slice(0, 100); expect(() => parseStl(truncated)).toThrow();
  });
  it('does not enable segment colors on STL solely because triangle counts match', () => {
    const stl = binaryStl(); stl.path = 'part/mesh.stl';
    const result = importFiles([stl, file('part/segments.json', { triangle_segment_ids: [3] }), file('predictions.json', { predictions: [good] })]);
    expect(result.errors).toEqual([]); const m = result.dataset!.meshes[0]; expect(m.mappingVerified).toBe(false);
    expect(triangleInfo(m, 0).segmentId).toBe(null); expect(result.warnings.join(' ')).toContain('unverified');
  });
  it('verifies matching STL/JSON corners and refuses reordered facets', () => {
    const stl = binaryStl(); stl.path = 'part/mesh.stl';
    const source = { ...mesh, triangles: [mesh.triangles[0]] };
    expect(importFiles([stl, file('part/mesh.json', source), file('part/segments.json', { triangle_segment_ids: [3] })]).errors).toEqual([]);
    const other = { ...mesh, triangles: [mesh.triangles[1]] };
    expect(importFiles([stl, file('part/mesh.json', other)]).errors.join(' ')).toContain('facet order or coordinates differ');
  });
  it('computes unit winding normals and correct area in the original coordinate frame', () => {
    const m = importFiles(indexed()).dataset!.meshes[0]; const info = triangleInfo(m, 0);
    expect(info.normal).toEqual([0, 0, 1]); expect(info.area).toBe(3); expect(info.position).toEqual([10 + 2 / 3, 21, 30]);
    const changed = structuredClone(mesh); changed.vertices = changed.vertices.map(v => [v[2] * 7, v[0] * 7, v[1] * 7]);
    const transformed = importFiles([file('part/mesh.json', changed)]).dataset!.meshes[0];
    expect(triangleInfo(transformed, 0).normal).toEqual([1, 0, 0]); expect(triangleInfo(transformed, 0).area).toBe(3 * 49);
  });
  it('marks a degenerate face normal unavailable', () => { const m = importFiles([file('mesh.json', { vertices: [[0, 0, 0], [1, 0, 0], [2, 0, 0]], triangles: [[0, 1, 2]] })]).dataset!.meshes[0]; expect(triangleInfo(m, 0).normal).toBe(null); expect(triangleInfo(m, 0).area).toBe(0); });
});

describe('actionable validation and fit overlays', () => {
  it.each([
    ['confidence', { ...good, confidence: 1.1 }, 'confidence'],
    ['duplicate', good, 'duplicate'],
    ['classification', { ...good, kind: 'unresolved' }, 'inconsistent'],
    ['fit status', { ...good, fit: { ...good.fit, status: 'not_applicable' } }, 'fitting attempt'],
    ['unknown segment', { ...good, segment_id: 99 }, 'absent'],
    ['unknown mesh', { ...good, mesh_id: 'other' }, 'unknown mesh_id']
  ])('rejects %s errors', (name, record, message) => { const predictions = name === 'duplicate' ? [record, record] : [record]; const result = importFiles([...indexed(), file('predictions.json', { predictions })]); expect(result.errors.join(' ')).toContain(message); expect(result.dataset).toBeUndefined(); });
  it('rejects assignment lengths, duplicate CSV IDs, nonfinite coordinates and invalid indices', () => {
    expect(importFiles([indexed()[0], file('part/segments.json', { triangle_segment_ids: [3] })]).errors.join(' ')).toContain('assignments for');
    expect(importFiles([indexed()[0], file('part/triangle_segments.csv', 'triangle_id,segment_id\n0,3\n0,9\n2,3')]).errors.join(' ')).toContain('duplicate');
    expect(importFiles([file('mesh.json', '{"vertices":[[1e999,0,0]],"triangles":[[0,0,0]]}')]).errors.join(' ')).toContain('finite coordinates');
    expect(importFiles([file('mesh.json', { ...mesh, triangles: [[0, 1, 100]] })]).errors.join(' ')).toContain('invalid vertex index');
  });
  it('blocks manifest traversal and count mismatches', () => {
    const manifest = { meshes: [{ mesh_id: 'part', directory: '../part' }] };
    expect(importFiles([...indexed(), file('manifest.json', manifest)]).errors.join(' ')).toContain('Unsafe file path');
    manifest.meshes[0].directory = 'part';
    expect(importFiles([...indexed(), file('manifest.json', { ...manifest, mesh_count: 2 })]).errors.join(' ')).toContain('mesh_count');
  });
  it('preserves unknown parameter conventions but disables the surface overlay', () => { const p = { ...good, fit: { ...good.fit, parameters: { coefficients: [1, 2, 3, 4] } } }; expect(validatePredictions({ predictions: [p] })[0].fit.parameters).toEqual(p.fit.parameters); expect(overlayAvailability(p)).toContain('unfamiliar'); });
  it('retains partial usable parameters and failed unresolved attempts', () => {
    const partial: Prediction = { ...good, fit: { ...good.fit, status: 'partial' } }; expect(overlayAvailability(partial)).toBe(null);
    const failed: Prediction = { ...good, kind: 'unresolved', primitive_type: null, fit: { status: 'failed', parameters: null, notes: 'Attempted plane; poor fit.' } }; expect(validatePredictions({ predictions: [failed] })[0]).toEqual(failed); expect(overlayAvailability(failed)).toContain('No usable');
  });
  it('creates source-aligned overlays for all five pipeline parameter conventions', () => {
    const records: Prediction[] = [good, ...[
      ['cylinder', { axis_point: [10, 20, 30], axis_direction: [0, 0, 1], radius: 2 }],
      ['cone', { apex: [10, 20, 20], axis_direction: [0, 0, 1], half_angle_radians: .3 }],
      ['sphere', { center: [10, 20, 30], radius: 2 }],
      ['torus', { center: [10, 20, 30], axis_direction: [0, 1, 0], major_radius: 3, minor_radius: 1 }]
    ].map(([type, parameters]) => ({ ...good, primitive_type: type, fit: { ...good.fit, parameters } }) as Prediction)];
    const bounds = { min: [8, 18, 30] as [number, number, number], max: [12, 22, 35] as [number, number, number] };
    records.forEach(p => { const overlay = createFitOverlay(p, bounds, new THREE.Vector3(10, 20, 30)); expect(overlay).not.toBeNull(); expect(overlay!.geometry.getAttribute('position').array.every(Number.isFinite)).toBe(true); });
    expect(createFitOverlay(good, bounds, new THREE.Vector3(10, 20, 30))!.position.toArray()).toEqual([0, 0, 0]);
    const samePlane = { ...good, fit: { ...good.fit, parameters: { point: [1000, 2000, 30], normal: [0, 0, 1] } } };
    expect(createFitOverlay(samePlane, bounds, new THREE.Vector3(10, 20, 30))!.position.toArray()).toEqual([0, 0, 0]);
  });
});
