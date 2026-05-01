(() => {
  'use strict';

  const VERSION = '1.2.1';
  const STORAGE_KEY = 'SCULPTit.project.v1.2.1';
  const MAX_VERTICES = 140000;

  const canvas = document.getElementById('viewport');
  const gl = canvas.getContext('webgl2', { antialias: true, alpha: false, powerPreference: 'high-performance' });
  if (!gl) {
    alert('WebGL2 is required. Please use a current Chromium, Edge, or Firefox browser.');
    return;
  }

  const $ = (id) => document.getElementById(id);
  const ui = {
    toolButtons: [...document.querySelectorAll('.tool-btn')],
    activeToolBadge: $('activeToolBadge'),
    radius: $('radius'), radiusValue: $('radiusValue'),
    strength: $('strength'), strengthValue: $('strengthValue'),
    hardness: $('hardness'), hardnessValue: $('hardnessValue'),
    spacing: $('spacing'), spacingValue: $('spacingValue'),
    symmetry: $('symmetry'),
    resetBrush: $('resetBrush'),
    primitiveSelect: $('primitiveSelect'), detail: $('detail'), detailValue: $('detailValue'),
    newModel: $('newModel'), subdivideMesh: $('subdivideMesh'),
    wireframeToggle: $('wireframeToggle'), clayMatcapToggle: $('clayMatcapToggle'), facetedToggle: $('facetedToggle'), invertOrbitY: $('invertOrbitY'),
    lightIntensity: $('lightIntensity'), lightIntensityValue: $('lightIntensityValue'),
    lightAzimuth: $('lightAzimuth'), lightAzimuthValue: $('lightAzimuthValue'),
    saveFile: $('saveFile'), loadFile: $('loadFile'), quickSave: $('quickSave'), quickLoad: $('quickLoad'), projectFileInput: $('projectFileInput'),
    exportObj: $('exportObj'), exportStl: $('exportStl'),
    docsButton: $('docsButton'), controlsButton: $('controlsButton'),
    layerList: $('layerList'), layerCountBadge: $('layerCountBadge'), addLayer: $('addLayer'), deleteLayer: $('deleteLayer'),
    modalBackdrop: $('modalBackdrop'), closeModal: $('closeModal'), modalTitle: $('modalTitle'), modalBody: $('modalBody'),
    brushCursor: $('brushCursor'), statusText: $('statusText'), polyStats: $('polyStats')
  };

  const state = {
    activeTool: 'pull',
    tempTool: null,
    radius: parseFloat(ui.radius.value),
    strength: parseFloat(ui.strength.value),
    hardness: parseFloat(ui.hardness.value),
    spacing: parseFloat(ui.spacing.value),
    symmetry: false,
    primitive: ui.primitiveSelect.value,
    detail: parseInt(ui.detail.value, 10),
    wireframe: true,
    clayShading: true,
    faceted: true,
    invertOrbitY: false,
    lightIntensity: parseFloat(ui.lightIntensity.value),
    lightAzimuth: parseFloat(ui.lightAzimuth.value),
    pointer: { x: 0, y: 0, ndcX: 0, ndcY: 0 },
    lastPointer: { x: 0, y: 0 },
    isSculpting: false,
    isOrbiting: false,
    isPanning: false,
    modifiers: { shift: false, alt: false, ctrl: false },
    lastHit: null,
    lastStrokePoint: null,
    strokeId: 1,
    dirty: false,
    saveHandle: null
  };

  const camera = {
    target: [0, 0, 0],
    yaw: -0.55,
    pitch: 0.24,
    distance: 4.25,
    fov: 48 * Math.PI / 180,
    near: 0.01,
    far: 100,
    position: [0, 0, 0],
    view: mat4Identity(),
    proj: mat4Identity(),
    viewProj: mat4Identity(),
    invViewProj: mat4Identity()
  };

  let layerSerial = 1;
  let mesh = prepareMesh(createPrimitive('sphere', state.detail));
  let topology = buildTopology(mesh.indices, mesh.positions.length / 3);
  let normals = computeNormals(mesh.positions, mesh.indices);
  let lineIndices = buildWireIndices(mesh.indices);
  let bounds = computeBounds(mesh.positions);
  let layers = [{
    id: 'layer-1',
    name: 'Clay Sphere',
    primitive: 'sphere',
    visible: true,
    mesh,
    topology,
    normals,
    lineIndices,
    bounds
  }];
  let activeLayerId = 'layer-1';

  const VERTEX_SHADER = `#version 300 es
    precision highp float;
    layout(location=0) in vec3 aPosition;
    layout(location=1) in vec3 aNormal;
    layout(location=2) in float aMask;
    uniform mat4 uViewProj;
    out vec3 vNormal;
    out vec3 vPos;
    out float vMask;
    void main() {
      vNormal = normalize(aNormal);
      vPos = aPosition;
      vMask = aMask;
      gl_Position = uViewProj * vec4(aPosition, 1.0);
    }
  `;

  const FRAGMENT_SHADER = `#version 300 es
    precision highp float;
    in vec3 vNormal;
    in vec3 vPos;
    in float vMask;
    uniform vec3 uLightDir;
    uniform float uLightIntensity;
    uniform float uClayShading;
    uniform float uFacetedShading;
    out vec4 outColor;
    void main() {
      vec3 smoothNormal = normalize(vNormal);
      vec3 faceNormal = normalize(cross(dFdx(vPos), dFdy(vPos)));
      if (!gl_FrontFacing) faceNormal = -faceNormal;
      if (dot(faceNormal, smoothNormal) < 0.0) faceNormal = -faceNormal;
      vec3 n = normalize(mix(smoothNormal, faceNormal, uFacetedShading));
      float lambert = max(dot(n, normalize(uLightDir)), 0.0);
      float rim = pow(1.0 - max(abs(n.z), 0.0), 2.0) * 0.16;
      vec3 clay = mix(vec3(0.38, 0.33, 0.13), vec3(1.00, 0.92, 0.33), lambert * uLightIntensity + 0.18);
      vec3 neon = vec3(1.0, 1.0, 0.0) * (rim + 0.04);
      vec3 basic = vec3(0.78, 0.69, 0.28) * (0.28 + lambert * uLightIntensity);
      vec3 color = mix(basic, clay + neon, uClayShading);
      vec3 maskColor = vec3(0.08, 0.38, 1.0);
      color = mix(color, maskColor, clamp(vMask, 0.0, 1.0) * 0.72);
      outColor = vec4(color, 1.0);
    }
  `;

  const LINE_VERTEX_SHADER = `#version 300 es
    precision highp float;
    layout(location=0) in vec3 aPosition;
    uniform mat4 uViewProj;
    void main() { gl_Position = uViewProj * vec4(aPosition, 1.0); }
  `;

  const LINE_FRAGMENT_SHADER = `#version 300 es
    precision highp float;
    uniform float uAlpha;
    out vec4 outColor;
    void main() { outColor = vec4(1.0, 1.0, 0.0, uAlpha); }
  `;

  const gpu = createGpuResources();
  const shader = createProgram(gl, VERTEX_SHADER, FRAGMENT_SHADER);
  const lineShader = createProgram(gl, LINE_VERTEX_SHADER, LINE_FRAGMENT_SHADER);

  gl.enable(gl.DEPTH_TEST);
  gl.depthFunc(gl.LEQUAL);
  gl.disable(gl.CULL_FACE);
  gl.disable(gl.BLEND);
  gl.clearColor(0, 0, 0, 1);

  uploadMesh(true);
  bindEvents();
  renderLayerList();
  resize();
  frameModel();
  setStatus(`SCULPTit v${VERSION} ready`);
  requestAnimationFrame(render);

  function bindEvents() {
    window.addEventListener('resize', resize);
    canvas.addEventListener('contextmenu', (e) => e.preventDefault());
    canvas.addEventListener('pointerdown', onPointerDown);
    window.addEventListener('pointermove', onPointerMove);
    window.addEventListener('pointerup', onPointerUp);
    canvas.addEventListener('wheel', onWheel, { passive: false });
    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);

    ui.toolButtons.forEach((button) => {
      button.addEventListener('click', () => setTool(button.dataset.tool));
    });

    bindRange(ui.radius, ui.radiusValue, 2, (v) => state.radius = v);
    bindRange(ui.strength, ui.strengthValue, 3, (v) => state.strength = v);
    bindRange(ui.hardness, ui.hardnessValue, 2, (v) => state.hardness = v);
    bindRange(ui.spacing, ui.spacingValue, 2, (v) => state.spacing = v);
    bindRange(ui.detail, ui.detailValue, 0, (v) => state.detail = Math.round(v));
    bindRange(ui.lightIntensity, ui.lightIntensityValue, 2, (v) => state.lightIntensity = v);
    ui.lightAzimuth.addEventListener('input', () => {
      state.lightAzimuth = parseFloat(ui.lightAzimuth.value);
      ui.lightAzimuthValue.textContent = `${Math.round(state.lightAzimuth)}°`;
    });

    ui.symmetry.addEventListener('change', () => state.symmetry = ui.symmetry.checked);
    ui.wireframeToggle.addEventListener('change', () => state.wireframe = ui.wireframeToggle.checked);
    ui.clayMatcapToggle.addEventListener('change', () => state.clayShading = ui.clayMatcapToggle.checked);
    ui.facetedToggle.addEventListener('change', () => state.faceted = ui.facetedToggle.checked);
    ui.invertOrbitY.addEventListener('change', () => state.invertOrbitY = ui.invertOrbitY.checked);
    ui.primitiveSelect.addEventListener('change', () => state.primitive = ui.primitiveSelect.value);

    ui.resetBrush.addEventListener('click', resetBrushSettings);
    ui.newModel.addEventListener('click', () => createNewModel());
    ui.subdivideMesh.addEventListener('click', subdivideCurrentMesh);
    ui.addLayer.addEventListener('click', addLayerFromPrimitive);
    ui.deleteLayer.addEventListener('click', deleteActiveLayer);
    ui.saveFile.addEventListener('click', saveProjectFile);
    ui.loadFile.addEventListener('click', () => ui.projectFileInput.click());
    ui.projectFileInput.addEventListener('change', loadProjectFile);
    ui.quickSave.addEventListener('click', quickSave);
    ui.quickLoad.addEventListener('click', quickLoad);
    ui.exportObj.addEventListener('click', exportObj);
    ui.exportStl.addEventListener('click', exportStl);
    ui.docsButton.addEventListener('click', openDocumentation);
    ui.controlsButton.addEventListener('click', openControls);
    ui.closeModal.addEventListener('click', closeModal);
    ui.modalBackdrop.addEventListener('click', (e) => { if (e.target === ui.modalBackdrop) closeModal(); });
  }

  function bindRange(input, valueNode, decimals, setter) {
    const update = () => {
      const value = parseFloat(input.value);
      setter(value);
      valueNode.textContent = decimals === 0 ? String(Math.round(value)) : value.toFixed(decimals);
    };
    input.addEventListener('input', update);
    update();
  }

  function resetBrushSettings() {
    ui.radius.value = '0.22'; ui.radius.dispatchEvent(new Event('input'));
    ui.strength.value = '0.045'; ui.strength.dispatchEvent(new Event('input'));
    ui.hardness.value = '0.45'; ui.hardness.dispatchEvent(new Event('input'));
    ui.spacing.value = '0.08'; ui.spacing.dispatchEvent(new Event('input'));
    setStatus('Brush settings reset');
  }

  function setTool(tool) {
    state.activeTool = tool;
    ui.toolButtons.forEach((b) => b.classList.toggle('active', b.dataset.tool === tool));
    ui.activeToolBadge.textContent = toolLabel(tool);
    setStatus(`${toolLabel(tool)} brush selected`);
  }

  function toolLabel(tool) {
    const labels = {
      pull: 'Pull', push: 'Push', clay: 'Clay', inflate: 'Inflate', flatten: 'Flatten', smooth: 'Smooth',
      pinch: 'Pinch', crease: 'Crease', scrape: 'Scrape', grab: 'Grab', twist: 'Twist', noise: 'Noise',
      relax: 'Relax', mask: 'Mask', eraseMask: 'Erase Mask', dent: 'Dent', ridge: 'Ridge',
      polish: 'Polish', smear: 'Smear', move: 'Move', scale: 'Scale'
    };
    return labels[tool] || tool;
  }

  function onPointerDown(e) {
    canvas.setPointerCapture?.(e.pointerId);
    updatePointer(e);
    state.lastPointer.x = e.clientX;
    state.lastPointer.y = e.clientY;
    state.modifiers.alt = e.altKey;
    state.modifiers.shift = e.shiftKey;
    state.modifiers.ctrl = e.ctrlKey;

    const button = e.button;
    const wantsOrbit = button === 2 || (button === 0 && e.altKey);
    const wantsPan = button === 1 || (button === 2 && e.shiftKey);
    state.isOrbiting = wantsOrbit && !wantsPan;
    state.isPanning = wantsPan;
    state.isSculpting = !state.isOrbiting && !state.isPanning && button === 0;
    state.lastHit = null;
    state.lastStrokePoint = null;
    if (state.isSculpting) {
      state.strokeId += 1;
      sculptAtPointer(true);
    }
  }

  function onPointerMove(e) {
    updatePointer(e);
    updateBrushCursor();
    const dx = e.clientX - state.lastPointer.x;
    const dy = e.clientY - state.lastPointer.y;
    state.modifiers.alt = e.altKey;
    state.modifiers.shift = e.shiftKey;
    state.modifiers.ctrl = e.ctrlKey;

    if (state.isOrbiting) {
      orbitCamera(dx, dy);
    } else if (state.isPanning) {
      panCamera(dx, dy);
    } else if (state.isSculpting) {
      sculptAtPointer(false);
    }

    state.lastPointer.x = e.clientX;
    state.lastPointer.y = e.clientY;
  }

  function onPointerUp(e) {
    canvas.releasePointerCapture?.(e.pointerId);
    if (state.isSculpting) {
      normals = computeNormals(mesh.positions, mesh.indices);
      commitActiveLayer();
      uploadMesh(false);
      setDirty(true);
    }
    state.isSculpting = false;
    state.isOrbiting = false;
    state.isPanning = false;
    state.lastHit = null;
    state.lastStrokePoint = null;
  }

  function onWheel(e) {
    e.preventDefault();
    const factor = Math.exp(e.deltaY * 0.0011);
    camera.distance = clamp(camera.distance * factor, 0.55, 30);
    updateCamera();
  }

  function onKeyDown(e) {
    state.modifiers.shift = e.shiftKey;
    state.modifiers.alt = e.altKey;
    state.modifiers.ctrl = e.ctrlKey;
    const key = e.key.toLowerCase();
    if (e.repeat) return;
    if (key === 'shift') {
      state.tempTool = state.activeTool;
      setToolVisualOnly('smooth');
    } else if (key === '1') setTool('pull');
    else if (key === '2') setTool('push');
    else if (key === '3') setTool('clay');
    else if (key === '4') setTool('inflate');
    else if (key === '5') setTool('flatten');
    else if (key === '6') setTool('smooth');
    else if (key === '7') setTool('pinch');
    else if (key === '8') setTool('crease');
    else if (key === '9') setTool('scrape');
    else if (key === 'f') frameModel();
    else if (key === 'n' && e.ctrlKey) { e.preventDefault(); createNewModel(); }
    else if (key === 's' && e.ctrlKey) { e.preventDefault(); saveProjectFile(); }
    else if (key === 'o' && e.ctrlKey) { e.preventDefault(); ui.projectFileInput.click(); }
    else if (key === 'escape') closeModal();
  }

  function onKeyUp(e) {
    state.modifiers.shift = e.shiftKey;
    state.modifiers.alt = e.altKey;
    state.modifiers.ctrl = e.ctrlKey;
    if (e.key.toLowerCase() === 'shift' && state.tempTool) {
      setToolVisualOnly(state.tempTool);
      state.tempTool = null;
    }
  }

  function setToolVisualOnly(tool) {
    state.activeTool = tool;
    ui.toolButtons.forEach((b) => b.classList.toggle('active', b.dataset.tool === tool));
    ui.activeToolBadge.textContent = toolLabel(tool);
  }

  function updatePointer(e) {
    const rect = canvas.getBoundingClientRect();
    state.pointer.x = e.clientX;
    state.pointer.y = e.clientY;
    state.pointer.ndcX = ((e.clientX - rect.left) / rect.width) * 2 - 1;
    state.pointer.ndcY = -(((e.clientY - rect.top) / rect.height) * 2 - 1);
  }

  function orbitCamera(dx, dy) {
    camera.yaw -= dx * 0.006;
    const dir = state.invertOrbitY ? -1 : 1;
    camera.pitch += dy * 0.006 * dir;
    camera.pitch = clamp(camera.pitch, -1.47, 1.47);
    updateCamera();
  }

  function panCamera(dx, dy) {
    const forward = vec3Normalize(vec3Sub(camera.target, camera.position));
    const right = vec3Normalize(vec3Cross(forward, [0, 1, 0]));
    const up = vec3Normalize(vec3Cross(right, forward));
    const scale = camera.distance * 0.0016;
    camera.target = vec3Add(camera.target, vec3Scale(right, -dx * scale));
    camera.target = vec3Add(camera.target, vec3Scale(up, dy * scale));
    updateCamera();
  }

  function sculptAtPointer(force) {
    const hit = intersectPointer();
    if (!hit) return;
    const spacingDistance = state.radius * state.spacing;
    if (!force && state.lastStrokePoint && vec3Distance(hit.point, state.lastStrokePoint) < spacingDistance) return;
    const tool = state.modifiers.shift ? 'smooth' : state.activeTool;
    const invert = state.modifiers.alt && tool === 'pull';
    const stroke = { point: hit.point, normal: hit.normal, tool, invert, previousHit: state.lastHit };
    applyBrush(stroke);
    if (state.symmetry && Math.abs(hit.point[0]) > 0.0001) {
      const mirrored = {
        point: [-hit.point[0], hit.point[1], hit.point[2]],
        normal: [-hit.normal[0], hit.normal[1], hit.normal[2]],
        tool,
        invert,
        previousHit: state.lastHit ? { point: [-state.lastHit.point[0], state.lastHit.point[1], state.lastHit.point[2]] } : null
      };
      applyBrush(mirrored);
    }
    normals = computeNormals(mesh.positions, mesh.indices);
    commitActiveLayer();
    uploadMesh(false);
    state.lastHit = hit;
    state.lastStrokePoint = hit.point.slice();
  }

  function applyBrush(stroke) {
    const positions = mesh.positions;
    const masks = mesh.masks;
    const radius = state.radius;
    const strength = state.strength;
    const hardness = state.hardness;
    const point = stroke.point;
    const normal = vec3Normalize(stroke.normal);
    const tool = stroke.tool;
    const grabDelta = tool === 'grab' && stroke.previousHit ? vec3Sub(point, stroke.previousHit.point) : [0, 0, 0];

    const indicesInBrush = [];
    for (let i = 0; i < positions.length; i += 3) {
      const v = [positions[i], positions[i + 1], positions[i + 2]];
      const d = vec3Distance(v, point);
      if (d <= radius) indicesInBrush.push([i / 3, d, v]);
    }
    if (indicesInBrush.length === 0) return;

    for (const [vi, d, v] of indicesInBrush) {
      const p = vi * 3;
      let falloff = brushFalloff(d / radius, hardness);
      const maskFactor = 1 - (masks[vi] || 0);
      if (tool !== 'mask' && tool !== 'eraseMask') falloff *= maskFactor;
      if (falloff <= 0) continue;
      const vertexNormal = [normals[p], normals[p + 1], normals[p + 2]];
      const alpha = clamp(strength * falloff * 18, 0, 1);
      let next = v;

      if (tool === 'pull') {
        const sign = stroke.invert ? -1 : 1;
        next = vec3Add(v, vec3Scale(normal, strength * falloff * sign));
      } else if (tool === 'push' || tool === 'dent') {
        const dentBoost = tool === 'dent' ? 1.35 : 1.0;
        next = vec3Add(v, vec3Scale(normal, -strength * falloff * dentBoost));
      } else if (tool === 'clay') {
        const signed = vec3Dot(vec3Sub(v, point), normal);
        const layer = strength * falloff * 0.72;
        next = vec3Add(v, vec3Scale(normal, layer - signed * alpha * 0.08));
      } else if (tool === 'inflate') {
        next = vec3Add(v, vec3Scale(vertexNormal, strength * falloff));
      } else if (tool === 'flatten') {
        const signed = vec3Dot(vec3Sub(v, point), normal);
        next = vec3Sub(v, vec3Scale(normal, signed * alpha));
      } else if (tool === 'scrape' || tool === 'polish') {
        const signed = vec3Dot(vec3Sub(v, point), normal);
        if (signed > 0 || tool === 'polish') next = vec3Sub(v, vec3Scale(normal, signed * alpha * (tool === 'polish' ? 0.62 : 1.0)));
        if (tool === 'polish') next = vec3Lerp(next, neighbourAverage(vi), alpha * 0.20);
      } else if (tool === 'smooth' || tool === 'relax') {
        const avg = neighbourAverage(vi);
        const relaxFactor = tool === 'relax' ? 0.38 : 0.62;
        next = vec3Lerp(v, avg, alpha * relaxFactor);
      } else if (tool === 'pinch') {
        const signed = vec3Dot(vec3Sub(v, point), normal);
        const planePoint = vec3Sub(v, vec3Scale(normal, signed));
        next = vec3Lerp(v, planePoint, 0.15 * alpha);
        next = vec3Lerp(next, point, 0.23 * alpha);
      } else if (tool === 'crease' || tool === 'ridge') {
        const signed = vec3Dot(vec3Sub(v, point), normal);
        const planePoint = vec3Sub(v, vec3Scale(normal, signed));
        next = vec3Lerp(v, planePoint, 0.18 * alpha);
        next = vec3Lerp(next, point, 0.20 * alpha);
        const ridgeSign = tool === 'ridge' ? 1 : -1;
        next = vec3Add(next, vec3Scale(normal, ridgeSign * strength * falloff * 0.45));
      } else if (tool === 'grab' || tool === 'move') {
        next = vec3Add(v, vec3Scale(grabDelta, falloff * (tool === 'move' ? 1.25 : 1.0)));
      } else if (tool === 'smear') {
        next = vec3Add(v, vec3Scale(grabDelta, falloff * 0.58));
        next = vec3Lerp(next, neighbourAverage(vi), alpha * 0.08);
      } else if (tool === 'scale') {
        const dirFromCenter = vec3Normalize(vec3Sub(v, point));
        next = vec3Add(v, vec3Scale(dirFromCenter, strength * falloff * (stroke.invert ? -1 : 1)));
      } else if (tool === 'twist') {
        const angle = strength * falloff * 5.0;
        next = rotateAroundAxis(v, point, normal, angle);
      } else if (tool === 'noise') {
        const rnd = pseudoRandom(vi * 12.9898 + state.strokeId * 78.233) * 2 - 1;
        next = vec3Add(v, vec3Scale(vertexNormal, rnd * strength * falloff * 0.85));
      } else if (tool === 'mask') {
        masks[vi] = clamp((masks[vi] || 0) + falloff * strength * 8, 0, 1);
        continue;
      } else if (tool === 'eraseMask') {
        masks[vi] = clamp((masks[vi] || 0) - falloff * strength * 8, 0, 1);
        continue;
      }

      positions[p] = next[0];
      positions[p + 1] = next[1];
      positions[p + 2] = next[2];
    }
    setDirty(true);
  }

  function neighbourAverage(vi) {
    const neighbours = topology.neighbours[vi];
    if (!neighbours || neighbours.length === 0) return getVertex(vi);
    const sum = [0, 0, 0];
    for (const ni of neighbours) {
      const p = ni * 3;
      sum[0] += mesh.positions[p];
      sum[1] += mesh.positions[p + 1];
      sum[2] += mesh.positions[p + 2];
    }
    return vec3Scale(sum, 1 / neighbours.length);
  }

  function getVertex(vi) {
    const p = vi * 3;
    return [mesh.positions[p], mesh.positions[p + 1], mesh.positions[p + 2]];
  }

  function brushFalloff(t, hardness) {
    t = clamp(1 - t, 0, 1);
    const smooth = t * t * (3 - 2 * t);
    const hard = Math.pow(t, 0.55);
    return smooth * (1 - hardness) + hard * hardness;
  }

  function intersectPointer() {
    const ray = getPointerRay();
    let best = null;
    const pos = mesh.positions;
    const idx = mesh.indices;
    for (let i = 0; i < idx.length; i += 3) {
      const a = readVertex(pos, idx[i]);
      const b = readVertex(pos, idx[i + 1]);
      const c = readVertex(pos, idx[i + 2]);
      const hit = intersectRayTriangle(ray.origin, ray.dir, a, b, c);
      if (hit && (!best || hit.t < best.t)) {
        const n = vec3Normalize(vec3Cross(vec3Sub(b, a), vec3Sub(c, a)));
        best = { t: hit.t, point: hit.point, normal: n };
      }
    }
    return best;
  }

  function getPointerRay() {
    const near = unproject([state.pointer.ndcX, state.pointer.ndcY, -1]);
    const far = unproject([state.pointer.ndcX, state.pointer.ndcY, 1]);
    return { origin: near, dir: vec3Normalize(vec3Sub(far, near)) };
  }

  function unproject(v) {
    const out = mat4TransformVec4(camera.invViewProj, [v[0], v[1], v[2], 1]);
    return [out[0] / out[3], out[1] / out[3], out[2] / out[3]];
  }

  function updateBrushCursor() {
    const hit = intersectPointer();
    if (!hit) {
      ui.brushCursor.style.display = 'none';
      return;
    }
    const screen = project(hit.point);
    const edge = vec3Add(hit.point, vec3Scale(cameraRight(), state.radius));
    const screenEdge = project(edge);
    const r = Math.max(14, Math.min(260, Math.abs(screenEdge[0] - screen[0])));
    ui.brushCursor.style.display = 'block';
    ui.brushCursor.style.left = `${screen[0]}px`;
    ui.brushCursor.style.top = `${screen[1]}px`;
    ui.brushCursor.style.width = `${r * 2}px`;
    ui.brushCursor.style.height = `${r * 2}px`;
  }

  function cameraRight() {
    const forward = vec3Normalize(vec3Sub(camera.target, camera.position));
    return vec3Normalize(vec3Cross(forward, [0, 1, 0]));
  }

  function project(point) {
    const clip = mat4TransformVec4(camera.viewProj, [point[0], point[1], point[2], 1]);
    const ndc = [clip[0] / clip[3], clip[1] / clip[3]];
    return [
      (ndc[0] * 0.5 + 0.5) * canvas.clientWidth,
      (-ndc[1] * 0.5 + 0.5) * canvas.clientHeight
    ];
  }

  function createNewModel() {
    const next = prepareMesh(createPrimitive(state.primitive, state.detail));
    replaceMesh(next, primitiveLabel(state.primitive));
    frameModel();
    setDirty(true);
    setStatus(`New ${primitiveLabel(state.primitive)} created on active layer`);
  }

  function replaceMesh(nextMesh, nextName) {
    mesh = prepareMesh(nextMesh);
    topology = buildTopology(mesh.indices, mesh.positions.length / 3);
    normals = computeNormals(mesh.positions, mesh.indices);
    lineIndices = buildWireIndices(mesh.indices);
    bounds = computeBounds(mesh.positions);
    const layer = getActiveLayer();
    if (layer) {
      layer.mesh = mesh;
      layer.topology = topology;
      layer.normals = normals;
      layer.lineIndices = lineIndices;
      layer.bounds = bounds;
      layer.primitive = state.primitive;
      if (nextName) layer.name = nextName;
    }
    uploadMesh(true);
    renderLayerList();
    updateStats();
  }

  function subdivideCurrentMesh() {
    const currentVertices = mesh.positions.length / 3;
    const predicted = currentVertices + topology.uniqueEdges;
    if (predicted > MAX_VERTICES) {
      setStatus(`Subdivision skipped: ${predicted.toLocaleString('en-US')} vertices would be too heavy`);
      return;
    }
    const next = prepareMesh(subdivide(mesh));
    replaceMesh(next);
    setDirty(true);
    setStatus('Active layer subdivided');
  }

  function addLayerFromPrimitive() {
    layerSerial += 1;
    const next = prepareMesh(createPrimitive(state.primitive, state.detail));
    const offset = (layers.length) * 1.35;
    offsetMesh(next, [offset, 0, 0]);
    const layer = makeLayer(`layer-${Date.now()}-${layerSerial}`, `${primitiveLabel(state.primitive)} ${layerSerial}`, state.primitive, next);
    layers.push(layer);
    setActiveLayer(layer.id);
    frameModel();
    setDirty(true);
    setStatus(`${layer.name} added`);
  }

  function deleteActiveLayer() {
    if (layers.length <= 1) {
      setStatus('At least one layer is required');
      return;
    }
    const index = layers.findIndex(layer => layer.id === activeLayerId);
    if (index < 0) return;
    const removed = layers.splice(index, 1)[0];
    const fallback = layers[Math.max(0, index - 1)] || layers[0];
    setActiveLayer(fallback.id);
    frameModel();
    setDirty(true);
    setStatus(`${removed.name} deleted`);
  }

  function renderLayerList() {
    if (!ui.layerList) return;
    ui.layerCountBadge.textContent = String(layers.length);
    ui.layerList.innerHTML = '';
    layers.forEach((layer, index) => {
      const row = document.createElement('button');
      row.type = 'button';
      row.className = `layer-row${layer.id === activeLayerId ? ' active' : ''}`;
      row.dataset.layerId = layer.id;
      row.innerHTML = `<span class="layer-dot"></span><strong>${escapeHtml(layer.name)}</strong><em>${meshStats(layer.mesh)}</em>`;
      row.addEventListener('click', () => setActiveLayer(layer.id));
      ui.layerList.appendChild(row);
    });
  }

  function setActiveLayer(id) {
    const layer = layers.find(item => item.id === id);
    if (!layer) return;
    activeLayerId = id;
    mesh = layer.mesh;
    topology = layer.topology;
    normals = layer.normals;
    lineIndices = layer.lineIndices;
    bounds = layer.bounds;
    uploadMesh(true);
    renderLayerList();
    updateStats();
  }

  function getActiveLayer() {
    return layers.find(layer => layer.id === activeLayerId) || null;
  }

  function commitActiveLayer() {
    const layer = getActiveLayer();
    if (!layer) return;
    layer.mesh = mesh;
    layer.topology = topology;
    layer.normals = normals;
    layer.lineIndices = lineIndices;
    layer.bounds = computeBounds(mesh.positions);
  }

  function makeLayer(id, name, primitive, layerMesh) {
    const prepared = prepareMesh(layerMesh);
    return {
      id,
      name,
      primitive,
      visible: true,
      mesh: prepared,
      topology: buildTopology(prepared.indices, prepared.positions.length / 3),
      normals: computeNormals(prepared.positions, prepared.indices),
      lineIndices: buildWireIndices(prepared.indices),
      bounds: computeBounds(prepared.positions)
    };
  }

  function primitiveLabel(type) {
    const map = { sphere: 'Clay Sphere', cube: 'Subdivided Cube', plane: 'Plane Grid', cylinder: 'Cylinder', cone: 'Cone', torus: 'Torus' };
    return map[type] || 'Primitive';
  }

  function meshStats(layerMesh) {
    const v = layerMesh.positions.length / 3;
    const f = layerMesh.indices.length / 3;
    return `${v.toLocaleString('en-US')} V / ${f.toLocaleString('en-US')} F`;
  }

  async function saveProjectFile() {
    const data = JSON.stringify(createProjectPayload(), null, 2);
    const filename = `SCULPTit_${new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-')}.sculptit`;
    try {
      if ('showSaveFilePicker' in window) {
        state.saveHandle = await window.showSaveFilePicker({
          suggestedName: filename,
          types: [{ description: 'SCULPTit Project', accept: { 'application/json': ['.sculptit', '.json'] } }]
        });
        const writable = await state.saveHandle.createWritable();
        await writable.write(data);
        await writable.close();
        setDirty(false);
        setStatus('Project saved as file');
        return;
      }
    } catch (err) {
      if (err && err.name === 'AbortError') return;
      console.warn(err);
    }
    downloadText(filename, data, 'application/json');
    setDirty(false);
    setStatus('Project file downloaded');
  }

  function loadProjectFile(e) {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      try {
        loadProjectPayload(JSON.parse(String(reader.result)));
        setStatus(`Loaded ${file.name}`);
      } catch (err) {
        console.error(err);
        setStatus('Project file could not be loaded');
      }
    };
    reader.readAsText(file);
    e.target.value = '';
  }

  function quickSave() {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(createProjectPayload()));
    setDirty(false);
    setStatus('Quick Save written to localStorage');
  }

  function quickLoad() {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) {
      setStatus('No Quick Save found');
      return;
    }
    try {
      loadProjectPayload(JSON.parse(raw));
      setStatus('Quick Save loaded');
    } catch (err) {
      console.error(err);
      setStatus('Quick Save could not be loaded');
    }
  }

  function createProjectPayload() {
    commitActiveLayer();
    return {
      app: 'SCULPTit',
      version: VERSION,
      savedAt: new Date().toISOString(),
      primitive: state.primitive,
      detail: state.detail,
      activeLayerId,
      layers: layers.map(layer => ({
        id: layer.id,
        name: layer.name,
        primitive: layer.primitive,
        visible: layer.visible,
        mesh: {
          positions: Array.from(layer.mesh.positions),
          indices: Array.from(layer.mesh.indices),
          masks: Array.from(layer.mesh.masks || new Float32Array(layer.mesh.positions.length / 3))
        }
      })),
      viewport: {
        cameraTarget: camera.target,
        cameraYaw: camera.yaw,
        cameraPitch: camera.pitch,
        cameraDistance: camera.distance
      }
    };
  }

  function loadProjectPayload(payload) {
    if (Array.isArray(payload?.layers) && payload.layers.length > 0) {
      layers = payload.layers.map((item, index) => makeLayer(
        item.id || `layer-${index + 1}`,
        item.name || `Layer ${index + 1}`,
        item.primitive || 'sphere',
        {
          positions: new Float32Array(item.mesh.positions),
          indices: new Uint32Array(item.mesh.indices),
          masks: new Float32Array(item.mesh.masks || new Array(item.mesh.positions.length / 3).fill(0))
        }
      ));
      layerSerial = Math.max(layers.length, layerSerial);
      activeLayerId = payload.activeLayerId && layers.some(layer => layer.id === payload.activeLayerId) ? payload.activeLayerId : layers[0].id;
      setActiveLayer(activeLayerId);
    } else if (payload?.mesh?.positions && payload?.mesh?.indices) {
      const loadedMesh = {
        positions: new Float32Array(payload.mesh.positions),
        indices: new Uint32Array(payload.mesh.indices),
        masks: new Float32Array(payload.mesh.masks || new Array(payload.mesh.positions.length / 3).fill(0))
      };
      layers = [makeLayer('layer-1', 'Imported Mesh', payload.primitive || 'sphere', loadedMesh)];
      activeLayerId = 'layer-1';
      setActiveLayer(activeLayerId);
    } else {
      throw new Error('Invalid SCULPTit project.');
    }

    state.primitive = payload.primitive || layers[0]?.primitive || 'sphere';
    state.detail = payload.detail || state.detail;
    if (ui.primitiveSelect.querySelector(`option[value="${state.primitive}"]`)) ui.primitiveSelect.value = state.primitive;
    ui.detail.value = String(state.detail);
    ui.detail.dispatchEvent(new Event('input'));

    if (payload.viewport) {
      camera.target = payload.viewport.cameraTarget || camera.target;
      camera.yaw = payload.viewport.cameraYaw ?? camera.yaw;
      camera.pitch = payload.viewport.cameraPitch ?? camera.pitch;
      camera.distance = payload.viewport.cameraDistance ?? camera.distance;
      updateCamera();
    }
    renderLayerList();
    updateStats();
    setDirty(false);
  }

  function exportObj() {
    commitActiveLayer();
    const lines = ['# SCULPTit OBJ Export', `# Version ${VERSION}`];
    let vertexOffset = 0;
    for (const layer of layers) {
      if (!layer.visible) continue;
      lines.push(`o ${safeObjName(layer.name)}`);
      for (let i = 0; i < layer.mesh.positions.length; i += 3) {
        lines.push(`v ${fmt(layer.mesh.positions[i])} ${fmt(layer.mesh.positions[i + 1])} ${fmt(layer.mesh.positions[i + 2])}`);
      }
      for (let i = 0; i < layer.normals.length; i += 3) {
        lines.push(`vn ${fmt(layer.normals[i])} ${fmt(layer.normals[i + 1])} ${fmt(layer.normals[i + 2])}`);
      }
      for (let i = 0; i < layer.mesh.indices.length; i += 3) {
        const a = layer.mesh.indices[i] + 1 + vertexOffset;
        const b = layer.mesh.indices[i + 1] + 1 + vertexOffset;
        const c = layer.mesh.indices[i + 2] + 1 + vertexOffset;
        lines.push(`f ${a}//${a} ${b}//${b} ${c}//${c}`);
      }
      vertexOffset += layer.mesh.positions.length / 3;
    }
    downloadText('SCULPTit_export.obj', lines.join('\n'), 'text/plain');
    setStatus('OBJ exported');
  }

  function exportStl() {
    commitActiveLayer();
    const lines = ['solid SCULPTit'];
    for (const layer of layers) {
      if (!layer.visible) continue;
      for (let i = 0; i < layer.mesh.indices.length; i += 3) {
        const a = readVertex(layer.mesh.positions, layer.mesh.indices[i]);
        const b = readVertex(layer.mesh.positions, layer.mesh.indices[i + 1]);
        const c = readVertex(layer.mesh.positions, layer.mesh.indices[i + 2]);
        const n = vec3Normalize(vec3Cross(vec3Sub(b, a), vec3Sub(c, a)));
        lines.push(`  facet normal ${fmt(n[0])} ${fmt(n[1])} ${fmt(n[2])}`);
        lines.push('    outer loop');
        lines.push(`      vertex ${fmt(a[0])} ${fmt(a[1])} ${fmt(a[2])}`);
        lines.push(`      vertex ${fmt(b[0])} ${fmt(b[1])} ${fmt(b[2])}`);
        lines.push(`      vertex ${fmt(c[0])} ${fmt(c[1])} ${fmt(c[2])}`);
        lines.push('    endloop');
        lines.push('  endfacet');
      }
    }
    lines.push('endsolid SCULPTit');
    downloadText('SCULPTit_export.stl', lines.join('\n'), 'model/stl');
    setStatus('STL exported');
  }

  function safeObjName(name) {
    return String(name || 'Layer').replace(/[^A-Za-z0-9_\-]+/g, '_');
  }

  function downloadText(filename, content, mime) {
    const blob = new Blob([content], { type: mime });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  }

  async function openDocumentation() {
    ui.modalTitle.textContent = 'SCULPTit Documentation';
    ui.modalBody.innerHTML = '<p>Loading documentation...</p>';
    ui.modalBackdrop.hidden = false;
    try {
      const response = await fetch('assets/Documentation.md', { cache: 'no-store' });
      const markdown = await response.text();
      ui.modalBody.innerHTML = renderMarkdown(markdown);
    } catch (err) {
      ui.modalBody.innerHTML = '<p>Documentation could not be loaded. Make sure SCULPTit is running through the local server.</p>';
    }
  }

  function openControls() {
    ui.modalTitle.textContent = 'Controls / Navigation';
    ui.modalBody.innerHTML = renderMarkdown(`# Controls

- **LMB:** Sculpt with the active brush
- **RMB:** Orbit / rotate the view
- **MMB:** Pan the view
- **Mouse Wheel:** Zoom
- **Alt + LMB:** Orbit instead of sculpting; with Pull, Alt also inverts Pull into Push
- **Shift:** Temporary Smooth brush
- **F:** Frame the scene in the viewport
- **1-5:** Pull, Push, Clay, Inflate, Flatten
- **6-9:** Smooth, Pinch, Crease, Scrape
- **Ctrl + S:** Save the project as a file
- **Ctrl + O:** Open a project file
- **Ctrl + N:** Create a new model on the active layer

Orbit Y is no longer inverted by default. Enable **Invert Orbit Y** under **Viewport** if you prefer the previous navigation behavior.`);
    ui.modalBackdrop.hidden = false;
  }

  function closeModal() { ui.modalBackdrop.hidden = true; }

  function renderMarkdown(md) {
    const escaped = escapeHtml(md).replace(/\r\n/g, '\n');
    const lines = escaped.split('\n');
    let html = '';
    let inList = false;
    let inCode = false;
    for (let line of lines) {
      if (line.trim().startsWith('```')) {
        if (!inCode) { html += '<pre><code>'; inCode = true; }
        else { html += '</code></pre>'; inCode = false; }
        continue;
      }
      if (inCode) { html += `${line}\n`; continue; }
      if (/^###\s+/.test(line)) { if (inList) { html += '</ul>'; inList = false; } html += `<h3>${inlineMd(line.replace(/^###\s+/, ''))}</h3>`; continue; }
      if (/^##\s+/.test(line)) { if (inList) { html += '</ul>'; inList = false; } html += `<h2>${inlineMd(line.replace(/^##\s+/, ''))}</h2>`; continue; }
      if (/^#\s+/.test(line)) { if (inList) { html += '</ul>'; inList = false; } html += `<h1>${inlineMd(line.replace(/^#\s+/, ''))}</h1>`; continue; }
      if (/^-\s+/.test(line)) { if (!inList) { html += '<ul>'; inList = true; } html += `<li>${inlineMd(line.replace(/^-\s+/, ''))}</li>`; continue; }
      if (line.trim() === '') { if (inList) { html += '</ul>'; inList = false; } continue; }
      if (inList) { html += '</ul>'; inList = false; }
      html += `<p>${inlineMd(line)}</p>`;
    }
    if (inList) html += '</ul>';
    if (inCode) html += '</code></pre>';
    return html;
  }

  function inlineMd(text) {
    return text
      .replace(/`([^`]+)`/g, '<code>$1</code>')
      .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
  }

  function escapeHtml(s) {
    return String(s).replace(/[&<>"]/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[ch]));
  }

  function createGpuResources() {
    return {
      vao: gl.createVertexArray(),
      pos: gl.createBuffer(),
      normal: gl.createBuffer(),
      mask: gl.createBuffer(),
      index: gl.createBuffer(),
      lineIndex: gl.createBuffer()
    };
  }

  function uploadMesh(full) {
    uploadMeshData(mesh, normals, lineIndices, full);
    updateStats();
  }

  function uploadMeshData(layerMesh, layerNormals, layerLineIndices, full) {
    gl.bindVertexArray(gpu.vao);
    gl.bindBuffer(gl.ARRAY_BUFFER, gpu.pos);
    gl.bufferData(gl.ARRAY_BUFFER, layerMesh.positions, gl.DYNAMIC_DRAW);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 3, gl.FLOAT, false, 0, 0);

    gl.bindBuffer(gl.ARRAY_BUFFER, gpu.normal);
    gl.bufferData(gl.ARRAY_BUFFER, layerNormals, gl.DYNAMIC_DRAW);
    gl.enableVertexAttribArray(1);
    gl.vertexAttribPointer(1, 3, gl.FLOAT, false, 0, 0);

    gl.bindBuffer(gl.ARRAY_BUFFER, gpu.mask);
    gl.bufferData(gl.ARRAY_BUFFER, layerMesh.masks, gl.DYNAMIC_DRAW);
    gl.enableVertexAttribArray(2);
    gl.vertexAttribPointer(2, 1, gl.FLOAT, false, 0, 0);

    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, gpu.index);
    gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, layerMesh.indices, full ? gl.STATIC_DRAW : gl.DYNAMIC_DRAW);
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, gpu.lineIndex);
    gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, layerLineIndices, full ? gl.STATIC_DRAW : gl.DYNAMIC_DRAW);
  }

  function render() {
    updateCamera();
    gl.viewport(0, 0, canvas.width, canvas.height);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);

    const light = lightDirection();
    for (const layer of layers) {
      if (!layer.visible) continue;
      uploadMeshData(layer.mesh, layer.normals, layer.lineIndices, false);

      gl.useProgram(shader);
      gl.bindVertexArray(gpu.vao);
      gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, gpu.index);
      gl.uniformMatrix4fv(gl.getUniformLocation(shader, 'uViewProj'), false, camera.viewProj);
      gl.uniform3fv(gl.getUniformLocation(shader, 'uLightDir'), light);
      gl.uniform1f(gl.getUniformLocation(shader, 'uLightIntensity'), state.lightIntensity);
      gl.uniform1f(gl.getUniformLocation(shader, 'uClayShading'), state.clayShading ? 1 : 0);
      gl.uniform1f(gl.getUniformLocation(shader, 'uFacetedShading'), state.faceted ? 1 : 0);
      gl.enable(gl.POLYGON_OFFSET_FILL);
      gl.polygonOffset(1.0, 1.0);
      gl.drawElements(gl.TRIANGLES, layer.mesh.indices.length, gl.UNSIGNED_INT, 0);
      gl.disable(gl.POLYGON_OFFSET_FILL);

      if (state.wireframe) {
        gl.enable(gl.BLEND);
        gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
        gl.useProgram(lineShader);
        gl.bindVertexArray(gpu.vao);
        gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, gpu.lineIndex);
        gl.uniformMatrix4fv(gl.getUniformLocation(lineShader, 'uViewProj'), false, camera.viewProj);
        gl.uniform1f(gl.getUniformLocation(lineShader, 'uAlpha'), layer.id === activeLayerId ? 0.30 : 0.16);
        gl.drawElements(gl.LINES, layer.lineIndices.length, gl.UNSIGNED_INT, 0);
        gl.disable(gl.BLEND);
      }
    }

    requestAnimationFrame(render);
  }

  function lightDirection() {
    const a = state.lightAzimuth * Math.PI / 180;
    return vec3Normalize([Math.sin(a), 0.55, Math.cos(a)]);
  }

  function resize() {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const width = Math.floor(canvas.clientWidth * dpr);
    const height = Math.floor(canvas.clientHeight * dpr);
    if (canvas.width !== width || canvas.height !== height) {
      canvas.width = width;
      canvas.height = height;
    }
    camera.proj = mat4Perspective(camera.fov, canvas.clientWidth / canvas.clientHeight, camera.near, camera.far);
    updateCamera();
  }

  function updateCamera() {
    const cp = Math.cos(camera.pitch);
    camera.position = [
      camera.target[0] + camera.distance * cp * Math.sin(camera.yaw),
      camera.target[1] + camera.distance * Math.sin(camera.pitch),
      camera.target[2] + camera.distance * cp * Math.cos(camera.yaw)
    ];
    camera.view = mat4LookAt(camera.position, camera.target, [0, 1, 0]);
    camera.viewProj = mat4Multiply(camera.proj, camera.view);
    camera.invViewProj = mat4Invert(camera.viewProj);
  }

  function frameModel() {
    bounds = computeSceneBounds();
    camera.target = bounds.center.slice();
    camera.distance = Math.max(2.2, bounds.radius * 3.0);
    updateCamera();
    setStatus('Viewport framed');
  }

  function computeSceneBounds() {
    let hasAny = false;
    const min = [Infinity, Infinity, Infinity];
    const max = [-Infinity, -Infinity, -Infinity];
    for (const layer of layers) {
      if (!layer.visible) continue;
      const b = computeBounds(layer.mesh.positions);
      hasAny = true;
      for (let i = 0; i < 3; i++) {
        min[i] = Math.min(min[i], b.min[i]);
        max[i] = Math.max(max[i], b.max[i]);
      }
    }
    if (!hasAny) return computeBounds(mesh.positions);
    const center = [(min[0] + max[0]) / 2, (min[1] + max[1]) / 2, (min[2] + max[2]) / 2];
    let radius = 1;
    for (const layer of layers) {
      if (!layer.visible) continue;
      for (let i = 0; i < layer.mesh.positions.length; i += 3) {
        radius = Math.max(radius, vec3Distance(center, [layer.mesh.positions[i], layer.mesh.positions[i + 1], layer.mesh.positions[i + 2]]));
      }
    }
    return { min, max, center, radius };
  }

  function setDirty(value) {
    state.dirty = value;
    if (value) ui.statusText.textContent = 'Unsaved changes';
  }

  function setStatus(text) {
    ui.statusText.textContent = text;
    clearTimeout(setStatus.timer);
    setStatus.timer = setTimeout(() => {
      ui.statusText.textContent = state.dirty ? 'Unsaved changes' : 'Ready';
    }, 2200);
  }

  function updateStats() {
    let v = 0, f = 0;
    for (const layer of layers) {
      v += layer.mesh.positions.length / 3;
      f += layer.mesh.indices.length / 3;
    }
    ui.polyStats.textContent = `${v.toLocaleString('en-US')} V / ${f.toLocaleString('en-US')} F`;
  }

  function fmt(n) { return Number(n).toFixed(6).replace(/\.0+$/, ''); }

  function prepareMesh(layerMesh) {
    if (!(layerMesh.positions instanceof Float32Array)) layerMesh.positions = new Float32Array(layerMesh.positions);
    if (!(layerMesh.indices instanceof Uint32Array)) layerMesh.indices = new Uint32Array(layerMesh.indices);
    const vertexCount = layerMesh.positions.length / 3;
    if (!layerMesh.masks || layerMesh.masks.length !== vertexCount) layerMesh.masks = new Float32Array(vertexCount);
    else if (!(layerMesh.masks instanceof Float32Array)) layerMesh.masks = new Float32Array(layerMesh.masks);
    orientMeshWinding(layerMesh);
    return layerMesh;
  }

  function orientMeshWinding(layerMesh) {
    const pos = layerMesh.positions;
    const idx = layerMesh.indices;
    const b = computeBounds(pos);
    for (let i = 0; i < idx.length; i += 3) {
      const ia = idx[i], ib = idx[i + 1], ic = idx[i + 2];
      const a = readVertex(pos, ia), bb = readVertex(pos, ib), c = readVertex(pos, ic);
      const n = vec3Cross(vec3Sub(bb, a), vec3Sub(c, a));
      const center = [(a[0] + bb[0] + c[0]) / 3, (a[1] + bb[1] + c[1]) / 3, (a[2] + bb[2] + c[2]) / 3];
      const outward = vec3Sub(center, b.center);
      if (vec3Length(outward) > 1e-5 && vec3Dot(n, outward) < 0) {
        idx[i + 1] = ic;
        idx[i + 2] = ib;
      }
    }
  }

  function offsetMesh(layerMesh, offset) {
    for (let i = 0; i < layerMesh.positions.length; i += 3) {
      layerMesh.positions[i] += offset[0];
      layerMesh.positions[i + 1] += offset[1];
      layerMesh.positions[i + 2] += offset[2];
    }
  }

  function createPrimitive(type, detail) {
    const d = Math.max(8, Math.min(96, Math.round(detail)));
    if (type === 'cube') return createCube(d);
    if (type === 'plane') return createPlane(d);
    if (type === 'cylinder') return createCylinder(d);
    if (type === 'cone') return createCone(d);
    if (type === 'torus') return createTorus(d);
    return createSphere(d);
  }

  function withMasks(positions, indices) {
    return { positions: new Float32Array(positions), indices: new Uint32Array(indices), masks: new Float32Array(positions.length / 3) };
  }

  function createSphere(detail) {
    const lat = Math.max(8, Math.round(detail));
    const lon = lat * 2;
    const positions = [];
    const indices = [];
    for (let y = 0; y <= lat; y++) {
      const v = y / lat;
      const theta = v * Math.PI;
      for (let x = 0; x <= lon; x++) {
        const u = x / lon;
        const phi = u * Math.PI * 2;
        positions.push(Math.sin(theta) * Math.cos(phi), Math.cos(theta), Math.sin(theta) * Math.sin(phi));
      }
    }
    for (let y = 0; y < lat; y++) {
      for (let x = 0; x < lon; x++) {
        const a = y * (lon + 1) + x;
        const b = a + lon + 1;
        indices.push(a, b, a + 1);
        indices.push(b, b + 1, a + 1);
      }
    }
    return withMasks(positions, indices);
  }

  function createPlane(detail) {
    const n = Math.max(2, detail);
    const positions = [];
    const indices = [];
    for (let z = 0; z <= n; z++) {
      for (let x = 0; x <= n; x++) {
        positions.push((x / n - 0.5) * 2.2, 0, (z / n - 0.5) * 2.2);
      }
    }
    for (let z = 0; z < n; z++) {
      for (let x = 0; x < n; x++) {
        const a = z * (n + 1) + x;
        const b = a + n + 1;
        indices.push(a, a + 1, b);
        indices.push(a + 1, b + 1, b);
      }
    }
    return withMasks(positions, indices);
  }

  function createCube(detail) {
    const n = Math.max(2, Math.floor(detail / 2));
    const positions = [];
    const indices = [];
    const faces = [
      { n: [1, 0, 0], u: [0, 0, -1], v: [0, 1, 0] },
      { n: [-1, 0, 0], u: [0, 0, 1], v: [0, 1, 0] },
      { n: [0, 1, 0], u: [1, 0, 0], v: [0, 0, -1] },
      { n: [0, -1, 0], u: [1, 0, 0], v: [0, 0, 1] },
      { n: [0, 0, 1], u: [1, 0, 0], v: [0, 1, 0] },
      { n: [0, 0, -1], u: [-1, 0, 0], v: [0, 1, 0] }
    ];
    for (const face of faces) {
      const base = positions.length / 3;
      for (let y = 0; y <= n; y++) {
        for (let x = 0; x <= n; x++) {
          const px = (x / n - 0.5) * 2;
          const py = (y / n - 0.5) * 2;
          const p = vec3Add(vec3Add(vec3Scale(face.n, 1), vec3Scale(face.u, px)), vec3Scale(face.v, py));
          positions.push(p[0], p[1], p[2]);
        }
      }
      for (let y = 0; y < n; y++) {
        for (let x = 0; x < n; x++) {
          const a = base + y * (n + 1) + x;
          const b = a + n + 1;
          indices.push(a, b, a + 1);
          indices.push(a + 1, b, b + 1);
        }
      }
    }
    return withMasks(positions, indices);
  }

  function createCylinder(detail) {
    const radial = Math.max(12, detail * 2);
    const hseg = Math.max(4, Math.floor(detail / 3));
    const positions = [];
    const indices = [];
    for (let y = 0; y <= hseg; y++) {
      const py = (y / hseg - 0.5) * 2;
      for (let r = 0; r <= radial; r++) {
        const a = r / radial * Math.PI * 2;
        positions.push(Math.cos(a), py, Math.sin(a));
      }
    }
    for (let y = 0; y < hseg; y++) {
      for (let r = 0; r < radial; r++) {
        const a = y * (radial + 1) + r;
        const b = a + radial + 1;
        indices.push(a, b, a + 1);
        indices.push(a + 1, b, b + 1);
      }
    }
    const topCenter = positions.length / 3; positions.push(0, 1, 0);
    const bottomCenter = positions.length / 3; positions.push(0, -1, 0);
    const topStart = hseg * (radial + 1);
    for (let r = 0; r < radial; r++) {
      indices.push(topCenter, topStart + r, topStart + r + 1);
      indices.push(bottomCenter, r + 1, r);
    }
    return withMasks(positions, indices);
  }

  function createCone(detail) {
    const radial = Math.max(12, detail * 2);
    const hseg = Math.max(4, Math.floor(detail / 3));
    const positions = [];
    const indices = [];
    for (let y = 0; y <= hseg; y++) {
      const t = y / hseg;
      const py = t * 2 - 1;
      const radius = 1 - t;
      for (let r = 0; r <= radial; r++) {
        const a = r / radial * Math.PI * 2;
        positions.push(Math.cos(a) * radius, py, Math.sin(a) * radius);
      }
    }
    for (let y = 0; y < hseg; y++) {
      for (let r = 0; r < radial; r++) {
        const a = y * (radial + 1) + r;
        const b = a + radial + 1;
        indices.push(a, b, a + 1);
        indices.push(a + 1, b, b + 1);
      }
    }
    const bottomCenter = positions.length / 3; positions.push(0, -1, 0);
    for (let r = 0; r < radial; r++) indices.push(bottomCenter, r + 1, r);
    return withMasks(positions, indices);
  }

  function createTorus(detail) {
    const major = Math.max(16, detail * 2);
    const minor = Math.max(8, Math.floor(detail / 2));
    const positions = [];
    const indices = [];
    const R = 0.78, rSmall = 0.32;
    for (let i = 0; i <= major; i++) {
      const u = i / major * Math.PI * 2;
      for (let j = 0; j <= minor; j++) {
        const v = j / minor * Math.PI * 2;
        const x = (R + rSmall * Math.cos(v)) * Math.cos(u);
        const y = rSmall * Math.sin(v);
        const z = (R + rSmall * Math.cos(v)) * Math.sin(u);
        positions.push(x, y, z);
      }
    }
    for (let i = 0; i < major; i++) {
      for (let j = 0; j < minor; j++) {
        const a = i * (minor + 1) + j;
        const b = a + minor + 1;
        indices.push(a, b, a + 1);
        indices.push(a + 1, b, b + 1);
      }
    }
    return withMasks(positions, indices);
  }

  function subdivide(source) {
    const positions = Array.from(source.positions);
    const masks = Array.from(source.masks || new Float32Array(source.positions.length / 3));
    const indices = [];
    const edgeCache = new Map();
    const mid = (a, b) => {
      const key = a < b ? `${a}_${b}` : `${b}_${a}`;
      if (edgeCache.has(key)) return edgeCache.get(key);
      const pa = a * 3, pb = b * 3;
      const vi = positions.length / 3;
      positions.push(
        (positions[pa] + positions[pb]) * 0.5,
        (positions[pa + 1] + positions[pb + 1]) * 0.5,
        (positions[pa + 2] + positions[pb + 2]) * 0.5
      );
      masks.push(((masks[a] || 0) + (masks[b] || 0)) * 0.5);
      edgeCache.set(key, vi);
      return vi;
    };
    const src = source.indices;
    for (let i = 0; i < src.length; i += 3) {
      const a = src[i], b = src[i + 1], c = src[i + 2];
      const ab = mid(a, b), bc = mid(b, c), ca = mid(c, a);
      indices.push(a, ab, ca, ab, b, bc, ca, bc, c, ab, bc, ca);
    }
    return { positions: new Float32Array(positions), indices: new Uint32Array(indices), masks: new Float32Array(masks) };
  }

  function buildTopology(indices, vertexCount) {
    const sets = Array.from({ length: vertexCount }, () => new Set());
    const edgeSet = new Set();
    for (let i = 0; i < indices.length; i += 3) {
      const a = indices[i], b = indices[i + 1], c = indices[i + 2];
      sets[a].add(b); sets[a].add(c);
      sets[b].add(a); sets[b].add(c);
      sets[c].add(a); sets[c].add(b);
      addEdge(edgeSet, a, b); addEdge(edgeSet, b, c); addEdge(edgeSet, c, a);
    }
    return { neighbours: sets.map(s => Array.from(s)), uniqueEdges: edgeSet.size };
  }

  function addEdge(set, a, b) { set.add(a < b ? `${a}_${b}` : `${b}_${a}`); }

  function computeNormals(positions, indices) {
    const out = new Float32Array(positions.length);
    for (let i = 0; i < indices.length; i += 3) {
      const ia = indices[i], ib = indices[i + 1], ic = indices[i + 2];
      const a = readVertex(positions, ia), b = readVertex(positions, ib), c = readVertex(positions, ic);
      const n = vec3Cross(vec3Sub(b, a), vec3Sub(c, a));
      addNormal(out, ia, n); addNormal(out, ib, n); addNormal(out, ic, n);
    }
    for (let i = 0; i < out.length; i += 3) {
      const n = vec3Normalize([out[i], out[i + 1], out[i + 2]]);
      out[i] = n[0]; out[i + 1] = n[1]; out[i + 2] = n[2];
    }
    return out;
  }

  function addNormal(out, idx, n) {
    const p = idx * 3;
    out[p] += n[0]; out[p + 1] += n[1]; out[p + 2] += n[2];
  }

  function buildWireIndices(indices) {
    const lines = [];
    for (let i = 0; i < indices.length; i += 3) {
      const a = indices[i], b = indices[i + 1], c = indices[i + 2];
      lines.push(a, b, b, c, c, a);
    }
    return new Uint32Array(lines);
  }

  function computeBounds(positions) {
    const min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity];
    for (let i = 0; i < positions.length; i += 3) {
      min[0] = Math.min(min[0], positions[i]); min[1] = Math.min(min[1], positions[i + 1]); min[2] = Math.min(min[2], positions[i + 2]);
      max[0] = Math.max(max[0], positions[i]); max[1] = Math.max(max[1], positions[i + 1]); max[2] = Math.max(max[2], positions[i + 2]);
    }
    const center = [(min[0] + max[0]) / 2, (min[1] + max[1]) / 2, (min[2] + max[2]) / 2];
    let radius = 1;
    for (let i = 0; i < positions.length; i += 3) radius = Math.max(radius, vec3Distance(center, [positions[i], positions[i + 1], positions[i + 2]]));
    return { min, max, center, radius };
  }

  function readVertex(positions, idx) {
    const p = idx * 3;
    return [positions[p], positions[p + 1], positions[p + 2]];
  }

  function intersectRayTriangle(origin, dir, a, b, c) {
    const eps = 1e-7;
    const edge1 = vec3Sub(b, a);
    const edge2 = vec3Sub(c, a);
    const pvec = vec3Cross(dir, edge2);
    const det = vec3Dot(edge1, pvec);
    if (Math.abs(det) < eps) return null;
    const invDet = 1 / det;
    const tvec = vec3Sub(origin, a);
    const u = vec3Dot(tvec, pvec) * invDet;
    if (u < 0 || u > 1) return null;
    const qvec = vec3Cross(tvec, edge1);
    const v = vec3Dot(dir, qvec) * invDet;
    if (v < 0 || u + v > 1) return null;
    const t = vec3Dot(edge2, qvec) * invDet;
    if (t < eps) return null;
    return { t, point: vec3Add(origin, vec3Scale(dir, t)) };
  }

  function createProgram(glc, vs, fs) {
    const v = compileShader(glc, glc.VERTEX_SHADER, vs);
    const f = compileShader(glc, glc.FRAGMENT_SHADER, fs);
    const p = glc.createProgram();
    glc.attachShader(p, v); glc.attachShader(p, f);
    glc.bindAttribLocation(p, 0, 'aPosition');
    glc.bindAttribLocation(p, 1, 'aNormal');
    glc.bindAttribLocation(p, 2, 'aMask');
    glc.linkProgram(p);
    if (!glc.getProgramParameter(p, glc.LINK_STATUS)) throw new Error(glc.getProgramInfoLog(p));
    return p;
  }

  function compileShader(glc, type, src) {
    const s = glc.createShader(type);
    glc.shaderSource(s, src);
    glc.compileShader(s);
    if (!glc.getShaderParameter(s, glc.COMPILE_STATUS)) throw new Error(glc.getShaderInfoLog(s));
    return s;
  }

  function vec3Add(a, b) { return [a[0] + b[0], a[1] + b[1], a[2] + b[2]]; }
  function vec3Sub(a, b) { return [a[0] - b[0], a[1] - b[1], a[2] - b[2]]; }
  function vec3Scale(a, s) { return [a[0] * s, a[1] * s, a[2] * s]; }
  function vec3Dot(a, b) { return a[0] * b[0] + a[1] * b[1] + a[2] * b[2]; }
  function vec3Cross(a, b) { return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]]; }
  function vec3Length(a) { return Math.hypot(a[0], a[1], a[2]); }
  function vec3Normalize(a) { const l = vec3Length(a) || 1; return [a[0] / l, a[1] / l, a[2] / l]; }
  function vec3Distance(a, b) { return vec3Length(vec3Sub(a, b)); }
  function vec3Lerp(a, b, t) { return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t]; }
  function clamp(v, min, max) { return Math.max(min, Math.min(max, v)); }
  function pseudoRandom(x) { return fract(Math.sin(x) * 43758.5453123); }
  function fract(x) { return x - Math.floor(x); }

  function rotateAroundAxis(v, center, axis, angle) {
    const p = vec3Sub(v, center);
    const cos = Math.cos(angle), sin = Math.sin(angle);
    const term1 = vec3Scale(p, cos);
    const term2 = vec3Scale(vec3Cross(axis, p), sin);
    const term3 = vec3Scale(axis, vec3Dot(axis, p) * (1 - cos));
    return vec3Add(center, vec3Add(vec3Add(term1, term2), term3));
  }

  function mat4Identity() {
    const m = new Float32Array(16);
    m[0] = m[5] = m[10] = m[15] = 1;
    return m;
  }

  function mat4Perspective(fovy, aspect, near, far) {
    const f = 1 / Math.tan(fovy / 2);
    const nf = 1 / (near - far);
    const m = new Float32Array(16);
    m[0] = f / aspect;
    m[5] = f;
    m[10] = (far + near) * nf;
    m[11] = -1;
    m[14] = (2 * far * near) * nf;
    return m;
  }

  function mat4LookAt(eye, center, up) {
    const z = vec3Normalize(vec3Sub(eye, center));
    const x = vec3Normalize(vec3Cross(up, z));
    const y = vec3Cross(z, x);
    const m = new Float32Array(16);
    m[0] = x[0]; m[1] = y[0]; m[2] = z[0]; m[3] = 0;
    m[4] = x[1]; m[5] = y[1]; m[6] = z[1]; m[7] = 0;
    m[8] = x[2]; m[9] = y[2]; m[10] = z[2]; m[11] = 0;
    m[12] = -vec3Dot(x, eye); m[13] = -vec3Dot(y, eye); m[14] = -vec3Dot(z, eye); m[15] = 1;
    return m;
  }

  function mat4Multiply(a, b) {
    const out = new Float32Array(16);
    for (let i = 0; i < 4; i++) {
      for (let j = 0; j < 4; j++) {
        out[j * 4 + i] = a[i] * b[j * 4] + a[4 + i] * b[j * 4 + 1] + a[8 + i] * b[j * 4 + 2] + a[12 + i] * b[j * 4 + 3];
      }
    }
    return out;
  }

  function mat4TransformVec4(m, v) {
    return [
      m[0] * v[0] + m[4] * v[1] + m[8] * v[2] + m[12] * v[3],
      m[1] * v[0] + m[5] * v[1] + m[9] * v[2] + m[13] * v[3],
      m[2] * v[0] + m[6] * v[1] + m[10] * v[2] + m[14] * v[3],
      m[3] * v[0] + m[7] * v[1] + m[11] * v[2] + m[15] * v[3]
    ];
  }

  function mat4Invert(a) {
    const out = new Float32Array(16);
    const a00 = a[0], a01 = a[1], a02 = a[2], a03 = a[3];
    const a10 = a[4], a11 = a[5], a12 = a[6], a13 = a[7];
    const a20 = a[8], a21 = a[9], a22 = a[10], a23 = a[11];
    const a30 = a[12], a31 = a[13], a32 = a[14], a33 = a[15];
    const b00 = a00 * a11 - a01 * a10;
    const b01 = a00 * a12 - a02 * a10;
    const b02 = a00 * a13 - a03 * a10;
    const b03 = a01 * a12 - a02 * a11;
    const b04 = a01 * a13 - a03 * a11;
    const b05 = a02 * a13 - a03 * a12;
    const b06 = a20 * a31 - a21 * a30;
    const b07 = a20 * a32 - a22 * a30;
    const b08 = a20 * a33 - a23 * a30;
    const b09 = a21 * a32 - a22 * a31;
    const b10 = a21 * a33 - a23 * a31;
    const b11 = a22 * a33 - a23 * a32;
    let det = b00 * b11 - b01 * b10 + b02 * b09 + b03 * b08 - b04 * b07 + b05 * b06;
    if (!det) return mat4Identity();
    det = 1.0 / det;
    out[0] = (a11 * b11 - a12 * b10 + a13 * b09) * det;
    out[1] = (a02 * b10 - a01 * b11 - a03 * b09) * det;
    out[2] = (a31 * b05 - a32 * b04 + a33 * b03) * det;
    out[3] = (a22 * b04 - a21 * b05 - a23 * b03) * det;
    out[4] = (a12 * b08 - a10 * b11 - a13 * b07) * det;
    out[5] = (a00 * b11 - a02 * b08 + a03 * b07) * det;
    out[6] = (a32 * b02 - a30 * b05 - a33 * b01) * det;
    out[7] = (a20 * b05 - a22 * b02 + a23 * b01) * det;
    out[8] = (a10 * b10 - a11 * b08 + a13 * b06) * det;
    out[9] = (a01 * b08 - a00 * b10 - a03 * b06) * det;
    out[10] = (a30 * b04 - a31 * b02 + a33 * b00) * det;
    out[11] = (a21 * b02 - a20 * b04 - a23 * b00) * det;
    out[12] = (a11 * b07 - a10 * b09 - a12 * b06) * det;
    out[13] = (a00 * b09 - a01 * b07 + a02 * b06) * det;
    out[14] = (a31 * b01 - a30 * b03 - a32 * b00) * det;
    out[15] = (a20 * b03 - a21 * b01 + a22 * b00) * det;
    return out;
  }

})();
// sksdesign (c) 2026 