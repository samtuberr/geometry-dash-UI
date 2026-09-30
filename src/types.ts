export const primitiveTypes = ['plane', 'cylinder', 'cone', 'sphere', 'torus'] as const;
export type Primitive = typeof primitiveTypes[number];
export type Vec3 = [number, number, number];
export type FitStatus = 'fitted' | 'partial' | 'failed' | 'not_applicable';
export interface Prediction {
  mesh_id: string; segment_id: number; kind: 'primitive' | 'unresolved';
  primitive_type: Primitive | null; confidence: number; reason: string;
  fit: { status: FitStatus; parameters: Record<string, unknown> | null; notes: string; residual?: Record<string, unknown>; [key: string]: unknown };
  [key: string]: unknown;
}
export interface Segment { id: number; triangles: number[]; color: string; prediction?: Prediction }
export interface MeshData {
  id: string; name: string; positions: Float64Array; segments: Segment[];
  triangleCount: number; vertexCount: number; segmented: boolean; mappingVerified: boolean;
  bounds: { min: Vec3; max: Vec3 }; units: string; source: string;
}
export interface Dataset {
  name: string; meshes: MeshData[]; predictions: Prediction[]; originalPredictions: string | null;
  sample: boolean; warnings: string[];
}
export interface InputFile { path: string; buffer: ArrayBuffer }
export interface ImportResult { dataset?: Dataset; errors: string[]; warnings: string[]; files: number }
export interface TriangleHit { triangleId: number; segmentId: number | null; position: Vec3; normal: Vec3 | null; area: number; pinned: boolean }
export interface Overlays { colors: boolean; wire: boolean; fit: boolean; normal: boolean; bounds: boolean; grid: boolean }
export type ColorMode = 'segment' | 'primitive' | 'neutral';
export const palette = ['#65b9ad', '#89aeda', '#d4b17c', '#b59bd2', '#dc9687', '#91b79c', '#8fb7ca', '#c4b775', '#ba99a8'];
export const typeColors: Record<string, string> = { plane: '#89aeda', cylinder: '#65b9ad', cone: '#d4b17c', sphere: '#b59bd2', torus: '#dc9687', unresolved: '#c4b775', missing: '#adb9c0' };
export const predictionKey = (mesh: string, segment: number) => JSON.stringify([mesh, segment]);
