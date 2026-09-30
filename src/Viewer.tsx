import { useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { Maximize, Minus, Plus, RotateCcw, Scan, Download } from 'lucide-react';
import { segmentBounds, surfaceColor, triangleInfo } from './geometry';
import { createFitOverlay, overlayAvailability } from './fitOverlay';
import type { ColorMode, MeshData, Overlays, TriangleHit, Vec3 } from './types';

type CameraState = { position: number[]; target: number[]; zoom: number; view: string };
const cameras = new WeakMap<MeshData, CameraState>();
type Props = { mesh: MeshData; selected: number | null; visible: Set<number>; overlays: Overlays; colorMode: ColorMode; hit: TriangleHit | null; onSelect: (id: number) => void; onHit: (hit: TriangleHit | null) => void; notify: (message: string) => void };
type Api = { update: (props: Props) => void; fit: (selection?: boolean, preset?: string) => void; zoom: (factor: number) => void; screenshot: () => void };
function disposeObject(object: THREE.Object3D) { object.traverse(o => { if (o instanceof THREE.Mesh || o instanceof THREE.LineSegments || o instanceof THREE.Line) { o.geometry.dispose(); (Array.isArray(o.material) ? o.material : [o.material]).forEach(m => m.dispose()); } }); }
const short = (n: number) => n === 0 ? '0' : Math.abs(n) < .001 || Math.abs(n) >= 100000 ? n.toExponential(3) : n.toFixed(3);
export const vectorText = (v: Vec3 | null) => v ? `(${v.map(short).join(', ')})` : 'Unavailable · degenerate triangle';

export default function Viewer(props: Props) {
  const host = useRef<HTMLDivElement>(null), frame = useRef<HTMLDivElement>(null), api = useRef<Api | null>(null), latest = useRef(props);
  latest.current = props;
  const [error, setError] = useState<string | null>(null), [view, setView] = useState('Isometric');
  const gizmo = useRef<SVGSVGElement>(null);
  useEffect(() => {
    const container = host.current!; const mesh = props.mesh; setError(null); setView('Isometric');
    let renderer: THREE.WebGLRenderer;
    try { renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, preserveDrawingBuffer: true }); }
    catch { setError('WebGL is unavailable in this browser. Results and source geometry details are still accessible.'); return; }
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.8)); renderer.setClearColor('#f5f9fa', 1); renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.domElement.setAttribute('aria-label', `Interactive 3D view of ${mesh.id}. Drag to orbit, scroll to zoom, right drag to pan. Click a triangle to inspect. Use arrow keys to pan.`);
    renderer.domElement.setAttribute('role', 'img'); renderer.domElement.tabIndex = 0; container.appendChild(renderer.domElement);
    const scene = new THREE.Scene();
    scene.add(new THREE.HemisphereLight('#ffffff', '#b0c4d0', 2.6));
    const sun = new THREE.DirectionalLight('#ffffff', 2.6); sun.position.set(3, -4, 7); scene.add(sun);
    const fill = new THREE.DirectionalLight('#dbeef4', 1.2); fill.position.set(-4, 2, 2); scene.add(fill);
    const offset = new THREE.Vector3(...mesh.bounds.min).add(new THREE.Vector3(...mesh.bounds.max)).multiplyScalar(.5);
    const fullSize = new THREE.Vector3(...mesh.bounds.max).distanceTo(new THREE.Vector3(...mesh.bounds.min)) || 1;
    const camera = new THREE.PerspectiveCamera(38, 1, fullSize * .0001, fullSize * 1000); camera.up.set(0, 0, 1);
    const controls = new OrbitControls(camera, renderer.domElement); controls.enableDamping = false; controls.minDistance = fullSize * .015; controls.maxDistance = fullSize * 100;
    controls.listenToKeyEvents(renderer.domElement);
    const grid = new THREE.GridHelper(fullSize * 2.4, 24, '#cbdce2', '#e0e9ed'); grid.rotation.x = Math.PI / 2; grid.position.z = mesh.bounds.min[2] - offset.z - fullSize * .035; scene.add(grid);
    const surfaces: THREE.Mesh<THREE.BufferGeometry, THREE.MeshStandardMaterial>[] = [];
    const segmentGroups = mesh.segmented && mesh.mappingVerified ? mesh.segments.map(s => ({ id: s.id, triangles: s.triangles })) : [{ id: -1, triangles: Array.from({ length: mesh.triangleCount }, (_, i) => i) }];
    segmentGroups.forEach(s => {
      const data = new Float32Array(s.triangles.length * 9);
      s.triangles.forEach((tri, i) => { for (let j = 0; j < 9; j++) data[i * 9 + j] = mesh.positions[tri * 9 + j] - offset.getComponent(j % 3); });
      const geometry = new THREE.BufferGeometry(); geometry.setAttribute('position', new THREE.BufferAttribute(data, 3)); geometry.computeVertexNormals();
      const surface = new THREE.Mesh(geometry, new THREE.MeshStandardMaterial({ color: '#65b9ad', roughness: .66, metalness: .06, side: THREE.DoubleSide, flatShading: true }));
      surface.userData = { segmentId: s.id, triangles: s.triangles }; surfaces.push(surface); scene.add(surface);
    });
    const highlight = new THREE.Mesh(new THREE.BufferGeometry(), new THREE.MeshBasicMaterial({ color: '#ffe2a1', side: THREE.DoubleSide, transparent: true, opacity: .66, depthTest: false, depthWrite: false })); highlight.renderOrder = 9; highlight.visible = false; scene.add(highlight);
    let overlay: THREE.Object3D | null = null, box: THREE.Box3Helper | null = null, arrow: THREE.ArrowHelper | null = null, wire: THREE.LineSegments | null = null;
    let lastSceneState: { selected: number | null; visible: Set<number>; overlays: Overlays; colorMode: ColorMode } | null = null;
    let currentView = 'Isometric';
    let raf = 0, alive = true, timer = 0, dragging = false, pointerDown: { x: number; y: number } | null = null;
    const render = () => { if (raf || !alive) return; raf = requestAnimationFrame(() => { raf = 0; renderer.render(scene, camera); updateGizmo(); }); };
    const updateGizmo = () => {
      const svg = gizmo.current; if (!svg) return;
      const inverse = camera.quaternion.clone().invert();
      [new THREE.Vector3(1, 0, 0), new THREE.Vector3(0, 1, 0), new THREE.Vector3(0, 0, 1)].forEach((v, i) => {
        v.applyQuaternion(inverse); const x = 40 + v.x * 25, y = 40 - v.y * 25;
        const line = svg.querySelectorAll('line')[i], label = svg.querySelectorAll('text')[i];
        line?.setAttribute('x2', String(x)); line?.setAttribute('y2', String(y)); label?.setAttribute('x', String(x + v.x * 7)); label?.setAttribute('y', String(y - v.y * 7 + 3));
      });
    };
    const fit = (selection = false, preset?: string) => {
      const b = selection ? segmentBounds(mesh, latest.current.selected) : mesh.bounds;
      const center = new THREE.Vector3(...b.min).add(new THREE.Vector3(...b.max)).multiplyScalar(.5).sub(offset);
      const radius = Math.max(new THREE.Vector3(...b.min).distanceTo(new THREE.Vector3(...b.max)) / 2, fullSize * .025);
      const distance = radius / Math.sin(THREE.MathUtils.degToRad(camera.fov / 2)) * Math.max(1, 1 / camera.aspect) * 1.18;
      let direction = camera.position.clone().sub(controls.target).normalize();
      if (preset === 'Front') direction.set(0, -1, .0001); else if (preset === 'Top') direction.set(0, -.0001, 1); else if (preset === 'Right') direction.set(1, 0, .0001); else if (preset === 'Isometric') direction.set(1, -1, .85).normalize();
      controls.target.copy(center); camera.position.copy(center).addScaledVector(direction, distance); camera.zoom = 1; camera.updateProjectionMatrix(); controls.update(); render();
      currentView = preset ?? 'Perspective'; setView(currentView);
    };
    const update = (p: Props) => {
      surfaces.forEach(s => { const id = s.userData.segmentId as number; s.visible = id === -1 || p.visible.has(id); const mode = p.overlays.colors ? p.colorMode : 'neutral';
        s.material.color.set(surfaceColor(mesh, id, mode)); if (p.selected !== null && id !== p.selected && id !== -1) s.material.color.lerp(new THREE.Color('#e7eef1'), .48);
      });
      grid.visible = p.overlays.grid;
      const rebuild = !lastSceneState || lastSceneState.selected !== p.selected || lastSceneState.visible !== p.visible || lastSceneState.overlays !== p.overlays || lastSceneState.colorMode !== p.colorMode;
      if (arrow) { scene.remove(arrow); disposeObject(arrow); arrow = null; }
      if (rebuild) {
      for (const o of [overlay, box, wire]) if (o) { scene.remove(o); disposeObject(o); } overlay = null; box = null; wire = null;
      const selected = mesh.segments.find(s => s.id === p.selected), bounds = segmentBounds(mesh, p.selected);
      const selectedVisible = p.selected === null || !mesh.mappingVerified || p.visible.has(p.selected);
      if (p.overlays.fit && selectedVisible && selected?.prediction && mesh.mappingVerified && !overlayAvailability(selected.prediction)) { overlay = createFitOverlay(selected.prediction, bounds, offset); if (overlay) scene.add(overlay); }
      if (p.overlays.bounds && selectedVisible) { box = new THREE.Box3Helper(new THREE.Box3(new THREE.Vector3(...bounds.min).sub(offset), new THREE.Vector3(...bounds.max).sub(offset)), '#688a96'); scene.add(box); }
      if (p.overlays.wire) {
        const target = surfaces.find(s => s.userData.segmentId === p.selected) ?? (mesh.segmented && mesh.mappingVerified ? undefined : surfaces[0]);
        if (target?.visible) { wire = new THREE.LineSegments(new THREE.WireframeGeometry(target.geometry), new THREE.LineBasicMaterial({ color: '#527b87', transparent: true, opacity: .45 })); scene.add(wire); }
      }
      lastSceneState = { selected: p.selected, visible: p.visible, overlays: p.overlays, colorMode: p.colorMode };
      }
      highlight.visible = false;
      if (p.hit && (p.hit.segmentId === null || p.visible.has(p.hit.segmentId))) {
        const tri = p.hit.triangleId, positions = new Float32Array(9); for (let j = 0; j < 9; j++) positions[j] = mesh.positions[tri * 9 + j] - offset.getComponent(j % 3);
        highlight.geometry.dispose(); highlight.geometry = new THREE.BufferGeometry(); highlight.geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3)); highlight.visible = true;
        if (p.overlays.normal && p.hit.normal) { arrow = new THREE.ArrowHelper(new THREE.Vector3(...p.hit.normal), new THREE.Vector3(...p.hit.position).sub(offset), fullSize * .16, '#e49f54', fullSize * .035, fullSize * .02); scene.add(arrow); }
      }
      render();
    };
    const pick = (event: PointerEvent, pinned: boolean) => {
      const rect = renderer.domElement.getBoundingClientRect(); const pointer = new THREE.Vector2((event.clientX - rect.left) / rect.width * 2 - 1, -(event.clientY - rect.top) / rect.height * 2 + 1);
      const ray = new THREE.Raycaster(); ray.setFromCamera(pointer, camera); const result = ray.intersectObjects(surfaces.filter(s => s.visible), false)[0];
      if (!result || result.faceIndex == null) { if (!latest.current.hit?.pinned) latest.current.onHit(null); return; }
      const triangleId = result.object.userData.triangles[result.faceIndex] as number;
      const info = triangleInfo(mesh, triangleId, result.point.add(offset).toArray() as Vec3); info.pinned = pinned;
      if (pinned && info.segmentId !== null) latest.current.onSelect(info.segmentId);
      latest.current.onHit(info);
    };
    const down = (event: PointerEvent) => { pointerDown = { x: event.clientX, y: event.clientY }; dragging = true; clearTimeout(timer); if (!latest.current.hit?.pinned) latest.current.onHit(null); };
    const move = (event: PointerEvent) => { if (dragging || latest.current.hit?.pinned) return; clearTimeout(timer); timer = window.setTimeout(() => pick(event, false), 120); };
    const up = (event: PointerEvent) => { dragging = false; if (pointerDown && event.button === 0 && Math.hypot(event.clientX - pointerDown.x, event.clientY - pointerDown.y) < 5) pick(event, true); pointerDown = null; };
    const leave = () => { clearTimeout(timer); if (!latest.current.hit?.pinned) latest.current.onHit(null); };
    const keydown = (event: KeyboardEvent) => { if (event.key === 'Escape') latest.current.onHit(null); if (event.key.toLowerCase() === 'f') fit(false); };
    renderer.domElement.addEventListener('pointerdown', down); renderer.domElement.addEventListener('pointermove', move); renderer.domElement.addEventListener('pointerleave', leave); window.addEventListener('pointerup', up); renderer.domElement.addEventListener('keydown', keydown);
    controls.addEventListener('change', render);
    controls.addEventListener('start', () => { currentView = 'Perspective'; setView(currentView); });
    const resize = new ResizeObserver(() => { const { width, height } = container.getBoundingClientRect(); renderer.setSize(width, height); camera.aspect = width / Math.max(1, height); camera.updateProjectionMatrix(); render(); }); resize.observe(container);
    const size = container.getBoundingClientRect(); renderer.setSize(size.width, size.height); camera.aspect = size.width / Math.max(1, size.height); camera.updateProjectionMatrix();
    const stored = cameras.get(mesh);
    if (stored) { camera.position.fromArray(stored.position); controls.target.fromArray(stored.target); camera.zoom = stored.zoom; currentView = stored.view; camera.updateProjectionMatrix(); controls.update(); setView(currentView); }
    else fit(false, 'Isometric');
    api.current = { update, fit, zoom: factor => { camera.position.sub(controls.target).multiplyScalar(factor).add(controls.target); controls.update(); render(); }, screenshot: () => { renderer.render(scene, camera); const a = document.createElement('a'); a.href = renderer.domElement.toDataURL('image/png'); a.download = `${mesh.id}-inspection.png`; a.click(); latest.current.notify('Viewport image exported.'); } };
    update(latest.current);
    return () => {
      cameras.set(mesh, { position: camera.position.toArray(), target: controls.target.toArray(), zoom: camera.zoom, view: currentView });
      alive = false; cancelAnimationFrame(raf); clearTimeout(timer); resize.disconnect(); window.removeEventListener('pointerup', up); controls.dispose(); disposeObject(scene); renderer.dispose(); renderer.domElement.remove(); api.current = null;
    };
  }, [props.mesh]);
  useEffect(() => { api.current?.update(props); }, [props.selected, props.visible, props.overlays, props.colorMode, props.hit]);
  const hit = props.hit;
  const preset = (value: string) => api.current?.fit(false, value);
  return <div className="canvas-panel" ref={frame}>
    <div className="canvas-toolbar"><span className="canvas-tag">{view.toUpperCase()} VIEW</span><div className="view-presets">{['Isometric', 'Front', 'Top', 'Right'].map(p => <button key={p} className={view === p ? 'active' : ''} onClick={() => preset(p)}>{p}</button>)}</div><span className="spacer"/><button className="icon-button" title="Reset view" aria-label="Reset view" onClick={() => preset('Isometric')}><RotateCcw size={16}/></button><button className="icon-button" title="Fit model (F)" aria-label="Fit model" onClick={() => api.current?.fit()}><Scan size={17}/></button><button className="icon-button" title="Download viewport image" aria-label="Download viewport image" onClick={() => api.current?.screenshot()}><Download size={16}/></button><button className="icon-button" title="Full screen" aria-label="Full screen" onClick={() => { if (document.fullscreenElement) void document.exitFullscreen(); else void frame.current?.requestFullscreen().catch(() => props.notify('Fullscreen is unavailable in this preview.')); }}><Maximize size={16}/></button></div>
    <div className="model-stage"><div className="webgl-host" ref={host}/><div className="stage-label"><span className="status-dot"/>{props.selected !== null ? `Segment ${props.selected} selected` : 'Original mesh'}<span className="stage-source">{props.mesh.source}</span></div>
      {error && <div className="canvas-error"><strong>3D view unavailable</strong><p>{error}</p></div>}
      <div className="orientation-gizmo"><svg ref={gizmo} viewBox="0 0 80 80" aria-label="Source coordinate orientation">{['#d28d80', '#7cad96', '#87aace'].map((color, i) => <g key={color}><line x1="40" y1="40" x2="40" y2="40" stroke={color} strokeWidth="1.5"/><text textAnchor="middle" fill={color} fontSize="10">{'XYZ'[i]}</text></g>)}<circle cx="40" cy="40" r="3" fill="#8a9eaa"/></svg></div>
      {hit && <div className="hover-card"><div className="hover-title"><strong>Triangle {hit.triangleId}</strong><span>{hit.pinned ? 'PINNED' : 'AT CURSOR'}</span></div><dl><dt>Segment</dt><dd>{hit.segmentId ?? 'Not supplied'}</dd><dt>Position</dt><dd>{vectorText(hit.position)}</dd><dt>Face normal</dt><dd>{vectorText(hit.normal)}</dd><dt>Area</dt><dd>{short(hit.area)} {props.mesh.units}²</dd></dl><p>{hit.pinned ? 'Esc or Clear inspection to unpin' : 'Click to pin this triangle'}</p></div>}
      <div className="zoom-controls"><button aria-label="Zoom in" onClick={() => api.current?.zoom(.8)}><Plus size={17}/></button><button aria-label="Zoom out" onClick={() => api.current?.zoom(1.25)}><Minus size={17}/></button></div>
      <div className="canvas-note"><span>Drag to orbit <i>·</i> Scroll to zoom <i>·</i> Right drag to pan</span><button onClick={() => api.current?.fit(true)}>Fit selection <Scan size={12}/></button></div>
    </div><div className="canvas-footer"><span><span className="status-dot"/> Original geometry</span><span>{props.mesh.triangleCount.toLocaleString()} triangles <i>·</i> {props.mesh.units}</span></div>
  </div>;
}
