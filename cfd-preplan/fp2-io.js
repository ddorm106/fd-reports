/* fp2-io.js — everything that comes into or leaves the Floor Plan editor.
 *
 * Three ways a DivisionScan capture reaches this page, and all three land here:
 *   1. "Load Latest" / ?job=<id>   -> GET /api/jobs/... (the Worker's shape)
 *   2. a .json file dropped or picked in the browser (the app's Share sheet)
 *   3. a payload already converted to canvas px by the Worker (ai_form_data.layout)
 *
 * v4 handled 1 and 3 and threw away two things worth keeping:
 *   - scan.rooms[]  — the app already named the rooms; they become zones here
 *   - the app's own door.wallId — the app ALREADY hosts openings on walls, so
 *     re-deriving that on this end was throwing away better information.
 *
 * Field names below were read off ScanManager.swift / MarkerModels.swift, not
 * guessed. Lengths in a raw scan are FEET and angles are RADIANS.
 */
(function (root, factory) {
  var api = factory(
    root && root.FPGeom ? root.FPGeom : (typeof require === 'function' ? require('./fp2-geom.js') : null),
    root && root.FPModel ? root.FPModel : (typeof require === 'function' ? require('./fp2-model.js') : null)
  );
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.FPIO = api;
})(typeof window !== 'undefined' ? window : null, function (G, M) {
  'use strict';

  var DEFAULT_SCALE = 12;      // px per foot, the historic page-11 value
  var PADDING = 80;            // px of margin around an imported building
  var MAX_CANVAS = 4000;       // px; beyond this the browser canvas gets unhappy

  function uid(p) { return M ? M.uid(p) : (p || '') + Math.random().toString(36).slice(2, 8); }
  function radToDeg(r) { return (r || 0) * 180 / Math.PI; }
  function num(v) { return typeof v === 'number' && isFinite(v) ? v : null; }

  /* The app's marker ids and this page's symbol ids were never reconciled:
   * DivisionScan says `gas_shutoff`, the symbol catalog says `gas-off`. An
   * unmapped id drew NOTHING on the canvas and showed as a raw id in the
   * legend — so the shutoffs and risers, which are the whole reason a marker
   * exists, silently vanished on import.
   *
   * Left side: every markerTypeId in MarkerModels.swift. Right side: the
   * matching id in fp2-symbols.js, or null where the catalog has no art (those
   * fall back to a labelled pin rather than disappearing). */
  var MARKER_ALIASES = {
    annunciator: 'annunciator',
    breaker_panel: 'elec',
    chemical: 'hazmat-store',
    co_detector: 'smoke',
    commercial_kitchen: 'stove',
    electrical_panel: 'elec',
    elevator: 'elevator',
    elevator_controls: 'elevator',
    exit: 'exit',
    exit_sign: 'exit',
    extinguisher: 'extinguisher',
    fdc: 'fdc',
    fdc_freestanding: 'fdc',
    fdc_siamese: 'fdc',
    fdc_standpipe: 'fdc',
    fdc_storz: 'fdc',
    fire_alarm_panel: 'facp',
    fire_hydrant: 'hydrant',
    fire_pump: 'sprinkler',
    flammable: 'hazmat-store',
    gas_shutoff: 'gas-off',
    generator: 'gen',
    hazmat_storage: 'hazmat-store',
    high_voltage: 'powerline',
    hvac: 'hvac',
    junction_box: 'elec',
    knox_box: 'knox',
    loading_dock: 'loading',
    office_building: 'office',
    oxygen: 'co2-tank',
    piv: 'water-off',
    propane: 'propane',
    pull_station: 'pull',
    riser_deluge: 'sprinkler',
    riser_dry: 'sprinkler',
    riser_preaction: 'sprinkler',
    riser_room: 'sprinkler',
    riser_wet: 'sprinkler',
    roof_access: 'roof',
    smoke_control_panel: 'facp',
    smoke_detector: 'smoke',
    sprinkler_riser: 'sprinkler',
    stairwell: 'stairs',
    standpipe: 'standpipe',
    sump_pump: 'machine',
    suppression_system: 'sprinkler',
    warehouse: 'storage',
    water_shutoff: 'water-off',
    /* No art in the catalog — deliberately null so the fallback pin runs. */
    ceiling_fan: null, ceiling_light: null, command_post: null, emergency_light: null,
    fluorescent: null, gfci_outlet: null, light_switch: null, medical_facility: null,
    note: null, outlet: null, outlet_220v: null, recessed_light: null,
    residential: null, school: null, staging: null, thermostat: null, water_heater: null
  };

  /* Map an app marker id onto a symbol id. Already-valid ids pass through, so
   * this is safe to run on payloads that were converted elsewhere. */
  function symbolIdFor(markerTypeId) {
    if (!markerTypeId) return 'note';
    var key = String(markerTypeId);
    if (Object.prototype.hasOwnProperty.call(MARKER_ALIASES, key)) {
      return MARKER_ALIASES[key] || key;      // null -> keep the raw id, drawn as a pin
    }
    return key;
  }

  /* ------------------------------------------------------------ unwrapping */

  /* The same scan arrives wrapped three different ways depending on who sent
   * it. Peeling this off in one place is what stopped a direct upload landing
   * as 'Unnamed' with no geometry — the identical bug the NAS importer had. */
  function unwrap(payload) {
    var p = payload;
    if (!p || typeof p !== 'object') return null;
    if (p.job && typeof p.job === 'object') p = p.job;
    if (p.scan && typeof p.scan === 'object' && (p.scan.walls || p.scan.rooms)) {
      // Direct upload from the app: {scan:{...}, markers:[], photos:[]}
      var merged = Object.assign({}, p.scan);
      if (!merged.markers && p.markers) merged.markers = p.markers;
      if (!merged.photoPins && p.photos) merged.photoPins = p.photos;
      if (p.preplanRecordId) merged.preplanRecordId = p.preplanRecordId;
      return merged;
    }
    if (p.data && typeof p.data === 'object' && p.data.walls) return p.data;
    return p;
  }

  /* -------------------------------------------------------------- parsing */

  /* Path A: the Worker already converted to canvas pixels. Trust it. */
  function fromLayout(layout, scan) {
    var out = {
      canvas_width: layout.canvas_width || 1000,
      canvas_height: layout.canvas_height || 700,
      scale_px_per_ft: layout.scale_px_per_ft || DEFAULT_SCALE,
      walls: (layout.walls || []).map(function (w) { return Object.assign({ id: uid('w_') }, w); }),
      doors: (layout.doors || []).map(function (d) { return Object.assign({ id: uid('d_') }, d); }),
      windows: (layout.windows || []).map(function (w) { return Object.assign({ id: uid('n_') }, w); }),
      objects: (layout.objects || []).map(function (o) { return Object.assign({ id: uid('o_') }, o); }),
      measurements: (layout.measurements || []).map(function (m) { return Object.assign({ id: uid('m_') }, m); }),
      symbols: [], texts: [], freehand: [], zones: [],
      sides: (layout.sides || []).map(function (s) { return Object.assign({}, s); })
    };
    return out;
  }

  /* Path B: raw iOS scan in feet + radians. */
  function fromRawScan(scan, warnings) {
    var xs = [], ys = [];
    function note(x, y) { if (num(x) !== null) xs.push(x); if (num(y) !== null) ys.push(y); }

    (scan.walls || []).forEach(function (w) { note(w.startX, w.startY); note(w.endX, w.endY); });
    ['doors', 'windows', 'openings', 'objects', 'markers', 'textAnnotations'].forEach(function (k) {
      (scan[k] || []).forEach(function (e) { note(e.x, e.y); });
    });
    (scan.rooms || []).forEach(function (r) { note(r.centerX, r.centerY); });

    if (!xs.length || !ys.length) return null;

    var minX = Math.min.apply(null, xs), maxX = Math.max.apply(null, xs);
    var minY = Math.min.apply(null, ys), maxY = Math.max.apply(null, ys);
    var spanX = Math.max(maxX - minX, 1), spanY = Math.max(maxY - minY, 1);

    /* Clamp the scale so a 300 ft building does not demand a 3,600 px canvas.
     * The PCFD footprint shells hit this — big buildings come out at ~7 px/ft,
     * not 12, and every consumer must read scale_px_per_ft rather than assume. */
    var scale = DEFAULT_SCALE;
    var need = Math.max(spanX, spanY) * scale + PADDING * 2;
    if (need > MAX_CANVAS) {
      scale = (MAX_CANVAS - PADDING * 2) / Math.max(spanX, spanY);
      warnings.push('Large building: scale set to ' + (Math.round(scale * 10) / 10) + ' px/ft to fit the canvas.');
    }

    var tx = function (ft) { return (ft - minX) * scale + PADDING; };
    var ty = function (ft) { return (ft - minY) * scale + PADDING; };

    var out = {
      canvas_width: Math.ceil(spanX * scale) + PADDING * 2,
      canvas_height: Math.ceil(spanY * scale) + PADDING * 2,
      scale_px_per_ft: scale,
      walls: [], doors: [], windows: [], objects: [], symbols: [], texts: [],
      measurements: [], freehand: [], zones: []
    };

    /* Wall ids: the app's UUIDs are what its doors reference, so keep a map
     * from the app's id to ours and re-point the openings through it. */
    var idMap = {};
    (scan.walls || []).forEach(function (w) {
      if (num(w.startX) === null || num(w.endX) === null) return;
      var id = uid('w_');
      if (w.id) idMap[String(w.id)] = id;
      out.walls.push({
        id: id,
        x1: tx(w.startX), y1: ty(w.startY),
        x2: tx(w.endX), y2: ty(w.endY),
        height_ft: num(w.height) || null
      });
    });

    function opening(e, kind, typeOverride) {
      if (num(e.x) === null || num(e.y) === null) return null;
      var o = {
        id: uid(kind === 'doors' ? 'd_' : 'n_'),
        x: tx(e.x), y: ty(e.y),
        width: (num(e.width) || 3) * scale,
        angle: radToDeg(e.angle || 0)
      };
      if (typeOverride) o.type = typeOverride;
      else if (e.type) o.type = e.type;
      /* The app sends "inswing"/"outswing"; the renderer wants +1/-1. Storing
       * the raw string meant every imported door drew with the default swing,
       * silently discarding what the crew recorded on scene. */
      if (e.swingDirection) o.swing = /out/i.test(e.swingDirection) ? -1 : 1;
      /* Prefer the app's hosting; fall back to solving it geometrically. */
      var mapped = e.wallId ? idMap[String(e.wallId)] : null;
      if (mapped) {
        o.wallId = mapped;
        var w = out.walls.filter(function (ww) { return ww.id === mapped; })[0];
        if (w) o.t = G.projT(o.x, o.y, w.x1, w.y1, w.x2, w.y2);
      } else {
        var host = G.hostOpening(o.x, o.y, out.walls, Math.max(24, scale * 2));
        if (host) { o.wallId = host.wallId; o.t = host.t; }
      }
      return o;
    }

    (scan.doors || []).forEach(function (d) { var o = opening(d, 'doors'); if (o) out.doors.push(o); });
    (scan.windows || []).forEach(function (w) { var o = opening(w, 'windows'); if (o) out.windows.push(o); });
    /* The page-11 schema has no openings[] of its own and its 2D door renderer
     * only branches on 'double' and 'rollup', so an entryway is imported as a
     * door typed 'entryway' and simply draws as a plain opening. */
    (scan.openings || []).forEach(function (e) {
      var o = opening(e, 'doors', 'entryway');
      if (o) out.doors.push(o);
    });

    (scan.objects || []).forEach(function (o) {
      if (num(o.x) === null) return;
      out.objects.push({
        id: uid('o_'),
        x: tx(o.x), y: ty(o.y),
        width: (num(o.widthFt) || 2) * scale,
        depth: (num(o.depthFt) || 2) * scale,
        height: num(o.heightFt) || null,
        angle: radToDeg(o.angle || 0),
        type: o.category || '', category: o.category || '',
        label: o.label || ''
      });
    });

    /* Markers are the fire-service content — hydrants, shutoffs, Knox, FDC.
     * These were dropped entirely by the v4 importer. */
    (scan.markers || []).forEach(function (m) {
      if (num(m.x) === null) return;
      /* Two spellings reach this loop. The app posts camelCase; both servers
       * store snake_case and Peach's NAS returns its rows verbatim, so a scan
       * loaded on Peach arrives as marker_type_id. Reading only the camelCase
       * form sent every Peach FDC, riser and shutoff to the generic note pin —
       * found live 2026-08-28 with a test import, not by a report, because the
       * symbol still LOOKED placed. */
      var mtid = m.markerTypeId || m.marker_type_id;
      var sym = {
        id: uid('s_'),
        symbolId: symbolIdFor(mtid),
        source_type: mtid || '',
        x: tx(m.x), y: ty(m.y),
        angle: num(m.rotation) || 0,
        note: m.note || '', label: m.label || m.markerName || m.marker_name || ''
      };
      /* An AI-generated symbol placed on the iPad carries its own drawing —
       * the spec exists nowhere else. With it attached, the renderer and the
       * PDF draw the real artwork instead of a labelled pin. */
      if (m.spec && typeof m.spec === 'object' && Array.isArray(m.spec.shapes)) {
        sym.spec = m.spec;
        sym.symbolId = 'custom';
      }
      out.symbols.push(sym);
    });

    (scan.textAnnotations || []).forEach(function (t) {
      if (num(t.x) === null) return;
      out.texts.push({
        id: uid('t_'),
        x: tx(t.x), y: ty(t.y),
        text: t.text || '',
        size: num(t.fontSize) || 14,
        color: t.colorHex || '#475569',
        angle: 0
      });
    });

    var measSrc = scan.savedMeasurements || scan.measurements || [];
    measSrc.forEach(function (m) {
      var ax = num(m.startX) !== null ? m.startX : m.x1;
      var ay = num(m.startY) !== null ? m.startY : m.y1;
      var bx = num(m.endX) !== null ? m.endX : m.x2;
      var by = num(m.endY) !== null ? m.endY : m.y2;
      if ([ax, ay, bx, by].some(function (v) { return num(v) === null; })) return;
      out.measurements.push({ id: uid('m_'), x1: tx(ax), y1: ty(ay), x2: tx(bx), y2: ty(by), label: m.label || '' });
    });

    /* Rooms carry a name, an area and a centre — but no outline. Solve the
     * outline here from the walls at that centre, and keep the app's area as a
     * cross-check: a big disagreement means the walls around that point do not
     * enclose what the app thought they did, which is worth telling the user
     * rather than silently drawing a wrong number on the plan. */
    out._pendingRooms = (scan.rooms || []).map(function (r) {
      if (num(r.centerX) === null) return null;
      return { name: r.name || '', appArea: num(r.area) || 0, x: tx(r.centerX), y: ty(r.centerY) };
    }).filter(Boolean);

    return out;
  }

  /* Turn imported rooms into zones by solving each room's outline. Separate
   * from fromRawScan so it can also be re-run after the user fixes walls. */
  function materializeRooms(floorData, warnings) {
    var pending = floorData._pendingRooms || [];
    delete floorData._pendingRooms;
    if (!pending.length || !G) return 0;
    var made = 0;
    pending.forEach(function (r) {
      var poly = G.faceAtPoint(floorData.walls, r.x, r.y, { closeGap: 8 });
      if (!poly) {
        warnings.push('Room "' + (r.name || 'unnamed') + '" is not enclosed by the scanned walls — no zone created.');
        return;
      }
      var areaPx = G.polyArea(poly);
      var sqft = G.areaPxToSqFt(areaPx, floorData.scale_px_per_ft);
      if (r.appArea > 5) {
        var diff = Math.abs(sqft - r.appArea) / r.appArea * 100;
        if (diff > 20) {
          warnings.push('Room "' + (r.name || 'unnamed') + '": solved ' + Math.round(sqft) +
                        ' sq ft vs the app\'s ' + Math.round(r.appArea) + ' sq ft (' + Math.round(diff) + '% apart).');
        }
      }
      var c = G.polyCentroid(poly);
      floorData.zones.push({
        id: uid('z_'), name: r.name || '', use: '', color: '#3b82f6', poly: poly,
        area_px: areaPx, area_sqft: Math.round(sqft * 10) / 10,
        perimeter_ft: Math.round(G.pxToFeet(G.polyPerimeter(poly), floorData.scale_px_per_ft) * 10) / 10,
        cx: c.x, cy: c.y, label_dx: 0, label_dy: 0, source: 'scan'
      });
      made++;
    });
    return made;
  }

  /* Parse anything into a floor's worth of geometry. Never throws. */
  function parseScan(payload) {
    var warnings = [];
    var scan = unwrap(payload);
    if (!scan) return { ok: false, error: 'Not a readable file.', warnings: warnings };

    var layout = (scan.ai_form_data && scan.ai_form_data.layout) || null;
    var floorData = null;

    if (layout && Array.isArray(layout.walls) && layout.walls.length) {
      floorData = fromLayout(layout, scan);
    } else if (Array.isArray(scan.walls) && scan.walls.length) {
      floorData = fromRawScan(scan, warnings);
      if (!floorData) return { ok: false, error: 'The scan has walls but no usable coordinates.', warnings: warnings };
      materializeRooms(floorData, warnings);
    } else if (Array.isArray(scan.walls)) {
      return { ok: false, error: 'That capture has no walls in it.', warnings: warnings };
    } else {
      return { ok: false, error: 'No floor plan geometry found in that file.', warnings: warnings };
    }

    /* ai_features is the Worker's separate list of detected fire features. */
    if (Array.isArray(scan.ai_features)) {
      scan.ai_features.forEach(function (f) {
        /* Prefer the real marker type id (the worker now sends it); the
         * category is a last resort and was never a symbol - mapping on it
         * turned every CFD marker into a generic pin wearing a label. */
        var fid = f.type || f.marker_type_id || f.category;
        floorData.symbols.push({
          id: uid('s_'), symbolId: symbolIdFor(fid),
          source_type: fid || '',
          x: num(f.x) || 0, y: num(f.y) || 0, angle: 0,
          note: f.note || '', label: f.name || f.marker_name || ''
        });
      });
    }

    var info = scan.buildingInfo || {};
    var meta = {
      scan_id: scan.id || scan.scanId || null,
      building_name: scan.buildingName || scan.building_name || '',
      building_address: scan.buildingAddress || scan.address || '',
      floor_label: scan.floor || '',
      scan_date: scan.scanDate || scan.created_at || null,
      department: scan.department || null,
      compass_heading: num(scan.compassHeading),
      total_area: num(scan.totalArea),
      construction_type: info.constructionType || '',
      occupancy_type: info.occupancyType || '',
      stories: info.stories || null,
      roof_type: info.roofType || '',
      year_built: info.yearBuilt || ''
    };

    var stats = {
      walls: floorData.walls.length, doors: floorData.doors.length,
      windows: floorData.windows.length, objects: floorData.objects.length,
      symbols: floorData.symbols.length, texts: floorData.texts.length,
      measurements: floorData.measurements.length, zones: floorData.zones.length
    };

    /* An area cross-check on the whole building, same reasoning as per-room. */
    if (meta.total_area > 10 && floorData.zones.length) {
      var zs = floorData.zones.reduce(function (t, z) { return t + (z.area_sqft || 0); }, 0);
      if (zs > 0 && Math.abs(zs - meta.total_area) / meta.total_area > 0.25) {
        warnings.push('Zones total ' + Math.round(zs) + ' sq ft but the scan reports ' +
                      Math.round(meta.total_area) + ' sq ft.');
      }
    }

    return { ok: true, floor: floorData, meta: meta, stats: stats, warnings: warnings };
  }

  /* ------------------------------------------------------------- applying */

  /* mode: 'replace' wipes the drawing, 'floor' adds it as a new storey,
   * 'merge' drops it onto the current storey alongside what is there. */
  function applyParsed(doc, parsed, mode, floorName) {
    if (!parsed || !parsed.ok) return false;
    var fd = parsed.floor;
    var d = doc.data;

    if (mode === 'replace') {
      d.floors = [];
      var f0 = M.emptyFloor(floorName || parsed.meta.floor_label || 'Floor 1', 1);
      d.floors.push(f0);
      d.active_floor = f0.id;
    } else if (mode === 'floor') {
      var lvl = d.floors.length + 1;
      var fN = M.emptyFloor(floorName || parsed.meta.floor_label || ('Floor ' + lvl), lvl);
      d.floors.push(fN);
      d.active_floor = fN.id;
    }

    var f = doc.floor();
    var lists = ['walls', 'doors', 'windows', 'objects', 'symbols', 'texts', 'measurements', 'zones'];

    if (mode === 'merge') {
      /* Merging keeps existing geometry, so imported ids must not collide with
       * what is already on the floor. Re-mint and re-point in one pass. */
      var remap = {};
      (fd.walls || []).forEach(function (w) { var o = w.id; w.id = uid('w_'); remap[o] = w.id; });
      ['doors', 'windows'].forEach(function (k) {
        (fd[k] || []).forEach(function (op) {
          op.id = uid(k.charAt(0) + '_');
          if (op.wallId && remap[op.wallId]) op.wallId = remap[op.wallId];
          else delete op.wallId;
        });
      });
      lists.forEach(function (k) {
        (fd[k] || []).forEach(function (el) { if (k !== 'walls' && k !== 'doors' && k !== 'windows') el.id = uid(k.charAt(0) + '_'); });
        f[k] = (f[k] || []).concat(fd[k] || []);
      });
    } else {
      lists.forEach(function (k) { f[k] = fd[k] || []; });
      f.freehand = f.freehand || [];
      d.canvas_width = Math.max(d.canvas_width || 0, fd.canvas_width || 1000);
      d.canvas_height = Math.max(d.canvas_height || 0, fd.canvas_height || 700);
      d.scale_px_per_ft = fd.scale_px_per_ft || DEFAULT_SCALE;
    }

    if (fd.sides) f.sides = fd.sides;
    d.scan_meta = parsed.meta;
    if (parsed.meta.compass_heading != null && d.sheet) d.sheet.north = parsed.meta.compass_heading;
    return true;
  }

  /* ---------------------------------------------------------- network I/O */

  function dept() {
    return (typeof location !== 'undefined' && location.hostname.indexOf('pcfdmembers') >= 0) ? 'PCFD' : 'CFD';
  }

  function fetchJSON(url) {
    return fetch(url, { cache: 'no-store' }).then(function (r) {
      if (!r.ok) throw new Error('HTTP ' + r.status);
      return r.json();
    });
  }

  function listCaptures(limit) {
    return fetchJSON('/api/jobs?dept=' + dept() + '&limit=' + (limit || 20))
      .then(function (l) { return l.jobs || []; });
  }

  function fetchCapture(id) {
    return fetchJSON('/api/jobs/' + encodeURIComponent(id)).then(function (j) { return j.job || j; });
  }

  /* ------------------------------------------------------------ file read */

  function readFileText(file) {
    return new Promise(function (resolve, reject) {
      var fr = new FileReader();
      fr.onload = function () { resolve(String(fr.result || '')); };
      fr.onerror = function () { reject(new Error('Could not read ' + file.name)); };
      fr.readAsText(file);
    });
  }

  function readScanFile(file) {
    return readFileText(file).then(function (txt) {
      var json;
      try { json = JSON.parse(txt); }
      catch (e) { throw new Error(file.name + ' is not valid JSON.'); }
      return parseScan(json);
    });
  }

  /* ------------------------------------------------------- underlay images
   *
   * A traced reference image is stored in the plan, so it has to be small.
   * localStorage is the constraint that has already destroyed data on this app
   * once (two copies of a 2.8 MB plan crossing the quota), so downscale hard
   * and re-encode as JPEG before anything touches storage. */

  var UNDERLAY_MAX_PX = 1800;
  var UNDERLAY_QUALITY = 0.72;

  function downscaleImage(dataURL, maxPx, quality) {
    return new Promise(function (resolve, reject) {
      var im = new Image();
      im.onload = function () {
        var w = im.naturalWidth, h = im.naturalHeight;
        if (!w || !h) { reject(new Error('That image could not be decoded.')); return; }
        var k = Math.min(1, (maxPx || UNDERLAY_MAX_PX) / Math.max(w, h));
        var cw = Math.max(1, Math.round(w * k)), chh = Math.max(1, Math.round(h * k));
        var c = document.createElement('canvas');
        c.width = cw; c.height = chh;
        var cx = c.getContext('2d');
        cx.fillStyle = '#fff';
        cx.fillRect(0, 0, cw, chh);
        cx.drawImage(im, 0, 0, cw, chh);
        resolve({ src: c.toDataURL('image/jpeg', quality || UNDERLAY_QUALITY), w: cw, h: chh, srcW: w, srcH: h });
      };
      im.onerror = function () { reject(new Error('That image could not be decoded.')); };
      im.src = dataURL;
    });
  }

  function readImageFile(file) {
    return new Promise(function (resolve, reject) {
      var fr = new FileReader();
      fr.onload = function () { resolve(String(fr.result || '')); };
      fr.onerror = function () { reject(new Error('Could not read ' + file.name)); };
      fr.readAsDataURL(file);
    }).then(function (url) { return downscaleImage(url, UNDERLAY_MAX_PX, UNDERLAY_QUALITY); });
  }

  /* PDF support is lazy: pdf.js is only fetched when someone actually picks a
   * PDF, so the page costs nothing for the common image case. Fire-marshal
   * life-safety plans arrive as PDFs constantly, which is why this exists. */
  var PDFJS_URL = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js';
  var PDFJS_WORKER = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';
  var pdfjsPromise = null;

  function loadPdfJs() {
    if (pdfjsPromise) return pdfjsPromise;
    pdfjsPromise = new Promise(function (resolve, reject) {
      if (window.pdfjsLib) { resolve(window.pdfjsLib); return; }
      var s = document.createElement('script');
      s.src = PDFJS_URL;
      s.onload = function () {
        if (!window.pdfjsLib) { reject(new Error('pdf.js loaded but did not register.')); return; }
        window.pdfjsLib.GlobalWorkerOptions.workerSrc = PDFJS_WORKER;
        resolve(window.pdfjsLib);
      };
      s.onerror = function () { reject(new Error('Could not load the PDF reader (no network?). Screenshot the plan and use the image instead.')); };
      document.head.appendChild(s);
    });
    return pdfjsPromise;
  }

  function readPdfFile(file, pageNum) {
    return loadPdfJs().then(function (pdfjsLib) {
      return file.arrayBuffer().then(function (buf) {
        return pdfjsLib.getDocument({ data: buf }).promise;
      }).then(function (pdf) {
        var n = Math.min(Math.max(1, pageNum || 1), pdf.numPages);
        return pdf.getPage(n).then(function (page) {
          var vp0 = page.getViewport({ scale: 1 });
          var k = Math.min(3, UNDERLAY_MAX_PX / Math.max(vp0.width, vp0.height));
          var vp = page.getViewport({ scale: k });
          var c = document.createElement('canvas');
          c.width = Math.ceil(vp.width); c.height = Math.ceil(vp.height);
          var cx = c.getContext('2d');
          cx.fillStyle = '#fff'; cx.fillRect(0, 0, c.width, c.height);
          return page.render({ canvasContext: cx, viewport: vp }).promise.then(function () {
            return { src: c.toDataURL('image/jpeg', UNDERLAY_QUALITY), w: c.width, h: c.height,
                     srcW: c.width, srcH: c.height, pages: pdf.numPages, page: n };
          });
        });
      });
    });
  }

  function readUnderlayFile(file, pageNum) {
    var name = (file.name || '').toLowerCase();
    if (file.type === 'application/pdf' || /\.pdf$/.test(name)) return readPdfFile(file, pageNum);
    return readImageFile(file);
  }

  /* Place a freshly loaded underlay so it covers the canvas sensibly. */
  function fitUnderlay(img, canvasW, canvasH) {
    var k = Math.min((canvasW * 0.9) / img.w, (canvasH * 0.9) / img.h);
    var w = img.w * k, h = img.h * k;
    return {
      src: img.src, natural_w: img.w, natural_h: img.h,
      x: (canvasW - w) / 2, y: (canvasH - h) / 2, w: w, h: h,
      rot: 0, opacity: 0.55, locked: false, calibrated: false
    };
  }

  /* Calibrate: the user clicks two points on the underlay and says how far
   * apart they really are. Scale the IMAGE about its own centre so the drawing
   * never moves — the walls already drawn are the reference, not the picture. */
  function calibrateUnderlay(underlay, p1, p2, realFeet, scalePxPerFt) {
    if (!underlay || !realFeet || realFeet <= 0) return null;
    var measuredPx = G.dist(p1.x, p1.y, p2.x, p2.y);
    if (measuredPx < 1) return null;
    var wantPx = realFeet * scalePxPerFt;
    var k = wantPx / measuredPx;
    var cx = underlay.x + underlay.w / 2, cy = underlay.y + underlay.h / 2;
    var nw = underlay.w * k, nh = underlay.h * k;
    underlay.x = cx - nw / 2;
    underlay.y = cy - nh / 2;
    underlay.w = nw;
    underlay.h = nh;
    underlay.calibrated = true;
    underlay.calibration = { feet: realFeet, px: wantPx, factor: k };
    return underlay;
  }

  /* ------------------------------------------------------------- exporting */

  function exportJSON(doc, meta) {
    var payload = {
      exported_from: 'fdtraining cfd-preplan page11 v5',
      exported_at: new Date().toISOString(),
      plan: meta || {},
      floor_plan_data: doc.serialize()
    };
    return JSON.stringify(payload, null, 2);
  }

  function downloadText(filename, text, mime) {
    var blob = new Blob([text], { type: mime || 'application/json' });
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url; a.download = filename;
    document.body.appendChild(a);
    a.click();
    setTimeout(function () { document.body.removeChild(a); URL.revokeObjectURL(url); }, 250);
  }

  return {
    DEFAULT_SCALE: DEFAULT_SCALE,
    MAX_CANVAS: MAX_CANVAS,
    unwrap: unwrap,
    MARKER_ALIASES: MARKER_ALIASES,
    symbolIdFor: symbolIdFor,
    parseScan: parseScan,
    materializeRooms: materializeRooms,
    applyParsed: applyParsed,
    listCaptures: listCaptures,
    fetchCapture: fetchCapture,
    dept: dept,
    readScanFile: readScanFile,
    readUnderlayFile: readUnderlayFile,
    readImageFile: readImageFile,
    downscaleImage: downscaleImage,
    fitUnderlay: fitUnderlay,
    calibrateUnderlay: calibrateUnderlay,
    exportJSON: exportJSON,
    downloadText: downloadText
  };
});
