/* fp2-symbols.js — fire-service symbol catalog.
 * Lifted verbatim from page11-floor-plan.html v4 (lines 391-1348) during the v5 rebuild.
 * Exposes window.FP_SYMBOLS = { all, byId, CATEGORIES }.
 */
// ============================================================================
// Symbol Library — 115 items, drawn as real-looking objects via Canvas 2D
// Each symbol has: { id, label, cat, w, h, draw(ctx,x,y,w,h,angle,scale), icon() }
//   - draw(): renders on the main floor plan canvas (at rotated position)
//   - icon(): returns inline SVG string for the symbol palette
//   - meta: { extrude3D: {type, height, color} } for Three.js 3D render
// ============================================================================

const SYMBOLS = (function(){

  // Common colors (fire service conventions)
  const C = {
    fire: '#dc2626', fireDk: '#991b1b', fireLt: '#fca5a5',
    red: '#dc2626', amber: '#f59e0b', orange: '#ea580c',
    blue: '#2563eb', blueLt: '#60a5fa', cyan: '#06b6d4',
    green: '#16a34a', greenDk: '#166534',
    wood: '#a78160', woodDk: '#78543c', woodLt: '#d4c4a8',
    metal: '#9ca3af', metalDk: '#4b5563', metalLt: '#d1d5db',
    fabric: '#d4c4a8', fabricDk: '#a89778', fabricBeige: '#e8dfd0',
    glass: '#cfe7f5', glassEdge: '#7bb3d6',
    white: '#ffffff', offwhite: '#f5f5f5', black: '#111827',
    gray: '#6b7280', grayLt: '#e5e7eb', grayDk: '#374151',
  };

  // Shortcut drawing helpers (take ctx already translated+rotated to symbol origin)
  function rect(ctx, x, y, w, h, fill, stroke, sw, r) {
    ctx.fillStyle = fill; ctx.strokeStyle = stroke || fill;
    ctx.lineWidth = sw || 1;
    if (r && ctx.roundRect) { ctx.beginPath(); ctx.roundRect(x, y, w, h, r); ctx.fill(); if (stroke) ctx.stroke(); }
    else { if (fill) ctx.fillRect(x, y, w, h); if (stroke) ctx.strokeRect(x, y, w, h); }
  }
  function circle(ctx, cx, cy, r, fill, stroke, sw) {
    ctx.fillStyle = fill; ctx.strokeStyle = stroke || fill; ctx.lineWidth = sw || 1;
    ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI*2); if (fill) ctx.fill(); if (stroke) ctx.stroke();
  }
  function line(ctx, x1, y1, x2, y2, stroke, sw) {
    ctx.strokeStyle = stroke; ctx.lineWidth = sw || 1;
    ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); ctx.stroke();
  }
  function textAt(ctx, t, x, y, size, color, bold) {
    ctx.fillStyle = color || '#111'; ctx.font = (bold?'bold ':'') + size + 'px system-ui, sans-serif';
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText(t, x, y);
  }

  // Build icon SVG programmatically — same drawing functions run on an OffscreenCanvas
  // producing the palette thumbnail. This guarantees palette matches canvas output.
  function toIconSVG(sym) {
    const s = 48;
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${s} ${s}" width="${s}" height="${s}">`;
    // We draw into an OffscreenCanvas then encode as PNG inline — but that's runtime-only.
    // For palette, render using the same draw() fn against a tiny fake canvas via a rasterizer.
    return svg + `</svg>`;
  }

  // ========== FIRE PROTECTION ==========
  const fire = [
    { id:'facp', label:'FACP', cat:'fire', w:32, h:24, extrude3D:{h:3,color:C.fire}, draw(ctx,w,h){
      rect(ctx, -w/2, -h/2, w, h, C.fire, C.fireDk, 1.5, 3);
      circle(ctx, -w*0.25, -h*0.2, 2, C.fireLt, '#fff', 0.5);
      circle(ctx, 0, -h*0.2, 2, '#86efac', '#fff', 0.5);
      circle(ctx, w*0.25, -h*0.2, 2, '#fde047', '#fff', 0.5);
      textAt(ctx, 'FACP', 0, h*0.2, 7, '#fff', true);
    }},
    { id:'annunciator', label:'Annunciator', cat:'fire', w:26, h:20, extrude3D:{h:2,color:C.fire}, draw(ctx,w,h){
      rect(ctx, -w/2, -h/2, w, h, C.fire, C.fireDk, 1.5, 2);
      rect(ctx, -w*0.35, -h*0.25, w*0.7, h*0.3, '#1f1f1f', '#000', 0.5, 1);
      textAt(ctx, 'ANN', 0, h*0.2, 6, '#fff', true);
    }},
    { id:'fdc', label:'FDC', cat:'fire', w:22, h:22, extrude3D:{h:2.5,color:C.fire}, draw(ctx,w,h){
      // Fire Department Connection — body + 2 siamese caps
      rect(ctx, -w/2, -h*0.2, w, h*0.7, C.fire, C.fireDk, 1.5, 3);
      circle(ctx, -w*0.22, h*0.15, w*0.18, '#e5e7eb', C.fireDk, 1.5);
      circle(ctx, w*0.22, h*0.15, w*0.18, '#e5e7eb', C.fireDk, 1.5);
      textAt(ctx, 'FDC', 0, -h*0.3, 7, '#fff', true);
    }},
    { id:'sprinkler', label:'Sprinkler Riser', cat:'fire', w:20, h:20, extrude3D:{h:10,color:C.blue}, draw(ctx,w,h){
      circle(ctx, 0, 0, w*0.4, '#dbeafe', C.blue, 1.5);
      line(ctx, 0, -w*0.25, 0, w*0.25, C.blue, 1);
      line(ctx, -w*0.25, 0, w*0.25, 0, C.blue, 1);
      circle(ctx, 0, 0, 2, C.blue, null, 0);
    }},
    { id:'standpipe', label:'Standpipe', cat:'fire', w:20, h:24, extrude3D:{h:8,color:'#4b5563'}, draw(ctx,w,h){
      rect(ctx, -w*0.15, -h/2, w*0.3, h, '#6b7280', '#374151', 1, 2);
      rect(ctx, -w*0.3, -h*0.15, w*0.6, h*0.12, C.fire, C.fireDk, 1, 1);
      textAt(ctx, 'SP', 0, h*0.3, 7, C.fire, true);
    }},
    { id:'extinguisher', label:'Extinguisher', cat:'fire', w:14, h:22, extrude3D:{h:2.5,color:C.fire}, draw(ctx,w,h){
      rect(ctx, -w*0.35, -h*0.4, w*0.7, h*0.8, C.fire, C.fireDk, 1.5, 3);
      rect(ctx, -w*0.2, -h*0.5, w*0.4, h*0.12, '#666', '#333', 1, 1);
      textAt(ctx, 'FE', 0, 0, 6, '#fff', true);
    }},
    { id:'hydrant', label:'Hydrant', cat:'fire', w:22, h:22, extrude3D:{h:3,color:C.fire}, draw(ctx,w,h){
      circle(ctx, 0, 0, w*0.42, C.fire, C.fireDk, 1.5);
      circle(ctx, 0, -w*0.45, w*0.17, '#ef4444', C.fireDk, 1);
      circle(ctx, -w*0.4, w*0.22, w*0.17, '#ef4444', C.fireDk, 1);
      circle(ctx, w*0.4, w*0.22, w*0.17, '#ef4444', C.fireDk, 1);
      circle(ctx, 0, 0, w*0.17, C.fireLt, C.fireDk, 0.75);
      textAt(ctx, 'H', 0, 0, 8, '#fff', true);
    }},
    { id:'pull', label:'Pull Station', cat:'fire', w:14, h:20, extrude3D:{h:2.5,color:C.fire}, draw(ctx,w,h){
      rect(ctx, -w/2, -h/2, w, h, C.fire, C.fireDk, 1.5, 2);
      rect(ctx, -w*0.3, h*0.1, w*0.6, h*0.3, '#fff', C.fireDk, 0.75, 1);
      textAt(ctx, 'PS', 0, -h*0.2, 6, '#fff', true);
    }},
    { id:'smoke', label:'Smoke Detector', cat:'fire', w:18, h:18, extrude3D:{h:1.5,color:'#fff'}, draw(ctx,w,h){
      circle(ctx, 0, 0, w*0.45, '#fff', '#888', 1.5);
      circle(ctx, 0, 0, w*0.22, 'transparent', '#bbb', 0.75);
      circle(ctx, 0, 0, 1.5, C.fire, null);
    }},
  ];

  // ========== DOORS & WINDOWS ==========
  const doors = [
    { id:'door-l', label:'Door L-Swing', cat:'doors', w:30, h:8, draw(ctx,w,h){
      // Opening break
      ctx.strokeStyle = '#fff'; ctx.lineWidth = 4;
      line(ctx, -w/2, 0, w/2, 0, '#fff', 4);
      // Leaf
      line(ctx, -w/2, 0, w/2, 0, C.orange, 1.5);
      // Swing arc
      ctx.strokeStyle = C.orange; ctx.lineWidth = 1;
      ctx.beginPath(); ctx.arc(-w/2, 0, w, 0, Math.PI/2); ctx.stroke();
    }},
    { id:'door-r', label:'Door R-Swing', cat:'doors', w:30, h:8, draw(ctx,w,h){
      line(ctx, -w/2, 0, w/2, 0, '#fff', 4);
      line(ctx, -w/2, 0, w/2, 0, C.orange, 1.5);
      ctx.strokeStyle = C.orange; ctx.lineWidth = 1;
      ctx.beginPath(); ctx.arc(w/2, 0, w, Math.PI/2, Math.PI); ctx.stroke();
    }},
    { id:'door-d', label:'Double Door', cat:'doors', w:40, h:8, draw(ctx,w,h){
      line(ctx, -w/2, 0, w/2, 0, '#fff', 4);
      line(ctx, -w/2, 0, 0, 0, C.orange, 1.5);
      line(ctx, 0, 0, w/2, 0, C.orange, 1.5);
      ctx.strokeStyle = C.orange; ctx.lineWidth = 1;
      ctx.beginPath(); ctx.arc(-w/2, 0, w/2, 0, Math.PI/2); ctx.stroke();
      ctx.beginPath(); ctx.arc(w/2, 0, w/2, Math.PI/2, Math.PI); ctx.stroke();
    }},
    { id:'door-roll', label:'Rollup/Overhead', cat:'doors', w:40, h:10, extrude3D:{h:10,color:'#999'}, draw(ctx,w,h){
      line(ctx, -w/2, 0, w/2, 0, '#fff', 4);
      ctx.setLineDash([3, 2]);
      line(ctx, -w/2, 0, w/2, 0, C.orange, 1.5);
      ctx.setLineDash([]);
      // Rollup housing box
      rect(ctx, -w/2, -4, w, 3, '#999', '#555', 0.75);
    }},
    { id:'door-slide', label:'Sliding Door', cat:'doors', w:36, h:6, draw(ctx,w,h){
      line(ctx, -w/2, 0, w/2, 0, '#fff', 4);
      line(ctx, -w/2, -1, 0, -1, C.orange, 1.5);
      line(ctx, 0, 1, w/2, 1, C.orange, 1.5);
      line(ctx, -w/2, 0, w/2, 0, '#888', 0.5);
    }},
    { id:'door-pocket', label:'Pocket Door', cat:'doors', w:32, h:6, draw(ctx,w,h){
      line(ctx, -w/2, 0, w/2, 0, '#fff', 4);
      ctx.setLineDash([2, 2]);
      line(ctx, -w/2, 0, w/2, 0, C.orange, 1);
      ctx.setLineDash([]);
      line(ctx, w/2-4, -2, w/2-4, 2, '#888', 1);
    }},
    { id:'door-bifold', label:'Bifold/Accordion', cat:'doors', w:32, h:8, draw(ctx,w,h){
      line(ctx, -w/2, 0, w/2, 0, '#fff', 4);
      // Zigzag
      ctx.strokeStyle = C.orange; ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(-w/2, 0);
      for (let i=0; i<4; i++) { ctx.lineTo(-w/2+w*(i+1)/4, i%2?0:-3); }
      ctx.stroke();
    }},
    { id:'door-revolve', label:'Revolving', cat:'doors', w:28, h:28, draw(ctx,w,h){
      circle(ctx, 0, 0, w*0.45, '#fff', C.orange, 1.5);
      line(ctx, -w*0.4, 0, w*0.4, 0, C.orange, 1);
      line(ctx, 0, -w*0.4, 0, w*0.4, C.orange, 1);
      line(ctx, -w*0.28, -w*0.28, w*0.28, w*0.28, C.orange, 0.75);
      line(ctx, w*0.28, -w*0.28, -w*0.28, w*0.28, C.orange, 0.75);
    }},
    { id:'win-3', label:"Window 3'", cat:'doors', w:24, h:6, draw(ctx,w,h){
      line(ctx, -w/2, 0, w/2, 0, '#fff', 4);
      line(ctx, -w/2, -1.5, w/2, -1.5, C.blue, 0.75);
      line(ctx, -w/2, 0, w/2, 0, C.blue, 0.75);
      line(ctx, -w/2, 1.5, w/2, 1.5, C.blue, 0.75);
    }},
    { id:'win-4', label:"Window 4'", cat:'doors', w:32, h:6, draw(ctx,w,h){
      line(ctx, -w/2, 0, w/2, 0, '#fff', 4);
      line(ctx, -w/2, -1.5, w/2, -1.5, C.blue, 0.75);
      line(ctx, -w/2, 0, w/2, 0, C.blue, 0.75);
      line(ctx, -w/2, 1.5, w/2, 1.5, C.blue, 0.75);
    }},
    { id:'win-6', label:"Window 6'", cat:'doors', w:48, h:6, draw(ctx,w,h){
      line(ctx, -w/2, 0, w/2, 0, '#fff', 4);
      line(ctx, -w/2, -1.5, w/2, -1.5, C.blue, 0.75);
      line(ctx, -w/2, 0, w/2, 0, C.blue, 0.75);
      line(ctx, -w/2, 1.5, w/2, 1.5, C.blue, 0.75);
    }},
    { id:'exit', label:'EXIT Sign', cat:'doors', w:28, h:14, draw(ctx,w,h){
      rect(ctx, -w/2, -h/2, w, h, C.green, '#166534', 1.5, 2);
      textAt(ctx, 'EXIT', 0, 0, 9, '#fff', true);
    }},
  ];

  // ========== ACCESS ==========
  const access = [
    { id:'parking-lot', label:'Parking Lot', cat:'access', w:36, h:24, extrude3D:{h:0.3,color:'#6b7280'}, draw(ctx,w,h){
      rect(ctx, -w/2, -h/2, w, h, '#9ca3af', '#4b5563', 1.5, 2);
      for (let i=1;i<6;i++){ const xx=-w/2 + i*w/6; line(ctx, xx, -h*0.45, xx, -h*0.06, '#f3f4f6', 1); line(ctx, xx, h*0.06, xx, h*0.45, '#f3f4f6', 1); }
      circle(ctx, 0, 0, h*0.26, '#2563eb', '#1e40af', 1);
      textAt(ctx, 'P', 0, 0, 8, '#fff', true);
    }},
    { id:'attic-access', label:'Attic Access', cat:'access', w:22, h:22, extrude3D:{h:0.5,color:'#a78160'}, draw(ctx,w,h){
      rect(ctx, -w/2, -h/2, w, h, '#e7ded0', '#78543c', 1.5, 2);
      line(ctx, -w*0.42, -h*0.42, w*0.42, h*0.42, '#a78160', 1);
      line(ctx, w*0.42, -h*0.42, -w*0.42, h*0.42, '#a78160', 1);
      textAt(ctx, 'ATTIC', 0, h*0.3, 5, '#78543c', true);
    }},
    { id:'stairs', label:'Stairs', cat:'access', w:36, h:28, extrude3D:{h:3,color:C.wood}, draw(ctx,w,h){
      rect(ctx, -w/2, -h/2, w, h, C.woodLt, C.woodDk, 1);
      for (let i=1; i<6; i++) {
        line(ctx, -w/2, -h/2 + h*i/6, w/2, -h/2 + h*i/6, C.woodDk, 0.75);
      }
      // Up arrow
      ctx.fillStyle = C.fire;
      ctx.beginPath();
      ctx.moveTo(0, -h*0.3);
      ctx.lineTo(-w*0.12, -h*0.1);
      ctx.lineTo(w*0.12, -h*0.1);
      ctx.closePath(); ctx.fill();
    }},
    { id:'elevator', label:'Elevator', cat:'access', w:28, h:28, extrude3D:{h:10,color:'#d1d5db'}, draw(ctx,w,h){
      rect(ctx, -w/2, -h/2, w, h, '#f0f0f0', '#888', 1.5, 2);
      line(ctx, 0, -h/2+3, 0, h/2-3, '#aaa', 1);
      line(ctx, -w/2+3, -h/2+3, w/2-3, h/2-3, '#bbb', 0.5);
      line(ctx, w/2-3, -h/2+3, -w/2+3, h/2-3, '#bbb', 0.5);
      textAt(ctx, 'ELEV', 0, 0, 8, '#666', true);
    }},
    { id:'roof', label:'Roof Access', cat:'access', w:24, h:24, extrude3D:{h:2,color:C.orange}, draw(ctx,w,h){
      rect(ctx, -w/2, -h/2, w, h, '#fef3c7', '#f59e0b', 1.5, 2);
      // Ladder rungs
      line(ctx, -w*0.3, -h*0.35, w*0.3, -h*0.35, '#d97706', 1);
      line(ctx, -w*0.3, -h*0.1, w*0.3, -h*0.1, '#d97706', 1);
      line(ctx, -w*0.3, h*0.15, w*0.3, h*0.15, '#d97706', 1);
      textAt(ctx, 'ROOF', 0, h*0.32, 6, '#d97706', true);
    }},
    { id:'knox', label:'Knox Box', cat:'access', w:22, h:18, extrude3D:{h:1.5,color:C.orange}, draw(ctx,w,h){
      rect(ctx, -w/2, -h/2, w, h, '#f97316', '#c2410c', 1.5, 2);
      circle(ctx, 0, -1, 3, '#1f1f1f', null);
      rect(ctx, -1, 1, 2, 5, '#1f1f1f', null);
      textAt(ctx, 'K', 0, -h*0.35, 5, '#fff', true);
    }},
  ];

  // ========== UTILITIES ==========
  const utilities = [
    { id:'elec-meter', label:'Electric Meter', cat:'utilities', w:18, h:24, extrude3D:{h:3,color:'#d1d5db'}, draw(ctx,w,h){
      rect(ctx, -w/2, -h/2, w, h, '#d1d5db', '#6b7280', 1.5, 2);
      circle(ctx, 0, -h*0.18, w*0.36, '#e0f2fe', '#374151', 1.2);
      line(ctx, 0, -h*0.18, w*0.2, -h*0.28, '#1f2937', 1.2);
      circle(ctx, 0, -h*0.18, 1.3, '#1f2937', null, 0);
      rect(ctx, -w*0.32, h*0.12, w*0.64, h*0.16, '#1f2937', '#000', 0.5, 1);
      textAt(ctx, 'kWh', 0, h*0.34, 5, '#1f2937', true);
    }},
    { id:'elec', label:'Electric Panel', cat:'utilities', w:22, h:30, extrude3D:{h:4,color:'#d1d5db'}, draw(ctx,w,h){
      rect(ctx, -w/2, -h/2, w, h, '#d1d5db', '#4b5563', 1.5, 2);
      for (let i=0; i<5; i++) {
        rect(ctx, -w*0.3, -h*0.35 + i*h*0.15, w*0.6, h*0.08, '#1f2937', '#000', 0.5);
      }
      line(ctx, 0, -h*0.35, 0, h*0.35, '#6b7280', 0.5);
    }},
    { id:'elec-off', label:'Elec Shutoff', cat:'utilities', w:22, h:22, extrude3D:{h:2,color:'#dc2626'}, draw(ctx,w,h){
      circle(ctx, 0, 0, w*0.45, '#fbbf24', '#b45309', 1.5);
      textAt(ctx, '⚡', 0, -h*0.1, 10, '#7c2d12', true);
      textAt(ctx, 'OFF', 0, h*0.22, 6, C.fire, true);
    }},
    { id:'gas-off', label:'Gas Shutoff', cat:'utilities', w:22, h:22, extrude3D:{h:2,color:'#fbbf24'}, draw(ctx,w,h){
      circle(ctx, 0, 0, w*0.45, '#fbbf24', '#b45309', 1.5);
      textAt(ctx, 'G', 0, -h*0.1, 10, '#7c2d12', true);
      textAt(ctx, 'OFF', 0, h*0.22, 6, C.fire, true);
    }},
    { id:'water-off', label:'Water Shutoff', cat:'utilities', w:22, h:22, extrude3D:{h:2,color:C.cyan}, draw(ctx,w,h){
      circle(ctx, 0, 0, w*0.45, '#67e8f9', '#0891b2', 1.5);
      textAt(ctx, 'W', 0, -h*0.1, 10, '#164e63', true);
      textAt(ctx, 'OFF', 0, h*0.22, 6, C.fire, true);
    }},
    { id:'hvac', label:'HVAC', cat:'utilities', w:36, h:24, extrude3D:{h:4,color:'#9ca3af'}, draw(ctx,w,h){
      rect(ctx, -w/2, -h/2, w, h, '#9ca3af', '#4b5563', 1.5, 2);
      // Fan blades
      circle(ctx, 0, 0, h*0.3, '#d1d5db', '#6b7280', 1);
      for (let i=0; i<4; i++) {
        ctx.save(); ctx.rotate(i * Math.PI/2);
        rect(ctx, -1, -h*0.28, 2, h*0.2, '#6b7280', null); ctx.restore();
      }
      circle(ctx, 0, 0, 1.5, '#1f2937', null);
    }},
    { id:'gen', label:'Generator', cat:'utilities', w:32, h:22, extrude3D:{h:3.5,color:'#374151'}, draw(ctx,w,h){
      rect(ctx, -w/2, -h/2, w, h, '#374151', '#1f2937', 1.5, 3);
      rect(ctx, -w*0.3, -h*0.25, w*0.6, h*0.3, '#f59e0b', '#b45309', 0.75, 1);
      textAt(ctx, 'GEN', 0, h*0.25, 7, '#fff', true);
    }},
  ];

  // ========== FURNITURE ==========
  const furniture = [
    { id:'bed', label:'Bed', cat:'furniture', w:45, h:70, extrude3D:{h:1.8,color:C.fabric}, draw(ctx,w,h){
      rect(ctx, -w/2, -h/2, w, h, '#f0ebe3', '#888', 1.5, 3);
      // Pillows
      rect(ctx, -w*0.4, -h*0.42, w*0.35, h*0.12, '#fff', '#aaa', 0.75, 4);
      rect(ctx, w*0.05, -h*0.42, w*0.35, h*0.12, '#fff', '#aaa', 0.75, 4);
      // Headboard
      rect(ctx, -w/2-2, -h/2-2, w+4, 4, '#8B7355', '#6B5335', 1, 1);
      // Sheet fold line
      line(ctx, -w/2+3, -h*0.2, w/2-3, -h*0.2, '#ccc', 0.75);
    }},
    { id:'sofa', label:'Sofa', cat:'furniture', w:55, h:26, extrude3D:{h:2.8,color:C.fabric}, draw(ctx,w,h){
      rect(ctx, -w/2, -h/2, w, h, '#ddd6c8', '#888', 1.5, 4);
      // Back
      rect(ctx, -w/2+2, -h/2+2, w-4, h*0.25, '#c8bfaf', '#999', 0.75, 3);
      // Arms
      rect(ctx, -w/2+2, -h/2+2, h*0.35, h-4, '#c8bfaf', '#999', 0.75, 3);
      rect(ctx, w/2-h*0.35-2, -h/2+2, h*0.35, h-4, '#c8bfaf', '#999', 0.75, 3);
      // Cushion divisions
      for (let i=1; i<3; i++) {
        line(ctx, -w/2 + h*0.35 + (w-h*0.7)*i/3, h*0.05, -w/2 + h*0.35 + (w-h*0.7)*i/3, h/2-3, '#b0a898', 0.75);
      }
    }},
    { id:'desk', label:'Desk', cat:'furniture', w:55, h:28, extrude3D:{h:2.5,color:C.wood}, draw(ctx,w,h){
      rect(ctx, -w/2, -h/2, w, h, '#e8dfd0', '#888', 1.5, 2);
      // Drawer unit
      rect(ctx, w*0.15, -h*0.35, w*0.3, h*0.7, 'transparent', '#aaa', 1, 1);
      for (let i=1; i<3; i++) {
        line(ctx, w*0.15, -h*0.35 + h*0.7*i/3, w*0.45, -h*0.35 + h*0.7*i/3, '#bbb', 0.75);
      }
    }},
    { id:'l-desk', label:'L-Desk', cat:'furniture', w:54, h:38, extrude3D:{h:2.5,color:C.wood}, draw(ctx,w,h){
      rect(ctx, -w/2, -h/2, w, h*0.45, '#e8dfd0', '#888', 1.5, 2);
      rect(ctx, w*0.2, -h/2, w*0.3, h, '#e8dfd0', '#888', 1.5, 2);
    }},
    { id:'table', label:'Table', cat:'furniture', w:40, h:28, extrude3D:{h:2.5,color:C.wood}, draw(ctx,w,h){
      rect(ctx, -w/2, -h/2, w, h, '#e8dfd0', '#888', 1.5, 2);
    }},
    { id:'round-table', label:'Round Table', cat:'furniture', w:36, h:36, extrude3D:{h:2.5,color:C.wood}, draw(ctx,w,h){
      circle(ctx, 0, 0, Math.min(w,h)/2, '#e8dfd0', '#888', 1.5);
    }},
    { id:'conf-table', label:'Conf Table', cat:'furniture', w:80, h:28, extrude3D:{h:2.5,color:C.wood}, draw(ctx,w,h){
      rect(ctx, -w/2, -h/2, w, h, '#ddd6c8', '#888', 1.5, h/2);
      line(ctx, -w/3, 0, w/3, 0, '#c0b8a8', 0.75);
    }},
    { id:'chair', label:'Chair', cat:'furniture', w:18, h:18, extrude3D:{h:2.5,color:C.fabric}, draw(ctx,w,h){
      circle(ctx, 0, 0, w*0.45, '#f5f0e8', '#666', 1.5);
      // Back curve
      ctx.strokeStyle = '#666'; ctx.lineWidth = 2.5;
      ctx.beginPath(); ctx.arc(0, -w*0.1, w*0.5, Math.PI*0.8, Math.PI*1.2); ctx.stroke();
    }},
    { id:'rolling-chair', label:'Office Chair', cat:'furniture', w:20, h:20, extrude3D:{h:3,color:C.fabric}, draw(ctx,w,h){
      // Base wheels
      circle(ctx, 0, 0, w*0.52, 'transparent', '#999', 0.75);
      for (let i=0; i<5; i++) {
        const a = Math.PI*2*i/5 - Math.PI/2;
        circle(ctx, w*0.48*Math.cos(a), w*0.48*Math.sin(a), 1.5, '#888', '#555', 0.5);
      }
      // Seat
      circle(ctx, 0, 0, w*0.35, '#e8e0d4', '#666', 1.5);
      // Back
      ctx.strokeStyle = '#555'; ctx.lineWidth = 2.5;
      ctx.beginPath(); ctx.arc(0, -w*0.08, w*0.4, Math.PI*0.75, Math.PI*1.25); ctx.stroke();
    }},
    { id:'bookshelf', label:'Bookshelf', cat:'furniture', w:28, h:14, extrude3D:{h:6,color:C.wood}, draw(ctx,w,h){
      rect(ctx, -w/2, -h/2, w, h, '#d4c4a8', '#888', 1.5);
      for (let i=1; i<4; i++) line(ctx, -w/2+2, -h/2 + h*i/4, w/2-2, -h/2 + h*i/4, '#a89878', 1);
      for (let i=0; i<6; i++) {
        const x = -w/2 + 4 + i*(w-8)/6;
        line(ctx, x, -h/2+2, x, h/2-2, '#c0b090', 0.5);
      }
    }},
    { id:'cubicle', label:'Cubicle', cat:'furniture', w:40, h:40, extrude3D:{h:5,color:'#c5bba8'}, draw(ctx,w,h){
      line(ctx, -w/2, -h/2, w/2, -h/2, '#777', 3.5);
      line(ctx, -w/2, -h/2, -w/2, h/2, '#777', 3.5);
      line(ctx, w/2, -h/2, w/2, h/2, '#777', 3.5);
      rect(ctx, -w*0.35, -h*0.15, w*0.7, h*0.3, '#e8dfd0', '#aaa', 0.75, 1);
    }},
    { id:'file-cab', label:'File Cab Tall', cat:'furniture', w:16, h:20, extrude3D:{h:5,color:'#d1d5db'}, draw(ctx,w,h){
      rect(ctx, -w/2, -h/2, w, h, '#d0d0d0', '#888', 1.5, 1);
      for (let i=0; i<4; i++) {
        const dy = -h/2 + h*i/4 + h/8;
        rect(ctx, -w/2+2, dy-h*0.08, w-4, h*0.16, 'transparent', '#aaa', 0.5, 1);
        line(ctx, -2, dy, 2, dy, '#888', 1.5);
      }
    }},
    { id:'file-lateral', label:'Lateral File', cat:'furniture', w:32, h:14, extrude3D:{h:3,color:'#d1d5db'}, draw(ctx,w,h){
      rect(ctx, -w/2, -h/2, w, h, '#d0d0d0', '#888', 1.5, 1);
      for (let i=0; i<2; i++) {
        const dy = -h/2 + h*i/2 + h/4;
        rect(ctx, -w/2+2, dy-h*0.15, w-4, h*0.3, 'transparent', '#aaa', 0.5, 1);
        line(ctx, -2, dy, 2, dy, '#888', 1.5);
      }
    }},
    { id:'tv', label:'TV/Monitor', cat:'furniture', w:32, h:6, extrude3D:{h:2,color:'#1f1f1f'}, draw(ctx,w,h){
      rect(ctx, -w/2, -h/2, w, h, '#1f2937', '#0f172a', 1, 1);
      line(ctx, -w/2+2, h/2-2, w/2-2, h/2-2, C.cyan, 0.75);
      textAt(ctx, 'TV', 0, -h/2-5, 7, '#555', true);
    }},
    { id:'fridge', label:'Refrigerator', cat:'furniture', w:28, h:30, extrude3D:{h:6,color:C.white}, draw(ctx,w,h){
      rect(ctx, -w/2, -h/2, w, h, '#eee', '#888', 1.5, 2);
      line(ctx, 0, -h/2+3, 0, h/2-3, '#bbb', 1);
      line(ctx, 3, -h*0.2, 3, h*0.2, '#999', 2);
      line(ctx, -3, -h*0.2, -3, h*0.2, '#999', 2);
    }},
    { id:'stove', label:'Stove/Range', cat:'furniture', w:28, h:28, extrude3D:{h:3,color:'#fff'}, draw(ctx,w,h){
      rect(ctx, -w/2, -h/2, w, h, '#e5e7eb', '#6b7280', 1.5, 2);
      // 4 burners
      circle(ctx, -w*0.22, -h*0.22, 4, '#1f1f1f', '#4b5563', 0.75);
      circle(ctx, w*0.22, -h*0.22, 4, '#1f1f1f', '#4b5563', 0.75);
      circle(ctx, -w*0.22, h*0.22, 4, '#1f1f1f', '#4b5563', 0.75);
      circle(ctx, w*0.22, h*0.22, 4, '#1f1f1f', '#4b5563', 0.75);
    }},
    { id:'sink', label:'Kitchen Sink', cat:'furniture', w:30, h:20, extrude3D:{h:1,color:C.metalLt}, draw(ctx,w,h){
      rect(ctx, -w/2, -h/2, w, h, '#e5e7eb', '#6b7280', 1.5, 2);
      rect(ctx, -w*0.35, -h*0.3, w*0.3, h*0.6, '#9ca3af', '#4b5563', 0.75, 2);
      rect(ctx, w*0.05, -h*0.3, w*0.3, h*0.6, '#9ca3af', '#4b5563', 0.75, 2);
      circle(ctx, 0, -h*0.4, 1.5, '#4b5563', null);
    }},
    { id:'dw', label:'Dishwasher', cat:'furniture', w:22, h:22, extrude3D:{h:3.5,color:C.white}, draw(ctx,w,h){
      rect(ctx, -w/2, -h/2, w, h, '#e8e8e8', '#888', 1.5, 2);
      rect(ctx, -w*0.4, -h*0.4, w*0.8, h*0.15, '#d0d0d0', '#aaa', 0.75, 1);
      line(ctx, -w*0.2, -h*0.15, w*0.2, -h*0.15, '#999', 2);
      textAt(ctx, 'DW', 0, h*0.15, 7, '#888', true);
    }},
    { id:'toilet', label:'Toilet', cat:'furniture', w:18, h:22, extrude3D:{h:1.4,color:C.white}, draw(ctx,w,h){
      rect(ctx, -w*0.35, -h*0.5, w*0.7, h*0.35, '#fff', '#888', 1.5, 3);
      ctx.fillStyle = '#fff'; ctx.strokeStyle = '#888'; ctx.lineWidth = 1.5;
      ctx.beginPath(); ctx.ellipse(0, h*0.05, w*0.4, h*0.45, 0, 0, Math.PI*2); ctx.fill(); ctx.stroke();
      ctx.beginPath(); ctx.ellipse(0, h*0.07, w*0.25, h*0.3, 0, 0, Math.PI*2); ctx.strokeStyle='#bbb'; ctx.lineWidth=0.75; ctx.stroke();
    }},
    { id:'tub', label:'Bathtub', cat:'furniture', w:45, h:25, extrude3D:{h:1.5,color:C.white}, draw(ctx,w,h){
      rect(ctx, -w/2, -h/2, w, h, '#f0f8ff', '#888', 2, h*0.4);
      rect(ctx, -w/2+4, -h/2+4, w-8, h-8, '#e0f0ff', '#aac8e8', 1, h*0.35);
      circle(ctx, 0, h*0.3, 2, '#999', null);
      circle(ctx, 0, -h*0.35, 3, '#ccc', '#999', 0.75);
    }},
    { id:'shower', label:'Shower', cat:'furniture', w:28, h:28, extrude3D:{h:7,color:'#e5e7eb'}, draw(ctx,w,h){
      rect(ctx, -w/2, -h/2, w, h, '#e8f4fd', '#888', 1.5, 2);
      circle(ctx, -w*0.3, -h*0.3, 3, '#ddd', '#999', 1);
      for (let i=0; i<3; i++) for (let j=0; j<3; j++) {
        circle(ctx, -w*0.18 + i*w*0.18, -h*0.18 + j*h*0.18, 0.8, '#a0d0f0', null);
      }
      circle(ctx, 0, 0, 2, '#999', null);
    }},
    { id:'bath-sink', label:'Bath Sink', cat:'furniture', w:22, h:15, extrude3D:{h:2.8,color:C.white}, draw(ctx,w,h){
      rect(ctx, -w/2, -h/2, w, h, '#fff', '#888', 1.5, 3);
      ctx.beginPath(); ctx.ellipse(0, h*0.1, w*0.35, h*0.3, 0, 0, Math.PI*2);
      ctx.fillStyle = '#e5e7eb'; ctx.strokeStyle = '#999'; ctx.lineWidth = 0.75; ctx.fill(); ctx.stroke();
      circle(ctx, 0, -h*0.3, 1.5, '#4b5563', null);
    }},
  ];

  // ========== MERCANTILE ==========
  const mercantile = [
    { id:'counter', label:'Countertop', cat:'mercantile', w:40, h:14, extrude3D:{h:3.5,color:'#a78160'}, draw(ctx,w,h){
      rect(ctx, -w/2, -h/2, w, h, '#d4c4a8', '#78543c', 1.5, 2);
      rect(ctx, -w/2, -h/2, w, h*0.34, '#efe7d8', '#78543c', 1, 2);
      textAt(ctx, 'COUNTER', 0, h*0.14, 5, '#78543c', true);
    }},
    { id:'standup-oven', label:'Stand-up Oven', cat:'mercantile', w:24, h:30, extrude3D:{h:16,color:'#6b7280'}, draw(ctx,w,h){
      rect(ctx, -w/2, -h/2, w, h, '#cbd5e1', '#475569', 1.5, 3);
      rect(ctx, -w*0.4, -h*0.42, w*0.8, h*0.5, '#6b7280', '#374151', 1, 2);
      rect(ctx, -w*0.3, -h*0.34, w*0.6, h*0.32, '#1f2937', '#000', 0.5, 1);
      rect(ctx, -w*0.34, -h*0.46, w*0.68, h*0.035, '#374151', '#374151', 0.5, 0);
      rect(ctx, -w*0.42, h*0.2, w*0.84, h*0.24, '#94a3b8', '#475569', 1, 1);
      circle(ctx, -w*0.22, h*0.32, 1.6, '#1f2937', null, 0); circle(ctx, 0, h*0.32, 1.6, '#1f2937', null, 0); circle(ctx, w*0.22, h*0.32, 1.6, '#1f2937', null, 0);
      textAt(ctx, 'OVEN', 0, -h*0.05, 5.5, '#fff', true);
    }},
    { id:'drink-dispenser', label:'Drink Dispenser', cat:'mercantile', w:26, h:24, extrude3D:{h:10,color:'#9ca3af'}, draw(ctx,w,h){
      rect(ctx, -w/2, -h/2, w, h, '#e5e7eb', '#6b7280', 1.5, 3);
      rect(ctx, -w*0.42, -h*0.4, w*0.84, h*0.38, '#94a3b8', '#475569', 1, 2);
      for (let i=0;i<4;i++){ rect(ctx, -w*0.36 + i*w*0.24, h*0.02, w*0.1, h*0.18, '#4b5563', '#1f2937', 0.5, 1); }
      rect(ctx, -w*0.44, h*0.3, w*0.88, h*0.12, '#6b7280', '#374151', 1, 1);
      textAt(ctx, 'SODA', 0, -h*0.18, 5.5, '#1f2937', true);
    }},
    { id:'chip-rack', label:'Chip Rack', cat:'mercantile', w:22, h:28, extrude3D:{h:8,color:'#f59e0b'}, draw(ctx,w,h){
      rect(ctx, -w/2, -h/2, w, h, '#fde68a', '#b45309', 1.5, 2);
      for (let i=0;i<4;i++){ const yy=-h*0.32 + i*h*0.2; line(ctx, -w*0.42, yy, w*0.42, yy, '#b45309', 1); rect(ctx, -w*0.38, yy-2, w*0.76, 3, '#ea580c', '#ea580c', 0.3, 0); }
      textAt(ctx, 'CHIPS', 0, h*0.4, 5, '#92400e', true);
    }},
    { id:'clothes-rack', label:'Clothes Rack', cat:'mercantile', w:60, h:18, extrude3D:{h:6,color:C.metal}, draw(ctx,w,h){
      rect(ctx, -w/2, -h/2, w, h, '#fef3c7', '#f59e0b', 1, 1);
      // Hangers
      for (let i=0; i<6; i++) {
        const x = -w/2 + (w/7)*(i+1);
        line(ctx, x-3, -h*0.25, x+3, -h*0.25, '#999', 0.75);
        line(ctx, x, -h*0.25, x, h*0.25, '#555', 1.5);
      }
    }},
    { id:'display-case', label:'Display Case', cat:'mercantile', w:40, h:20, extrude3D:{h:3.5,color:C.glass}, draw(ctx,w,h){
      rect(ctx, -w/2, -h/2, w, h, C.glass, C.glassEdge, 1.5, 1);
      line(ctx, -w/2+3, 0, w/2-3, 0, C.glassEdge, 0.5);
      for (let i=1; i<3; i++) line(ctx, -w/2+(w/3)*i, -h/2+2, -w/2+(w/3)*i, h/2-2, C.glassEdge, 0.5);
    }},
    { id:'shelf-aisle', label:'Shelving Aisle', cat:'mercantile', w:90, h:14, extrude3D:{h:7,color:C.metalLt}, draw(ctx,w,h){
      rect(ctx, -w/2, -h/2, w, h, '#d1d5db', '#6b7280', 1, 1);
      // Vertical dividers
      for (let i=1; i<8; i++) line(ctx, -w/2 + (w/8)*i, -h/2, -w/2 + (w/8)*i, h/2, '#9ca3af', 0.5);
      line(ctx, -w/2, 0, w/2, 0, '#6b7280', 0.5);
    }},
    { id:'checkout', label:'Checkout Counter', cat:'mercantile', w:50, h:22, extrude3D:{h:3.5,color:C.woodLt}, draw(ctx,w,h){
      rect(ctx, -w/2, -h/2, w, h, '#d4c4a8', '#78543c', 1.5, 2);
      rect(ctx, w*0.1, -h*0.3, w*0.15, h*0.2, '#1f1f1f', '#000', 0.75);
      textAt(ctx, 'CHECKOUT', 0, h*0.25, 6, '#78543c', true);
    }},
    { id:'register', label:'Cash Register', cat:'mercantile', w:16, h:14, extrude3D:{h:2,color:'#d1d5db'}, draw(ctx,w,h){
      rect(ctx, -w/2, -h/2, w, h, '#d0d0d0', '#888', 1.5, 2);
      rect(ctx, -w*0.3, -h*0.3, w*0.6, h*0.25, '#1f1f1f', '#555', 0.75, 1);
      rect(ctx, -w*0.4, h*0.05, w*0.8, h*0.3, '#bbb', '#999', 0.75);
      textAt(ctx, '$', 0, h*0.22, 6, '#666', true);
    }},
    { id:'cart-corral', label:'Cart Corral', cat:'mercantile', w:50, h:30, extrude3D:{h:2.5,color:C.metalLt}, draw(ctx,w,h){
      rect(ctx, -w/2, -h/2, w, h, 'transparent', '#6b7280', 2);
      // Carts
      for (let i=0; i<4; i++) {
        rect(ctx, -w*0.4 + i*w*0.22, -h*0.1, w*0.18, h*0.35, '#e5e7eb', '#9ca3af', 0.75, 1);
      }
    }},
    { id:'freezer', label:'Freezer Case', cat:'mercantile', w:60, h:22, extrude3D:{h:3,color:C.cyan}, draw(ctx,w,h){
      rect(ctx, -w/2, -h/2, w, h, C.glass, '#67e8f9', 1.5, 2);
      ctx.setLineDash([4, 3]);
      line(ctx, -w/2+3, -h*0.1, w/2-3, -h*0.1, '#0891b2', 0.75);
      ctx.setLineDash([]);
      textAt(ctx, 'FREEZER', 0, h*0.2, 7, '#0891b2', true);
    }},
    { id:'cooler', label:'Walk-in Cooler', cat:'mercantile', w:60, h:50, extrude3D:{h:9,color:C.metalLt}, draw(ctx,w,h){
      rect(ctx, -w/2, -h/2, w, h, '#e5e7eb', '#6b7280', 2, 2);
      rect(ctx, -w*0.45, -h*0.45, w*0.9, h*0.9, 'transparent', '#9ca3af', 0.75, 1);
      textAt(ctx, 'COOLER', 0, 0, 9, '#4b5563', true);
    }},
    { id:'storage', label:'Storage Room', cat:'mercantile', w:55, h:45, extrude3D:{h:9,color:'#c5bba8'}, draw(ctx,w,h){
      rect(ctx, -w/2, -h/2, w, h, '#fef9c3', '#ca8a04', 1.5, 2);
      textAt(ctx, 'STORAGE', 0, 0, 10, '#713f12', true);
    }},
  ];

  // ========== ADA ==========
  const ada = [
    { id:'handicap', label:'Handicap Sym', cat:'ada', w:22, h:22, draw(ctx,w,h){
      circle(ctx, 0, 0, w*0.48, C.blue, '#1e3a8a', 1.5);
      // Stick figure on wheel
      ctx.fillStyle = '#fff';
      circle(ctx, 0, -w*0.15, 2.5, '#fff', null);
      ctx.fillRect(-1.5, -w*0.08, 3, w*0.25);
      circle(ctx, 0, w*0.22, w*0.18, 'transparent', '#fff', 2);
    }},
    { id:'ada-park', label:'ADA Parking', cat:'ada', w:30, h:22, extrude3D:{h:0.1,color:C.blue}, draw(ctx,w,h){
      rect(ctx, -w/2, -h/2, w, h, C.blue, '#1e3a8a', 1.5, 2);
      circle(ctx, 0, -h*0.1, h*0.2, 'transparent', '#fff', 1.5);
      textAt(ctx, 'ADA', 0, h*0.3, 6, '#fff', true);
    }},
    { id:'ada-ramp', label:'Wheelchair Ramp', cat:'ada', w:40, h:22, extrude3D:{h:0.5,color:'#a78bfa'}, draw(ctx,w,h){
      rect(ctx, -w/2, -h/2, w, h, '#a78bfa', '#6d28d9', 1.5, 2);
      for (let i=0; i<5; i++) line(ctx, -w*0.4 + i*w*0.2, -h*0.3, -w*0.4 + i*w*0.2, h*0.3, '#6d28d9', 0.75);
      textAt(ctx, 'RAMP', 0, 0, 7, '#fff', true);
    }},
    { id:'ada-restroom', label:'ADA Restroom', cat:'ada', w:24, h:22, draw(ctx,w,h){
      rect(ctx, -w/2, -h/2, w, h, C.blue, '#1e3a8a', 1.5, 2);
      textAt(ctx, '♿', 0, 0, 12, '#fff', true);
    }},
    { id:'ada-elev', label:'ADA Elevator', cat:'ada', w:24, h:26, extrude3D:{h:10,color:'#d1d5db'}, draw(ctx,w,h){
      rect(ctx, -w/2, -h/2, w, h, '#eff6ff', C.blue, 1.5, 2);
      line(ctx, 0, -h/2+2, 0, h/2-2, '#bfdbfe', 1);
      textAt(ctx, '♿', 0, -h*0.18, 8, C.blue, true);
      textAt(ctx, 'ELEV', 0, h*0.2, 6, C.blue, true);
    }},
    { id:'auto-door', label:'Auto Door', cat:'ada', w:36, h:10, draw(ctx,w,h){
      line(ctx, -w/2, 0, w/2, 0, '#fff', 4);
      line(ctx, -w/2, 0, w/2, 0, C.blue, 1.5);
      // Sensor indicator
      circle(ctx, 0, -h*0.3, 1.5, C.blue, '#fff', 0.5);
      textAt(ctx, 'AUTO', 0, h*0.5, 5, C.blue, true);
    }},
  ];

  // ========== OBSTRUCTIONS ==========
  const obstructions = [
    { id:'tree', label:'Tree', cat:'obstructions', w:30, h:30, extrude3D:{h:16,color:C.green}, draw(ctx,w,h){
      // Canopy layers
      circle(ctx, 0, 0, w*0.48, '#86efac', '#166534', 1);
      circle(ctx, -w*0.15, -w*0.1, w*0.3, '#4ade80', null);
      circle(ctx, w*0.15, -w*0.05, w*0.28, '#22c55e', null);
      circle(ctx, 0, w*0.12, w*0.25, '#16a34a', null);
      // Trunk
      circle(ctx, 0, 0, w*0.08, C.woodDk, '#422006', 0.5);
    }},
    { id:'shrub', label:'Shrub/Bush', cat:'obstructions', w:18, h:18, extrude3D:{h:3.5,color:C.green}, draw(ctx,w,h){
      circle(ctx, -w*0.2, 0, w*0.3, '#86efac', '#166534', 0.75);
      circle(ctx, w*0.2, -w*0.08, w*0.28, '#22c55e', '#166534', 0.75);
      circle(ctx, 0, w*0.15, w*0.28, '#4ade80', '#166534', 0.75);
    }},
    { id:'powerline', label:'Power Lines', cat:'obstructions', w:50, h:14, draw(ctx,w,h){
      // Pole
      rect(ctx, -w*0.04, -h/2, w*0.08, h, C.woodDk, '#422006', 0.75);
      // Crossarm
      line(ctx, -w*0.3, -h*0.3, w*0.3, -h*0.3, '#6b7280', 1.5);
      // Wires
      for (let i=0; i<3; i++) {
        ctx.strokeStyle = '#1f1f1f'; ctx.lineWidth = 0.5;
        ctx.beginPath(); ctx.moveTo(-w/2, -h*0.3 + i*3); ctx.quadraticCurveTo(0, h*0.1 + i*3, w/2, -h*0.3 + i*3); ctx.stroke();
      }
      textAt(ctx, '⚡', 0, h*0.25, 8, C.amber);
    }},
    { id:'gas-line', label:'Gas Line', cat:'obstructions', w:60, h:6, draw(ctx,w,h){
      line(ctx, -w/2, 0, w/2, 0, '#fbbf24', 3);
      ctx.setLineDash([6, 3]);
      line(ctx, -w/2, 0, w/2, 0, '#92400e', 1);
      ctx.setLineDash([]);
      textAt(ctx, 'GAS', 0, -h-1, 6, '#92400e', true);
    }},
    { id:'water-line', label:'Water Line', cat:'obstructions', w:60, h:6, draw(ctx,w,h){
      line(ctx, -w/2, 0, w/2, 0, C.blueLt, 3);
      ctx.setLineDash([6, 3]);
      line(ctx, -w/2, 0, w/2, 0, '#1e40af', 1);
      ctx.setLineDash([]);
      textAt(ctx, 'H2O', 0, -h-1, 6, '#1e40af', true);
    }},
    { id:'fence', label:'Fence', cat:'obstructions', w:50, h:6, extrude3D:{h:6,color:C.wood}, draw(ctx,w,h){
      line(ctx, -w/2, 0, w/2, 0, C.woodDk, 2);
      for (let i=0; i<11; i++) {
        const x = -w/2 + (w/10)*i;
        line(ctx, x, -3, x, 3, C.woodDk, 0.75);
      }
    }},
    { id:'bollard', label:'Bollard', cat:'obstructions', w:12, h:12, extrude3D:{h:4,color:'#fbbf24'}, draw(ctx,w,h){
      circle(ctx, 0, 0, w*0.4, '#fbbf24', '#b45309', 1.5);
      circle(ctx, 0, 0, w*0.25, '#fef3c7', null);
    }},
    { id:'limited', label:'Limited Access', cat:'obstructions', w:28, h:16, draw(ctx,w,h){
      rect(ctx, -w/2, -h/2, w, h, '#fef08a', '#ca8a04', 1.5, 2);
      textAt(ctx, '!', 0, 0, 12, '#854d0e', true);
      textAt(ctx, 'LIMITED', 0, h*0.35, 5, '#854d0e', true);
    }},
    { id:'no-access', label:'No Access', cat:'obstructions', w:20, h:20, draw(ctx,w,h){
      circle(ctx, 0, 0, w*0.45, '#fff', C.fire, 2);
      line(ctx, -w*0.3, -w*0.3, w*0.3, w*0.3, C.fire, 2.5);
    }},
    { id:'overhead', label:'Overhead Obst', cat:'obstructions', w:30, h:14, draw(ctx,w,h){
      rect(ctx, -w/2, -h/2, w, h, '#fde68a', '#ca8a04', 1.5, 2);
      textAt(ctx, '↕', 0, -h*0.1, 10, '#854d0e', true);
      textAt(ctx, 'HEIGHT', 0, h*0.3, 5, '#854d0e', true);
    }},
  ];

  // ========== MECHANICAL ==========
  const mechanical = [
    { id:'ac-condenser', label:'Outside A/C Unit', cat:'mechanical', w:28, h:28, extrude3D:{h:9,color:'#94a3b8'}, draw(ctx,w,h){
      rect(ctx, -w/2, -h/2, w, h, '#cbd5e1', '#475569', 1.5, 3);
      circle(ctx, 0, -h*0.05, w*0.32, '#94a3b8', '#475569', 1.5);
      for (let k=0;k<4;k++){ const an=k*Math.PI/2; line(ctx, 0, -h*0.05, Math.cos(an)*w*0.28, -h*0.05+Math.sin(an)*w*0.28, '#475569', 1.2); }
      circle(ctx, 0, -h*0.05, 1.8, '#334155', null, 0);
      textAt(ctx, 'A/C', 0, h*0.4, 5.5, '#334155', true);
    }},
    { id:'vehicle-lift', label:'Vehicle Lift', cat:'mechanical', w:70, h:22, extrude3D:{h:0.5,color:C.metalDk}, draw(ctx,w,h){
      rect(ctx, -w/2, -h*0.1, w, h*0.2, '#6b7280', '#1f2937', 1.5);
      rect(ctx, -w*0.35, -h/2, w*0.05, h, '#4b5563', '#000', 1);
      rect(ctx, w*0.3, -h/2, w*0.05, h, '#4b5563', '#000', 1);
      textAt(ctx, 'LIFT', 0, h*0.3, 7, '#1f2937', true);
    }},
    { id:'tool-bench', label:'Tool Bench', cat:'mechanical', w:55, h:22, extrude3D:{h:3,color:C.wood}, draw(ctx,w,h){
      rect(ctx, -w/2, -h/2, w, h, '#a78160', '#78543c', 1.5);
      for (let i=0; i<6; i++) {
        rect(ctx, -w*0.4 + i*w*0.15, -h*0.35, w*0.1, h*0.15, '#555', '#000', 0.5);
      }
      rect(ctx, -w*0.4, h*0.1, w*0.8, h*0.25, '#78543c', null);
    }},
    { id:'compressor', label:'Air Compressor', cat:'mechanical', w:30, h:20, extrude3D:{h:3.5,color:C.fire}, draw(ctx,w,h){
      rect(ctx, -w/2, -h*0.15, w, h*0.45, C.fire, C.fireDk, 1.5, 2);
      // Tank
      ctx.beginPath(); ctx.ellipse(0, h*0.25, w*0.35, h*0.18, 0, 0, Math.PI*2);
      ctx.fillStyle = C.fire; ctx.strokeStyle = C.fireDk; ctx.lineWidth = 1.5; ctx.fill(); ctx.stroke();
      // Motor
      rect(ctx, -w*0.15, -h*0.4, w*0.3, h*0.2, '#1f2937', '#000', 0.75, 1);
    }},
    { id:'welder', label:'Welding Station', cat:'mechanical', w:28, h:30, draw(ctx,w,h){
      rect(ctx, -w/2, -h/2, w, h, C.amber, '#92400e', 1.5, 2);
      textAt(ctx, '⚡', 0, -h*0.1, 14, '#fff', true);
      textAt(ctx, 'WELD', 0, h*0.3, 6, '#fff', true);
    }},
    { id:'paint-booth', label:'Paint Booth', cat:'mechanical', w:60, h:50, extrude3D:{h:9,color:'#a855f7'}, draw(ctx,w,h){
      rect(ctx, -w/2, -h/2, w, h, '#f3e8ff', '#7c3aed', 2, 2);
      // Door line
      line(ctx, -w*0.4, h*0.45, w*0.4, h*0.45, '#7c3aed', 1.5);
      textAt(ctx, 'PAINT', 0, 0, 10, '#6d28d9', true);
      textAt(ctx, 'BOOTH', 0, h*0.2, 8, '#6d28d9', true);
    }},
    { id:'oil-pit', label:'Oil Change Pit', cat:'mechanical', w:60, h:22, draw(ctx,w,h){
      rect(ctx, -w/2, -h/2, w, h, '#1f2937', '#000', 2, 1);
      ctx.setLineDash([3, 2]);
      rect(ctx, -w*0.45, -h*0.4, w*0.9, h*0.8, 'transparent', C.amber, 1);
      ctx.setLineDash([]);
      textAt(ctx, 'OIL PIT', 0, 0, 8, C.amber, true);
    }},
    { id:'conveyor', label:'Conveyor', cat:'mechanical', w:80, h:14, extrude3D:{h:3,color:C.metalDk}, draw(ctx,w,h){
      rect(ctx, -w/2, -h/2, w, h, '#4b5563', '#1f2937', 1.5, 1);
      ctx.setLineDash([4, 3]);
      line(ctx, -w/2+3, 0, w/2-3, 0, '#fbbf24', 1);
      ctx.setLineDash([]);
      for (let i=0; i<2; i++) {
        circle(ctx, -w/2+6 + i*(w-12), 0, h*0.3, '#1f2937', '#000', 0.75);
      }
    }},
    { id:'forklift', label:'Forklift Area', cat:'mechanical', w:40, h:24, draw(ctx,w,h){
      rect(ctx, -w/2, -h/2, w, h, '#fef3c7', C.amber, 1.5, 2);
      textAt(ctx, '🛠', 0, 0, 10);
      textAt(ctx, 'FORKLIFT', 0, h*0.3, 6, '#854d0e', true);
    }},
    { id:'crane', label:'Overhead Crane', cat:'mechanical', w:70, h:10, extrude3D:{h:14,color:C.metalDk}, draw(ctx,w,h){
      rect(ctx, -w/2, -h/2, w, h, '#4b5563', '#000', 1.5);
      for (let i=0; i<7; i++) line(ctx, -w*0.4 + i*w*0.13, -h*0.4, -w*0.4 + i*w*0.13, h*0.4, '#1f2937', 0.75);
      textAt(ctx, 'CRANE', 0, 0, 6, '#fff', true);
    }},
    { id:'machine', label:'Machinery', cat:'mechanical', w:38, h:30, extrude3D:{h:5,color:C.metalDk}, draw(ctx,w,h){
      rect(ctx, -w/2, -h/2, w, h, '#6b7280', '#1f2937', 1.5, 2);
      rect(ctx, -w*0.35, -h*0.35, w*0.7, h*0.3, '#1f2937', '#000', 0.75, 1);
      circle(ctx, -w*0.25, h*0.15, 3, '#fbbf24', null);
      circle(ctx, w*0.25, h*0.15, 3, '#16a34a', null);
    }},
    { id:'pallet', label:'Pallet Rack', cat:'mechanical', w:45, h:22, extrude3D:{h:12,color:C.metalDk}, draw(ctx,w,h){
      rect(ctx, -w/2, -h/2, w, h, '#d4c4a8', C.woodDk, 1.5, 1);
      // 6 pallets in grid
      for (let r=0; r<2; r++) for (let c=0; c<3; c++) {
        rect(ctx, -w*0.4 + c*w*0.3, -h*0.35 + r*h*0.4, w*0.22, h*0.3, '#a78160', C.woodDk, 0.5);
      }
    }},
    { id:'loading', label:'Loading Dock', cat:'mechanical', w:45, h:20, extrude3D:{h:3.5,color:C.metalDk}, draw(ctx,w,h){
      rect(ctx, -w/2, -h/2, w, h, '#6b7280', '#1f2937', 2, 1);
      // Dock edge
      line(ctx, -w/2, -h*0.3, w/2, -h*0.3, '#fbbf24', 2);
      ctx.setLineDash([4, 3]);
      line(ctx, -w/2, 0, w/2, 0, '#fbbf24', 0.75);
      ctx.setLineDash([]);
      textAt(ctx, 'DOCK', 0, h*0.25, 7, '#fbbf24', true);
    }},
  ];

  // ========== ASSEMBLY ==========
  const assembly = [
    { id:'pew', label:'Pew/Seating', cat:'assembly', w:60, h:12, extrude3D:{h:1.8,color:C.wood}, draw(ctx,w,h){
      rect(ctx, -w/2, -h/2, w, h, C.woodLt, C.woodDk, 1.5, 1);
      // Seat + back split
      line(ctx, -w/2+3, -h*0.15, w/2-3, -h*0.15, C.woodDk, 1);
    }},
    { id:'altar', label:'Altar', cat:'assembly', w:40, h:20, extrude3D:{h:3.5,color:C.wood}, draw(ctx,w,h){
      rect(ctx, -w/2, -h/2, w, h, '#fde68a', C.woodDk, 1.5, 2);
      rect(ctx, -w*0.35, -h*0.35, w*0.7, h*0.2, '#fef9c3', C.woodDk, 0.75);
      textAt(ctx, 'ALTAR', 0, h*0.2, 8, '#78350f', true);
    }},
    { id:'pulpit', label:'Pulpit', cat:'assembly', w:20, h:18, extrude3D:{h:4,color:C.wood}, draw(ctx,w,h){
      ctx.beginPath();
      ctx.moveTo(-w/2, h/2);
      ctx.lineTo(w/2, h/2);
      ctx.lineTo(w*0.3, -h/2);
      ctx.lineTo(-w*0.3, -h/2);
      ctx.closePath();
      ctx.fillStyle = C.wood; ctx.strokeStyle = C.woodDk; ctx.lineWidth = 1.5;
      ctx.fill(); ctx.stroke();
      textAt(ctx, 'P', 0, 0, 9, '#fff', true);
    }},
    { id:'baptistry', label:'Baptistry', cat:'assembly', w:32, h:28, extrude3D:{h:3.5,color:C.blueLt}, draw(ctx,w,h){
      rect(ctx, -w/2, -h/2, w, h, C.blueLt, '#1e40af', 2, 3);
      ctx.beginPath(); ctx.ellipse(0, 0, w*0.35, h*0.35, 0, 0, Math.PI*2);
      ctx.fillStyle = '#bfdbfe'; ctx.fill();
      textAt(ctx, '~', 0, 0, 14, '#1e40af', true);
    }},
    { id:'choir', label:'Choir Loft', cat:'assembly', w:50, h:30, extrude3D:{h:3,color:C.wood}, draw(ctx,w,h){
      ctx.beginPath();
      ctx.arc(0, h*0.2, w*0.45, Math.PI*1.15, Math.PI*1.85);
      ctx.lineTo(-w*0.35, h*0.35);
      ctx.lineTo(w*0.35, h*0.35);
      ctx.closePath();
      ctx.fillStyle = C.woodLt; ctx.strokeStyle = C.woodDk; ctx.lineWidth = 1.5;
      ctx.fill(); ctx.stroke();
      textAt(ctx, 'CHOIR', 0, h*0.15, 8, '#78350f', true);
    }},
    { id:'organ', label:'Organ/Piano', cat:'assembly', w:40, h:20, extrude3D:{h:4.5,color:'#111'}, draw(ctx,w,h){
      rect(ctx, -w/2, -h/2, w, h, '#1f2937', '#000', 1.5, 2);
      rect(ctx, -w*0.4, -h*0.2, w*0.8, h*0.15, '#fff', '#000', 0.5);
      for (let i=0; i<12; i++) line(ctx, -w*0.4 + i*w*0.067, -h*0.2, -w*0.4 + i*w*0.067, -h*0.05, '#000', 0.5);
      // Black keys
      for (let i=0; i<8; i++) if (i%7!==2 && i%7!==6) rect(ctx, -w*0.4 + i*w*0.1 - w*0.02, -h*0.2, w*0.04, h*0.08, '#000', null);
    }},
    { id:'seat-row', label:'Seating Row', cat:'assembly', w:50, h:10, extrude3D:{h:2.5,color:C.fabricDk}, draw(ctx,w,h){
      for (let i=0; i<7; i++) {
        circle(ctx, -w*0.43 + i*w*0.145, 0, w*0.055, '#f5f0e8', '#666', 0.75);
      }
    }},
    { id:'stage', label:'Stage', cat:'assembly', w:70, h:30, extrude3D:{h:3.5,color:C.woodDk}, draw(ctx,w,h){
      rect(ctx, -w/2, -h/2, w, h, '#78350f', '#422006', 2, 1);
      for (let i=0; i<6; i++) line(ctx, -w/2, -h/2 + h*i/6, w/2, -h/2 + h*i/6, '#422006', 0.5);
      textAt(ctx, 'STAGE', 0, 0, 12, '#fde68a', true);
    }},
    { id:'bleachers', label:'Bleachers', cat:'assembly', w:60, h:30, extrude3D:{h:8,color:C.metalLt}, draw(ctx,w,h){
      for (let i=0; i<5; i++) {
        rect(ctx, -w/2, -h/2 + i*h/5, w, h/5-0.5, i%2?'#e5e7eb':'#d1d5db', '#6b7280', 0.5);
      }
    }},
    { id:'concession', label:'Concession', cat:'assembly', w:40, h:22, extrude3D:{h:7,color:C.orange}, draw(ctx,w,h){
      rect(ctx, -w/2, -h/2, w, h, '#fed7aa', '#c2410c', 1.5, 2);
      // Awning stripes
      for (let i=0; i<6; i++) rect(ctx, -w/2 + i*w/6, -h/2, w/6, h*0.2, i%2?'#fff':'#dc2626', null);
      textAt(ctx, 'CONCESSIONS', 0, h*0.2, 6, '#7c2d12', true);
    }},
    { id:'ticket', label:'Ticket Booth', cat:'assembly', w:22, h:22, extrude3D:{h:7,color:C.orange}, draw(ctx,w,h){
      rect(ctx, -w/2, -h/2, w, h, '#fef3c7', '#ca8a04', 1.5, 2);
      rect(ctx, -w*0.35, -h*0.15, w*0.7, h*0.15, '#1f1f1f', null, 0);
      textAt(ctx, 'TIX', 0, h*0.25, 6, '#854d0e', true);
    }},
  ];

  // ========== HAZMAT ==========
  const hazmat = [
    { id:'co2-tank', label:'CO2 Container', cat:'hazmat', w:14, h:28, extrude3D:{h:14,color:'#4b5563'}, draw(ctx,w,h){
      rect(ctx, -w*0.34, -h*0.32, w*0.68, h*0.72, '#4b5563', '#1f2937', 1.5, 4);
      circle(ctx, 0, -h*0.32, w*0.34, '#6b7280', '#1f2937', 1);
      rect(ctx, -w*0.12, -h*0.5, w*0.24, h*0.12, '#9ca3af', '#374151', 1, 1);
      textAt(ctx, 'CO2', 0, h*0.02, 5.5, '#fff', true);
    }},
    { id:'nfpa704', label:'NFPA 704', cat:'hazmat', w:30, h:30, draw(ctx,w,h){
      // Diamond
      ctx.save(); ctx.rotate(Math.PI/4);
      rect(ctx, -w*0.32, -w*0.32, w*0.64, w*0.64, '#fff', '#000', 1);
      // 4 quadrants
      rect(ctx, -w*0.32, -w*0.32, w*0.32, w*0.32, C.blue, null); // health
      rect(ctx, 0, -w*0.32, w*0.32, w*0.32, C.fire, null);        // fire
      rect(ctx, 0, 0, w*0.32, w*0.32, '#fbbf24', null);           // reactivity
      rect(ctx, -w*0.32, 0, w*0.32, w*0.32, '#fff', null);        // special
      ctx.restore();
      textAt(ctx, 'H', -w*0.2, -w*0.05, 6, '#fff', true);
      textAt(ctx, 'F', 0, -w*0.23, 6, '#fff', true);
      textAt(ctx, 'R', w*0.2, -w*0.05, 6, '#fff', true);
      textAt(ctx, 'W', 0, w*0.13, 6, '#000', true);
    }},
    { id:'hazmat-store', label:'Hazmat Storage', cat:'hazmat', w:36, h:30, extrude3D:{h:7,color:C.amber}, draw(ctx,w,h){
      rect(ctx, -w/2, -h/2, w, h, '#fef3c7', '#ca8a04', 2, 2);
      textAt(ctx, '☣', 0, -h*0.1, 14, '#7c2d12', true);
      textAt(ctx, 'HAZMAT', 0, h*0.3, 7, '#7c2d12', true);
    }},
    { id:'fuel-tank', label:'Fuel Tank', cat:'hazmat', w:40, h:18, extrude3D:{h:6,color:C.metalDk}, draw(ctx,w,h){
      rect(ctx, -w/2, -h/2, w, h, '#6b7280', '#1f2937', 2, h/2);
      // End caps
      circle(ctx, -w/2+3, 0, h/2-2, '#9ca3af', '#1f2937', 1);
      circle(ctx, w/2-3, 0, h/2-2, '#9ca3af', '#1f2937', 1);
      textAt(ctx, 'FUEL', 0, 0, 7, '#fff', true);
    }},
    { id:'propane', label:'Propane Tank', cat:'hazmat', w:28, h:18, extrude3D:{h:5,color:C.fire}, draw(ctx,w,h){
      rect(ctx, -w/2, -h/2, w, h, C.fire, C.fireDk, 2, h/2);
      circle(ctx, -w/2+3, 0, h/2-2, '#fca5a5', C.fireDk, 1);
      circle(ctx, w/2-3, 0, h/2-2, '#fca5a5', C.fireDk, 1);
      textAt(ctx, 'LPG', 0, 0, 8, '#fff', true);
    }},
  ];

  // ========== COMPASS ==========
  const compass = [
    { id:'compass-rose', label:'Compass Rose', cat:'compass', w:36, h:36, draw(ctx,w,h){
      circle(ctx, 0, 0, w*0.48, '#fff', '#1f2937', 1);
      // NSEW arms
      ctx.fillStyle = '#1f2937';
      ctx.beginPath(); ctx.moveTo(0, -w*0.45); ctx.lineTo(-w*0.1, 0); ctx.lineTo(w*0.1, 0); ctx.closePath(); ctx.fill();
      ctx.fillStyle = '#9ca3af';
      ctx.beginPath(); ctx.moveTo(0, w*0.45); ctx.lineTo(-w*0.1, 0); ctx.lineTo(w*0.1, 0); ctx.closePath(); ctx.fill();
      ctx.beginPath(); ctx.moveTo(-w*0.45, 0); ctx.lineTo(0, -w*0.1); ctx.lineTo(0, w*0.1); ctx.closePath(); ctx.fill();
      ctx.beginPath(); ctx.moveTo(w*0.45, 0); ctx.lineTo(0, -w*0.1); ctx.lineTo(0, w*0.1); ctx.closePath(); ctx.fill();
      textAt(ctx, 'N', 0, -w*0.35, 7, '#fff', true);
    }},
    { id:'north-arrow', label:'North Arrow', cat:'compass', w:20, h:32, draw(ctx,w,h){
      ctx.fillStyle = '#1f2937';
      ctx.beginPath();
      ctx.moveTo(0, -h/2);
      ctx.lineTo(-w*0.35, h*0.3);
      ctx.lineTo(0, h*0.1);
      ctx.lineTo(w*0.35, h*0.3);
      ctx.closePath(); ctx.fill();
      textAt(ctx, 'N', 0, h*0.38, 9, '#1f2937', true);
    }},
    { id:'north-simple', label:'Simple N', cat:'compass', w:18, h:22, draw(ctx,w,h){
      ctx.strokeStyle = '#1f2937'; ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(0, h/2);
      ctx.lineTo(0, -h*0.3);
      ctx.moveTo(-w*0.35, -h*0.2);
      ctx.lineTo(0, -h*0.3);
      ctx.lineTo(w*0.35, -h*0.2);
      ctx.stroke();
      textAt(ctx, 'N', 0, -h*0.4, 8, '#1f2937', true);
    }},
  ];

  // ========== OTHER ==========
  const other = [
    { id:'dumpster', label:'Dumpster', cat:'other', w:32, h:22, extrude3D:{h:4,color:C.metalDk}, draw(ctx,w,h){
      rect(ctx, -w/2, -h/2, w, h, '#6b7280', '#1f2937', 2, 2);
      line(ctx, -w/2+3, -h*0.2, w/2-3, -h*0.2, '#4b5563', 1.5);
      textAt(ctx, 'DUMP', 0, h*0.15, 8, '#fff', true);
    }},
    { id:'restroom', label:'Restroom', cat:'other', w:24, h:22, draw(ctx,w,h){
      rect(ctx, -w/2, -h/2, w, h, '#e0e7ff', '#4338ca', 1.5, 2);
      textAt(ctx, 'WC', 0, 0, 10, '#4338ca', true);
    }},
    { id:'office', label:'Office', cat:'other', w:40, h:30, extrude3D:{h:9,color:'#c5bba8'}, draw(ctx,w,h){
      rect(ctx, -w/2, -h/2, w, h, '#fef3c7', '#ca8a04', 1.5, 2);
      textAt(ctx, 'OFFICE', 0, 0, 10, '#713f12', true);
    }},
    { id:'breakroom', label:'Break Room', cat:'other', w:42, h:32, extrude3D:{h:9,color:'#c5bba8'}, draw(ctx,w,h){
      rect(ctx, -w/2, -h/2, w, h, '#dbeafe', '#1d4ed8', 1.5, 2);
      textAt(ctx, 'BREAK', 0, -h*0.1, 9, '#1e40af', true);
      textAt(ctx, 'ROOM', 0, h*0.15, 9, '#1e40af', true);
    }},
    { id:'server-room', label:'Server Room', cat:'other', w:40, h:30, extrude3D:{h:9,color:'#1f2937'}, draw(ctx,w,h){
      rect(ctx, -w/2, -h/2, w, h, '#1f2937', '#000', 1.5, 2);
      for (let i=0; i<8; i++) rect(ctx, -w*0.4 + (i%4)*w*0.2, -h*0.35 + Math.floor(i/4)*h*0.3, w*0.15, h*0.2, '#374151', '#4b5563', 0.5);
      textAt(ctx, 'SERVERS', 0, h*0.3, 7, C.green, true);
    }},
    { id:'mech-room', label:'Mech Room', cat:'other', w:38, h:30, extrude3D:{h:9,color:'#6b7280'}, draw(ctx,w,h){
      rect(ctx, -w/2, -h/2, w, h, '#f3f4f6', '#374151', 1.5, 2);
      circle(ctx, 0, 0, h*0.25, 'transparent', '#4b5563', 1);
      textAt(ctx, '⚙', 0, 0, 14);
      textAt(ctx, 'MECH', 0, h*0.35, 7, '#374151', true);
    }},
    { id:'pool', label:'Pool', cat:'other', w:60, h:32, extrude3D:{h:0.5,color:C.blueLt}, draw(ctx,w,h){
      rect(ctx, -w/2, -h/2, w, h, C.glass, '#0891b2', 2, 6);
      rect(ctx, -w*0.45, -h*0.4, w*0.9, h*0.8, '#67e8f9', '#0e7490', 1, 5);
      // Ripples
      ctx.strokeStyle = '#fff'; ctx.lineWidth = 0.5;
      for (let i=0; i<3; i++) {
        ctx.beginPath(); ctx.arc(-w*0.2 + i*w*0.2, -h*0.1, 4 + i, 0, Math.PI*2); ctx.stroke();
      }
      textAt(ctx, 'POOL', 0, h*0.25, 8, '#0e7490', true);
    }},
  ];

  // Combine
  const all = [
    ...fire, ...doors, ...access, ...utilities, ...furniture, ...mercantile,
    ...ada, ...obstructions, ...mechanical, ...assembly, ...hazmat, ...compass, ...other
  ];
  const byId = {};
  all.forEach(s => byId[s.id] = s);

  // Category metadata
  const CATEGORIES = [
    { id: 'fire',         label: '🔥 Fire Protection' },
    { id: 'doors',        label: '🚪 Doors & Windows' },
    { id: 'access',       label: '🪜 Access' },
    { id: 'utilities',    label: '⚡ Utilities' },
    { id: 'furniture',    label: '🛋️ Furniture' },
    { id: 'mercantile',   label: '🏪 Mercantile' },
    { id: 'ada',          label: '♿ ADA' },
    { id: 'obstructions', label: '⚠️ Obstructions' },
    { id: 'mechanical',   label: '🔧 Mechanical' },
    { id: 'assembly',     label: '⛪ Assembly' },
    { id: 'hazmat',       label: '☢️ Hazmat' },
    { id: 'compass',      label: '🧭 Compass' },
    { id: 'other',        label: '📍 Other' },
  ];

  return { all, byId, CATEGORIES };
})();
window.FP_SYMBOLS = SYMBOLS;
