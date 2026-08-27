/* fp2-geom.js — geometry engine for the Floor Plan editor (v5 rebuild).
 *
 * Pure functions only: no DOM, no canvas, no globals beyond the export at the
 * bottom. That is deliberate — every algorithm in here can be exercised from
 * node with plain assertions, which is the only practical way to know a zone
 * area or a corner solve is right without a browser round-trip.
 *
 * Units: everything is in PLAN PIXELS (the floor_plan_data coordinate space).
 * Feet come from scale_px_per_ft at the edges, never in the middle of a solve.
 */
(function (root, factory) {
  var api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.FPGeom = api;
})(typeof window !== 'undefined' ? window : null, function () {
  'use strict';

  var EPS = 1e-9;

  /* ---------------------------------------------------------------- basics */

  function dist(x1, y1, x2, y2) { return Math.hypot(x2 - x1, y2 - y1); }

  function wallLength(w) { return dist(w.x1, w.y1, w.x2, w.y2); }

  /* Projection parameter of p onto segment ab, clamped to [0,1]. */
  function projT(px, py, x1, y1, x2, y2) {
    var dx = x2 - x1, dy = y2 - y1;
    var len2 = dx * dx + dy * dy;
    if (len2 < EPS) return 0;
    var t = ((px - x1) * dx + (py - y1) * dy) / len2;
    return t < 0 ? 0 : (t > 1 ? 1 : t);
  }

  /* Perpendicular distance from p to the SEGMENT ab (not the infinite line). */
  function pointToSeg(px, py, x1, y1, x2, y2) {
    var t = projT(px, py, x1, y1, x2, y2);
    return dist(px, py, x1 + (x2 - x1) * t, y1 + (y2 - y1) * t);
  }

  function segMid(w) { return { x: (w.x1 + w.x2) / 2, y: (w.y1 + w.y2) / 2 }; }

  /* Intersection of two INFINITE lines, each given by a point and a direction.
   * Returns null when they are within `minAngleDeg` of parallel — an
   * ill-conditioned corner is worse than no corner, the same lesson the Sight
   * Trace work learned on shallow cuts. */
  function lineIntersect(p1, d1, p2, d2, minAngleDeg) {
    var minA = (minAngleDeg == null ? 8 : minAngleDeg) * Math.PI / 180;
    var n1 = Math.hypot(d1.x, d1.y), n2 = Math.hypot(d2.x, d2.y);
    if (n1 < EPS || n2 < EPS) return null;
    var u1 = { x: d1.x / n1, y: d1.y / n1 }, u2 = { x: d2.x / n2, y: d2.y / n2 };
    var cross = u1.x * u2.y - u1.y * u2.x;
    if (Math.abs(cross) < Math.sin(minA)) return null;
    var t = ((p2.x - p1.x) * u2.y - (p2.y - p1.y) * u2.x) / cross;
    return { x: p1.x + u1.x * t, y: p1.y + u1.y * t };
  }

  /* Do two segments cross? Used for self-intersection checks. */
  function segIntersect(a1, a2, b1, b2) {
    function cr(o, a, b) { return (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x); }
    var d1 = cr(b1, b2, a1), d2 = cr(b1, b2, a2), d3 = cr(a1, a2, b1), d4 = cr(a1, a2, b2);
    if (((d1 > 0 && d2 < 0) || (d1 < 0 && d2 > 0)) &&
        ((d3 > 0 && d4 < 0) || (d3 < 0 && d4 > 0))) {
      var t = d3 / (d3 - d4);
      return { x: b1.x + t * (b2.x - b1.x), y: b1.y + t * (b2.y - b1.y) };
    }
    return null;
  }

  function angleOf(x1, y1, x2, y2) { return Math.atan2(y2 - y1, x2 - x1); }

  /* Smallest absolute difference between two headings, in radians, folded into
   * [0, PI/2] so a wall and its reverse count as the same direction. */
  function angleDiffFolded(a, b) {
    var d = Math.abs(a - b) % Math.PI;
    if (d > Math.PI / 2) d = Math.PI - d;
    return d;
  }

  /* --------------------------------------------------------------- polygons */

  /* Shoelace. Returns SIGNED area: positive when counter-clockwise in a
   * y-down screen space means clockwise on paper — callers should use
   * Math.abs() unless they specifically want winding. */
  function polyAreaSigned(pts) {
    var n = pts.length, s = 0;
    if (n < 3) return 0;
    for (var i = 0; i < n; i++) {
      var j = (i + 1) % n;
      s += pts[i].x * pts[j].y - pts[j].x * pts[i].y;
    }
    return s / 2;
  }

  function polyArea(pts) { return Math.abs(polyAreaSigned(pts)); }

  function polyPerimeter(pts) {
    var n = pts.length, s = 0;
    if (n < 2) return 0;
    for (var i = 0; i < n; i++) {
      var j = (i + 1) % n;
      s += dist(pts[i].x, pts[i].y, pts[j].x, pts[j].y);
    }
    return s;
  }

  /* Area-weighted centroid. Falls back to the vertex mean for degenerate
   * (zero-area) rings so a label still lands somewhere sane. */
  function polyCentroid(pts) {
    var n = pts.length;
    if (!n) return { x: 0, y: 0 };
    var a = polyAreaSigned(pts);
    if (Math.abs(a) < EPS) {
      var sx = 0, sy = 0;
      for (var k = 0; k < n; k++) { sx += pts[k].x; sy += pts[k].y; }
      return { x: sx / n, y: sy / n };
    }
    var cx = 0, cy = 0;
    for (var i = 0; i < n; i++) {
      var j = (i + 1) % n;
      var f = pts[i].x * pts[j].y - pts[j].x * pts[i].y;
      cx += (pts[i].x + pts[j].x) * f;
      cy += (pts[i].y + pts[j].y) * f;
    }
    return { x: cx / (6 * a), y: cy / (6 * a) };
  }

  function pointInPoly(px, py, pts) {
    var inside = false, n = pts.length;
    for (var i = 0, j = n - 1; i < n; j = i++) {
      var xi = pts[i].x, yi = pts[i].y, xj = pts[j].x, yj = pts[j].y;
      if (((yi > py) !== (yj > py)) && (px < (xj - xi) * (py - yi) / (yj - yi + EPS) + xi)) {
        inside = !inside;
      }
    }
    return inside;
  }

  function bbox(pts) {
    var b = { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity };
    for (var i = 0; i < pts.length; i++) {
      if (pts[i].x < b.minX) b.minX = pts[i].x;
      if (pts[i].y < b.minY) b.minY = pts[i].y;
      if (pts[i].x > b.maxX) b.maxX = pts[i].x;
      if (pts[i].y > b.maxY) b.maxY = pts[i].y;
    }
    return b;
  }

  function wallsBBox(walls, pad) {
    var pts = [];
    for (var i = 0; i < walls.length; i++) {
      pts.push({ x: walls[i].x1, y: walls[i].y1 });
      pts.push({ x: walls[i].x2, y: walls[i].y2 });
    }
    var b = bbox(pts);
    var p = pad || 0;
    return { minX: b.minX - p, minY: b.minY - p, maxX: b.maxX + p, maxY: b.maxY + p };
  }

  /* Douglas-Peucker on an OPEN path. */
  function simplifyPath(pts, eps) {
    if (pts.length < 3) return pts.slice();
    var first = 0, last = pts.length - 1;
    var keep = new Array(pts.length);
    keep[first] = keep[last] = true;
    (function rec(i, j) {
      if (j <= i + 1) return;
      var maxD = -1, idx = -1;
      for (var k = i + 1; k < j; k++) {
        var d = pointToSeg(pts[k].x, pts[k].y, pts[i].x, pts[i].y, pts[j].x, pts[j].y);
        if (d > maxD) { maxD = d; idx = k; }
      }
      if (maxD > eps) { keep[idx] = true; rec(i, idx); rec(idx, j); }
    })(first, last);
    var out = [];
    for (var i2 = 0; i2 < pts.length; i2++) if (keep[i2]) out.push(pts[i2]);
    return out;
  }

  /* Douglas-Peucker on a CLOSED ring. Rotates the ring so it starts at the
   * vertex furthest from the centroid — otherwise the arbitrary start vertex is
   * pinned and a real corner near it gets shaved off. */
  function simplifyRing(pts, eps) {
    if (pts.length < 4) return pts.slice();
    var c = polyCentroid(pts), best = 0, bestD = -1;
    for (var i = 0; i < pts.length; i++) {
      var d = dist(pts[i].x, pts[i].y, c.x, c.y);
      if (d > bestD) { bestD = d; best = i; }
    }
    var rot = pts.slice(best).concat(pts.slice(0, best));
    rot.push({ x: rot[0].x, y: rot[0].y });
    var simp = simplifyPath(rot, eps);
    simp.pop();
    return simp;
  }

  /* Drop vertices whose two edges are near-collinear. Runs after DP because DP
   * leaves stair-step residue on diagonal walls. */
  function mergeCollinear(pts, angleTolDeg) {
    var tol = (angleTolDeg == null ? 6 : angleTolDeg) * Math.PI / 180;
    if (pts.length < 4) return pts.slice();
    var out = pts.slice(), changed = true;
    while (changed && out.length > 3) {
      changed = false;
      for (var i = 0; i < out.length; i++) {
        var p = out[(i - 1 + out.length) % out.length], q = out[i], r = out[(i + 1) % out.length];
        var a1 = angleOf(p.x, p.y, q.x, q.y), a2 = angleOf(q.x, q.y, r.x, r.y);
        var d = Math.abs(a1 - a2);
        while (d > Math.PI) d = Math.abs(d - 2 * Math.PI);
        if (d < tol) { out.splice(i, 1); changed = true; break; }
      }
    }
    return out;
  }

  /* ------------------------------------------------------- zone / face find
   *
   * Why a raster flood fill and not a planar-graph cycle walk: hand-traced and
   * LiDAR-derived walls do not meet exactly. A graph solve needs the corners to
   * be topologically shared, and when they are 3 px apart it reports "not
   * enclosed" and the operator has no idea which corner to fix. Filling a
   * rasterised mask with the walls DILATED by a tolerance closes those gaps the
   * same way the eye does, and it does not care whether walls are orthogonal,
   * angled, or curved — which matters here, because the Belk is full of angled
   * walls and nothing may assume 90 degrees.
   */

  function makeGrid(bb, cell) {
    var w = Math.max(2, Math.ceil((bb.maxX - bb.minX) / cell) + 2);
    var h = Math.max(2, Math.ceil((bb.maxY - bb.minY) / cell) + 2);
    return {
      w: w, h: h, cell: cell,
      x0: bb.minX - cell, y0: bb.minY - cell,
      g: new Uint8Array(w * h)
    };
  }

  function gridStamp(grid, cx, cy, r) {
    var ri = Math.ceil(r / grid.cell);
    var gx = Math.round((cx - grid.x0) / grid.cell);
    var gy = Math.round((cy - grid.y0) / grid.cell);
    for (var dy = -ri; dy <= ri; dy++) {
      var y = gy + dy;
      if (y < 0 || y >= grid.h) continue;
      for (var dx = -ri; dx <= ri; dx++) {
        var x = gx + dx;
        if (x < 0 || x >= grid.w) continue;
        if (dx * dx + dy * dy <= ri * ri) grid.g[y * grid.w + x] = 1;
      }
    }
  }

  /* Rasterise wall segments as thick strokes. `thick` is the closing tolerance
   * in plan px — it is what bridges small gaps at corners. */
  function rasterizeWalls(walls, grid, thick) {
    var r = Math.max(grid.cell, thick / 2);
    for (var i = 0; i < walls.length; i++) {
      var w = walls[i];
      var len = wallLength(w);
      var steps = Math.max(1, Math.ceil(len / (grid.cell * 0.5)));
      for (var s = 0; s <= steps; s++) {
        var t = s / steps;
        gridStamp(grid, w.x1 + (w.x2 - w.x1) * t, w.y1 + (w.y2 - w.y1) * t, r);
      }
    }
    return grid;
  }

  /* 4-connected flood from a seed. Returns null if the fill escapes to the grid
   * border (i.e. the point is outside the building / the room leaks). */
  function floodRegion(grid, seedX, seedY) {
    var sx = Math.round((seedX - grid.x0) / grid.cell);
    var sy = Math.round((seedY - grid.y0) / grid.cell);
    if (sx < 0 || sy < 0 || sx >= grid.w || sy >= grid.h) return null;
    if (grid.g[sy * grid.w + sx]) return null;           // seed landed on a wall
    var seen = new Uint8Array(grid.w * grid.h);
    var stack = [sy * grid.w + sx];
    var cells = [];
    seen[stack[0]] = 1;
    var escaped = false;
    while (stack.length) {
      var idx = stack.pop();
      var y = (idx / grid.w) | 0, x = idx - y * grid.w;
      if (x === 0 || y === 0 || x === grid.w - 1 || y === grid.h - 1) escaped = true;
      cells.push(idx);
      var nb = [idx - 1, idx + 1, idx - grid.w, idx + grid.w];
      for (var k = 0; k < 4; k++) {
        var n = nb[k];
        if (n < 0 || n >= seen.length) continue;
        if (k === 0 && x === 0) continue;
        if (k === 1 && x === grid.w - 1) continue;
        if (seen[n] || grid.g[n]) continue;
        seen[n] = 1;
        stack.push(n);
      }
    }
    if (escaped) return null;
    return { cells: cells, seen: seen };
  }

  /* Boundary of a filled cell set, as a closed ring in plan coordinates.
   * Collects the unit edges between filled and unfilled cells and chains them.
   * Produces an axis-aligned staircase, which the caller then simplifies. */
  function regionOutline(grid, region) {
    var seen = region.seen, W = grid.w;
    var edges = new Map();
    function key(x, y) { return x + ',' + y; }
    function addEdge(ax, ay, bx, by) {
      var k = key(ax, ay);
      if (!edges.has(k)) edges.set(k, []);
      edges.get(k).push({ x: bx, y: by });
    }
    for (var i = 0; i < region.cells.length; i++) {
      var idx = region.cells[i];
      var y = (idx / W) | 0, x = idx - y * W;
      var up = y > 0 ? seen[idx - W] : 0;
      var dn = y < grid.h - 1 ? seen[idx + W] : 0;
      var lf = x > 0 ? seen[idx - 1] : 0;
      var rt = x < W - 1 ? seen[idx + 1] : 0;
      /* Wind each boundary edge consistently (clockwise around the region) so
       * the chain has a unique successor at every node. */
      if (!up) addEdge(x, y, x + 1, y);
      if (!rt) addEdge(x + 1, y, x + 1, y + 1);
      if (!dn) addEdge(x + 1, y + 1, x, y + 1);
      if (!lf) addEdge(x, y + 1, x, y);
    }
    if (!edges.size) return null;
    // Walk the longest chain we can build.
    var startKey = edges.keys().next().value;
    var parts = startKey.split(',');
    var cur = { x: +parts[0], y: +parts[1] };
    var ring = [cur];
    var guard = edges.size * 4 + 16;
    while (guard-- > 0) {
      var k = key(cur.x, cur.y);
      var outs = edges.get(k);
      if (!outs || !outs.length) break;
      var next = outs.shift();
      if (!outs.length) edges.delete(k);
      cur = next;
      if (cur.x === ring[0].x && cur.y === ring[0].y) break;
      ring.push(cur);
    }
    if (ring.length < 4) return null;
    return ring.map(function (p) {
      return { x: grid.x0 + p.x * grid.cell, y: grid.y0 + p.y * grid.cell };
    });
  }

  /* Snap a rough (staircase) ring onto the actual wall lines.
   *
   * For each edge of the simplified ring, find the wall that is both nearly
   * parallel to it and close to it, and adopt that wall's infinite line as the
   * edge's support. Corners then become intersections of consecutive supports —
   * exactly the trick Sight Trace uses, and for the same reason: a corner
   * solved from two well-determined lines beats a corner measured directly.
   * Edges with no matching wall keep their original support line. */
  function refineRingToWalls(ring, walls, opts) {
    opts = opts || {};
    var maxDist = opts.maxDist == null ? 14 : opts.maxDist;
    var maxAngleDeg = opts.maxAngle == null ? 12 : opts.maxAngle;
    var maxAngle = maxAngleDeg * Math.PI / 180;
    var n = ring.length;
    if (n < 3 || !walls.length) return ring.slice();

    var supports = [];
    for (var i = 0; i < n; i++) {
      var a = ring[i], b = ring[(i + 1) % n];
      var eAng = angleOf(a.x, a.y, b.x, b.y);
      var mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
      var best = null, bestScore = Infinity;
      for (var j = 0; j < walls.length; j++) {
        var w = walls[j];
        if (wallLength(w) < EPS) continue;
        var wAng = angleOf(w.x1, w.y1, w.x2, w.y2);
        var da = angleDiffFolded(eAng, wAng);
        if (da > maxAngle) continue;
        var d = pointToSeg(mid.x, mid.y, w.x1, w.y1, w.x2, w.y2);
        if (d > maxDist) continue;
        var score = d + da * 30;
        if (score < bestScore) { bestScore = score; best = w; }
      }
      if (best) {
        supports.push({ p: { x: best.x1, y: best.y1 }, d: { x: best.x2 - best.x1, y: best.y2 - best.y1 }, fitted: true });
      } else {
        supports.push({ p: a, d: { x: b.x - a.x, y: b.y - a.y }, fitted: false });
      }
    }

    var out = [];
    for (var k = 0; k < n; k++) {
      var prev = supports[(k - 1 + n) % n], cur = supports[k];
      var p = lineIntersect(prev.p, prev.d, cur.p, cur.d, 8);
      /* Reject a solve that flies off — near-parallel supports throw the corner
       * a long way, and the raw vertex is then the honest answer. */
      if (p && dist(p.x, p.y, ring[k].x, ring[k].y) <= Math.max(maxDist * 2.5, 30)) out.push(p);
      else out.push({ x: ring[k].x, y: ring[k].y });
    }
    return out;
  }

  /* Find the enclosed face containing (px,py).
   * opts: { closeGap, cell, simplify, refine }  — all in plan px. */
  function faceAtPoint(walls, px, py, opts) {
    opts = opts || {};
    if (!walls || walls.length < 3) return null;
    var closeGap = opts.closeGap == null ? 6 : opts.closeGap;
    var bb = wallsBBox(walls, Math.max(20, closeGap * 3));
    if (px < bb.minX || px > bb.maxX || py < bb.minY || py > bb.maxY) return null;

    /* Cell size trades accuracy for speed. Cap the grid so a huge building
     * (the Belk is ~97,000 sq ft) does not allocate tens of megabytes. */
    var span = Math.max(bb.maxX - bb.minX, bb.maxY - bb.minY);
    var cell = opts.cell || Math.max(1, Math.min(4, span / 700));
    var grid = makeGrid(bb, cell);
    rasterizeWalls(walls, grid, Math.max(closeGap, cell * 1.5));

    var region = floodRegion(grid, px, py);
    if (!region) return null;
    var areaPx = region.cells.length * cell * cell;
    if (areaPx < (opts.minArea == null ? 25 : opts.minArea)) return null;

    var ring = regionOutline(grid, region);
    if (!ring) return null;
    var simp = simplifyRing(ring, opts.simplify == null ? Math.max(2.5, cell * 1.4) : opts.simplify);
    simp = mergeCollinear(simp, 7);
    if (simp.length < 3) return null;
    if (opts.refine !== false) {
      simp = refineRingToWalls(simp, walls, { maxDist: Math.max(14, closeGap * 2.5) });
      simp = mergeCollinear(simp, 4);
    }
    return simp.length >= 3 ? simp : null;
  }

  /* Sweep the building on a coarse lattice and return every distinct enclosed
   * face. Used by "Detect rooms". Dedupes by centroid + area. */
  function detectAllFaces(walls, opts) {
    opts = opts || {};
    if (!walls || walls.length < 3) return [];
    var bb = wallsBBox(walls, 4);
    var step = opts.step || Math.max(6, Math.min(28, Math.max(bb.maxX - bb.minX, bb.maxY - bb.minY) / 60));
    var found = [];
    var minArea = opts.minAreaPx == null ? 400 : opts.minAreaPx;
    for (var y = bb.minY + step / 2; y < bb.maxY; y += step) {
      for (var x = bb.minX + step / 2; x < bb.maxX; x += step) {
        var already = false;
        for (var f = 0; f < found.length; f++) {
          if (pointInPoly(x, y, found[f].poly)) { already = true; break; }
        }
        if (already) continue;
        var poly = faceAtPoint(walls, x, y, opts);
        if (!poly) continue;
        var a = polyArea(poly);
        if (a < minArea) continue;
        var c = polyCentroid(poly);
        var dup = false;
        for (var g = 0; g < found.length; g++) {
          if (Math.abs(found[g].area - a) / Math.max(a, 1) < 0.05 &&
              dist(c.x, c.y, found[g].centroid.x, found[g].centroid.y) < step) { dup = true; break; }
        }
        if (!dup) found.push({ poly: poly, area: a, centroid: c });
      }
    }
    found.sort(function (a, b) { return b.area - a.area; });
    return found;
  }

  /* ------------------------------------------------------------- snapping */

  /* Snap a raw pointer position against the drawing.
   *
   * Returns { x, y, snap, guides }. `snap` names what caught it so the UI can
   * draw the right glyph — an operator who cannot see WHY a point jumped does
   * not trust the tool, which is the Sight Trace lesson restated.
   *
   * ctx: { walls, zones, origin, gridSize, ortho, angleStep, tol,
   *        excludeWallId, useGrid, useAlign } */
  function snapPoint(x, y, c) {
    c = c || {};
    var tol = c.tol == null ? 12 : c.tol;
    var walls = c.walls || [];
    var best = null;

    function offer(nx, ny, kind, prio, extra) {
      var d = dist(x, y, nx, ny);
      if (d > tol) return;
      var score = d - prio * 3;
      if (!best || score < best.score) {
        best = { x: nx, y: ny, snap: kind, score: score, d: d, ref: extra || null };
      }
    }

    // 1. Wall endpoints — the strongest snap, because a shared corner is what
    //    makes a room read as enclosed at all.
    for (var i = 0; i < walls.length; i++) {
      var w = walls[i];
      if (c.excludeWallId && w.id === c.excludeWallId) continue;
      offer(w.x1, w.y1, 'endpoint', 4, w);
      offer(w.x2, w.y2, 'endpoint', 4, w);
    }
    // 2. Midpoints.
    for (var m = 0; m < walls.length; m++) {
      var wm = walls[m];
      if (c.excludeWallId && wm.id === c.excludeWallId) continue;
      var mid = segMid(wm);
      offer(mid.x, mid.y, 'midpoint', 2, wm);
    }
    // 3. Wall intersections near the cursor.
    for (var a = 0; a < walls.length; a++) {
      for (var b = a + 1; b < walls.length; b++) {
        var wa = walls[a], wb = walls[b];
        var ip = segIntersect({ x: wa.x1, y: wa.y1 }, { x: wa.x2, y: wa.y2 },
                              { x: wb.x1, y: wb.y1 }, { x: wb.x2, y: wb.y2 });
        if (ip) offer(ip.x, ip.y, 'intersection', 3, null);
      }
    }
    // 4. Nearest point ON a wall.
    for (var s = 0; s < walls.length; s++) {
      var ws = walls[s];
      if (c.excludeWallId && ws.id === c.excludeWallId) continue;
      var t = projT(x, y, ws.x1, ws.y1, ws.x2, ws.y2);
      offer(ws.x1 + (ws.x2 - ws.x1) * t, ws.y1 + (ws.y2 - ws.y1) * t, 'onwall', 0, ws);
    }
    // 5. Grid.
    if (c.useGrid && c.gridSize > 0) {
      offer(Math.round(x / c.gridSize) * c.gridSize, Math.round(y / c.gridSize) * c.gridSize, 'grid', -1, null);
    }

    var res = best ? { x: best.x, y: best.y, snap: best.snap, ref: best.ref, guides: [] }
                   : { x: x, y: y, snap: null, ref: null, guides: [] };

    /* Alignment guides: line up with an existing corner in x or y. Applied
     * AFTER the point snaps, and only on the axes the snap did not already
     * pin, so it can never fight an endpoint snap. */
    if (c.useAlign !== false && !best) {
      var gTol = c.alignTol == null ? 7 : c.alignTol;
      var bestX = null, bestY = null;
      for (var q = 0; q < walls.length; q++) {
        var wq = walls[q];
        var cand = [{ x: wq.x1, y: wq.y1 }, { x: wq.x2, y: wq.y2 }];
        for (var e = 0; e < 2; e++) {
          if (Math.abs(cand[e].x - x) < gTol && (!bestX || Math.abs(cand[e].x - x) < Math.abs(bestX.x - x))) bestX = cand[e];
          if (Math.abs(cand[e].y - y) < gTol && (!bestY || Math.abs(cand[e].y - y) < Math.abs(bestY.y - y))) bestY = cand[e];
        }
      }
      if (bestX) { res.x = bestX.x; res.guides.push({ kind: 'v', x: bestX.x, from: bestX }); }
      if (bestY) { res.y = bestY.y; res.guides.push({ kind: 'h', y: bestY.y, from: bestY }); }
      if (res.guides.length) res.snap = res.snap || 'align';
    }
    return res;
  }

  /* Constrain a segment from `origin` to (x,y): ortho lock or fixed angle
   * increments. Applied before snapPoint so a snap can still win. */
  function constrainAngle(ox, oy, x, y, opts) {
    opts = opts || {};
    var dx = x - ox, dy = y - oy;
    var len = Math.hypot(dx, dy);
    if (len < EPS) return { x: x, y: y, locked: false };
    if (opts.ortho) {
      if (Math.abs(dx) >= Math.abs(dy)) return { x: x, y: oy, locked: true, angle: dx >= 0 ? 0 : 180 };
      return { x: ox, y: y, locked: true, angle: dy >= 0 ? 90 : 270 };
    }
    if (opts.angleStep && opts.angleStep > 0) {
      var step = opts.angleStep * Math.PI / 180;
      var a = Math.atan2(dy, dx);
      var snapped = Math.round(a / step) * step;
      return { x: ox + Math.cos(snapped) * len, y: oy + Math.sin(snapped) * len, locked: true,
               angle: snapped * 180 / Math.PI };
    }
    return { x: x, y: y, locked: false };
  }

  /* Re-place a point at an exact distance along the current heading. This is
   * what makes typed dimensions work: keep the direction the operator drew,
   * replace only the length. */
  function pointAtDistance(ox, oy, towardX, towardY, distancePx) {
    var a = Math.atan2(towardY - oy, towardX - ox);
    return { x: ox + Math.cos(a) * distancePx, y: oy + Math.sin(a) * distancePx };
  }

  /* --------------------------------------------------- wall-hosted openings
   *
   * A door stored as {x,y,angle} is orphaned the moment its wall moves. Storing
   * {wallId, t, width} makes the wall the parent and resolves position at draw
   * time, so dragging a wall carries its doors with it. Legacy openings that
   * only have x/y are adopted by hostOpening() on load. */

  function resolveOpening(op, wallsById) {
    if (!op) return null;
    var w = op.wallId ? wallsById[op.wallId] : null;
    if (!w) {
      // Unhosted (legacy or free-floating): trust the stored geometry.
      return { x: op.x, y: op.y, angle: op.angle || 0, width: op.width || 32, hosted: false };
    }
    var t = op.t == null ? 0.5 : op.t;
    var len = wallLength(w);
    var x = w.x1 + (w.x2 - w.x1) * t;
    var y = w.y1 + (w.y2 - w.y1) * t;
    var ang = angleOf(w.x1, w.y1, w.x2, w.y2) * 180 / Math.PI;
    /* Clamp so an opening can never hang off the end of a shortened wall. */
    var width = Math.min(op.width || 32, Math.max(4, len));
    var half = width / 2;
    var along = t * len;
    if (along < half) { t = half / len; x = w.x1 + (w.x2 - w.x1) * t; y = w.y1 + (w.y2 - w.y1) * t; }
    else if (len - along < half) { t = (len - half) / len; x = w.x1 + (w.x2 - w.x1) * t; y = w.y1 + (w.y2 - w.y1) * t; }
    return { x: x, y: y, angle: ang, width: width, hosted: true, wall: w, t: t };
  }

  /* Find the wall an opening should belong to. */
  function hostOpening(x, y, walls, maxDist) {
    var lim = maxDist == null ? 22 : maxDist;
    var best = null;
    for (var i = 0; i < walls.length; i++) {
      var w = walls[i];
      if (wallLength(w) < EPS) continue;
      var d = pointToSeg(x, y, w.x1, w.y1, w.x2, w.y2);
      if (d > lim) continue;
      if (!best || d < best.dist) {
        best = { wallId: w.id, wall: w, dist: d, t: projT(x, y, w.x1, w.y1, w.x2, w.y2) };
      }
    }
    return best;
  }

  /* ------------------------------------------------------ welding / chains */

  /* Pull endpoints that are within tol of each other onto a shared point.
   * Deliberately capped: welding MOVES corners, so a large tolerance drags
   * genuinely separate walls together. Same rule as the app's 0.5 ft join. */
  function weldCorners(walls, tolPx) {
    var tol = Math.min(tolPx == null ? 6 : tolPx, 36);
    var pts = [];
    for (var i = 0; i < walls.length; i++) {
      pts.push({ w: i, end: 1, x: walls[i].x1, y: walls[i].y1 });
      pts.push({ w: i, end: 2, x: walls[i].x2, y: walls[i].y2 });
    }
    var clusters = [];
    var used = new Uint8Array(pts.length);
    for (var a = 0; a < pts.length; a++) {
      if (used[a]) continue;
      var cl = [a]; used[a] = 1;
      for (var b = a + 1; b < pts.length; b++) {
        if (used[b]) continue;
        if (dist(pts[a].x, pts[a].y, pts[b].x, pts[b].y) <= tol) { cl.push(b); used[b] = 1; }
      }
      clusters.push(cl);
    }
    var moved = 0;
    for (var c = 0; c < clusters.length; c++) {
      var cl2 = clusters[c];
      if (cl2.length < 2) continue;
      var sx = 0, sy = 0;
      for (var k = 0; k < cl2.length; k++) { sx += pts[cl2[k]].x; sy += pts[cl2[k]].y; }
      var mx = sx / cl2.length, my = sy / cl2.length;
      for (var m = 0; m < cl2.length; m++) {
        var p = pts[cl2[m]], w = walls[p.w];
        if (p.end === 1) { if (w.x1 !== mx || w.y1 !== my) moved++; w.x1 = mx; w.y1 = my; }
        else { if (w.x2 !== mx || w.y2 !== my) moved++; w.x2 = mx; w.y2 = my; }
      }
    }
    return moved;
  }

  /* Chain loose segments into connected runs (shared corners), so an outline
   * imported from a scan reads as one room rather than N unrelated sticks. */
  function chainWalls(walls, tolPx) {
    var tol = tolPx == null ? 4 : tolPx;
    var remaining = walls.slice();
    var runs = [];
    while (remaining.length) {
      var seed = remaining.shift();
      var run = [{ x: seed.x1, y: seed.y1 }, { x: seed.x2, y: seed.y2 }];
      var grew = true;
      while (grew) {
        grew = false;
        for (var i = 0; i < remaining.length; i++) {
          var w = remaining[i];
          var head = run[0], tail = run[run.length - 1];
          if (dist(tail.x, tail.y, w.x1, w.y1) <= tol) { run.push({ x: w.x2, y: w.y2 }); }
          else if (dist(tail.x, tail.y, w.x2, w.y2) <= tol) { run.push({ x: w.x1, y: w.y1 }); }
          else if (dist(head.x, head.y, w.x1, w.y1) <= tol) { run.unshift({ x: w.x2, y: w.y2 }); }
          else if (dist(head.x, head.y, w.x2, w.y2) <= tol) { run.unshift({ x: w.x1, y: w.y1 }); }
          else continue;
          remaining.splice(i, 1);
          grew = true;
          break;
        }
      }
      runs.push(run);
    }
    return runs;
  }

  /* ------------------------------------------------------------ conversion */

  function pxToFeet(px, scalePxPerFt) {
    var s = scalePxPerFt > 0 ? scalePxPerFt : 12;
    return px / s;
  }

  function areaPxToSqFt(areaPx, scalePxPerFt) {
    var s = scalePxPerFt > 0 ? scalePxPerFt : 12;
    return areaPx / (s * s);
  }

  function formatFeet(feet, opts) {
    opts = opts || {};
    if (!isFinite(feet)) return '—';
    var neg = feet < 0;
    var f = Math.abs(feet);
    var ft = Math.floor(f);
    var inches = Math.round((f - ft) * 12);
    if (inches === 12) { ft += 1; inches = 0; }
    var s = opts.decimal ? (Math.round(f * 10) / 10) + "'" : ft + "'" + (inches ? ' ' + inches + '"' : '');
    return (neg ? '-' : '') + s;
  }

  return {
    EPS: EPS,
    dist: dist, wallLength: wallLength, projT: projT, pointToSeg: pointToSeg, segMid: segMid,
    lineIntersect: lineIntersect, segIntersect: segIntersect, angleOf: angleOf,
    angleDiffFolded: angleDiffFolded,
    polyArea: polyArea, polyAreaSigned: polyAreaSigned, polyPerimeter: polyPerimeter,
    polyCentroid: polyCentroid, pointInPoly: pointInPoly, bbox: bbox, wallsBBox: wallsBBox,
    simplifyPath: simplifyPath, simplifyRing: simplifyRing, mergeCollinear: mergeCollinear,
    makeGrid: makeGrid, rasterizeWalls: rasterizeWalls, floodRegion: floodRegion,
    regionOutline: regionOutline, refineRingToWalls: refineRingToWalls,
    faceAtPoint: faceAtPoint, detectAllFaces: detectAllFaces,
    snapPoint: snapPoint, constrainAngle: constrainAngle, pointAtDistance: pointAtDistance,
    resolveOpening: resolveOpening, hostOpening: hostOpening,
    weldCorners: weldCorners, chainWalls: chainWalls,
    pxToFeet: pxToFeet, areaPxToSqFt: areaPxToSqFt, formatFeet: formatFeet
  };
});
