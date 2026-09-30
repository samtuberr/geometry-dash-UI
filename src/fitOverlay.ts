import * as THREE from 'three';
import type { MeshData, Prediction, Vec3 } from './types';
function vector(p: Record<string, unknown>, name: string): THREE.Vector3 | null {
  const v = p[name]; return Array.isArray(v) && v.length === 3 && v.every(n => typeof n === 'number' && Number.isFinite(n)) ? new THREE.Vector3(...v as Vec3) : null;
}
const scalar = (p: Record<string, unknown>, name: string) => typeof p[name] === 'number' && Number.isFinite(p[name]) && (p[name] as number) > 0 ? p[name] as number : null;
export function overlayAvailability(prediction?: Prediction): string | null {
  if (!prediction) return 'Import predictions to view a fitted surface.';
  if (prediction.fit.status === 'failed' || prediction.fit.status === 'not_applicable') return 'No usable fitted surface. See the original fit notes.';
  const p = prediction.fit.parameters; if (!p || !prediction.primitive_type) return 'Fit parameters are not supplied.';
  const direction = (key: string) => { const v = vector(p, key); return v && v.length() > 1e-10; };
  const type = prediction.primitive_type;
  const valid = type === 'plane' ? vector(p, 'point') && direction('normal')
    : type === 'cylinder' ? vector(p, 'axis_point') && direction('axis_direction') && scalar(p, 'radius')
    : type === 'cone' ? vector(p, 'apex') && direction('axis_direction') && scalar(p, 'half_angle_radians') && (p.half_angle_radians as number) < Math.PI / 2
    : type === 'sphere' ? vector(p, 'center') && scalar(p, 'radius')
    : vector(p, 'center') && direction('axis_direction') && scalar(p, 'major_radius') && scalar(p, 'minor_radius');
  return valid ? null : 'Parameters are incomplete or use an unfamiliar convention. Raw JSON remains available.';
}
export function createFitOverlay(prediction: Prediction, bounds: MeshData['bounds'], offset: THREE.Vector3): THREE.Mesh | null {
  if (overlayAvailability(prediction)) return null;
  const p = prediction.fit.parameters!, type = prediction.primitive_type!;
  const min = new THREE.Vector3(...bounds.min), max = new THREE.Vector3(...bounds.max), size = min.distanceTo(max) || 1;
  const center = min.clone().add(max).multiplyScalar(.5);
  let geometry: THREE.BufferGeometry, position = center.clone(), axis = new THREE.Vector3(0, 1, 0);
  if (type === 'plane') { geometry = new THREE.PlaneGeometry(size * 1.1, size * 1.1); const point = vector(p, 'point')!; axis = vector(p, 'normal')!.normalize(); position = center.clone().addScaledVector(axis, point.clone().sub(center).dot(axis)); }
  else if (type === 'sphere') { geometry = new THREE.SphereGeometry(p.radius as number, 48, 32); position = vector(p, 'center')!; }
  else if (type === 'torus') { geometry = new THREE.TorusGeometry(p.major_radius as number, p.minor_radius as number, 24, 64); position = vector(p, 'center')!; axis = vector(p, 'axis_direction')!.normalize(); }
  else {
    axis = vector(p, 'axis_direction')!.normalize(); const origin = vector(p, type === 'cone' ? 'apex' : 'axis_point')!;
    const values: number[] = [];
    for (const x of [min.x, max.x]) for (const y of [min.y, max.y]) for (const z of [min.z, max.z]) values.push(new THREE.Vector3(x, y, z).sub(origin).dot(axis));
    let low = Math.min(...values), high = Math.max(...values); if (type === 'cone') { low = Math.max(0, low); high = Math.max(low + size * .001, high); }
    const height = Math.max(high - low, size * .001); position = origin.clone().addScaledVector(axis, (high + low) / 2);
    const slope = Math.tan(p.half_angle_radians as number);
    geometry = type === 'cone' ? new THREE.CylinderGeometry(high * slope, low * slope, height, 64, 1, true) : new THREE.CylinderGeometry(p.radius as number, p.radius as number, height, 64, 1, true);
  }
  const material = new THREE.MeshBasicMaterial({ color: '#137f78', transparent: true, opacity: .22, side: THREE.DoubleSide, depthWrite: false, wireframe: false });
  const mesh = new THREE.Mesh(geometry, material); mesh.position.copy(position.sub(offset));
  if (type === 'plane' || type === 'torus') mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), axis);
  else if (type === 'cone' || type === 'cylinder') mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), axis);
  const wire = new THREE.LineSegments(new THREE.WireframeGeometry(geometry), new THREE.LineBasicMaterial({ color: '#137f78', transparent: true, opacity: .14 })); mesh.add(wire);
  return mesh;
}
