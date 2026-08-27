/* fp2-model.js — document model, storage and undo for the Floor Plan editor.
 *
 * SCHEMA v5. The v4 document was a single flat set of arrays, which is why the
 * app could only ever hold one storey. v5 introduces floors[], zones[] and a
 * per-floor tracing underlay.
 *
 * COMPATIBILITY IS NOT OPTIONAL. Two other pieces of software read
 * floor_plan_data and neither is being rebuilt today:
 *   - page12-submit.html renderV4Floorplan()  -> the PDF the IC carries
 *   - the fdtraining Worker handleFromCapture -> DivisionScan imports
 * Both read the FLAT arrays. So v5 keeps a flat mirror of the ACTIVE floor at
 * the top level, always written on save. An old reader sees exactly what it saw
 * before; a v5 reader sees floors[]. Never drop the mirror to "clean up".
 */
(function (root, factory) {
  var api = factory(root && root.FPGeom ? root.FPGeom : (typeof require === 'function' ? require('./fp2-geom.js') : null));
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.FPModel = api;
})(typeof window !== 'undefined' ? window : null, function (G) {
  'use strict';

  var PLAN_KEY = 'preFirePlan';
  var SCHEMA_VERSION = 5;
  var UNDO_LIMIT = 40;

  /* Element collections that live on a floor. `freehand` is the odd one out —
   * it is not pluralised, which every loop here has to respect. */
  var FLOOR_LISTS = ['walls', 'doors', 'windows', 'objects', 'symbols', 'texts',
                     'measurements', 'freehand', 'zones'];
  /* The subset the v4 readers know about — this is what gets mirrored flat. */
  var LEGACY_LISTS = ['walls', 'doors', 'windows', 'objects', 'symbols', 'texts',
                      'measurements', 'freehand'];

  var DEFAULT_LAYERS = {
    underlay: true, zones: true, walls: true, doors: true, windows: true,
    objects: true, symbols: true, texts: true, measurements: true,
    freehand: true, dimensions: true, legend: true, grid: false
  };

  function uid(prefix) {
    return (prefix || '') + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
  }

  function clone(o) { return o == null ? o : JSON.parse(JSON.stringify(o)); }

  function emptyFloor(name, level) {
    var f = { id: uid('fl_'), name: name || 'Floor 1', level: level == null ? 1 : level, underlay: null };
    FLOOR_LISTS.forEach(function (k) { f[k] = []; });
    return f;
  }

  function emptyPlan() {
    var f = emptyFloor('Floor 1', 1);
    var d = {
      version: SCHEMA_VERSION,
      canvas_width: 1000, canvas_height: 700, scale_px_per_ft: 12,
      floors: [f],
      active_floor: f.id,
      layers: clone(DEFAULT_LAYERS),
      sheet: { north: 0, show_north: true, show_scalebar: true, show_titleblock: false, title: '' },
      legend: { show: true, x: null, y: null },
      view_rotation: 0
    };
    LEGACY_LISTS.forEach(function (k) { d[k] = []; });
    return d;
  }

  /* ------------------------------------------------------------ migration */

  function isV5(d) { return !!(d && Array.isArray(d.floors) && d.floors.length); }

  /* Give every wall a stable id. Openings reference walls by id, so an id that
   * changes between loads would orphan every door on the plan. Ids are
   * therefore minted ONCE, here, and then persisted. */
  function ensureWallIds(floor) {
    var seen = {};
    (floor.walls || []).forEach(function (w) {
      if (!w.id || seen[w.id]) w.id = uid('w_');
      seen[w.id] = 1;
    });
  }

  /* Adopt legacy free-floating doors/windows onto the wall they sit on.
   * Keeps x/y as written so the v4 PDF renderer is unaffected; adds wallId + t
   * so v5 can move them with the wall. Anything too far from a wall stays
   * unhosted rather than being yanked onto the nearest one. */
  function adoptOpenings(floor) {
    if (!G) return 0;
    var adopted = 0;
    ['doors', 'windows'].forEach(function (kind) {
      (floor[kind] || []).forEach(function (op) {
        if (!op.id) op.id = uid(kind === 'doors' ? 'd_' : 'n_');
        if (op.wallId) return;
        if (typeof op.x !== 'number' || typeof op.y !== 'number') return;
        var host = G.hostOpening(op.x, op.y, floor.walls || [], 24);
        if (host) { op.wallId = host.wallId; op.t = host.t; adopted++; }
      });
    });
    return adopted;
  }

  function ensureIds(floor) {
    ['objects', 'symbols', 'texts', 'measurements', 'freehand', 'zones'].forEach(function (k) {
      (floor[k] || []).forEach(function (el) { if (!el.id) el.id = uid(k.charAt(0) + '_'); });
    });
  }

  /* v4 (flat) -> v5 (floors). Also the path taken for a fresh DivisionScan
   * import, since the Worker writes v4. */
  function migrate(d) {
    if (!d) return emptyPlan();
    if (isV5(d)) {
      d.version = SCHEMA_VERSION;
      d.layers = Object.assign(clone(DEFAULT_LAYERS), d.layers || {});
      d.sheet = Object.assign({ north: 0, show_north: true, show_scalebar: true, show_titleblock: false, title: '' }, d.sheet || {});
      d.legend = Object.assign({ show: true, x: null, y: null }, d.legend || {});
      d.floors.forEach(function (f) {
        FLOOR_LISTS.forEach(function (k) { if (!Array.isArray(f[k])) f[k] = []; });
        ensureWallIds(f); ensureIds(f); adoptOpenings(f);
      });
      if (!d.active_floor || !d.floors.some(function (f) { return f.id === d.active_floor; })) {
        d.active_floor = d.floors[0].id;
      }
      return d;
    }

    // v4: one flat storey.
    var out = emptyPlan();
    out.canvas_width = d.canvas_width || 1000;
    out.canvas_height = d.canvas_height || 700;
    out.scale_px_per_ft = d.scale_px_per_ft || 12;
    out.view_rotation = d.view_rotation || 0;
    var f = out.floors[0];
    LEGACY_LISTS.forEach(function (k) {
      f[k] = Array.isArray(d[k]) ? clone(d[k]) : [];
    });
    f.zones = Array.isArray(d.zones) ? clone(d.zones) : [];
    ensureWallIds(f); ensureIds(f); adoptOpenings(f);
    if (d.building_name) out.building_name = d.building_name;
    if (d.scan_id) out.scan_id = d.scan_id;
    return out;
  }

  /* ------------------------------------------------------------- document */

  function Doc(data) {
    this.data = migrate(data);
    this.undoStack = [];
    this.redoStack = [];
    this.dirty = false;
  }

  Doc.prototype.floor = function () {
    var d = this.data;
    for (var i = 0; i < d.floors.length; i++) if (d.floors[i].id === d.active_floor) return d.floors[i];
    d.active_floor = d.floors[0].id;
    return d.floors[0];
  };

  Doc.prototype.floorById = function (id) {
    for (var i = 0; i < this.data.floors.length; i++) if (this.data.floors[i].id === id) return this.data.floors[i];
    return null;
  };

  Doc.prototype.list = function (kind) {
    var f = this.floor();
    var key = kind === 'freehand' ? 'freehand' : (kind.slice(-1) === 's' ? kind : kind + 's');
    if (!Array.isArray(f[key])) f[key] = [];
    return f[key];
  };

  Doc.prototype.wallsById = function () {
    var map = {}, ws = this.list('walls');
    for (var i = 0; i < ws.length; i++) map[ws[i].id] = ws[i];
    return map;
  };

  Doc.prototype.setActiveFloor = function (id) {
    if (this.floorById(id)) { this.data.active_floor = id; return true; }
    return false;
  };

  Doc.prototype.addFloor = function (name) {
    var lvl = this.data.floors.length + 1;
    var f = emptyFloor(name || ('Floor ' + lvl), lvl);
    this.data.floors.push(f);
    this.data.active_floor = f.id;
    return f;
  };

  /* Removing a storey is destructive and irreversible past the undo cap, so it
   * refuses to remove the last one — a plan with no floors has no drawing
   * surface and the editor would have to invent one silently. */
  Doc.prototype.removeFloor = function (id) {
    if (this.data.floors.length < 2) return false;
    var i = this.data.floors.findIndex(function (f) { return f.id === id; });
    if (i < 0) return false;
    this.data.floors.splice(i, 1);
    if (this.data.active_floor === id) this.data.active_floor = this.data.floors[0].id;
    return true;
  };

  Doc.prototype.duplicateFloor = function (id) {
    var src = this.floorById(id || this.data.active_floor);
    if (!src) return null;
    var copy = clone(src);
    copy.id = uid('fl_');
    copy.name = src.name + ' (copy)';
    copy.level = this.data.floors.length + 1;
    /* Fresh ids throughout, or the copy's doors would point at the ORIGINAL
     * floor's wall ids and follow walls on a different storey. */
    var idMap = {};
    (copy.walls || []).forEach(function (w) { var old = w.id; w.id = uid('w_'); idMap[old] = w.id; });
    ['doors', 'windows'].forEach(function (k) {
      (copy[k] || []).forEach(function (op) {
        op.id = uid(k.charAt(0) + '_');
        if (op.wallId && idMap[op.wallId]) op.wallId = idMap[op.wallId];
        else delete op.wallId;
      });
    });
    ['objects', 'symbols', 'texts', 'measurements', 'freehand', 'zones'].forEach(function (k) {
      (copy[k] || []).forEach(function (el) { el.id = uid(k.charAt(0) + '_'); });
    });
    this.data.floors.push(copy);
    this.data.active_floor = copy.id;
    return copy;
  };

  /* ----------------------------------------------------------------- undo */

  Doc.prototype.pushUndo = function () {
    this.undoStack.push(JSON.stringify(this.data));
    if (this.undoStack.length > UNDO_LIMIT) this.undoStack.shift();
    this.redoStack.length = 0;
    this.dirty = true;
  };

  Doc.prototype.undo = function () {
    if (!this.undoStack.length) return false;
    this.redoStack.push(JSON.stringify(this.data));
    this.data = JSON.parse(this.undoStack.pop());
    return true;
  };

  Doc.prototype.redo = function () {
    if (!this.redoStack.length) return false;
    this.undoStack.push(JSON.stringify(this.data));
    this.data = JSON.parse(this.redoStack.pop());
    return true;
  };

  Doc.prototype.canUndo = function () { return this.undoStack.length > 0; };
  Doc.prototype.canRedo = function () { return this.redoStack.length > 0; };

  /* ---------------------------------------------------------------- zones */

  Doc.prototype.recomputeZone = function (z) {
    if (!G || !z || !z.poly || z.poly.length < 3) return z;
    var areaPx = G.polyArea(z.poly);
    z.area_px = areaPx;
    z.area_sqft = Math.round(G.areaPxToSqFt(areaPx, this.data.scale_px_per_ft) * 10) / 10;
    z.perimeter_ft = Math.round(G.pxToFeet(G.polyPerimeter(z.poly), this.data.scale_px_per_ft) * 10) / 10;
    var c = G.polyCentroid(z.poly);
    z.cx = c.x; z.cy = c.y;
    return z;
  };

  Doc.prototype.addZone = function (poly, props) {
    var z = Object.assign({
      id: uid('z_'), name: '', use: '', color: '#3b82f6', poly: poly, label_dx: 0, label_dy: 0
    }, props || {});
    this.recomputeZone(z);
    this.list('zones').push(z);
    return z;
  };

  /* Total enclosed area on a floor. Overlapping zones would double-count, which
   * matters because this figure can be pushed to page 8's fire-flow calc — so
   * zones flagged excluded (mezzanines, voids) are left out. */
  Doc.prototype.floorAreaSqFt = function (floorId) {
    var f = floorId ? this.floorById(floorId) : this.floor();
    if (!f) return 0;
    var t = 0;
    (f.zones || []).forEach(function (z) { if (!z.exclude_from_total) t += (z.area_sqft || 0); });
    return Math.round(t * 10) / 10;
  };

  Doc.prototype.buildingAreaSqFt = function () {
    var self = this, t = 0;
    this.data.floors.forEach(function (f) { t += self.floorAreaSqFt(f.id); });
    return Math.round(t * 10) / 10;
  };

  /* --------------------------------------------------------------- legend */

  /* The legend is DERIVED, never stored as content — a stored legend goes stale
   * the moment a symbol is deleted, and a legend that lists a Knox box which is
   * no longer on the plan is worse than no legend at all. */
  Doc.prototype.buildLegend = function (symbolIndex) {
    var counts = {};
    var f = this.floor();
    (f.symbols || []).forEach(function (s) {
      var def = symbolIndex && symbolIndex[s.symbolId];
      /* An id with no catalog art still gets a readable name — the legend used
       * to print raw ids like "gas_shutoff" straight onto the IC's plan. */
      var pretty = String(s.symbolId || 'Marker').replace(/[_-]+/g, ' ')
        .replace(/\b\w/g, function (c) { return c.toUpperCase(); });
      var label = (def && def.label) || s.label || pretty;
      var k = 'sym:' + (s.symbolId || label);
      if (!counts[k]) counts[k] = { kind: 'symbol', symbolId: s.symbolId, label: label, count: 0 };
      counts[k].count++;
    });
    (f.objects || []).forEach(function (o) {
      var label = o.label || o.type || 'Object';
      var k = 'obj:' + label;
      if (!counts[k]) counts[k] = { kind: 'object', type: o.type, label: label, count: 0 };
      counts[k].count++;
    });
    var out = Object.keys(counts).map(function (k) { return counts[k]; });
    out.sort(function (a, b) {
      if (b.count !== a.count) return b.count - a.count;
      return String(a.label).localeCompare(String(b.label));
    });
    return out;
  };

  /* --------------------------------------------------------------- storage */

  function readPlan() {
    try { return JSON.parse(localStorage.getItem(PLAN_KEY) || '{}'); } catch (e) { return {}; }
  }

  function writePlan(patch) {
    /* Rule 2 of the storage split: a key ABSENT from a write means unchanged,
     * so read-modify-write the whole object rather than posting a fragment. */
    var plan = readPlan();
    Object.keys(patch).forEach(function (k) { plan[k] = patch[k]; });
    localStorage.setItem(PLAN_KEY, JSON.stringify(plan));
    return plan;
  }

  /* Write the active floor's arrays to the top level so v4 readers still work.
   * Called on every save. */
  function mirrorLegacy(doc) {
    var d = doc.data, f = doc.floor();
    LEGACY_LISTS.forEach(function (k) { d[k] = f[k] || []; });
    d.zones = f.zones || [];
    return d;
  }

  Doc.prototype.serialize = function () {
    mirrorLegacy(this);
    return this.data;
  };

  Doc.prototype.save = function (extra) {
    var patch = { floor_plan_data: this.serialize() };
    if (extra) Object.keys(extra).forEach(function (k) { patch[k] = extra[k]; });
    writePlan(patch);
    this.dirty = false;
    return patch.floor_plan_data;
  };

  function loadDoc() {
    var plan = readPlan();
    var d = plan.floor_plan_data;
    if (!d || typeof d !== 'object') return null;
    return new Doc(d);
  }

  /* Statistics for the status bar / meta line. */
  Doc.prototype.counts = function () {
    var f = this.floor(), out = {};
    FLOOR_LISTS.forEach(function (k) { out[k] = (f[k] || []).length; });
    return out;
  };

  Doc.prototype.isEmpty = function () {
    var c = this.counts();
    var total = 0;
    FLOOR_LISTS.forEach(function (k) { total += c[k]; });
    return total === 0 && !this.floor().underlay;
  };

  return {
    SCHEMA_VERSION: SCHEMA_VERSION,
    PLAN_KEY: PLAN_KEY,
    FLOOR_LISTS: FLOOR_LISTS,
    LEGACY_LISTS: LEGACY_LISTS,
    DEFAULT_LAYERS: DEFAULT_LAYERS,
    Doc: Doc,
    uid: uid,
    clone: clone,
    emptyPlan: emptyPlan,
    emptyFloor: emptyFloor,
    migrate: migrate,
    isV5: isV5,
    readPlan: readPlan,
    writePlan: writePlan,
    loadDoc: loadDoc,
    adoptOpenings: adoptOpenings,
    ensureWallIds: ensureWallIds
  };
});
