/* UI planning prototype. All shapes and result records below are illustrative. */
const segments = [
  { id: 0, type: 'plane', kind: 'primitive', confidence: .98, status: 'fitted', color: '#8aaed5', reason: 'Consistent face normals and a small point-to-plane deviation.', notes: 'Illustrative fit assessment; no source output is connected.', parameters: [['Normal', '(0.000, 0.000, 1.000)'], ['Point', '(0.000, 0.000, 0.000)']] },
  { id: 1, type: 'cylinder', kind: 'primitive', confidence: .96, status: 'fitted', color: '#65b9b0', reason: 'The surface follows a circular profile with a consistent axial direction.', notes: 'Illustrative fit assessment; no source output is connected.', parameters: [['Axis', '(0.000, 0.000, 1.000)'], ['Axis point', '(0.000, 0.000, 0.000)'], ['Radius', '14.000 model units']] },
  { id: 2, type: 'cone', kind: 'primitive', confidence: .78, status: 'partial', color: '#d5b386', reason: 'A tapered surface is supported, but the partial patch leaves some estimates uncertain.', notes: 'Only the axis estimate is available; a full overlay needs additional parameters.', parameters: [['Axis', '(0.000, 0.000, 1.000)'], ['Apex', 'Not supplied'], ['Half-angle', 'Not supplied']] },
  { id: 3, type: 'unresolved', kind: 'unresolved', confidence: .44, status: 'not_applicable', color: '#c4b576', reason: 'The surface does not have enough evidence for a supported primitive.', notes: 'No primitive selected. Fitting is not applicable in this sample record.', parameters: [] }
];
let selected = 1;
let activeTab = 'summary';
let zoom = 1;
let pinned = false;
let wireframe = false;
const visibility = new Set(segments.map(s => s.id));
const overlays = { colors: true, pca: false, normal: false, fit: false, bounds: false, grid: true };
const $ = (selector) => document.querySelector(selector);
const capitalize = (value) => value.replace(/_/g, ' ').replace(/^./, c => c.toUpperCase());
const badge = (value) => `<span class="badge ${value}">${capitalize(value)}</span>`;
const point = (x, y, z) => [300 + (x - y) * 4.7, 306 + (x + y) * 1.8 - z * 4.8];
const points = (vertices) => vertices.map(v => point(...v).map(n => n.toFixed(2)).join(',')).join(' ');
function shade(hex, amount) {
  const channels = hex.slice(1).match(/../g).map(v => Math.max(0, Math.min(255, Math.round(parseInt(v, 16) * amount))));
  return `rgb(${channels.join(',')})`;
}
function surfaceColor(id) {
  if (!overlays.colors || $('#color-mode').value === 'neutral') return '#abbfc8';
  if ($('#color-mode').value === 'primitive') return ['#8aaed5', '#65b9b0', '#d5b386', '#c4b576'][id];
  return segments[id].color;
}
function modelSvg(small = false) {
  const prefix = small ? 'thumb' : 'main';
  let grid = '';
  for (let i = -65; i <= 65; i += 8) {
    const a = point(i, -65, -1), b = point(i, 65, -1), c = point(-65, i, -1), d = point(65, i, -1);
    grid += `<path d="M${a}L${b}M${c}L${d}"/>`;
  }
  const faces = [];
  const ring = (radius, z, angle) => [Math.cos(angle) * radius, Math.sin(angle) * radius, z];
  // A disk, cylinder, tapered band and deliberately irregular crown form a sample assembly.
  const bands = [
    { id: 1, low: 0, high: 32, r0: 14, r1: 14, steps: 8 },
    { id: 2, low: 32, high: 41, r0: 14, r1: 8, steps: 3 },
    { id: 3, low: 41, high: 44, r0: 8, r1: 2, steps: 2 }
  ];
  const slices = 40;
  for (let i = 0; i < slices; i++) {
    const a = i / slices * Math.PI * 2, b = (i + 1) / slices * Math.PI * 2;
    faces.push({id:0, vertices:[[0,0,0],ring(23,0,a),ring(23,0,b)], light: .95 + .03 * Math.cos(a)});
  }
  bands.forEach(band => {
    for (let j = 0; j < band.steps; j++) for (let i = 0; i < slices; i++) {
      const a = i / slices * Math.PI * 2, b = (i + 1) / slices * Math.PI * 2;
      const t0 = j / band.steps, t1 = (j + 1) / band.steps;
      const r0 = band.r0 + (band.r1 - band.r0) * t0, r1 = band.r0 + (band.r1 - band.r0) * t1;
      const z0 = band.low + (band.high - band.low) * t0, z1 = band.low + (band.high - band.low) * t1;
      const crown = angle => band.id === 3 ? .85 * Math.sin(angle * 3) : 0;
      const v0 = ring(r0,z0+crown(a),a), v1 = ring(r0,z0+crown(b),b), v2 = ring(r1,z1+crown(b),b), v3 = ring(r1,z1+crown(a),a);
      const light = .78 + .2 * Math.cos(a - 2.2);
      faces.push({id:band.id, vertices:[v0,v1,v2], light}, {id:band.id, vertices:[v0,v2,v3], light:light+.035});
    }
  });
  faces.sort((a,b) => {
    const depth = f => f.vertices.reduce((sum,v) => sum + v[0] + v[1] + v[2] * .75,0)/3;
    return depth(a)-depth(b);
  });
  let polygons = '';
  faces.forEach((f,i) => {
    if (!small && !visibility.has(f.id)) return;
    const color = surfaceColor(f.id);
    const fill = shade(color,f.light);
    polygons += `<polygon ${small ? '' : `class="model-surface" data-segment="${f.id}" data-triangle="${i}"`} points="${points(f.vertices)}" fill="${fill}" stroke="${wireframe && !small ? '#487c88' : fill}" stroke-width="${wireframe && !small ? '.45' : '.35'}"/>`;
  });
  const ringPath = (r,z) => {
    const vertices = Array.from({length:81},(_,i)=>ring(r,z,i/80*Math.PI*2));
    return `M${vertices.map(v => point(...v).join(',')).join('L')}Z`;
  };
  let diagnostic = '';
  if (!small && visibility.has(selected)) {
    if (overlays.fit && segments[selected].status === 'fitted') {
      const d = selected === 1 ? `${ringPath(14.5,0)} ${ringPath(14.5,32)} M${point(14.5,0,0)}L${point(14.5,0,32)} M${point(-14.5,0,0)}L${point(-14.5,0,32)}` : ringPath(23.4,.3);
      diagnostic += `<g class="overlay-fit"><path d="${d}" fill="none" stroke="#479cab" stroke-width="1.5" stroke-dasharray="5 4"/><text x="${point(23,0,1)[0]}" y="${point(23,0,1)[1]+18}" fill="#6c969f" font-size="8">sample fit · visualization extent</text></g>`;
    }
    if (overlays.bounds) diagnostic += `<g class="overlay-bounds"><path d="M167 376V107H435V376Z M167 107l-36-27h268l36 27 M399 80v269l36 27 M131 80v269l36 27 M131 349h268" stroke="#96a8b5" stroke-width=".8" stroke-dasharray="5 5" fill="none"/></g>`;
    if (overlays.pca) {
      const o=point(0,0,18), ends=[point(0,0,53),point(26,0,18),point(0,26,18)], colors=['#518bb3','#db937c','#8aa57e'];
      diagnostic += `<g class="overlay-pca">${ends.map((e,i)=>`<path d="M${o}L${e}" stroke="${colors[i]}" stroke-width="1.7" marker-end="url(#${prefix}-axis-arrow-${i})"/><text class="axis-label" x="${e[0]+7}" y="${e[1]-5}" fill="${colors[i]}">PC${i+1}</text>`).join('')}<circle cx="${o[0]}" cy="${o[1]}" r="3" fill="#fff" stroke="#81a5ae"/></g>`;
    }
    if (overlays.normal) {
      const a=point(11,-7,18),b=point(26,-16,18);
      diagnostic += `<g class="overlay-normal"><circle cx="${a[0]}" cy="${a[1]}" r="3" fill="#fff" stroke="#947aad"/><path d="M${a}L${b}" stroke="#947aad" stroke-width="1.8" marker-end="url(#${prefix}-normal-arrow)"/><text x="${b[0]-25}" y="${b[1]-10}" fill="#947aad" font-size="9">n̂</text></g>`;
    }
  }
  const selectedRing = !small && visibility.has(selected) ? `<path d="${ringPath(selected===0?23:selected===3?8:14,selected===2?32:selected===3?41:0)}" stroke="${shade(surfaceColor(selected),.8)}" stroke-width="1.1" fill="none"/>` : '';
  return `<svg viewBox="0 0 600 470" role="img" aria-label="Illustrative segmented mechanical form; not an imported STL"><defs><radialGradient id="${prefix}-shadow"><stop stop-color="#8aa4af" stop-opacity=".17"/><stop offset="1" stop-color="#8aa4af" stop-opacity="0"/></radialGradient>${['#518bb3','#db937c','#8aa57e'].map((c,i)=>`<marker id="${prefix}-axis-arrow-${i}" viewBox="0 0 8 8" refX="7" refY="4" markerWidth="5" markerHeight="5" orient="auto"><path d="M0 0 8 4 0 8Z" fill="${c}"/></marker>`).join('')}<marker id="${prefix}-normal-arrow" viewBox="0 0 8 8" refX="7" refY="4" markerWidth="5" markerHeight="5" orient="auto"><path d="M0 0 8 4 0 8Z" fill="#947aad"/></marker></defs><g class="ground-grid" stroke="#dce6eb" stroke-width=".65" fill="none" opacity="${overlays.grid ? '.52' : '0'}">${grid}</g><ellipse cx="300" cy="332" rx="160" ry="70" fill="url(#${prefix}-shadow)"/><g transform="translate(300 235) scale(${small ? .92 : zoom}) translate(-300 -235)">${polygons}${selectedRing}${diagnostic}</g></svg>`;
}
function otherModel(kind) {
  if (kind==='sphere') return `<svg viewBox="0 0 400 190" role="img" aria-label="Illustrative sphere"><defs><radialGradient id="sphere-shade" cx="35%" cy="28%"><stop stop-color="#f0dee4"/><stop offset=".6" stop-color="#d3b0bf"/><stop offset="1" stop-color="#af8ea3"/></radialGradient></defs><ellipse cx="202" cy="157" rx="64" ry="13" fill="#dce4e9" opacity=".4"/><circle cx="200" cy="92" r="57" fill="url(#sphere-shade)"/>${[-40,-25,0,25,40].map(t=>`<ellipse cx="200" cy="92" rx="${57-Math.abs(t)*.65}" ry="57" fill="none" stroke="#fff" opacity=".2" stroke-width=".7"/>`).join('')}<ellipse cx="200" cy="92" rx="57" ry="18" fill="none" stroke="#fff" opacity=".25"/><ellipse cx="200" cy="72" rx="53" ry="15" fill="none" stroke="#fff" opacity=".2"/><ellipse cx="200" cy="115" rx="52" ry="16" fill="none" stroke="#fff" opacity=".2"/></svg>`;
  return `<svg viewBox="0 0 400 190" role="img" aria-label="Illustrative torus"><defs><linearGradient id="torus-shade" x2="0" y2="1"><stop stop-color="#ddd4ea"/><stop offset="1" stop-color="#a497be"/></linearGradient><mask id="torus-hole"><rect width="400" height="190" fill="white"/><ellipse cx="200" cy="85" rx="40" ry="15" fill="black"/></mask></defs><ellipse cx="200" cy="142" rx="92" ry="16" fill="#dce4e9" opacity=".4"/><g mask="url(#torus-hole)"><ellipse cx="200" cy="102" rx="92" ry="44" fill="#a497be"/><ellipse cx="200" cy="86" rx="92" ry="44" fill="url(#torus-shade)"/>${Array.from({length:30},(_,i)=>{const a=i/30*Math.PI*2;return `<path d="M${200+40*Math.cos(a)} ${85+15*Math.sin(a)}L${200+92*Math.cos(a)} ${86+44*Math.sin(a)}" stroke="#fff" opacity=".25" stroke-width=".7"/>`;}).join('')}</g><ellipse cx="200" cy="85" rx="40" ry="15" fill="#f6f9fa"/></svg>`;
}
function renderCards() {
  $('#mesh-cards').innerHTML = [
    {id:'mesh_01',title:'Stepped surface',sub:'Plane · cylinder · tapered region',svg:modelSvg(true),types:['plane','cylinder','cone']},
    {id:'mesh_02',title:'Curved surface',sub:'A partial spherical surface',svg:otherModel('sphere'),types:['sphere']},
    {id:'mesh_03',title:'Ring surface',sub:'Circular toroidal geometry',svg:otherModel('torus'),types:['torus']}
  ].map((m,i)=>`<a href="${i===0?'#inspector':'#guide'}" class="mesh-card"><div class="mesh-thumbnail"><span class="thumbnail-label">${m.id.toUpperCase()} · ILLUSTRATION</span>${m.svg}</div><div class="mesh-card-body"><div class="mesh-card-title"><h3>${m.title}</h3><span>↗</span></div><p>${m.sub}</p><div class="mesh-tags">${m.types.map(badge).join('')}</div></div></a>`).join('');
}
function renderSegments() {
  const query=$('#segment-search').value.trim().toLowerCase();
  const matches=segments.filter(s=>`segment ${s.id} ${s.type}`.includes(query));
  $('#segment-list').innerHTML=matches.map(s=>`<div class="segment-row ${s.id===selected?'selected':''}"><button data-select="${s.id}" aria-pressed="${s.id===selected}"><span class="segment-color" style="background:${s.color}"></span><span class="segment-name">Segment ${s.id}<span class="segment-kind">${capitalize(s.type)}${s.status==='partial'?' · partial fit':''}</span></span></button><input type="checkbox" data-visible="${s.id}" aria-label="Show segment ${s.id}" ${visibility.has(s.id)?'checked':''}></div>`).join('') || '<p class="muted" style="font-size:11px;padding:15px 5px">No matching segments</p>';
}
function renderDetails() {
  const s=segments[selected];
  $('#detail-title').innerHTML=`Segment ${s.id} ${badge(s.type)}`;
  $('#detail-subtitle').textContent=`mesh_01 / segment_id: ${s.id}`;
  $('#stage-selection').textContent=`Segment ${s.id} selected${visibility.has(s.id)?'':' · hidden'}`;
  document.querySelectorAll('[data-tab]').forEach(el=>el.setAttribute('aria-selected',el.dataset.tab===activeTab?'true':'false'));
  if(activeTab==='summary') $('#detail-content').innerHTML=`<div class="detail-meta"><span>Classification</span><strong>${capitalize(s.kind)}</strong></div><div class="detail-meta"><span>Fit status</span>${badge(s.status)}</div><div class="confidence-wrap"><div class="confidence-label"><span>Reported confidence · example</span><strong>${s.confidence.toFixed(2)}</strong></div><div class="confidence-track"><div style="width:${s.confidence*100}%"></div></div></div><div class="reason-box"><span>Decision evidence</span><p>${s.reason}</p></div>`;
  if(activeTab==='parameters') $('#detail-content').innerHTML=`${s.parameters.length?s.parameters.map(([name,value])=>`<div class="parameter-row"><span>${name}</span><code>${value}</code></div>`).join(''):'<p class="diagnostics-copy">No primitive parameters are available for this unresolved surface.</p>'}<p class="parameter-note">${s.notes}</p><p class="parameter-note">All values are illustrative and in the source frame.</p>`;
  if(activeTab==='diagnostics') $('#detail-content').innerHTML=selected===1?`<h3 class="diagnostics-title">Position PCA · sample diagnostics</h3><p class="diagnostics-copy">Area-weighted surface samples. The two transverse axes are nearly ambiguous.</p><div class="parameter-row"><span>PC1</span><code>(0.000, 0.000, 1.000)</code></div><div class="parameter-row"><span>Eigenvalues</span><code>121, 72, 70 units²</code></div><p class="parameter-note">PCA is explanatory evidence, not a fitted primitive axis.</p>`:'<h3 class="diagnostics-title">PCA not supplied</h3><p class="diagnostics-copy">The sample only includes PCA for Segment 1. Missing diagnostics do not prevent viewing.</p>';
  const pca=$('[data-overlay="pca"]');
  pca.disabled=selected!==1;
  pca.parentElement.title=selected===1?'Sample position PCA is available':'PCA diagnostics unavailable for this sample segment';
  if(selected!==1) {overlays.pca=false;pca.checked=false;}
  const fit=$('[data-overlay="fit"]');
  fit.disabled=s.status!=='fitted';
  fit.parentElement.title=s.status==='fitted'?'Illustrative fitted surface overlay':'Not enough parameters to display a fitted surface';
  if(s.status!=='fitted'){overlays.fit=false;fit.checked=false;}
}
function renderModel() { $('#main-model').innerHTML=modelSvg(); }
function selectSegment(id) { selected=Number(id); pinned=false;$('#hover-card').hidden=true;renderSegments();renderDetails();renderModel(); }
function renderResults() {
  const query=$('#result-search').value.trim().toLowerCase(),filter=$('#result-filter').value;
  const matches=segments.filter(s=>(`mesh_01 ${s.id} ${s.type} ${s.reason}`.toLowerCase().includes(query))&&(filter==='all'||s.kind===filter||s.status===filter));
  $('#results-body').innerHTML=matches.map(s=>`<tr><td><strong>mesh_01</strong><span class="row-segment">Segment ${s.id}</span></td><td>${badge(s.type)}</td><td><code>${s.confidence.toFixed(2)}</code></td><td>${badge(s.status)}</td><td class="muted">Not supplied</td><td class="evidence">${s.reason}</td><td><a href="#inspector" class="text-link" data-select="${s.id}">Inspect ↗</a></td></tr>`).join('') || '<tr><td colspan="7" class="empty-table">No results match these filters.</td></tr>';
  $('#result-count').textContent=`${matches.length} illustrative result${matches.length===1?'':'s'}`;
}
function showToast(message) { $('#toast').textContent=message;$('#toast').hidden=false;clearTimeout(showToast.timer);showToast.timer=setTimeout(()=>$('#toast').hidden=true,3600); }
const visual = (content) => `<svg viewBox="0 0 160 120" aria-hidden="true">${content}</svg>`;
const guideCards = [
  ['Vertex','A point in 3D space, described by three coordinates.','v = (x, y, z)',visual('<path d="M75 79 140 97 M75 79 22 100 M75 79V15" stroke="#b6c8d1" fill="none"/><circle cx="75" cy="79" r="5" fill="#549b9e"/><text x="85" y="68" fill="#73939f" font-size="10">(x, y, z)</text>')],
  ['Triangle','Three vertices make one flat face. Its ID connects the picture to the original data.','triangle = (v0, v1, v2)',visual('<polygon points="34,85 121,78 91,24" fill="#c0dcd8" stroke="#81b3ae"/><circle cx="34" cy="85" r="3" fill="#6d969d"/><circle cx="121" cy="78" r="3" fill="#6d969d"/><circle cx="91" cy="24" r="3" fill="#6d969d"/><path d="M34 85 82 56 121 78" stroke="#fff" fill="none" stroke-width="1.5"/>')],
  ['Mesh & segment','A mesh contains triangles. A supplied segment groups triangles into a surface region.','triangle_id → segment_id',visual('<polygon points="23,78 53,28 104,28 137,78 80,107" fill="#e0edf3" stroke="#91b1c5"/><path d="M23 78 80 59 53 28 M80 59 104 28 M80 59 137 78 M80 59 80 107" stroke="#91b1c5" fill="none"/><polygon points="80,59 104,28 137,78 80,107" fill="#84bcb5" opacity=".65"/>')],
  ['Face normal','A unit vector perpendicular to one triangle. Winding determines its sign.','n̂ = cross(B−A, C−A) / ||cross||',visual('<polygon points="24,82 120,96 131,56 51,43" fill="#c2d9e3" stroke="#91b1c5"/><path d="M80 73V18" stroke="#8c78aa" stroke-width="2"/><path d="m76 25 4-8 4 8" fill="none" stroke="#8c78aa" stroke-width="2"/><text x="90" y="27" font-size="10" fill="#8c78aa">n̂</text>')],
  ['Triangle area','The size of a face, rather than its triangle count. Area uses squared model units.','A = ½ ||cross(B−A, C−A)||',visual('<polygon points="30,92 133,92 64,27" fill="#e9dbc1" stroke="#bcaa84"/><path d="M64 27V92" stroke="#c1ad85" stroke-dasharray="3 3"/><path d="M64 84h8v8" fill="none" stroke="#bcaa84"/><text x="72" y="68" font-size="10" fill="#a18c68">height</text>')],
  ['PCA axes','Three principal directions for a sample distribution. Their meaning depends on the samples and weighting.','PC1, PC2, PC3 + eigenvalues',visual('<ellipse cx="79" cy="65" rx="45" ry="23" fill="#e3eff1" transform="rotate(-25 79 65)"/><path d="M79 65 135 39" stroke="#6298b6" stroke-width="1.5"/><path d="M79 65 40 36" stroke="#ce987e" stroke-width="1.5"/><path d="M79 65 78 105" stroke="#89a581" stroke-width="1.5"/><circle cx="79" cy="65" r="3" fill="#7697a1"/>')]
];
$('#guide-cards').innerHTML=guideCards.map(([title,copy,formula,svg])=>`<article class="guide-card"><div class="guide-visual">${svg}</div><div class="guide-copy"><h2>${title}</h2><p>${copy}</p><code>${formula}</code></div></article>`).join('');
function navigate() {
  const route=location.hash.slice(1)||'overview';
  const current=['overview','inspector','results','import','guide'].includes(route)?route:'overview';
  document.querySelectorAll('.page').forEach(page=>page.hidden=page.id!==`page-${current}`);
  document.querySelectorAll('[data-nav]').forEach(link=>{link.classList.toggle('active',link.dataset.nav===current);if(link.dataset.nav===current)link.setAttribute('aria-current','page');else link.removeAttribute('aria-current');});
  document.title=`${({overview:'Overview',inspector:'3D Inspector',results:'Results',import:'Import',guide:'Geometry Guide'})[current]} · geometrydash-ui design`;
  window.scrollTo(0,0);
}
document.addEventListener('click',event=>{
  const select=event.target.closest('[data-select]');
  if(select)selectSegment(select.dataset.select);
  const tab=event.target.closest('[data-tab]');
  if(tab){activeTab=tab.dataset.tab;renderDetails();}
  const face=event.target.closest('.model-surface');
  if(face){const showNormal=overlays.normal;selectSegment(face.dataset.segment);if(showNormal){pinned=true;showHover(face);}}
});
document.addEventListener('change',event=>{
  const el=event.target;
  if(el.matches('[data-visible]')){const id=Number(el.dataset.visible);if(el.checked)visibility.add(id);else visibility.delete(id);renderDetails();renderModel();}
  if(el.matches('[data-overlay]')){overlays[el.dataset.overlay]=el.checked;if(el.dataset.overlay==='normal'&&!el.checked){pinned=false;$('#hover-card').hidden=true;}renderModel();}
});
let hoverTimer;
function showHover(face) {
  // Numerical readouts intentionally remain labeled samples; the SVG is not source geometry.
  $('#hover-id').textContent=face.dataset.triangle;
  $('#hover-segment').textContent=`${face.dataset.segment} · ${capitalize(segments[face.dataset.segment].type)}`;
  $('#hover-card').hidden=false;
}
$('#main-model').addEventListener('pointerover',event=>{
  if(!overlays.normal||pinned)return;
  const face=event.target.closest('.model-surface');if(!face)return;
  clearTimeout(hoverTimer);hoverTimer=setTimeout(()=>showHover(face),100);
});
$('#main-model').addEventListener('pointerleave',()=>{clearTimeout(hoverTimer);if(!pinned)$('#hover-card').hidden=true;});
$('#segment-search').addEventListener('input',renderSegments);
$('#result-search').addEventListener('input',renderResults);
$('#result-filter').addEventListener('change',renderResults);
$('#color-mode').addEventListener('change',renderModel);
$('#isolate').addEventListener('click',()=>{visibility.clear();visibility.add(selected);renderSegments();renderDetails();renderModel();});
$('#show-all').addEventListener('click',()=>{segments.forEach(s=>visibility.add(s.id));renderSegments();renderDetails();renderModel();});
$('#zoom-in').addEventListener('click',()=>{zoom=Math.min(zoom+.15,1.8);renderModel();});
$('#zoom-out').addEventListener('click',()=>{zoom=Math.max(zoom-.15,.55);renderModel();});
const resetZoom=()=>{zoom=1;renderModel();};
$('#reset-view').addEventListener('click',resetZoom);$('#fit-view').addEventListener('click',resetZoom);
function setWire(value){wireframe=value;$('#wire-mode').classList.toggle('active',value);$('#solid-mode').classList.toggle('active',!value);renderModel();}
$('#wire-mode').addEventListener('click',()=>setWire(true));$('#solid-mode').addEventListener('click',()=>setWire(false));
$('#toggle-panels').addEventListener('click',()=>{$('#workspace').classList.toggle('expanded');$('#toggle-panels').textContent=$('#workspace').classList.contains('expanded')?'Show panels':'Expand canvas';});
document.addEventListener('keydown',event=>{
  if(event.key==='Escape'){pinned=false;$('#hover-card').hidden=true;}
  if(event.key==='/'&&location.hash==='#inspector'&&!['INPUT','SELECT','TEXTAREA'].includes(document.activeElement.tagName)){event.preventDefault();$('#segment-search').focus();}
});
window.addEventListener('hashchange',navigate);
renderCards();renderSegments();renderDetails();renderModel();renderResults();navigate();
