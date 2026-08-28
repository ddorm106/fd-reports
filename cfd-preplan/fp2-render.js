/* fp2-render.js — everything that puts pixels on the floor-plan canvas.
 *
 * The wall/door/window/object drawing in the middle of this file is LIFTED
 * VERBATIM from page11 v4. That is deliberate: those routines are what make the
 * editor, the PDF the IC carries, and the iOS app draw the same building the
 * same way. Rewriting them would have been a cosmetic change nobody asked for
 * and a chance to make three renderers disagree.
 *
 * What is new here: the tracing underlay, zones with live areas, dimension
 * strings, snap/alignment feedback, the derived legend, and the sheet furniture
 * (north arrow + scale bar).
 *
 * The lifted code reads `state.data.walls` etc. So before each frame we build a
 * VIEW MODEL: the active floor, with wall-hosted doors and windows already
 * resolved to x/y/angle. The old code then needs no edits at all.
 */
(function (root) {
  'use strict';
  var G = root.FPGeom;

  var COL = {
    bg: '#F5F3EF', wall: '#2D2D2D', doorLeaf: '#1E1E1E', doorArc: '#555',
    window: '#C8E0F0', windowEdge: '#5A8CA8', selection: '#2563eb',
    /* The drawing code reads windowLine/windowGap — which this palette never
     * defined, so the canvas silently kept the previous style and windows
     * drew in wall-black. Blue, by request: glass reads as glass. */
    windowLine: '#2563eb', windowGap: '#DCEBFA',
    symbolRing: '#2563eb', text: '#475569', measure: '#eab308',
    freehand: '#0f172a', dim: '#64748b', guide: '#e11d48',
    zoneStroke: '#1d4ed8', gridLine: '#dfe5ea'
  };

  function degToRad(d) { return d * Math.PI / 180; }
  function radToDeg(r) { return r * 180 / Math.PI; }
  function dist(x1, y1, x2, y2) { return Math.hypot(x2 - x1, y2 - y1); }
  function pointToSeg(px, py, x1, y1, x2, y2) { return G.pointToSeg(px, py, x1, y1, x2, y2); }

  /* Create a renderer bound to a canvas and a shared view state.
   *
   * state: { view:{zoom,panX,panY,rotation,width,height}, dpr, selected,
   *          drawing, hover, snap, guides, visibleLayers }
   * getDoc(): the FPModel.Doc currently being edited. */
  function createRenderer(opts) {
    var canvas = opts.canvas;
    var ctx = canvas.getContext('2d');
    var getDoc = opts.getDoc;
    var SYMBOLS = opts.symbols;
    var state = opts.state;

    /* The view model the lifted drawing code reads. Rebuilt every frame. */
    state.data = null;

    var underlayImages = {};   // floor id -> HTMLImageElement, cached per src

    function activeFloor() {
      var doc = getDoc();
      return doc ? doc.floor() : null;
    }

    /* Resolve wall-hosted openings into plain x/y/angle/width so the lifted
     * renderers can stay exactly as they were. */
    function buildViewModel() {
      var doc = getDoc();
      if (!doc) { state.data = null; return null; }
      var f = doc.floor();
      var byId = doc.wallsById();
      function resolve(list, fallbackWidth) {
        return (list || []).map(function (op) {
          var r = G.resolveOpening(op, byId);
          if (!r) return op;
          var out = Object.assign({}, op);
          out.x = r.x; out.y = r.y;
          out.angle = r.angle;
          out.width = r.width || fallbackWidth;
          out._hosted = r.hosted;
          return out;
        });
      }
      var vm = {
        canvas_width: doc.data.canvas_width,
        canvas_height: doc.data.canvas_height,
        scale_px_per_ft: doc.data.scale_px_per_ft,
        walls: f.walls || [],
        doors: resolve(f.doors, 32),
        windows: resolve(f.windows, 40),
        objects: f.objects || [],
        symbols: f.symbols || [],
        texts: f.texts || [],
        measurements: f.measurements || [],
        freehand: f.freehand || [],
        zones: f.zones || [],
        sides: f.sides || [],
        underlay: f.underlay || null
      };
      state.data = vm;
      return vm;
    }

    function selEq(k, i) { return state.selected && state.selected.kind === k && state.selected.index === i; }

    /* ---------------------------------------------------------- transforms */

    function resizeCanvas(wrapEl) {
      var rect = wrapEl.getBoundingClientRect();
      state.view.width = rect.width;
      state.view.height = rect.height;
      canvas.width = Math.floor(rect.width * state.dpr);
      canvas.height = Math.floor(rect.height * state.dpr);
      canvas.style.width = rect.width + 'px';
      canvas.style.height = rect.height + 'px';
    }

    function dataToScreen(x, y) {
      var d = state.data;
      var cw = (d && d.canvas_width) || state.view.width;
      var ch = (d && d.canvas_height) || state.view.height;
      var cx = cw / 2, cy = ch / 2;
      var r = degToRad(state.view.rotation);
      var dx = x - cx, dy = y - cy;
      var rx = dx * Math.cos(r) - dy * Math.sin(r);
      var ry = dx * Math.sin(r) + dy * Math.cos(r);
      return { sx: (rx + cx) * state.view.zoom + state.view.panX,
               sy: (ry + cy) * state.view.zoom + state.view.panY };
    }

    function screenToData(sx, sy) {
      var d = state.data;
      var cw = (d && d.canvas_width) || state.view.width;
      var ch = (d && d.canvas_height) || state.view.height;
      var cx = cw / 2, cy = ch / 2;
      var r = -degToRad(state.view.rotation);
      var dx = (sx - state.view.panX) / state.view.zoom - cx;
      var dy = (sy - state.view.panY) / state.view.zoom - cy;
      var rx = dx * Math.cos(r) - dy * Math.sin(r);
      var ry = dx * Math.sin(r) + dy * Math.cos(r);
      return { x: rx + cx, y: ry + cy };
    }

    /* Fit the DRAWING, not the nominal canvas. A scan padded into a 4,000 px
     * canvas would otherwise open zoomed out to a speck in the middle. */
    function contentBounds() {
      var d = state.data;
      if (!d) return null;
      var pts = [];
      (d.walls || []).forEach(function (w) { pts.push({ x: w.x1, y: w.y1 }, { x: w.x2, y: w.y2 }); });
      ['doors', 'windows', 'objects', 'symbols', 'texts'].forEach(function (k) {
        (d[k] || []).forEach(function (e) { if (typeof e.x === 'number') pts.push({ x: e.x, y: e.y }); });
      });
      (d.zones || []).forEach(function (z) { (z.poly || []).forEach(function (p) { pts.push(p); }); });
      /* Side labels are drawn OUTSIDE the walls, in plan units, so their box
       * has to be part of the fit or A/B/C/D hang off the edges. */
      (d.sides || []).forEach(function (sd) {
        if (typeof sd.x !== 'number') return;
        pts.push({ x: sd.x - 36, y: sd.y - 14 });
        pts.push({ x: sd.x + 36, y: sd.y + 14 });
      });
      if (d.underlay) {
        pts.push({ x: d.underlay.x, y: d.underlay.y });
        pts.push({ x: d.underlay.x + d.underlay.w, y: d.underlay.y + d.underlay.h });
      }
      if (pts.length < 2) return null;
      return G.bbox(pts);
    }

    /* How much screen the legend will occupy, so fitToView can keep clear of it. */
    function legendInset() {
      var doc = getDoc();
      if (!doc) return 0;
      if (state.visibleLayers && state.visibleLayers.legend === false) return 0;
      if (doc.data.legend && doc.data.legend.show === false) return 0;
      var rows = doc.buildLegend(SYMBOLS.byId);
      if (!rows.length) return 0;
      /* Capped: on a narrow canvas a fixed 232px inset squeezed the drawing
       * into a third of the width and left the rest empty. */
      return Math.min(10 + 208 + 14, state.view.width * 0.24);
    }

    function fitToView() {
      var d = state.data || buildViewModel();
      if (!d) return;
      var pad = 46;
      var padLeft = pad + legendInset();
      var b = contentBounds();
      var minX, minY, w, h;
      if (b && (b.maxX - b.minX) > 4 && (b.maxY - b.minY) > 4) {
        minX = b.minX; minY = b.minY;
        w = b.maxX - b.minX; h = b.maxY - b.minY;
      } else {
        minX = 0; minY = 0; w = d.canvas_width; h = d.canvas_height;
      }
      /* Rotation is applied about the canvas centre, so a rotated drawing needs
       * the fit computed on its rotated extent or it clips at 90 degrees. */
      var r = degToRad(state.view.rotation);
      var cw = d.canvas_width, ch = d.canvas_height;
      var cx = cw / 2, cy = ch / 2;
      var corners = [{ x: minX, y: minY }, { x: minX + w, y: minY },
                     { x: minX + w, y: minY + h }, { x: minX, y: minY + h }];
      var rx = [], ry = [];
      corners.forEach(function (p) {
        var dx = p.x - cx, dy = p.y - cy;
        rx.push(dx * Math.cos(r) - dy * Math.sin(r) + cx);
        ry.push(dx * Math.sin(r) + dy * Math.cos(r) + cy);
      });
      var bx0 = Math.min.apply(null, rx), bx1 = Math.max.apply(null, rx);
      var by0 = Math.min.apply(null, ry), by1 = Math.max.apply(null, ry);
      var rw = Math.max(bx1 - bx0, 1), rh = Math.max(by1 - by0, 1);
      /* Asymmetric: the left inset is whatever the legend is covering. On a
       * narrow screen the legend would eat the whole canvas, so it is capped. */
      var usableW = state.view.width - padLeft - pad;
      if (usableW < state.view.width * 0.45) { padLeft = pad; usableW = state.view.width - pad * 2; }
      var zx = usableW / rw;
      var zy = (state.view.height - pad * 2) / rh;
      state.view.zoom = Math.max(0.02, Math.min(zx, zy, 2.5));
      state.view.panX = padLeft + (usableW - rw * state.view.zoom) / 2 - bx0 * state.view.zoom;
      state.view.panY = (state.view.height - rh * state.view.zoom) / 2 - by0 * state.view.zoom;
      draw();
    }

    function zoomAt(sx, sy, factor) {
      var before = screenToData(sx, sy);
      state.view.zoom = Math.max(0.02, Math.min(12, state.view.zoom * factor));
      var after = screenToData(sx, sy);
      /* Keep the point under the cursor fixed. Compare in screen space after
       * the zoom so rotation is accounted for. */
      var p1 = dataToScreen(before.x, before.y);
      state.view.panX += sx - p1.sx;
      state.view.panY += sy - p1.sy;
      draw();
    }

    /* ============================================================
     * LIFTED VERBATIM from page11 v4 — see the note at the top.
     * Reads state.data (the view model) and state.view. Do not
     * 'modernise' these: the PDF renderer in page12 and the iOS app
     * draw the same shapes, and all three must agree.
     * ============================================================ */
function drawWallsAsPolygons(walls) {
  const WALL_HALF = 3;   // wall is 6 px thick (scale_px_per_ft=12, ~6 inches)
  ctx.fillStyle = COL.wall;
  walls.forEach(w => {
    const dx = w.x2 - w.x1, dy = w.y2 - w.y1;
    const len = Math.hypot(dx, dy);
    if (len < 0.01) return;
    const nx = -dy / len * WALL_HALF, ny = dx / len * WALL_HALF;
    ctx.beginPath();
    ctx.moveTo(w.x1 + nx, w.y1 + ny);
    ctx.lineTo(w.x2 + nx, w.y2 + ny);
    ctx.lineTo(w.x2 - nx, w.y2 - ny);
    ctx.lineTo(w.x1 - nx, w.y1 - ny);
    ctx.closePath();
    ctx.fill();
  });
}
function drawWallHighlight(w) {
  const WALL_HALF = 5;
  const dx = w.x2 - w.x1, dy = w.y2 - w.y1;
  const len = Math.hypot(dx, dy); if (len < 0.01) return;
  const nx = -dy / len * WALL_HALF, ny = dx / len * WALL_HALF;
  ctx.strokeStyle = COL.selection;
  ctx.lineWidth = 3 / state.view.zoom;
  ctx.beginPath();
  ctx.moveTo(w.x1 + nx, w.y1 + ny);
  ctx.lineTo(w.x2 + nx, w.y2 + ny);
  ctx.lineTo(w.x2 - nx, w.y2 - ny);
  ctx.lineTo(w.x1 - nx, w.y1 - ny);
  ctx.closePath();
  ctx.stroke();
}

// Door gap — cleared white quad in wall (matches iOS). Runs BEFORE door symbol
function findNearestWallAngle(x, y){
  const W = (state.data && state.data.walls) || [];
  let bestAngle = 0, bestDist = Infinity;
  for (const wall of W) {
    const wx = wall.x2 - wall.x1, wy = wall.y2 - wall.y1;
    const wl = Math.hypot(wx, wy); if (wl <= 0) continue;
    const t = Math.max(0, Math.min(1, ((x - wall.x1)*wx + (y - wall.y1)*wy) / (wl*wl)));
    const px = wall.x1 + t*wx, py = wall.y1 + t*wy;
    const dd = Math.hypot(x - px, y - py);
    if (dd < bestDist) { bestDist = dd; bestAngle = Math.atan2(wy, wx); }
  }
  return bestAngle;
}
function drawDoorGap(d, sel) {
  const cx = d.x, cy = d.y;
  const w = d.width || 30;
  const a = d.angle ? degToRad(d.angle) : findNearestWallAngle(d.x, d.y);
  const cosA = Math.cos(a), sinA = Math.sin(a);
  const half = w / 2;
  const WALL_HALF = 4;
  const nx = -sinA * WALL_HALF, ny = cosA * WALL_HALF;
  const p1x = cx - half*cosA, p1y = cy - half*sinA;
  const p2x = cx + half*cosA, p2y = cy + half*sinA;
  ctx.fillStyle = COL.bg;  // cream — matches iOS background
  ctx.beginPath();
  ctx.moveTo(p1x + nx, p1y + ny);
  ctx.lineTo(p2x + nx, p2y + ny);
  ctx.lineTo(p2x - nx, p2y - ny);
  ctx.lineTo(p1x - nx, p1y - ny);
  ctx.closePath();
  ctx.fill();
}
function drawDoorSymbol(d, sel) {
  const cx = d.x, cy = d.y;
  const w = d.width || 30;
  const a = d.angle ? degToRad(d.angle) : findNearestWallAngle(d.x, d.y);
  const cosA = Math.cos(a), sinA = Math.sin(a);
  ctx.save();
  if (d.type === 'entryway' || d.type === 'opening') {
    // An open doorway with no leaf — a cased opening, an arch, the gap
    // between a sales floor and a vestibule. drawDoorGap has already cut the
    // wall, so there is nothing more to draw. Showing a swing panel here
    // would put a door on the plan that isn't there.
    if (sel) {
      ctx.strokeStyle = COL.selection;
      ctx.lineWidth = 2 / state.view.zoom;
      ctx.beginPath(); ctx.arc(cx, cy, w/2 + 4/state.view.zoom, 0, Math.PI*2); ctx.stroke();
    }
    ctx.restore();
    return;
  }
  if (d.type === 'rollup') {
    ctx.strokeStyle = COL.doorRoll;
    ctx.lineWidth = 2.5 / state.view.zoom;
    ctx.setLineDash([6/state.view.zoom, 3/state.view.zoom]);
    ctx.beginPath();
    ctx.moveTo(cx - w/2*cosA, cy - w/2*sinA);
    ctx.lineTo(cx + w/2*cosA, cy + w/2*sinA);
    ctx.stroke();
    ctx.setLineDash([]);
  } else if (d.type === 'double') {
    // Two panels meeting in middle. Both leaves mirror together when the swing
    // is flipped — a double that opens the other way opens BOTH ways.
    const dblSign = (d.swing === -1) ? -1 : 1;
    const swingA = a + dblSign * Math.PI/2;
    // Left panel — hinge at left end (cx-dx,cy-dy), swings to center
    ctx.strokeStyle = COL.doorLeaf;
    ctx.lineWidth = 1.8 / state.view.zoom;
    const hL_x = cx - w/2*cosA, hL_y = cy - w/2*sinA;
    const hR_x = cx + w/2*cosA, hR_y = cy + w/2*sinA;
    const pL_x = hL_x + (w/2)*Math.cos(swingA);
    const pL_y = hL_y + (w/2)*Math.sin(swingA);
    const pR_x = hR_x + (w/2)*Math.cos(swingA + Math.PI);
    const pR_y = hR_y + (w/2)*Math.sin(swingA + Math.PI);
    ctx.beginPath(); ctx.moveTo(hL_x, hL_y); ctx.lineTo(pL_x, pL_y); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(hR_x, hR_y); ctx.lineTo(pR_x, pR_y); ctx.stroke();
    // Dashed arcs
    ctx.strokeStyle = COL.doorArc;
    ctx.lineWidth = 0.9 / state.view.zoom;
    ctx.setLineDash([4/state.view.zoom, 2/state.view.zoom]);
    ctx.beginPath(); ctx.arc(hL_x, hL_y, w/2, a, a + dblSign * Math.PI/2, dblSign < 0); ctx.stroke();
    ctx.beginPath(); ctx.arc(hR_x, hR_y, w/2, a + Math.PI, a + Math.PI + dblSign * Math.PI/2, dblSign < 0); ctx.stroke();
    ctx.setLineDash([]);
    // Hinge dots
    ctx.fillStyle = COL.doorLeaf;
    ctx.beginPath(); ctx.arc(hL_x, hL_y, 2/state.view.zoom, 0, Math.PI*2); ctx.fill();
    ctx.beginPath(); ctx.arc(hR_x, hR_y, 2/state.view.zoom, 0, Math.PI*2); ctx.fill();
  } else {
    // Single door — hinge at chosen end, swings to chosen side (left/right)
    const atEnd = (d.hinge === 'end');
    const hx = cx + (atEnd ? 1 : -1) * w/2 * cosA, hy = cy + (atEnd ? 1 : -1) * w/2 * sinA;
    const closedDir = atEnd ? (a + Math.PI) : a;
    const swingSign = (d.swing === -1) ? -1 : 1;
    /* Hinge and swing have to be INDEPENDENT. Rotating by a fixed +90 from the
     * closed direction meant moving the hinge to the other jamb also threw the
     * door to the other side of the wall, so the two buttons fought each other.
     * Measuring from a reversed closed direction needs a reversed sweep to land
     * on the same side. */
    const effSign = (atEnd ? -1 : 1) * swingSign;
    const swingA = closedDir + effSign * Math.PI/2;
    const px_ = hx + w*Math.cos(swingA);
    const py_ = hy + w*Math.sin(swingA);
    // Panel
    ctx.strokeStyle = COL.doorLeaf;
    ctx.lineWidth = 1.8 / state.view.zoom;
    ctx.beginPath(); ctx.moveTo(hx, hy); ctx.lineTo(px_, py_); ctx.stroke();
    // Arc
    ctx.strokeStyle = COL.doorArc;
    ctx.lineWidth = 0.9 / state.view.zoom;
    ctx.setLineDash([4/state.view.zoom, 2/state.view.zoom]);
    ctx.beginPath();
    ctx.arc(hx, hy, w, closedDir, swingA, effSign < 0);
    ctx.stroke();
    ctx.setLineDash([]);
    // Hinge dot
    ctx.fillStyle = COL.doorLeaf;
    ctx.beginPath(); ctx.arc(hx, hy, 2/state.view.zoom, 0, Math.PI*2); ctx.fill();
  }
  // Selection ring
  if (sel) {
    ctx.strokeStyle = COL.selection;
    ctx.lineWidth = 2 / state.view.zoom;
    ctx.beginPath(); ctx.arc(cx, cy, w/2 + 4/state.view.zoom, 0, Math.PI*2); ctx.stroke();
  }
  ctx.restore();
}

// Window: light-blue cleared gap + 3 parallel lines (iOS style)
function drawWindowGap(w, sel) {
  const cx = w.x, cy = w.y;
  const width = w.width || 30;
  const a = w.angle ? degToRad(w.angle) : findNearestWallAngle(w.x, w.y);
  const cosA = Math.cos(a), sinA = Math.sin(a);
  const half = width/2;
  const WALL_HALF = 4;
  const nx = -sinA * WALL_HALF, ny = cosA * WALL_HALF;
  const p1x = cx - half*cosA, p1y = cy - half*sinA;
  const p2x = cx + half*cosA, p2y = cy + half*sinA;
  ctx.fillStyle = COL.windowGap;
  ctx.beginPath();
  ctx.moveTo(p1x + nx, p1y + ny);
  ctx.lineTo(p2x + nx, p2y + ny);
  ctx.lineTo(p2x - nx, p2y - ny);
  ctx.lineTo(p1x - nx, p1y - ny);
  ctx.closePath();
  ctx.fill();
}
function drawWindowSymbol(w, sel) {
  const cx = w.x, cy = w.y;
  const width = w.width || 30;
  const a = w.angle ? degToRad(w.angle) : findNearestWallAngle(w.x, w.y);
  const cosA = Math.cos(a), sinA = Math.sin(a);
  const half = width/2;
  const p1x = cx - half*cosA, p1y = cy - half*sinA;
  const p2x = cx + half*cosA, p2y = cy + half*sinA;
  const offs = [-2.4, 0, 2.4];
  ctx.strokeStyle = COL.windowLine;
  offs.forEach(off => {
    const lw = off === 0 ? 1.5/state.view.zoom : 0.75/state.view.zoom;
    ctx.lineWidth = lw;
    ctx.beginPath();
    ctx.moveTo(p1x + (-sinA*off), p1y + (cosA*off));
    ctx.lineTo(p2x + (-sinA*off), p2y + (cosA*off));
    ctx.stroke();
  });
  if (sel) {
    ctx.strokeStyle = COL.selection;
    ctx.lineWidth = 2 / state.view.zoom;
    ctx.beginPath(); ctx.arc(cx, cy, width/2 + 4/state.view.zoom, 0, Math.PI*2); ctx.stroke();
  }
}

// Object catalog mirrored from the DivisionScan app (category -> color + glyph).
// Glyphs prefixed with '@' are custom canvas drawings; others are emoji.
var OC = { fur:'#8C6638', app:'#66737F', plu:'#2E80CC', com:'#218C8C', saf:'#CC3833',
  ele:'#E69E1A', ind:'#59616B', mec:'#4D809E', uti:'#8C7326', obs:'#80808C',
  note:'#263361', exg:'#268C47', veh:'#4D5973', site:'#408C4D', eng:'#EBB81A' };
var OBJ_CAT = {
  chair:{c:OC.fur,g:'🪑'}, office_chair:{c:OC.fur,g:'🪑'}, stool:{c:OC.fur,g:'🪑'},
  booth:{c:OC.fur,g:'🛋'}, sofa:{c:OC.fur,g:'🛋'}, bed:{c:OC.fur,g:'🛏'},
  table:{c:OC.fur,g:''}, round_table:{c:OC.fur,g:''}, desk:{c:OC.fur,g:'💻'}, storage:{c:OC.fur,g:''},
  stove:{c:OC.app,g:'@range'}, oven:{c:OC.app,g:''}, refrigerator:{c:OC.app,g:'🧊'},
  dishwasher:{c:OC.app,g:''}, sink:{c:OC.plu,g:'@sink'}, prep_table:{c:OC.com,g:''},
  counter:{c:OC.com,g:''}, hood:{c:OC.app,g:'🌀'}, walk_in:{c:OC.plu,g:'❄️'}, freezer_case:{c:OC.plu,g:'❄️'},
  toilet:{c:OC.plu,g:'@toilet'}, urinal:{c:OC.plu,g:'@toilet'}, lavatory:{c:OC.plu,g:'@sink'},
  bathtub:{c:OC.plu,g:'🛁'}, shower:{c:OC.plu,g:'🚿'},
  shelving:{c:OC.com,g:''}, display_case:{c:OC.com,g:''}, checkout:{c:OC.com,g:'🛒'},
  vending:{c:OC.app,g:'🥤'}, television:{c:OC.app,g:'📺'}, washerDryer:{c:OC.app,g:''},
  panel:{c:OC.ele,g:'@panel'}, alarm_panel:{c:OC.saf,g:'@panel'}, water_heater:{c:OC.app,g:'🛢'},
  fdc:{c:OC.saf,g:'@fdc'}, hydrant:{c:OC.saf,g:'@hydrant'}, fire_ext:{c:OC.saf,g:'🧯'},
  knox_box:{c:OC.ele,g:'@panel'}, stairs:{c:OC.app,g:'@stairs'}, elevator:{c:OC.app,g:'🛗'},
  fireplace:{c:OC.saf,g:'🔥'}, text:{c:OC.note,g:''},
  machine:{c:OC.ind,g:'⚙️'}, conveyor:{c:OC.ind,g:'↔'}, compressor:{c:OC.ind,g:'💨'},
  generator:{c:OC.ind,g:'⚡'}, transformer:{c:OC.ele,g:'⚡'}, boiler:{c:OC.ind,g:'🔥'},
  pump:{c:OC.ind,g:'💧'}, storage_tank:{c:OC.ind,g:'🛢'}, pallet:{c:OC.ind,g:'📦'}, hazmat:{c:OC.saf,g:'@nfpa'},
  hvac:{c:OC.mec,g:'❄️'}, ac_return:{c:OC.mec,g:'❄️'}, ac_outdoor:{c:OC.mec,g:'❄️'},
  air_handler:{c:OC.mec,g:'❄️'}, furnace:{c:OC.mec,g:'🔥'}, chiller:{c:OC.mec,g:'❄️'},
  condenser:{c:OC.mec,g:'❄️'}, duct:{c:OC.mec,g:''}, exhaust_fan:{c:OC.mec,g:'🌀'},
  vehicle_lift:{c:OC.ind,g:'🚗'}, workbench:{c:OC.ind,g:'🔧'}, tool_cabinet:{c:OC.ind,g:'🧰'},
  welding:{c:OC.saf,g:'🔥'}, parts_rack:{c:OC.ind,g:''}, tire_rack:{c:OC.ind,g:'⭕'},
  water_shutoff:{c:OC.plu,g:'🛑'}, gas_shutoff:{c:OC.uti,g:'🛑'}, gas_meter:{c:OC.uti,g:''},
  water_meter:{c:OC.plu,g:''}, main_disconnect:{c:OC.ele,g:'⚡'}, sprinkler_riser:{c:OC.saf,g:'💧'},
  standpipe:{c:OC.saf,g:'💧'}, floor_drain:{c:OC.plu,g:''},
  gen_shutoff:{c:OC.ele,g:'🛑'}, fuel_shutoff:{c:OC.uti,g:'🛑'}, co2:{c:OC.saf,g:''}, propane:{c:OC.uti,g:'🔥'},
  hazmat_cabinet:{c:OC.saf,g:'@nfpa'}, nfpa704:{c:OC.saf,g:'@nfpa'},
  fire_door:{c:OC.saf,g:''}, bifold_door:{c:OC.app,g:''}, apparatus_door:{c:OC.app,g:''},
  roof_access:{c:OC.ele,g:''}, attic_access:{c:OC.ele,g:''},
  exit_sign:{c:OC.exg,g:'🚪'}, no_access:{c:OC.saf,g:'🚫'}, ada:{c:OC.plu,g:'♿'},
  vehicle:{c:OC.veh,g:'🚗'}, box_truck:{c:OC.veh,g:'🚚'}, fire_apparatus:{c:OC.saf,g:'🚒'},
  ambulance:{c:OC.saf,g:'🚑'}, police:{c:OC.veh,g:'🚓'}, bus:{c:OC.veh,g:'🚌'},
  parking:{c:OC.obs,g:'🅿'}, ada_parking:{c:OC.plu,g:'♿'}, ada_ramp:{c:OC.plu,g:'♿'},
  tree:{c:OC.site,g:'🌳'}, shrub:{c:OC.site,g:'🌿'},
  solar_panel:{c:OC.eng,g:'☀'}, solar_battery:{c:OC.eng,g:'🔋'},
  computer:{c:OC.app,g:'💻'}, countertop:{c:OC.com,g:''}, checkout_counter:{c:OC.com,g:'🛒'},
  column:{c:OC.obs,g:''}, round_column:{c:OC.obs,g:''}, beam:{c:OC.obs,g:''},
  partition:{c:OC.obs,g:''}, planter:{c:OC.site,g:'🪴'}, bollard:{c:OC.obs,g:''}, railing:{c:OC.obs,g:''}
};
function hexA(hex, a){ var n = parseInt(hex.slice(1),16); return 'rgba('+((n>>16)&255)+','+((n>>8)&255)+','+(n&255)+','+a+')'; }

// Map object categories to page 11's built-in vector symbol art (clean line
// drawings, like the app) instead of emoji. Unmapped categories fall back to
// the glyph/emoji path below.
var OBJ_SYM = {
  chair:'chair', office_chair:'chair', stool:'chair', booth:'sofa', sofa:'sofa', bed:'bed',
  table:'table', round_table:'table', desk:'desk', counter:'counter', countertop:'counter',
  prep_table:'counter', storage:'storage', shelving:'bookshelf', parts_rack:'bookshelf',
  display_case:'counter', stove:'stove', oven:'stove', refrigerator:'fridge', dishwasher:'dw',
  sink:'sink', lavatory:'sink', walk_in:'cooler', freezer_case:'freezer',
  toilet:'toilet', urinal:'toilet', bathtub:'tub', shower:'shower',
  checkout:'checkout', checkout_counter:'checkout', television:'tv', computer:'tv',
  panel:'elec', transformer:'elec', alarm_panel:'facp', fdc:'fdc', hydrant:'hydrant',
  fire_ext:'extinguisher', knox_box:'knox', stairs:'stairs', elevator:'elevator', roof_access:'roof',
  hvac:'hvac', ac_return:'hvac', ac_outdoor:'hvac', air_handler:'hvac', generator:'gen',
  compressor:'compressor', welding:'welder', conveyor:'conveyor', machine:'machine', pallet:'pallet',
  sprinkler_riser:'sprinkler', standpipe:'standpipe', exit_sign:'exit', no_access:'limited',
  ada:'handicap', ada_parking:'handicap', ada_ramp:'handicap', tree:'tree', shrub:'shrub',
  bollard:'bollard', propane:'propane'
};

function drawObjGlyph(id, w, d, color){
  var hw=w/2, hd=d/2; ctx.strokeStyle=color; ctx.fillStyle=color;
  ctx.lineWidth=Math.max(0.6, 1.4/state.view.zoom); ctx.lineJoin='round';
  if(id==='toilet'){ ctx.strokeRect(-hw*0.5,-hd,hw,hd*0.5); ctx.beginPath(); ctx.ellipse(0,hd*0.1,hw*0.55,hd*0.6,0,0,Math.PI*2); ctx.stroke(); }
  else if(id==='sink'){ ctx.strokeRect(-hw*0.8,-hd*0.7,hw*1.6,hd*1.4); ctx.beginPath(); ctx.arc(0,0,2,0,Math.PI*2); ctx.fill(); ctx.beginPath(); ctx.moveTo(0,-hd*0.7); ctx.lineTo(0,-hd); ctx.stroke(); }
  else if(id==='stairs'){ for(var i=0;i<=5;i++){ var yy=-hd+i/5*d; ctx.beginPath(); ctx.moveTo(-hw,yy); ctx.lineTo(hw,yy); ctx.stroke(); } ctx.beginPath(); ctx.moveTo(0,hd*0.7); ctx.lineTo(0,-hd*0.7); ctx.stroke(); }
  else if(id==='panel'){ ctx.strokeRect(-hw*0.8,-hd*0.9,hw*1.6,hd*1.8); for(var j=0;j<3;j++){ var y2=-hd*0.5+j*hd*0.5; ctx.beginPath(); ctx.moveTo(-hw*0.5,y2); ctx.lineTo(hw*0.5,y2); ctx.stroke(); } }
  else if(id==='hydrant'){ ctx.strokeRect(-hw*0.3,-hd*0.6,hw*0.6,hd*1.2); ctx.beginPath(); ctx.ellipse(0,-hd*0.7,hw*0.25,hd*0.2,0,0,Math.PI*2); ctx.stroke(); ctx.beginPath(); ctx.moveTo(-hw*0.3,0); ctx.lineTo(-hw*0.55,0); ctx.moveTo(hw*0.3,0); ctx.lineTo(hw*0.55,0); ctx.stroke(); }
  else if(id==='range'){ ctx.strokeRect(-hw*0.9,-hd*0.9,hw*1.8,hd*1.8); [[-1,-1],[1,-1],[-1,1],[1,1]].forEach(function(s){ ctx.beginPath(); ctx.arc(s[0]*hw*0.4,s[1]*hd*0.4,Math.min(hw,hd)*0.18,0,Math.PI*2); ctx.stroke(); }); }
  else if(id==='fdc'){ ctx.beginPath(); ctx.arc(0,0,Math.min(hw,hd)*0.7,0,Math.PI*2); ctx.stroke(); ctx.beginPath(); ctx.arc(-hw*0.25,0,hw*0.16,0,Math.PI*2); ctx.stroke(); ctx.beginPath(); ctx.arc(hw*0.25,0,hw*0.16,0,Math.PI*2); ctx.stroke(); }
  else if(id==='nfpa'){ ctx.beginPath(); ctx.moveTo(0,-hd); ctx.lineTo(hw,0); ctx.lineTo(0,hd); ctx.lineTo(-hw,0); ctx.closePath(); ctx.stroke(); ctx.beginPath(); ctx.moveTo(-hw,0); ctx.lineTo(hw,0); ctx.moveTo(0,-hd); ctx.lineTo(0,hd); ctx.stroke(); }
}

function drawObjText(o, sel){
  ctx.save(); ctx.translate(o.x, o.y); ctx.rotate(-degToRad(state.view.rotation));
  var label = o.label || 'Note';
  ctx.font = 'bold ' + (11/state.view.zoom) + 'px "Source Sans Pro", system-ui';
  ctx.textAlign='center'; ctx.textBaseline='middle';
  var tw = ctx.measureText(label).width, pad = 4/state.view.zoom, h = 13/state.view.zoom;
  ctx.fillStyle = 'rgba(255,243,153,0.92)'; ctx.strokeStyle = sel ? COL.selection : '#cca60f'; ctx.lineWidth = 1/state.view.zoom;
  if(ctx.roundRect){ ctx.beginPath(); ctx.roundRect(-tw/2-pad,-h/2-pad,tw+pad*2,h+pad*2,3/state.view.zoom); ctx.fill(); ctx.stroke(); }
  else { ctx.fillRect(-tw/2-pad,-h/2-pad,tw+pad*2,h+pad*2); }
  ctx.fillStyle = '#1a2550'; ctx.fillText(label, 0, 0);
  ctx.restore();
}

function drawObject(o, sel) {
  if (o.category === 'text') { drawObjText(o, sel); return; }
  var cat = OBJ_CAT[o.category] || { c:'#777', g:'' };
  var w = o.width || 20, dp = o.depth || 20;
  var g = cat.g;
  ctx.save();
  ctx.translate(o.x, o.y); ctx.rotate(degToRad(o.angle || 0));
  var symId = OBJ_SYM[o.category];
  var hasArt = symId && SYMBOLS.byId[symId];
  // Box only for selection, or for objects with neither vector art nor a glyph.
  if (sel) {
    ctx.fillStyle = 'rgba(251,191,36,0.42)'; ctx.strokeStyle = COL.selection;
    ctx.lineWidth = 2 / state.view.zoom;
    ctx.fillRect(-w/2, -dp/2, w, dp); ctx.strokeRect(-w/2, -dp/2, w, dp);
  } else if (!hasArt && !g) {
    ctx.fillStyle = hexA(cat.c, 0.12); ctx.strokeStyle = cat.c;
    ctx.lineWidth = 1.2 / state.view.zoom;
    ctx.fillRect(-w/2, -dp/2, w, dp); ctx.strokeRect(-w/2, -dp/2, w, dp);
  }
  // Symbol — prefer page 11's built-in vector art (clean, like the app); else glyph/emoji.
  if (hasArt && Math.min(w, dp) >= 6 && state.view.zoom > 0.12) {
    var def = SYMBOLS.byId[symId];
    var fit = Math.min(w / def.w, dp / def.h);
    ctx.save(); ctx.scale(fit, fit); try { def.draw(ctx, def.w, def.h); } catch(e){} ctx.restore();
  } else {
    var sz = Math.min(w, dp) * 0.6;
    if (g && sz >= 8 && state.view.zoom > 0.2) {
      if (g.charAt(0) === '@') {
        drawObjGlyph(g.slice(1), w, dp, cat.c);
      } else {
        ctx.save();
        ctx.rotate(-degToRad(o.angle || 0)); ctx.rotate(-degToRad(state.view.rotation));
        ctx.font = sz + 'px system-ui'; ctx.textAlign='center'; ctx.textBaseline='middle';
        ctx.fillText(g, 0, 0);
        ctx.restore();
      }
    }
  }
  // Label (upright)
  if (o.label && state.view.zoom > 0.25) {
    ctx.rotate(-degToRad(o.angle || 0)); ctx.rotate(-degToRad(state.view.rotation));
    ctx.fillStyle = sel ? '#78350f' : '#374151';
    ctx.font = (10 / state.view.zoom) + 'px "Source Sans Pro", system-ui';
    ctx.textAlign = 'center'; ctx.textBaseline = 'top';
    ctx.fillText(o.label, 0, dp/2 + 2);
  }
  ctx.restore();
}

// Fireground A/B/C/D side labels (from layout.sides)
function drawSides(sides){
  // If the upload didn't carry side labels, derive A/B/C/D from the floor-plan
  // bounding box: A=front(bottom), B=left, C=rear(top), D=right.
  // First time (or old saved plan with none): seed 4 movable labels from the
  // floor-plan bounds and STORE them in state.data.sides so they can be dragged
  // and are saved. A=front(bottom), B=left, C=rear(top), D=right — drag to taste.
  /* Seeding used to happen HERE, writing to state.data.sides. In v5 state.data
   * is a view model rebuilt every frame, so the labels were re-seeded on every
   * draw and never persisted — which is also why dragging one could not stick.
   * Seeding now lives in the controller (ensureSides) and writes to the floor.
   * A draw function must not mutate the document. */
  if(!sides || !sides.length) return;
  var selSide = (state.selected && state.selected.kind==='side') ? state.selected.index : -1;
  ctx.save(); ctx.font='bold 13px system-ui,sans-serif'; ctx.textAlign='center'; ctx.textBaseline='middle';
  sides.forEach(function(s,i){
    if(typeof s.x!=='number') return;
    ctx.save(); ctx.translate(s.x, s.y); ctx.rotate(-degToRad(state.view.rotation));
    var t='SIDE '+s.label, tw=ctx.measureText(t).width;
    ctx.fillStyle = (i===selSide) ? 'rgba(251,191,36,0.55)' : 'rgba(255,255,255,0.85)';
    if(ctx.roundRect){ ctx.beginPath(); ctx.roundRect(-tw/2-5,-10,tw+10,20,4); ctx.fill(); if(i===selSide){ ctx.strokeStyle=COL.selection; ctx.lineWidth=2; ctx.stroke(); } }
    else { ctx.fillRect(-tw/2-5,-10,tw+10,20); }
    ctx.fillStyle='#b91c1c'; ctx.fillText(t,0,0);
    ctx.restore();
  });
  ctx.restore();
}

// Auto length labels on every wall (transferred "measurements")
function drawWallDimensions(walls){
  if(!walls) return;
  var sf = (state.data && state.data.scale_px_per_ft) || 12;
  ctx.save(); ctx.font='9px system-ui,monospace'; ctx.textAlign='center'; ctx.textBaseline='middle';
  walls.forEach(function(w){
    var dx=w.x2-w.x1, dy=w.y2-w.y1, len=Math.hypot(dx,dy); if(len<8) return;
    var lbl=(len/sf).toFixed(1)+"'", mx=(w.x1+w.x2)/2, my=(w.y1+w.y2)/2, nx=-dy/len, ny=dx/len, off=10;
    ctx.save(); ctx.translate(mx+nx*off, my+ny*off); ctx.rotate(-degToRad(state.view.rotation));
    var tw=ctx.measureText(lbl).width; ctx.fillStyle='rgba(255,255,255,0.8)'; ctx.fillRect(-tw/2-2,-7,tw+4,14);
    ctx.fillStyle='#3040a0'; ctx.fillText(lbl,0,0); ctx.restore();
  });
  ctx.restore();
}

/* Humanise an id the catalog has no art for: gas_shutoff -> "Gas Shutoff". */
function prettySymbolId(id) {
  return String(id || 'Marker').replace(/[_-]+/g, ' ')
    .replace(/\b\w/g, function (c) { return c.toUpperCase(); });
}

/* A marker whose id has no catalog art used to draw NOTHING — the symbol was
 * in the data, counted in the layer panel, and invisible on the plan. Anything
 * unrecognised now draws as a labelled pin so it can at least be seen, moved
 * and re-typed. */
function drawUnknownSymbol(s, sel) {
  var z = state.view.zoom;
  var r = 9;
  ctx.save();
  ctx.translate(s.x, s.y);
  ctx.rotate(-degToRad(state.view.rotation));
  ctx.beginPath();
  ctx.moveTo(0, 0);
  ctx.quadraticCurveTo(-r, -r * 1.2, 0, -r * 2.2);
  ctx.quadraticCurveTo(r, -r * 1.2, 0, 0);
  ctx.closePath();
  ctx.fillStyle = sel ? '#2563eb' : '#64748b';
  ctx.fill();
  ctx.strokeStyle = '#fff';
  ctx.lineWidth = 1.4 / z;
  ctx.stroke();
  ctx.beginPath();
  ctx.arc(0, -r * 1.35, r * 0.42, 0, Math.PI * 2);
  ctx.fillStyle = '#fff';
  ctx.fill();
  if (z > 0.3) {
    var label = s.label || prettySymbolId(s.source_type || s.symbolId);
    ctx.fillStyle = '#334155';
    ctx.font = (9 / z) + 'px "Source Sans Pro", system-ui';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    ctx.fillText(label, 0, 4);
  }
  ctx.restore();
}

function drawSymbol(s, sel) {
  /* A generated symbol carries its own shape list, so the drawing stays whole
   * on another machine that has never seen the device library it came from. */
  if (s.spec && root.FPSymGen) {
    var zc = state.view.zoom;
    ctx.save();
    ctx.translate(s.x, s.y);
    ctx.rotate(degToRad(s.angle || 0));
    var sc = s.scale || 1;
    if (sel) {
      ctx.strokeStyle = COL.symbolRing;
      ctx.lineWidth = 3 / zc;
      var rr = Math.max(s.spec.w || 32, s.spec.h || 32) * 0.7 * sc;
      ctx.beginPath(); ctx.arc(0, 0, rr, 0, Math.PI * 2); ctx.stroke();
    }
    ctx.scale(sc, sc);
    try { root.FPSymGen.drawSpec(ctx, s.spec); } catch (e) {}
    ctx.restore();
    return;
  }
  const def = SYMBOLS.byId[s.symbolId];
  if (!def) { drawUnknownSymbol(s, sel); return; }
  ctx.save();
  ctx.translate(s.x, s.y);
  ctx.rotate(degToRad(s.angle || 0));
  const _sc = s.scale || 1;
  if (sel) {
    ctx.strokeStyle = COL.symbolRing;
    ctx.lineWidth = 3 / state.view.zoom;
    const r = Math.max(def.w, def.h) * 0.7 * _sc;
    ctx.beginPath(); ctx.arc(0, 0, r, 0, Math.PI*2); ctx.stroke();
  }
  ctx.save(); ctx.scale(_sc, _sc); def.draw(ctx, def.w, def.h); ctx.restore();
  if (s.label && state.view.zoom > 0.3) {
    // Labels upright regardless of symbol + view rotation
    ctx.rotate(-degToRad(s.angle || 0));
    ctx.rotate(-degToRad(state.view.rotation));
    ctx.fillStyle = '#1f2937';
    ctx.font = (9 / state.view.zoom) + 'px "Source Sans Pro", system-ui';
    ctx.textAlign = 'center'; ctx.textBaseline = 'top';
    ctx.fillText(s.label, 0, def.h/2 * (s.scale||1) + 3);
  }
  ctx.restore();
}

function drawText(t, sel) {
  ctx.save();
  // Text always upright — rotate canvas back by -view.rotation around text anchor
  ctx.translate(t.x, t.y);
  ctx.rotate(-degToRad(state.view.rotation));
  ctx.rotate(degToRad(t.angle || 0));
  ctx.font = (t.size || 14) + 'px ' + (t.font || '"Source Sans Pro", system-ui');
  ctx.fillStyle = sel ? '#b45309' : COL.text;
  ctx.textAlign = 'left'; ctx.textBaseline = 'top';
  ctx.fillText(t.text, 0, 0);
  if (sel) {
    const m = ctx.measureText(t.text);
    const tw = m.width, th = (t.size || 14) * 1.2;
    ctx.strokeStyle = COL.selection;
    ctx.lineWidth = 2 / state.view.zoom;
    ctx.setLineDash([4/state.view.zoom, 2/state.view.zoom]);
    ctx.strokeRect(-2, -2, tw + 4, th + 4);
    ctx.setLineDash([]);
  }
  ctx.restore();
}

function drawMeasure(m, sel) {
  const len = dist(m.x1, m.y1, m.x2, m.y2);
  ctx.save();
  ctx.strokeStyle = sel ? '#b45309' : COL.measure;
  ctx.lineWidth = 2 / state.view.zoom;
  ctx.beginPath(); ctx.moveTo(m.x1, m.y1); ctx.lineTo(m.x2, m.y2); ctx.stroke();
  const a = Math.atan2(m.y2-m.y1, m.x2-m.x1);
  const tick = 6 / state.view.zoom;
  [[m.x1,m.y1],[m.x2,m.y2]].forEach(([x,y]) => {
    ctx.beginPath();
    ctx.moveTo(x + tick*Math.cos(a+Math.PI/2), y + tick*Math.sin(a+Math.PI/2));
    ctx.lineTo(x + tick*Math.cos(a-Math.PI/2), y + tick*Math.sin(a-Math.PI/2));
    ctx.stroke();
  });
  const mx = (m.x1+m.x2)/2, my = (m.y1+m.y2)/2;
  const sf = state.data?.scale_px_per_ft || 12;
  const ft = (len / sf).toFixed(1) + " ft";
  // Label always upright
  ctx.translate(mx, my);
  ctx.rotate(-degToRad(state.view.rotation));
  ctx.font = 'bold ' + (11/state.view.zoom) + 'px "Source Sans Pro", system-ui';
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  const tw = ctx.measureText(ft).width;
  ctx.fillStyle = sel ? '#b45309' : COL.measure;
  ctx.fillRect(-tw/2 - 4/state.view.zoom, -8/state.view.zoom, tw + 8/state.view.zoom, 16/state.view.zoom);
  ctx.fillStyle = '#fff';
  ctx.fillText(ft, 0, 0);
  ctx.restore();
}

function drawFreehand(f, sel) {
  if (!f.points || f.points.length < 2) return;
  ctx.save();
  ctx.strokeStyle = sel ? COL.selection : (f.color || COL.freehand);
  ctx.lineWidth = (f.width || 2) / state.view.zoom;
  ctx.lineCap = 'round'; ctx.lineJoin = 'round';
  ctx.beginPath();
  ctx.moveTo(f.points[0].x, f.points[0].y);
  for (let i = 1; i < f.points.length; i++) ctx.lineTo(f.points[i].x, f.points[i].y);
  ctx.stroke();
  ctx.restore();
}


    /* ================================================================
     * NEW IN v5 — underlay, zones, dimensions, snap feedback, legend
     * ================================================================ */

    /* ------------------------------------------------------------- grid */

    function drawGrid() {
      var d = state.data;
      if (!d) return;
      var ft = d.scale_px_per_ft || 12;
      var step = ft * 5;                       // a 5 ft grid
      /* Below this zoom the grid is denser than the pixels and just muddies
       * the drawing, so it drops out rather than aliasing. */
      if (step * state.view.zoom < 6) return;
      var b = { x0: 0, y0: 0, x1: d.canvas_width, y1: d.canvas_height };
      ctx.save();
      ctx.strokeStyle = COL.gridLine;
      ctx.lineWidth = 1 / state.view.zoom;
      ctx.beginPath();
      for (var x = 0; x <= b.x1; x += step) { ctx.moveTo(x, 0); ctx.lineTo(x, b.y1); }
      for (var y = 0; y <= b.y1; y += step) { ctx.moveTo(0, y); ctx.lineTo(b.x1, y); }
      ctx.stroke();
      ctx.restore();
    }

    /* --------------------------------------------------------- underlay */

    function underlayImage(u) {
      if (!u || !u.src) return null;
      var im = underlayImages[u.src];
      if (im === undefined) {
        im = new Image();
        im.onload = function () { draw(); };
        im.onerror = function () { underlayImages[u.src] = null; };
        im.src = u.src;
        underlayImages[u.src] = im;
        return im.complete ? im : null;
      }
      return im && im.naturalWidth ? im : null;
    }

    function drawUnderlay() {
      var d = state.data;
      if (!d || !d.underlay) return;
      var u = d.underlay;
      var im = underlayImage(u);
      if (!im) return;
      ctx.save();
      ctx.globalAlpha = u.opacity == null ? 0.55 : u.opacity;
      ctx.translate(u.x + u.w / 2, u.y + u.h / 2);
      if (u.rot) ctx.rotate(degToRad(u.rot));
      ctx.drawImage(im, -u.w / 2, -u.h / 2, u.w, u.h);
      ctx.restore();

      /* An unlocked underlay shows a handle frame so it is obvious it can be
       * moved — and, more importantly, that it is NOT part of the drawing. */
      if (!u.locked) {
        ctx.save();
        ctx.strokeStyle = '#0ea5e9';
        ctx.lineWidth = 1.5 / state.view.zoom;
        ctx.setLineDash([7 / state.view.zoom, 5 / state.view.zoom]);
        ctx.translate(u.x + u.w / 2, u.y + u.h / 2);
        if (u.rot) ctx.rotate(degToRad(u.rot));
        ctx.strokeRect(-u.w / 2, -u.h / 2, u.w, u.h);
        ctx.setLineDash([]);
        ctx.fillStyle = '#0ea5e9';
        var hs = 7 / state.view.zoom;
        [[-1, -1], [1, -1], [1, 1], [-1, 1]].forEach(function (c) {
          ctx.fillRect(c[0] * u.w / 2 - hs / 2, c[1] * u.h / 2 - hs / 2, hs, hs);
        });
        ctx.restore();
      }
    }

    /* ------------------------------------------------------------ zones */

    function zoneFill(z, alpha) {
      var hex = z.color || '#3b82f6';
      var n = parseInt(hex.slice(1), 16);
      return 'rgba(' + ((n >> 16) & 255) + ',' + ((n >> 8) & 255) + ',' + (n & 255) + ',' + alpha + ')';
    }

    function drawZone(z, sel) {
      if (!z.poly || z.poly.length < 3) return;
      ctx.save();
      ctx.beginPath();
      ctx.moveTo(z.poly[0].x, z.poly[0].y);
      for (var i = 1; i < z.poly.length; i++) ctx.lineTo(z.poly[i].x, z.poly[i].y);
      ctx.closePath();
      ctx.fillStyle = zoneFill(z, sel ? 0.34 : 0.18);
      ctx.fill();
      ctx.strokeStyle = sel ? COL.selection : zoneFill(z, 0.75);
      ctx.lineWidth = (sel ? 2.5 : 1.2) / state.view.zoom;
      ctx.stroke();
      ctx.restore();
    }

    /* The label is drawn upright regardless of the view rotation — a room name
     * you have to tilt your head to read is a room name nobody reads. */
    function drawZoneLabel(z) {
      if (!z.poly || z.poly.length < 3) return;
      var name = z.name || '';
      var area = z.area_sqft;
      if (!name && !area) return;
      var cx = (z.cx == null ? G.polyCentroid(z.poly).x : z.cx) + (z.label_dx || 0);
      var cy = (z.cy == null ? G.polyCentroid(z.poly).y : z.cy) + (z.label_dy || 0);
      var zoom = state.view.zoom;
      if (zoom < 0.12) return;
      ctx.save();
      ctx.translate(cx, cy);
      ctx.rotate(-degToRad(state.view.rotation));
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      var nameSize = 13 / zoom, areaSize = 11 / zoom;
      var lines = [];
      if (name) lines.push({ t: name, s: nameSize, c: '#0f172a', b: true });
      if (area) lines.push({ t: Math.round(area).toLocaleString() + ' sq ft', s: areaSize, c: '#334155', b: false });
      var totalH = lines.reduce(function (t, l) { return t + l.s * 1.25; }, 0);
      var y = -totalH / 2 + lines[0].s * 0.62;
      /* A soft plate behind the text so a label over a busy scan stays legible. */
      var maxW = 0;
      lines.forEach(function (l) {
        ctx.font = (l.b ? 'bold ' : '') + l.s + 'px "Source Sans Pro", system-ui, sans-serif';
        maxW = Math.max(maxW, ctx.measureText(l.t).width);
      });
      var padX = 6 / zoom, padY = 4 / zoom;
      ctx.fillStyle = 'rgba(255,255,255,0.72)';
      if (ctx.roundRect) {
        ctx.beginPath();
        ctx.roundRect(-maxW / 2 - padX, -totalH / 2 - padY, maxW + padX * 2, totalH + padY * 2, 4 / zoom);
        ctx.fill();
      } else {
        ctx.fillRect(-maxW / 2 - padX, -totalH / 2 - padY, maxW + padX * 2, totalH + padY * 2);
      }
      lines.forEach(function (l) {
        ctx.font = (l.b ? 'bold ' : '') + l.s + 'px "Source Sans Pro", system-ui, sans-serif';
        ctx.fillStyle = l.c;
        ctx.fillText(l.t, 0, y);
        y += l.s * 1.25;
      });
      ctx.restore();
    }

    /* -------------------------------------------------- snap + guides UI */

    function drawGuides() {
      if (!state.guides || !state.guides.length) return;
      var d = state.data;
      var span = Math.max(d ? d.canvas_width : 2000, d ? d.canvas_height : 2000) * 2;
      ctx.save();
      ctx.strokeStyle = COL.guide;
      ctx.lineWidth = 1 / state.view.zoom;
      ctx.setLineDash([6 / state.view.zoom, 4 / state.view.zoom]);
      state.guides.forEach(function (g) {
        ctx.beginPath();
        if (g.kind === 'v') { ctx.moveTo(g.x, -span); ctx.lineTo(g.x, span); }
        else { ctx.moveTo(-span, g.y); ctx.lineTo(span, g.y); }
        ctx.stroke();
      });
      ctx.setLineDash([]);
      ctx.restore();
    }

    /* Each snap kind gets its own glyph. Without this the point simply jumps
     * and the operator cannot tell whether it caught a corner or the grid. */
    function drawSnapIndicator() {
      var s = state.snap;
      if (!s || !s.snap) return;
      var z = state.view.zoom;
      var r = 6 / z;
      ctx.save();
      ctx.translate(s.x, s.y);
      ctx.rotate(-degToRad(state.view.rotation));
      ctx.strokeStyle = '#0ea5e9';
      ctx.fillStyle = 'rgba(14,165,233,0.18)';
      ctx.lineWidth = 2 / z;
      if (s.snap === 'endpoint') {
        ctx.strokeRect(-r, -r, r * 2, r * 2);
        ctx.fillRect(-r, -r, r * 2, r * 2);
      } else if (s.snap === 'midpoint') {
        ctx.beginPath();
        ctx.moveTo(0, -r); ctx.lineTo(r, r); ctx.lineTo(-r, r); ctx.closePath();
        ctx.fill(); ctx.stroke();
      } else if (s.snap === 'intersection') {
        ctx.beginPath();
        ctx.moveTo(-r, -r); ctx.lineTo(r, r); ctx.moveTo(r, -r); ctx.lineTo(-r, r);
        ctx.stroke();
      } else {
        ctx.beginPath();
        ctx.arc(0, 0, r * 0.8, 0, Math.PI * 2);
        ctx.fill(); ctx.stroke();
      }
      ctx.restore();
    }

    /* ------------------------------------------------- in-progress shapes */

    function fmtLen(px) {
      var d = state.data;
      return G.formatFeet(G.pxToFeet(px, d ? d.scale_px_per_ft : 12));
    }

    /* A live readout on the segment being drawn: length, and bearing so a wall
     * can be reproduced from a field note. */
    function drawLiveDimension(x1, y1, x2, y2) {
      var len = dist(x1, y1, x2, y2);
      if (len < 1) return;
      var z = state.view.zoom;
      var mx = (x1 + x2) / 2, my = (y1 + y2) / 2;
      var ang = Math.atan2(y2 - y1, x2 - x1);
      var deg = (radToDeg(ang) + 360) % 360;
      var label = fmtLen(len) + '   ' + Math.round(deg) + '°';
      ctx.save();
      ctx.translate(mx, my);
      ctx.rotate(-degToRad(state.view.rotation));
      ctx.font = 'bold ' + (12 / z) + 'px "Source Sans Pro", system-ui, sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      var w = ctx.measureText(label).width, pad = 5 / z, h = 15 / z;
      ctx.fillStyle = 'rgba(15,23,42,0.88)';
      if (ctx.roundRect) { ctx.beginPath(); ctx.roundRect(-w / 2 - pad, -h / 2 - pad, w + pad * 2, h + pad * 2, 4 / z); ctx.fill(); }
      else ctx.fillRect(-w / 2 - pad, -h / 2 - pad, w + pad * 2, h + pad * 2);
      ctx.fillStyle = '#fff';
      ctx.fillText(label, 0, 0);
      ctx.restore();
    }

    function drawInProgress(d) {
      if (!d) return;
      var z = state.view.zoom;
      ctx.save();
      ctx.strokeStyle = COL.selection;
      ctx.lineWidth = 2 / z;
      ctx.setLineDash([8 / z, 4 / z]);

      if (d.kind === 'wall' || d.kind === 'measure') {
        ctx.beginPath(); ctx.moveTo(d.x1, d.y1); ctx.lineTo(d.x2, d.y2); ctx.stroke();
        ctx.setLineDash([]);
        drawLiveDimension(d.x1, d.y1, d.x2, d.y2);
      } else if (d.kind === 'room') {
        var x = Math.min(d.x1, d.x2), y = Math.min(d.y1, d.y2);
        var w = Math.abs(d.x2 - d.x1), h = Math.abs(d.y2 - d.y1);
        ctx.strokeRect(x, y, w, h);
        ctx.setLineDash([]);
        drawLiveDimension(x, y, x + w, y);
        drawLiveDimension(x + w, y, x + w, y + h);
        /* Area of the room being dragged out, live. */
        var sqft = G.areaPxToSqFt(w * h, state.data ? state.data.scale_px_per_ft : 12);
        ctx.save();
        ctx.translate(x + w / 2, y + h / 2);
        ctx.rotate(-degToRad(state.view.rotation));
        ctx.font = 'bold ' + (13 / z) + 'px "Source Sans Pro", system-ui, sans-serif';
        ctx.fillStyle = '#1d4ed8';
        ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
        ctx.fillText(Math.round(sqft).toLocaleString() + ' sq ft', 0, 0);
        ctx.restore();
      } else if (d.kind === 'chain') {
        /* The wall chain: committed segments solid, the live one dashed. */
        var pts = d.points || [];
        if (pts.length) {
          ctx.setLineDash([]);
          ctx.strokeStyle = COL.selection;
          ctx.lineWidth = 2.5 / z;
          ctx.beginPath();
          ctx.moveTo(pts[0].x, pts[0].y);
          for (var i = 1; i < pts.length; i++) ctx.lineTo(pts[i].x, pts[i].y);
          ctx.stroke();
          if (d.cursor) {
            ctx.setLineDash([8 / z, 4 / z]);
            ctx.beginPath();
            ctx.moveTo(pts[pts.length - 1].x, pts[pts.length - 1].y);
            ctx.lineTo(d.cursor.x, d.cursor.y);
            ctx.stroke();
            ctx.setLineDash([]);
            drawLiveDimension(pts[pts.length - 1].x, pts[pts.length - 1].y, d.cursor.x, d.cursor.y);
          }
          /* The green start dot — tapping it closes the loop, which is how a
           * room becomes enclosed and therefore zoneable. */
          ctx.fillStyle = '#16a34a';
          ctx.strokeStyle = '#fff';
          ctx.lineWidth = 2 / z;
          ctx.beginPath();
          ctx.arc(pts[0].x, pts[0].y, 7 / z, 0, Math.PI * 2);
          ctx.fill(); ctx.stroke();
          ctx.fillStyle = '#1d4ed8';
          for (var p = 1; p < pts.length; p++) {
            ctx.beginPath();
            ctx.arc(pts[p].x, pts[p].y, 3.5 / z, 0, Math.PI * 2);
            ctx.fill();
          }
        }
      } else if (d.kind === 'zone') {
        var zp = d.points || [];
        if (zp.length) {
          ctx.setLineDash([]);
          ctx.fillStyle = 'rgba(59,130,246,0.18)';
          ctx.beginPath();
          ctx.moveTo(zp[0].x, zp[0].y);
          for (var q = 1; q < zp.length; q++) ctx.lineTo(zp[q].x, zp[q].y);
          if (d.cursor) ctx.lineTo(d.cursor.x, d.cursor.y);
          ctx.closePath();
          ctx.fill();
          ctx.strokeStyle = COL.zoneStroke;
          ctx.lineWidth = 2 / z;
          ctx.stroke();
          ctx.fillStyle = '#16a34a';
          ctx.beginPath(); ctx.arc(zp[0].x, zp[0].y, 7 / z, 0, Math.PI * 2); ctx.fill();
        }
      } else if (d.kind === 'pen') {
        ctx.setLineDash([]);
        ctx.strokeStyle = COL.freehand;
        ctx.lineWidth = 2 / z;
        ctx.beginPath();
        (d.points || []).forEach(function (p, i) { i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y); });
        ctx.stroke();
      } else if (d.kind === 'calibrate') {
        ctx.setLineDash([]);
        ctx.strokeStyle = '#f59e0b';
        ctx.lineWidth = 3 / z;
        ctx.beginPath(); ctx.moveTo(d.x1, d.y1); ctx.lineTo(d.x2, d.y2); ctx.stroke();
        [[d.x1, d.y1], [d.x2, d.y2]].forEach(function (p) {
          ctx.beginPath(); ctx.arc(p[0], p[1], 5 / z, 0, Math.PI * 2); ctx.fill();
        });
      }
      ctx.setLineDash([]);
      ctx.restore();
    }

    /* ------------------------------------------------- legend / schedule
     *
     * Screen-space, not plan-space: the legend is sheet furniture and must stay
     * the same size whatever the zoom. */

    function drawLegendPanel() {
      var doc = getDoc();
      if (!doc || !state.visibleLayers || state.visibleLayers.legend === false) return;
      if (doc.data.legend && doc.data.legend.show === false) return;
      var rows = doc.buildLegend(SYMBOLS.byId);
      if (!rows.length) return;

      var pad = 10, rowH = 19, icon = 15;
      var boxW = 208;
      var title = 'LEGEND';
      var maxRows = Math.max(1, Math.floor((state.view.height - 90) / rowH));
      var shown = rows.slice(0, maxRows);
      var hidden = rows.length - shown.length;
      var bh = pad + 18 + shown.length * rowH + (hidden > 0 ? 14 : 0) + 6;
      var x = 10, y = 10;

      ctx.save();
      ctx.setTransform(state.dpr, 0, 0, state.dpr, 0, 0);
      ctx.fillStyle = 'rgba(255,255,255,0.94)';
      ctx.strokeStyle = '#94a3b8';
      ctx.lineWidth = 1;
      if (ctx.roundRect) { ctx.beginPath(); ctx.roundRect(x, y, boxW, bh, 8); ctx.fill(); ctx.stroke(); }
      else { ctx.fillRect(x, y, boxW, bh); ctx.strokeRect(x, y, boxW, bh); }

      ctx.fillStyle = '#1e3a5f';
      ctx.font = 'bold 11px system-ui, sans-serif';
      ctx.textAlign = 'left';
      ctx.textBaseline = 'middle';
      ctx.fillText(title, x + pad, y + pad + 4);

      var ry = y + pad + 20;
      shown.forEach(function (row) {
        var def = row.symbolId ? SYMBOLS.byId[row.symbolId] : null;
        if (def) {
          ctx.save();
          ctx.translate(x + pad + icon / 2, ry);
          var sc = icon / Math.max(def.w, def.h);
          ctx.scale(sc, sc);
          try { def.draw(ctx, def.w, def.h); } catch (e) {}
          ctx.restore();
        } else {
          ctx.fillStyle = '#7c3aed';
          ctx.fillRect(x + pad + 2, ry - 5, 11, 10);
        }
        ctx.fillStyle = '#334155';
        ctx.font = '10px system-ui, sans-serif';
        ctx.textBaseline = 'middle';
        ctx.textAlign = 'left';
        var label = String(row.label || '');
        if (label.length > 24) label = label.slice(0, 23) + '…';
        ctx.fillText(label, x + pad + icon + 8, ry);
        if (row.count > 1) {
          ctx.textAlign = 'right';
          ctx.fillStyle = '#64748b';
          ctx.font = 'bold 10px system-ui, sans-serif';
          ctx.fillText('×' + row.count, x + boxW - pad, ry);
        }
        ry += rowH;
      });
      if (hidden > 0) {
        ctx.fillStyle = '#94a3b8';
        ctx.font = 'italic 9px system-ui, sans-serif';
        ctx.textAlign = 'left';
        ctx.fillText('+' + hidden + ' more (see the PDF)', x + pad, ry + 3);
      }
      ctx.restore();
    }

    /* ------------------------------------------------- sheet furniture */

    function drawSheetFurniture() {
      var doc = getDoc();
      var d = state.data;
      if (!doc || !d) return;
      var sheet = doc.data.sheet || {};
      ctx.save();
      ctx.setTransform(state.dpr, 0, 0, state.dpr, 0, 0);

      /* North arrow. It points at true north AFTER the view rotation, which is
       * the whole reason it exists — a rotated plan with a fixed arrow is a
       * plan that will send a crew to the wrong side of the building. */
      if (sheet.show_north !== false) {
        var nx = state.view.width - 46, ny = 46;
        /* Published so the pointer handler can let you grab the arrow itself.
         * Typing a bearing into a panel is not how anyone orients a plan while
         * standing in front of the building. */
        state.northHit = { x: nx, y: ny, r: 26 };
        var north = degToRad((sheet.north || 0) + state.view.rotation);
        ctx.save();
        ctx.translate(nx, ny);
        if (state.draggingNorth) {
          ctx.beginPath();
          ctx.arc(0, 0, 24, 0, Math.PI * 2);
          ctx.fillStyle = 'rgba(37,99,235,0.14)';
          ctx.fill();
          ctx.strokeStyle = '#2563eb';
          ctx.lineWidth = 1.5;
          ctx.stroke();
        }
        ctx.rotate(north);
        ctx.fillStyle = state.draggingNorth ? '#2563eb' : '#0f172a';
        ctx.beginPath();
        ctx.moveTo(0, -20); ctx.lineTo(7, 8); ctx.lineTo(0, 3); ctx.lineTo(-7, 8);
        ctx.closePath();
        ctx.fill();
        ctx.restore();
        ctx.fillStyle = '#0f172a';
        ctx.font = 'bold 11px system-ui, sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText('N', nx, ny + 22);
      }

      /* Graphic scale bar — survives photocopying and rescaling, which a
       * printed "1:96" does not. */
      if (sheet.show_scalebar !== false) {
        var pxPerFt = (d.scale_px_per_ft || 12) * state.view.zoom;
        if (pxPerFt > 0.02) {
          var targets = [5, 10, 20, 25, 50, 100, 200, 500];
          var feet = targets[0];
          for (var i = 0; i < targets.length; i++) {
            if (targets[i] * pxPerFt <= 190) feet = targets[i];
          }
          var barPx = feet * pxPerFt;
          /* Bottom CENTRE. The bottom-right corner belongs to the photo FAB and
           * the ISO badge, and the scale bar was landing underneath both. */
          var bx = (state.view.width - barPx) / 2, by = state.view.height - 26;
          ctx.fillStyle = 'rgba(255,255,255,0.85)';
          ctx.fillRect(bx - 8, by - 16, barPx + 16, 32);
          ctx.strokeStyle = '#0f172a';
          ctx.lineWidth = 1.4;
          ctx.beginPath();
          ctx.moveTo(bx, by); ctx.lineTo(bx + barPx, by);
          ctx.moveTo(bx, by - 5); ctx.lineTo(bx, by + 5);
          ctx.moveTo(bx + barPx, by - 5); ctx.lineTo(bx + barPx, by + 5);
          ctx.moveTo(bx + barPx / 2, by - 4); ctx.lineTo(bx + barPx / 2, by + 4);
          ctx.stroke();
          /* Solid half makes it read as a scale bar rather than a stray line. */
          ctx.fillStyle = '#0f172a';
          ctx.fillRect(bx, by - 3, barPx / 2, 6);
          ctx.font = 'bold 10px system-ui, sans-serif';
          ctx.textAlign = 'center';
          ctx.textBaseline = 'top';
          ctx.fillText(feet + " ft", bx + barPx / 2, by + 7);
        }
      }
      ctx.restore();
    }

    /* --------------------------------------------------------- the frame */

    function draw() {
      var d = buildViewModel();
      ctx.setTransform(state.dpr, 0, 0, state.dpr, 0, 0);
      ctx.fillStyle = COL.bg;
      ctx.fillRect(0, 0, state.view.width, state.view.height);
      if (!d) { if (opts.onStatus) opts.onStatus(); return; }

      var VL = state.visibleLayers || {};

      ctx.save();
      ctx.translate(state.view.panX, state.view.panY);
      ctx.scale(state.view.zoom, state.view.zoom);
      ctx.translate(d.canvas_width / 2, d.canvas_height / 2);
      ctx.rotate(degToRad(state.view.rotation));
      ctx.translate(-d.canvas_width / 2, -d.canvas_height / 2);

      if (VL.grid) drawGrid();
      if (VL.underlay !== false) drawUnderlay();

      /* Zones sit under everything so their fill never hides a wall or a
       * hydrant. */
      if (VL.zones !== false) {
        (d.zones || []).forEach(function (z, i) { drawZone(z, selEq('zone', i)); });
      }

      if (VL.objects) (d.objects || []).forEach(function (o, i) { drawObject(o, selEq('object', i)); });
      if (VL.walls) drawWallsAsPolygons(d.walls);
      if (VL.windows) (d.windows || []).forEach(function (w, i) { drawWindowGap(w, selEq('window', i)); });
      if (VL.doors) (d.doors || []).forEach(function (dr, i) { drawDoorGap(dr, selEq('door', i)); });
      if (VL.doors) (d.doors || []).forEach(function (dr, i) { drawDoorSymbol(dr, selEq('door', i)); });
      if (VL.windows) (d.windows || []).forEach(function (w, i) { drawWindowSymbol(w, selEq('window', i)); });
      if (VL.symbols) (d.symbols || []).forEach(function (s, i) { drawSymbol(s, selEq('symbol', i)); });
      if (VL.texts) (d.texts || []).forEach(function (t, i) { drawText(t, selEq('text', i)); });
      if (VL.measurements) (d.measurements || []).forEach(function (m, i) { drawMeasure(m, selEq('measurement', i)); });
      if (VL.freehand) (d.freehand || []).forEach(function (f, i) { drawFreehand(f, selEq('freehand', i)); });

      /* Zone labels go on TOP of the geometry, or a wall crosses the text. */
      if (VL.zones !== false) (d.zones || []).forEach(function (z) { drawZoneLabel(z); });

      if (VL.dimensions !== false) { try { drawWallDimensions(d.walls); } catch (e) {} }
      try { drawSides(d.sides); } catch (e) {}

      if (VL.walls && state.selected && state.selected.kind === 'wall') {
        var sw = d.walls[state.selected.index];
        if (sw) drawWallHighlight(sw);
      }

      drawGuides();
      if (state.drawing) drawInProgress(state.drawing);
      drawSnapIndicator();

      ctx.restore();

      drawLegendPanel();
      drawSheetFurniture();
      if (opts.onStatus) opts.onStatus();

      /* Late overlay hook. fp-markers.js paints its photo pins here, and the
       * Worker-injected panel expects it too — the contract predates this
       * rebuild and outside code depends on it. */
      if (root.__FP_OVERLAY) { try { root.__FP_OVERLAY(); } catch (e) { console.warn('[fp] overlay', e); } }
    }

    /* ------------------------------------------------------------ hit test */

    function hitTest(sx, sy) {
      var d = state.data;
      if (!d) return null;
      var p = screenToData(sx, sy);
      var tol = 10 / state.view.zoom;

      function near(e, r) { return dist(p.x, p.y, e.x, e.y) <= (r || tol); }

      /* Front-to-back: the thing drawn last is the thing you meant to click. */
      var i;
      for (i = (d.texts || []).length - 1; i >= 0; i--) {
        var t = d.texts[i];
        var size = (t.size || 14);
        if (p.x >= t.x - 4 && p.x <= t.x + size * 0.62 * String(t.text || '').length + 8 &&
            p.y >= t.y - 4 && p.y <= t.y + size + 6) return { kind: 'text', index: i };
      }
      for (i = (d.symbols || []).length - 1; i >= 0; i--) {
        var s = d.symbols[i];
        var def = SYMBOLS.byId[s.symbolId];
        /* A generated symbol carries its own box; a placed one may reference an
         * id this device has never registered, so the spec is the better
         * source. Both are scaled, or a resized symbol could not be grabbed
         * where it is actually drawn. */
        var box = s.spec ? Math.max(s.spec.w || 32, s.spec.h || 32)
                         : (def ? Math.max(def.w, def.h) : 24);
        var rr = box * 0.6 * (s.scale || 1);
        if (near(s, Math.max(rr, tol))) return { kind: 'symbol', index: i };
      }
      for (i = (d.doors || []).length - 1; i >= 0; i--) {
        if (near(d.doors[i], Math.max((d.doors[i].width || 32) / 2, tol))) return { kind: 'door', index: i };
      }
      for (i = (d.windows || []).length - 1; i >= 0; i--) {
        if (near(d.windows[i], Math.max((d.windows[i].width || 40) / 2, tol))) return { kind: 'window', index: i };
      }
      for (i = (d.objects || []).length - 1; i >= 0; i--) {
        var o = d.objects[i];
        var hw = (o.width || 20) / 2, hh = (o.depth || o.height || 20) / 2;
        var a = -degToRad(o.angle || 0);
        var lx = (p.x - o.x) * Math.cos(a) - (p.y - o.y) * Math.sin(a);
        var ly = (p.x - o.x) * Math.sin(a) + (p.y - o.y) * Math.cos(a);
        if (Math.abs(lx) <= hw + 3 && Math.abs(ly) <= hh + 3) return { kind: 'object', index: i };
      }
      for (i = (d.measurements || []).length - 1; i >= 0; i--) {
        var m = d.measurements[i];
        if (pointToSeg(p.x, p.y, m.x1, m.y1, m.x2, m.y2) <= tol) return { kind: 'measurement', index: i };
      }
      for (i = (d.walls || []).length - 1; i >= 0; i--) {
        var w = d.walls[i];
        if (pointToSeg(p.x, p.y, w.x1, w.y1, w.x2, w.y2) <= tol) return { kind: 'wall', index: i };
      }
      for (i = (d.freehand || []).length - 1; i >= 0; i--) {
        var fh = d.freehand[i], pts = fh.points || [];
        for (var k = 1; k < pts.length; k++) {
          if (pointToSeg(p.x, p.y, pts[k - 1].x, pts[k - 1].y, pts[k].x, pts[k].y) <= tol) {
            return { kind: 'freehand', index: i };
          }
        }
      }
      /* Fireground side labels. Drawn in plan units at a fixed 13px font, so
       * the box is about 46 x 20 around the anchor. */
      for (i = (d.sides || []).length - 1; i >= 0; i--) {
        var sd = d.sides[i];
        if (typeof sd.x !== 'number') continue;
        if (Math.abs(p.x - sd.x) <= 30 && Math.abs(p.y - sd.y) <= 12) {
          return { kind: 'side', index: i };
        }
      }

      /* Zones last: they are large, so anything on top of one wins. */
      for (i = (d.zones || []).length - 1; i >= 0; i--) {
        var z = d.zones[i];
        if (z.poly && G.pointInPoly(p.x, p.y, z.poly)) return { kind: 'zone', index: i };
      }
      return null;
    }

    return {
      ctx: ctx,
      canvas: canvas,
      COL: COL,
      state: state,
      draw: draw,
      resizeCanvas: resizeCanvas,
      dataToScreen: dataToScreen,
      screenToData: screenToData,
      fitToView: fitToView,
      zoomAt: zoomAt,
      hitTest: hitTest,
      buildViewModel: buildViewModel,
      contentBounds: contentBounds,
      fmtLen: fmtLen,
      underlayImage: underlayImage
    };
  }

  root.FPRender = { create: createRenderer, COL: COL };
})(typeof window !== 'undefined' ? window : this);
