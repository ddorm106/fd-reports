/* fp2-3d.js — the extruded 3D view.
 *
 * LIFTED VERBATIM from page11 v4 (three.js r128, loaded globally by the page).
 * It reads `state.data`, which the renderer rebuilds each frame as the ACTIVE
 * FLOOR's view model — so on a multi-storey plan this shows the storey you are
 * editing, which is the behaviour you want and came for free from the rebuild.
 *
 * Kept as its own file because it is ~450 lines that almost never change and
 * has no business lengthening the editor.
 */
(function (root) {
  'use strict';

  function create(opts) {
    var state = opts.state;
    var wrap = opts.wrap;               // the canvas wrapper, for sizing
    var threeCanvas = opts.threeCanvas;
    var SYMBOLS = opts.symbols;
    var beforeRebuild = opts.beforeRebuild || function () {};

    function degToRad(d) { return d * Math.PI / 180; }
    function dist(x1, y1, x2, y2) { return Math.hypot(x2 - x1, y2 - y1); }

const threeState = { scene:null, camera:null, renderer:null, group:null, isInit:false, rafId:null };
function initOrUpdateThreeD() {
  if (typeof THREE === 'undefined') { showToast('Three.js not loaded', 'err'); return; }
  if (!threeState.isInit) initThreeD();
  rebuildThreeDScene(); updateThreeDCamera(); startThreeDLoop();
}
function initThreeD() {
  const rect = wrap.getBoundingClientRect();
  threeState.scene = new THREE.Scene();
  threeState.scene.background = new THREE.Color(0xeef2f7);
  threeState.camera = new THREE.PerspectiveCamera(40, rect.width / rect.height, 0.1, 10000);
  threeState.renderer = new THREE.WebGLRenderer({ canvas: threeCanvas, antialias: true });
  threeState.renderer.setPixelRatio(state.dpr);
  threeState.renderer.setSize(rect.width, rect.height, false);
  const amb = new THREE.AmbientLight(0xffffff, 0.6); threeState.scene.add(amb);
  const dir = new THREE.DirectionalLight(0xffffff, 0.7); dir.position.set(200, 400, 300); threeState.scene.add(dir);
  const dir2 = new THREE.DirectionalLight(0xddeeff, 0.35); dir2.position.set(-200, 200, -100); threeState.scene.add(dir2);
  threeState.isInit = true;
}
function rebuildThreeDScene() {
  if (!threeState.scene) return;
  if (threeState.group) {
    threeState.scene.remove(threeState.group);
    threeState.group.traverse(o => {
      if (o.geometry) o.geometry.dispose();
      if (o.material) {
        if (Array.isArray(o.material)) o.material.forEach(m => m.dispose());
        else o.material.dispose();
      }
    });
  }
  threeState.group = new THREE.Group();
  if (!state.data) { threeState.scene.add(threeState.group); return; }

  const d = state.data;
  const sf = d.scale_px_per_ft || 12;
  const H = state.threeDView.wallH * sf;
  const wallThick = 6;                 // wall is 6px thick in plan view
  const doorThick = wallThick + 4;     // protrudes 2px each side of wall
  const winThick  = wallThick + 4;

  // ── Ground + grid ──────────────────────────────────────────────
  const gw = d.canvas_width + 200, gh = d.canvas_height + 200;
  const ground = new THREE.Mesh(
    new THREE.PlaneGeometry(gw, gh),
    new THREE.MeshLambertMaterial({ color: 0xf1f5f9 })
  );
  ground.rotation.x = -Math.PI/2;
  ground.position.set(d.canvas_width/2, 0, d.canvas_height/2);
  threeState.group.add(ground);
  const grid = new THREE.GridHelper(Math.max(gw, gh), 20, 0xcbd5e1, 0xe2e8f0);
  grid.position.set(d.canvas_width/2, 0.1, d.canvas_height/2);
  threeState.group.add(grid);

  // ── Walls (with door / window cutouts) ─────────────────────────
  // For each wall, identify doors/windows on it and build the wall as a
  // Shape with holes where those openings are. Non-opening walls render as
  // plain BoxGeometry (cheaper).
  (d.walls || []).forEach(w => {
    const len = dist(w.x1, w.y1, w.x2, w.y2);
    if (len < 1) return;
    const ang = Math.atan2(w.y2 - w.y1, w.x2 - w.x1);
    const cx = (w.x1 + w.x2) / 2, cy = (w.y1 + w.y2) / 2;

    // Find openings on this wall (within 1ft perpendicular distance)
    const openingsOnWall = [];
    (d.doors || []).forEach((dr, idx) => {
      const pd = Fp_perpDistance(dr.x, dr.y, w.x1, w.y1, w.x2, w.y2);
      if (pd < wallThick/2 + 4) {
        // Project door onto wall
        const t = Fp_projT(dr.x, dr.y, w.x1, w.y1, w.x2, w.y2);
        if (t > 0.02 && t < 0.98) {
          openingsOnWall.push({ t, w: dr.width || 30, kind: 'door', idx });
        }
      }
    });
    (d.windows || []).forEach((wn, idx) => {
      const pd = Fp_perpDistance(wn.x, wn.y, w.x1, w.y1, w.x2, w.y2);
      if (pd < wallThick/2 + 4) {
        const t = Fp_projT(wn.x, wn.y, w.x1, w.y1, w.x2, w.y2);
        if (t > 0.02 && t < 0.98) {
          openingsOnWall.push({ t, w: wn.width || 30, kind: 'window', idx });
        }
      }
    });

    if (!openingsOnWall.length) {
      // Simple box wall
      const geo = new THREE.BoxGeometry(len, H, wallThick);
      const mat = new THREE.MeshLambertMaterial({ color: 0xe5e7eb });
      const m = new THREE.Mesh(geo, mat);
      m.position.set(cx, H/2, cy);
      m.rotation.y = -ang;
      threeState.group.add(m);
    } else {
      // Build wall shape with holes using ExtrudeGeometry.
      // Wall local space: X along length (-len/2..+len/2), Y is HEIGHT.
      const shape = new THREE.Shape();
      shape.moveTo(-len/2, 0);
      shape.lineTo(+len/2, 0);
      shape.lineTo(+len/2, H);
      shape.lineTo(-len/2, H);
      shape.lineTo(-len/2, 0);

      openingsOnWall.sort((a, b) => a.t - b.t).forEach(op => {
        const cxLocal = (op.t - 0.5) * len;
        const opW = op.w;
        // Door: 7ft tall (84 px @ 12 px/ft), starts at floor
        // Window: 3ft tall, starts at 3ft up from floor
        const bottom = op.kind === 'door' ? 0 : 3 * sf;
        const top    = op.kind === 'door' ? 7 * sf : 6 * sf;
        const hTop = Math.min(top, H - 0.5);
        const hBot = Math.max(bottom, 0);
        if (hTop - hBot < 4 || opW < 4) return;
        const hole = new THREE.Path();
        hole.moveTo(cxLocal - opW/2, hBot);
        hole.lineTo(cxLocal + opW/2, hBot);
        hole.lineTo(cxLocal + opW/2, hTop);
        hole.lineTo(cxLocal - opW/2, hTop);
        hole.lineTo(cxLocal - opW/2, hBot);
        shape.holes.push(hole);
      });

      const extrudeGeo = new THREE.ExtrudeGeometry(shape, {
        depth: wallThick,
        bevelEnabled: false,
        curveSegments: 1
      });
      // Center the extrusion on wall thickness (extrude goes +Z from shape)
      extrudeGeo.translate(0, 0, -wallThick/2);
      const mat = new THREE.MeshLambertMaterial({ color: 0xe5e7eb, side: THREE.DoubleSide });
      const m = new THREE.Mesh(extrudeGeo, mat);
      m.position.set(cx, 0, cy);
      // Rotate so wall's local X axis aligns with the world direction
      m.rotation.y = -ang;
      threeState.group.add(m);
    }

    // Top cap (dark trim line regardless)
    const topGeo = new THREE.BoxGeometry(len, 2, wallThick + 0.5);
    const top = new THREE.Mesh(topGeo, new THREE.MeshLambertMaterial({ color: 0x2D2D2D }));
    top.position.set(cx, H, cy);
    top.rotation.y = -ang;
    threeState.group.add(top);
  });

  // ── Doors — rendered as visible 3D leaves in the cutout ────────
  (d.doors || []).forEach(dr => {
    const w = dr.width || 30;
    const a = degToRad(dr.angle || 0);
    const doorH = Math.min(7 * sf, H - 2);
    // Door frame: dark rectangle at 7/8 thickness so edges peek out both sides
    const frameGeo = new THREE.BoxGeometry(w, doorH, doorThick);
    const frameMat = new THREE.MeshLambertMaterial({ color: 0x78350F }); // dark brown frame
    const frame = new THREE.Mesh(frameGeo, frameMat);
    frame.position.set(dr.x, doorH/2, dr.y);
    frame.rotation.y = -a;
    threeState.group.add(frame);
    // Bright orange leaf on one side to indicate entry (matches our 2D color)
    const leafGeo = new THREE.BoxGeometry(w * 0.9, doorH * 0.95, 1);
    const leafMat = new THREE.MeshLambertMaterial({ color: 0xC05020 });
    const leaf = new THREE.Mesh(leafGeo, leafMat);
    leaf.position.set(dr.x, doorH/2, dr.y);
    leaf.rotation.y = -a;
    // Offset leaf slightly forward so it sits inside the frame visibly
    const offset = (doorThick/2) - 0.6;
    leaf.translateZ(offset);
    threeState.group.add(leaf);
  });

  // ── Windows — translucent blue glass panes ─────────────────────
  (d.windows || []).forEach(wn => {
    const w = wn.width || 30;
    const a = degToRad(wn.angle || 0);
    const winH = 3 * sf; // 3ft tall window
    const sillY = 3 * sf + winH/2; // sill at 3ft up
    // Frame (dark, slightly larger than glass)
    const frameGeo = new THREE.BoxGeometry(w, winH + 3, winThick);
    const frame = new THREE.Mesh(frameGeo,
      new THREE.MeshLambertMaterial({ color: 0x374151 }));
    frame.position.set(wn.x, sillY, wn.y);
    frame.rotation.y = -a;
    threeState.group.add(frame);
    // Translucent glass
    const glassGeo = new THREE.BoxGeometry(w * 0.88, winH * 0.88, winThick + 0.8);
    const glassMat = new THREE.MeshPhongMaterial({
      color: 0x7DC5E8, transparent: true, opacity: 0.55, shininess: 110
    });
    const glass = new THREE.Mesh(glassGeo, glassMat);
    glass.position.set(wn.x, sillY, wn.y);
    glass.rotation.y = -a;
    threeState.group.add(glass);
    // Mullion (vertical divider)
    const mullGeo = new THREE.BoxGeometry(1.5, winH, winThick + 1);
    const mull = new THREE.Mesh(mullGeo,
      new THREE.MeshLambertMaterial({ color: 0x374151 }));
    mull.position.set(wn.x, sillY, wn.y);
    mull.rotation.y = -a;
    threeState.group.add(mull);
  });

  // ── Objects — user-togglable furniture rendering ───────────────
  // By default, render simplified category-specific meshes (not plain boxes).
  // User can toggle "Show furniture" in the 3D panel.
  if (state.threeDView.showFurniture !== false) {
    (d.objects || []).forEach(o => {
      const mesh = buildObjectMesh(o, sf);
      if (!mesh) return;
      mesh.position.x = o.x;
      mesh.position.z = o.y;
      mesh.rotation.y = -degToRad(o.angle || 0);
      threeState.group.add(mesh);
    });
  }

  // ── Symbols — extrude category height or skip (flat markers) ──
  (d.symbols || []).forEach(s => {
    const def = SYMBOLS.byId[s.symbolId]; if (!def) return;
    const ex = def.extrude3D;
    const h3d = ex ? ex.h * sf : 6;
    const geo = new THREE.CylinderGeometry(
      Math.max(def.w, def.h) * 0.5, Math.max(def.w, def.h) * 0.5, h3d, 16);
    const col = ex ? new THREE.Color(ex.color) : 0xdc2626;
    const m = new THREE.Mesh(geo, new THREE.MeshLambertMaterial({ color: col }));
    m.position.set(s.x, h3d/2, s.y);
    m.rotation.y = -degToRad(s.angle || 0);
    threeState.group.add(m);
  });

  threeState.scene.add(threeState.group);
}

// Helpers for 3D wall-opening projection

function buildObjectMesh(o, sf) {
  const w = o.width, d = o.depth;
  const cat = (o.category || '').toLowerCase();
  const g = new THREE.Group();

  // Color per category (matches 2D palette roughly)
  const COL_MAP = {
    television: 0x1f2937, sofa: 0x8B5A3C, chair: 0x8B6F4C,
    table: 0xA78160, storageCabinet: 0x6b7280, storage: 0x6b7280,
    bed: 0xD4C4A8, stove: 0xE5E7EB, refrigerator: 0xF5F5F5,
    toilet: 0xFFFFFF, bathtub: 0xF0F8FF, sink: 0xE5E7EB,
    dishwasher: 0xF5F5F5, oven: 0x4B5563, washerDryer: 0xF0F9FF,
    fireplace: 0x7C2D12, stairs: 0x92400E
  };
  const baseColor = COL_MAP[cat] || 0x9ca3af;

  if (cat === 'television') {
    // Screen on a stand
    const screen = new THREE.Mesh(
      new THREE.BoxGeometry(w, 24, 3),
      new THREE.MeshLambertMaterial({ color: 0x0f172a }));
    screen.position.y = 28;
    g.add(screen);
    const stand = new THREE.Mesh(
      new THREE.BoxGeometry(w*0.5, 6, d*0.8),
      new THREE.MeshLambertMaterial({ color: 0x334155 }));
    stand.position.y = 3;
    g.add(stand);
  } else if (cat === 'sofa' || cat === 'chair') {
    // Seat + back + arms
    const seatH = cat === 'sofa' ? 16 : 18;
    const seat = new THREE.Mesh(
      new THREE.BoxGeometry(w, seatH, d),
      new THREE.MeshLambertMaterial({ color: baseColor }));
    seat.position.y = seatH/2;
    g.add(seat);
    const back = new THREE.Mesh(
      new THREE.BoxGeometry(w, 20, d*0.3),
      new THREE.MeshLambertMaterial({ color: baseColor }));
    back.position.set(0, seatH + 10, -d*0.35);
    g.add(back);
  } else if (cat === 'bed') {
    // Mattress + headboard
    const mattress = new THREE.Mesh(
      new THREE.BoxGeometry(w, 14, d),
      new THREE.MeshLambertMaterial({ color: 0xFEF3C7 }));
    mattress.position.y = 7 + 4;
    g.add(mattress);
    const frame = new THREE.Mesh(
      new THREE.BoxGeometry(w + 2, 4, d + 2),
      new THREE.MeshLambertMaterial({ color: 0x78350F }));
    frame.position.y = 4;
    g.add(frame);
    const headboard = new THREE.Mesh(
      new THREE.BoxGeometry(w + 2, 26, 3),
      new THREE.MeshLambertMaterial({ color: 0x78350F }));
    headboard.position.set(0, 17, -d/2 - 1.5);
    g.add(headboard);
  } else if (cat === 'table') {
    // Top + 4 legs
    const top = new THREE.Mesh(
      new THREE.BoxGeometry(w, 3, d),
      new THREE.MeshLambertMaterial({ color: baseColor }));
    top.position.y = 28;
    g.add(top);
    const legMat = new THREE.MeshLambertMaterial({ color: 0x78543c });
    [[-1,-1],[1,-1],[-1,1],[1,1]].forEach(([sx, sz]) => {
      const leg = new THREE.Mesh(new THREE.BoxGeometry(2, 26, 2), legMat);
      leg.position.set(sx * (w/2 - 2), 13, sz * (d/2 - 2));
      g.add(leg);
    });
  } else if (cat === 'refrigerator') {
    const body = new THREE.Mesh(
      new THREE.BoxGeometry(w, 72, d),
      new THREE.MeshLambertMaterial({ color: baseColor }));
    body.position.y = 36;
    g.add(body);
    // Handle line
    const handle = new THREE.Mesh(
      new THREE.BoxGeometry(1.5, 30, 1.5),
      new THREE.MeshLambertMaterial({ color: 0x9ca3af }));
    handle.position.set(w/2 - 2, 36, d/2 + 0.5);
    g.add(handle);
  } else if (cat === 'stove' || cat === 'oven') {
    const body = new THREE.Mesh(
      new THREE.BoxGeometry(w, 36, d),
      new THREE.MeshLambertMaterial({ color: baseColor }));
    body.position.y = 18;
    g.add(body);
    // Top burner plate
    const top = new THREE.Mesh(
      new THREE.BoxGeometry(w, 1, d),
      new THREE.MeshLambertMaterial({ color: 0x0f172a }));
    top.position.y = 36;
    g.add(top);
  } else if (cat === 'toilet') {
    const bowl = new THREE.Mesh(
      new THREE.CylinderGeometry(w*0.35, w*0.4, 16, 16),
      new THREE.MeshLambertMaterial({ color: 0xFFFFFF }));
    bowl.position.y = 8;
    g.add(bowl);
    const tank = new THREE.Mesh(
      new THREE.BoxGeometry(w*0.7, 16, d*0.3),
      new THREE.MeshLambertMaterial({ color: 0xFFFFFF }));
    tank.position.set(0, 24, -d*0.3);
    g.add(tank);
  } else if (cat === 'bathtub') {
    const tub = new THREE.Mesh(
      new THREE.BoxGeometry(w, 18, d),
      new THREE.MeshLambertMaterial({ color: 0xF0F8FF }));
    tub.position.y = 9;
    g.add(tub);
    // Inner basin (darker to suggest depth)
    const basin = new THREE.Mesh(
      new THREE.BoxGeometry(w - 4, 2, d - 4),
      new THREE.MeshLambertMaterial({ color: 0x94A3B8 }));
    basin.position.y = 17;
    g.add(basin);
  } else if (cat === 'sink') {
    const base = new THREE.Mesh(
      new THREE.BoxGeometry(w, 3, d),
      new THREE.MeshLambertMaterial({ color: 0xE5E7EB }));
    base.position.y = 32;
    g.add(base);
    const bowl = new THREE.Mesh(
      new THREE.BoxGeometry(w - 4, 6, d - 4),
      new THREE.MeshLambertMaterial({ color: 0xBAE6FD }));
    bowl.position.y = 28;
    g.add(bowl);
  } else if (cat === 'stairs') {
    // Stepped geometry (simplified)
    for (let i = 0; i < 5; i++) {
      const step = new THREE.Mesh(
        new THREE.BoxGeometry(w, 6, d / 5 * (5 - i)),
        new THREE.MeshLambertMaterial({ color: 0x92400E }));
      step.position.set(0, 3 + i * 6, d/2 - (d / 5 * (5 - i))/2);
      g.add(step);
    }
  } else if (cat === 'fireplace') {
    const hearth = new THREE.Mesh(
      new THREE.BoxGeometry(w, 6, d),
      new THREE.MeshLambertMaterial({ color: 0x6B7280 }));
    hearth.position.y = 3;
    g.add(hearth);
    const opening = new THREE.Mesh(
      new THREE.BoxGeometry(w*0.7, 30, d*0.7),
      new THREE.MeshLambertMaterial({ color: 0x1F2937 }));
    opening.position.y = 22;
    g.add(opening);
    const mantel = new THREE.Mesh(
      new THREE.BoxGeometry(w + 2, 4, d*0.3),
      new THREE.MeshLambertMaterial({ color: 0x78543c }));
    mantel.position.y = 42;
    g.add(mantel);
  } else {
    // Storage / unknown: box with handle
    const h = getObjectHeight(o);
    const body = new THREE.Mesh(
      new THREE.BoxGeometry(w, h, d),
      new THREE.MeshLambertMaterial({ color: baseColor }));
    body.position.y = h/2;
    g.add(body);
  }

  // Add text label floating above (always visible, upright)
  if (o.label) {
    try {
      const canvas = document.createElement('canvas');
      canvas.width = 256; canvas.height = 64;
      const cctx = canvas.getContext('2d');
      cctx.fillStyle = 'rgba(255,255,255,0.9)';
      cctx.fillRect(0, 0, 256, 64);
      cctx.strokeStyle = '#1f2937';
      cctx.lineWidth = 2;
      cctx.strokeRect(1, 1, 254, 62);
      cctx.fillStyle = '#1f2937';
      cctx.font = 'bold 28px "Source Sans Pro", system-ui';
      cctx.textAlign = 'center';
      cctx.textBaseline = 'middle';
      cctx.fillText(o.label, 128, 32);
      const tex = new THREE.CanvasTexture(canvas);
      const mat = new THREE.SpriteMaterial({ map: tex, transparent: true });
      const sprite = new THREE.Sprite(mat);
      sprite.scale.set(30, 8, 1);
      sprite.position.y = getObjectHeight(o) + 8;
      g.add(sprite);
    } catch (e) { /* ignore label errors */ }
  }

  return g;
}

function getObjectHeight(o) {
  const h = { television:15, sofa:36, chair:36, table:30, storage:72, bed:18, stove:36, refrigerator:72, toilet:16, bathtub:18, dishwasher:34, oven:34, sink:34, washer:38, fireplace:48 };
  return h[(o.category || '').toLowerCase()] || 30;
}
function getObjectColor(o) {
  const c = { television:0x1f2937, sofa:0xa78160, chair:0x78543c, table:0xa78160, storage:0x6b7280, bed:0xd4c4a8, stove:0xe5e7eb, refrigerator:0xf5f5f5, toilet:0xffffff, bathtub:0xf0f8ff, sink:0xe5e7eb, dishwasher:0xf5f5f5, oven:0x4b5563, washer:0xf0f9ff, fireplace:0x7c2d12 };
  return c[(o.category || '').toLowerCase()] || 0x9ca3af;
}
function updateThreeDCamera() {
  if (!threeState.camera || !state.data) return;
  const d = state.data;
  const cx = d.canvas_width/2, cz = d.canvas_height/2;
  const dMax = Math.max(d.canvas_width, d.canvas_height) * 1.2;
  const tilt = degToRad(state.threeDView.tilt), rot = degToRad(state.threeDView.rotate);
  threeState.camera.position.set(
    cx + dMax * Math.cos(tilt) * Math.sin(rot),
    dMax * Math.sin(tilt),
    cz + dMax * Math.cos(tilt) * Math.cos(rot)
  );
  threeState.camera.lookAt(cx, 0, cz);
}
function startThreeDLoop() {
  function loop() {
    if (!state.threeD) return;
    threeState.renderer.render(threeState.scene, threeState.camera);
    threeState.rafId = requestAnimationFrame(loop);
  }
  if (!threeState.rafId) loop();
}

// ---------- UI updates ----------

    return {
      threeState: threeState,
      initOrUpdate: function () { beforeRebuild(); initOrUpdateThreeD(); },
      rebuild: function () { beforeRebuild(); rebuildThreeDScene(); },
      updateCamera: updateThreeDCamera,
      startLoop: startThreeDLoop,
      resize: function (w, h) {
        if (!threeState.renderer) return;
        threeState.renderer.setSize(w, h, false);
        threeState.camera.aspect = w / h;
        threeState.camera.updateProjectionMatrix();
      },
      stop: function () {
        if (threeState.rafId) { cancelAnimationFrame(threeState.rafId); threeState.rafId = null; }
      }
    };
  }

  root.FP3D = { create: create };
})(typeof window !== 'undefined' ? window : this);
