import type { MeshData, TriangleHit, Vec3, ColorMode } from './types';
import { typeColors } from './types';
export function boundsOf(positions: ArrayLike<number>): MeshData['bounds'] {
  const min: Vec3 = [Infinity, Infinity, Infinity], max: Vec3 = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < positions.length; i++) { const axis = i % 3; min[axis] = Math.min(min[axis], positions[i]); max[axis] = Math.max(max[axis], positions[i]); }
  return { min, max };
}
export function triangleInfo(mesh: MeshData, triangleId: number, position?: Vec3): TriangleHit {
  const p = mesh.positions, i = triangleId * 9;
  const a = [p[i], p[i + 1], p[i + 2]], b = [p[i + 3], p[i + 4], p[i + 5]], c = [p[i + 6], p[i + 7], p[i + 8]];
  const u = b.map((n, j) => n - a[j]), v = c.map((n, j) => n - a[j]);
  const cross: Vec3 = [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]];
  const length = Math.hypot(...cross);
  return { triangleId, segmentId: mesh.segmented && mesh.mappingVerified ? mesh.segments.find(s => s.triangles.includes(triangleId))?.id ?? null : null,
    position: position ?? a.map((n, j) => (n + b[j] + c[j]) / 3) as Vec3, normal: length > 0 ? cross.map(n => n / length) as Vec3 : null, area: length / 2, pinned: false };
}
export function segmentBounds(mesh: MeshData, id: number | null): MeshData['bounds'] {
  const segment = mesh.segments.find(s => s.id === id);
  if (!segment || !mesh.mappingVerified) return mesh.bounds;
  const p = new Float64Array(segment.triangles.length * 9);
  segment.triangles.forEach((tri, i) => p.set(mesh.positions.subarray(tri * 9, tri * 9 + 9), i * 9));
  return boundsOf(p);
}
export function surfaceColor(mesh: MeshData, id: number, mode: ColorMode): string {
  if (mode === 'neutral' || !mesh.segmented || !mesh.mappingVerified) return '#a0b7c2';
  const s = mesh.segments.find(s => s.id === id);
  return mode === 'primitive' ? typeColors[s?.prediction?.primitive_type ?? s?.prediction?.kind ?? 'missing'] : s?.color ?? '#a0b7c2';
}
// Project source triangles once into a static thumbnail; no additional WebGL contexts.
export function meshThumbnail(mesh: MeshData): string {
  const center = mesh.bounds.min.map((v, i) => (v + mesh.bounds.max[i]) / 2);
  const projected: { points: number[][]; depth: number; color: string }[] = [];
  const colorByFace = new Map<number, string>();
  mesh.segments.forEach(s => s.triangles.forEach(t => colorByFace.set(t, surfaceColor(mesh, s.id, 'segment'))));
  const stride = Math.max(1, Math.ceil(mesh.triangleCount / 10000));
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  for (let t = 0; t < mesh.triangleCount; t += stride) {
    let depth = 0;
    const points = [0, 1, 2].map(c => {
      const i = t * 9 + c * 3, x = mesh.positions[i] - center[0], y = mesh.positions[i + 1] - center[1], z = mesh.positions[i + 2] - center[2];
      const px = (x - y) * .707, py = (x + y) * .32 - z * .88;
      minX = Math.min(minX, px); maxX = Math.max(maxX, px); minY = Math.min(minY, py); maxY = Math.max(maxY, py); depth += x + y + z * .5;
      return [px, py];
    });
    projected.push({ points, depth, color: colorByFace.get(t) ?? '#a0b7c2' });
  }
  const scale = Math.min(200 / (maxX - minX || 1), 135 / (maxY - minY || 1));
  const polygons = projected.sort((a, b) => a.depth - b.depth).map(f => `<polygon points="${f.points.map(p => `${(150 + (p[0] - (minX + maxX) / 2) * scale).toFixed(1)},${(100 + (p[1] - (minY + maxY) / 2) * scale).toFixed(1)}`).join(' ')}" fill="${f.color}" stroke="#506f7a" stroke-opacity=".17" stroke-width=".35"/>`).join('');
  return `data:image/svg+xml,${encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 300 200"><defs><pattern id="grid" width="25" height="25" patternUnits="userSpaceOnUse"><path d="M25 0H0V25" fill="none" stroke="#dfe9ec" stroke-width=".6"/></pattern></defs><rect width="300" height="200" fill="#f5f9fa"/><rect y="115" width="300" height="85" fill="url(#grid)"/><ellipse cx="150" cy="174" rx="76" ry="9" fill="#496d80" opacity=".05"/>${polygons}</svg>`)}`;
}
