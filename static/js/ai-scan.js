// Hero illustration: an IHC-stained field of nuclei is swept by a scan line;
// each nucleus behind the line is classified positive (DAB) or negative
// (hematoxylin) and the readout card tallies a live score. One marker per pass.
(function () {
  var canvas = document.getElementById('scanCanvas');
  if (!canvas) return;
  var ctx = canvas.getContext('2d');
  var $ = function (id) { return document.getElementById(id); };
  var ui = { marker: $('scanMarker'), pattern: $('scanPattern'), pct: $('scanPct'),
             bar: $('scanBar'), cells: $('scanCells'), ctrl: $('scanCtrl'), mag: $('scanMag') };
  var REDUCED = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  // Illustrative markers: target positivity and the pattern label shown when a pass completes.
  var MARKERS = [
    { name: 'p53',   target: 0.78, label: 'Aberrant · overexpression', blob: 0.9 },
    { name: 'Ki-67', target: 0.24, label: 'Proliferation index',       blob: 0.5 },
    { name: 'MLH1',  target: 0.91, label: 'Intact nuclear expression', blob: 0.2 },
    { name: 'PD-L1', target: 0.46, label: 'TPS ≥ 1% · positive',       blob: 0.7 }
  ];
  var MAG_LABELS = ['1×', '5×', '10×', '20×', '40×'];
  var MAG_SCALE  = [0.42, 0.55, 0.7, 0.85, 1];
  var PASS_MS = 5200, HOLD_MS = 2200, TAU = Math.PI * 2;

  var W = 0, H = 0, dpr = 1, cells = [], tissue, overlay, octx, mi = 0, magIdx = 4;
  var passStart = 0, scanned = 0, pos = 0, running = false, visible = true;

  // Cheap smooth noise from a few random sinusoids.
  function noise2() {
    var k = [];
    for (var i = 0; i < 4; i++) k.push([Math.random() * 0.02 + 0.004, Math.random() * 0.02 + 0.004, Math.random() * TAU]);
    return function (x, y) {
      var v = 0;
      for (var i = 0; i < k.length; i++) v += Math.sin(x * k[i][0] + y * k[i][1] + k[i][2]);
      return v / k.length;
    };
  }

  function layer() {
    var c = document.createElement('canvas'); c.width = W * dpr; c.height = H * dpr;
    var g = c.getContext('2d'); g.setTransform(dpr, 0, 0, dpr, 0, 0); return [c, g];
  }

  function outline(g, c, grow) {
    var n = c.poly.length, ca = Math.cos(c.a), sa = Math.sin(c.a);
    g.beginPath();
    for (var v = 0; v <= n; v++) {
      var th = v / n * TAU, k = c.poly[v % n];
      var ex = Math.cos(th) * (c.rx * k + grow), ey = Math.sin(th) * (c.ry * k + grow);
      var x = c.x + ex * ca - ey * sa, y = c.y + ex * sa + ey * ca;
      if (v === 0) g.moveTo(x, y); else g.lineTo(x, y);
    }
    g.closePath();
  }

  // Holographic rendering of the same tissue architecture: a deep violet
  // projection field, faint luminous collagen, and nuclei that glow by class.
  function paintTissue(g, isTumor, fibre, s) {
    var bg = g.createRadialGradient(W * 0.45, H * 0.4, 0, W * 0.5, H * 0.5, Math.max(W, H) * 0.75);
    bg.addColorStop(0, '#24104F'); bg.addColorStop(0.6, '#160A36'); bg.addColorStop(1, '#0C0620');
    g.fillStyle = bg; g.fillRect(0, 0, W, H);
    var step = 6;
    for (var y = 0; y < H; y += step) for (var x = 0; x < W; x += step) {
      if (isTumor(x, y)) { g.fillStyle = 'rgba(130,90,255,0.10)'; g.fillRect(x, y, step, step); }
    }
    g.save(); g.filter = 'blur(6px)'; g.drawImage(g.canvas, 0, 0, W, H); g.restore();
    g.save(); g.globalCompositeOperation = 'lighter'; g.lineCap = 'round';
    for (var f = 0; f < 150; f++) {
      var fx = Math.random() * W, fy = Math.random() * H;
      if (isTumor(fx, fy)) continue;
      var a = fibre(fx / s, fy / s) * 1.6, len = (30 + Math.random() * 60) * s;
      g.strokeStyle = 'rgba(150,110,255,' + (0.05 + Math.random() * 0.08) + ')';
      g.lineWidth = (0.8 + Math.random() * 1.8) * s;
      g.beginPath(); g.moveTo(fx, fy);
      g.quadraticCurveTo(fx + Math.cos(a) * len * 0.5 + (Math.random() - 0.5) * 10, fy + Math.sin(a) * len * 0.5 + (Math.random() - 0.5) * 10,
                         fx + Math.cos(a) * len, fy + Math.sin(a) * len);
      g.stroke();
    }
    g.restore();
  }

  // Glass cells: translucent cytoplasm with a fresnel rim, a membrane line,
  // a nucleus (magenta when DAB-positive) with nucleolus, and a specular glint.
  function paintNucleus(g, c, s) {
    var nuc = c.p ? [255, 110, 210] : [140, 128, 255];
    var cb = c.t ? 2.05 : 1.55;                              // cell body relative to nucleus
    var body = { x: c.x, y: c.y, rx: c.rx * cb, ry: c.ry * (c.t ? cb * 1.05 : 1.9), a: c.a, poly: c.poly };
    var R = Math.max(body.rx, body.ry);
    g.save();
    // Cytoplasm: dark core, bright rim (fresnel) gives the glass-bead read.
    var cy = g.createRadialGradient(c.x, c.y, R * 0.15, c.x, c.y, R * 1.02);
    cy.addColorStop(0, 'rgba(90,60,180,0.10)');
    cy.addColorStop(0.72, 'rgba(120,90,230,0.16)');
    cy.addColorStop(0.93, 'rgba(196,170,255,' + (c.t ? 0.42 : 0.28) + ')');
    cy.addColorStop(1, 'rgba(225,210,255,0.10)');
    g.fillStyle = cy; outline(g, body, 0); g.fill();
    g.strokeStyle = 'rgba(210,190,255,' + (c.t ? 0.35 : 0.22) + ')'; g.lineWidth = 0.7;
    outline(g, body, 0); g.stroke();                         // membrane
    // Nucleus with soft glow.
    g.globalCompositeOperation = 'lighter';
    g.shadowColor = 'rgba(' + nuc + ',0.7)'; g.shadowBlur = (c.p ? 8 : 4) * s;
    var na = c.p ? 0.55 + c.d * 0.35 : 0.28 + c.d * 0.25;
    var ng = g.createRadialGradient(c.x - c.rx * 0.2, c.y - c.ry * 0.25, 0, c.x, c.y, Math.max(c.rx, c.ry));
    ng.addColorStop(0, 'rgba(' + nuc + ',' + na * 0.7 + ')');
    ng.addColorStop(1, 'rgba(' + nuc + ',' + na + ')');
    g.fillStyle = ng; outline(g, c, 0); g.fill();
    g.shadowBlur = 0;
    if (c.t) {                                               // nucleolus
      g.fillStyle = 'rgba(255,235,255,' + (0.35 + c.d * 0.3) + ')';
      g.beginPath(); g.arc(c.x + c.rx * 0.18, c.y - c.ry * 0.1, Math.max(0.8, c.rx * 0.2), 0, TAU); g.fill();
    }
    // Specular glint on the upper-left of the cell body.
    var hx = c.x - body.rx * 0.42, hy = c.y - body.ry * 0.48;
    var sp = g.createRadialGradient(hx, hy, 0, hx, hy, R * 0.45);
    sp.addColorStop(0, 'rgba(255,255,255,' + (c.t ? 0.45 : 0.25) + ')'); sp.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = sp; g.beginPath(); g.ellipse(hx, hy, R * 0.45, R * 0.28, -0.6, 0, TAU); g.fill();
    g.restore();
  }

  function build() {
    var r = canvas.getBoundingClientRect();
    W = Math.round(r.width); H = Math.round(r.height);
    if (W < 10 || H < 10) return false;
    dpr = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = W * dpr; canvas.height = H * dpr;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    var m = MARKERS[mi], s = MAG_SCALE[magIdx];
    var tumorField = noise2(), lumenField = noise2(), clump = noise2(), fibre = noise2();
    // Tumour nests where the field is high; small round lumens punched inside them.
    var isTumor = function (x, y) { return tumorField(x / s, y / s) > -0.05; };
    var isLumen = function (x, y) { return lumenField(x * 2.4 / s, y * 2.4 / s) > 0.62; };

    // Blue-noise placement (dart throwing on a hash grid): dense in tumour, sparse in stroma.
    var minT = 17 * s, minS = 26 * s, cs = minT, grid = {}, pts = [];
    var key = function (x, y) { return Math.floor(x / cs) + ',' + Math.floor(y / cs); };
    for (var tries = 0, want = W * H / (minT * minT) * 1.6; tries < want; tries++) {
      var px = Math.random() * W, py = Math.random() * H, tum = isTumor(px, py);
      if (tum && isLumen(px, py)) continue;
      var md = tum ? minT : minS, ok = true, gx = Math.floor(px / cs), gy = Math.floor(py / cs), R = Math.ceil(md / cs);
      for (var i = -R; i <= R && ok; i++) for (var j = -R; j <= R && ok; j++) {
        var b = grid[(gx + i) + ',' + (gy + j)];
        if (b) for (var k = 0; k < b.length; k++) { var dx = b[k].x - px, dy = b[k].y - py; if (dx * dx + dy * dy < md * md) { ok = false; break; } }
      }
      if (!ok) continue;
      var pt = { x: px, y: py, t: tum }; pts.push(pt); (grid[key(px, py)] = grid[key(px, py)] || []).push(pt);
    }

    // Positivity: tumour nuclei only, spatially clumped, tuned to the marker's target share.
    var tum = pts.filter(function (p) { return p.t; });
    var sc = function (p) { return clump(p.x / s, p.y / s) * m.blob + (Math.random() * 2 - 1) * (1 - m.blob); };
    tum.forEach(function (p) { p.sc = sc(p); });
    var sorted = tum.map(function (p) { return p.sc; }).sort(function (a, b) { return a - b; });
    var thr = sorted.length ? sorted[Math.floor((1 - m.target) * sorted.length)] : 0;

    cells = pts.map(function (p) {
      var r = (p.t ? 4.6 : 3.4) * s * (0.85 + Math.random() * 0.35);
      var elong = p.t ? 0.72 + Math.random() * 0.25 : 0.32 + Math.random() * 0.18;   // stroma = spindle nuclei
      var ang = p.t ? Math.random() * Math.PI : fibre(p.x / s, p.y / s) * 1.6;
      var poly = [];                                        // irregular nuclear outline
      for (var v = 0; v < 11; v++) poly.push(1 + (Math.random() - 0.5) * 0.22);
      return { x: p.x, y: p.y, rx: r, ry: r * elong, a: ang, poly: poly, t: p.t,
               p: p.t && p.sc > thr, d: 0.45 + Math.random() * 0.55 };
    });
    cells.sort(function (a, b) { return a.x - b.x; });

    var t = layer(), g = t[1]; tissue = t[0];
    paintTissue(g, isTumor, fibre, s);
    cells.forEach(function (c) { paintNucleus(g, c, s); });
    var o = layer(); overlay = o[0]; octx = o[1];
    scanned = 0; pos = 0;
    return true;
  }

  function setText(el, v) { if (el && el.textContent !== v) el.textContent = v; }

  function readout(frac, final) {
    var pct = scanned ? Math.round(pos / scanned * 100) : 0;
    setText(ui.marker, MARKERS[mi].name);
    setText(ui.pct, scanned < 25 ? '0' : String(pct));   // avoid noisy early percentages
    setText(ui.cells, scanned.toLocaleString());
    if (ui.bar) ui.bar.style.transform = 'scaleX(' + (pct / 100) + ')';
    setText(ui.pattern, final ? MARKERS[mi].label : 'Scanning… ' + Math.round(frac * 100) + '%');
    if (ui.ctrl) {
      setText(ui.ctrl, final ? 'In range ✓' : 'Checking…');
      ui.ctrl.className = final ? 'ctrl-ok' : 'ctrl-wait';
    }
  }

  // Classified rings are drawn once onto the overlay layer as the line passes.
  function classifyUpTo(sx) {
    while (scanned < cells.length && cells[scanned].x <= sx) {
      var c = cells[scanned++]; if (c.p) pos++;
      octx.strokeStyle = c.p ? 'rgba(255,190,240,0.9)' : 'rgba(140,230,255,0.55)';
      octx.lineWidth = 1;
      var ob = { x: c.x, y: c.y, rx: c.rx * (c.t ? 2.05 : 1.55) + 1.2, ry: c.ry * (c.t ? 2.15 : 1.9) + 1.2, a: c.a, poly: c.poly };
      outline(octx, ob, 0); octx.stroke();                  // segmentation contour on the membrane
    }
  }

  function draw(sx, showLine) {
    ctx.clearRect(0, 0, W, H);
    ctx.drawImage(tissue, 0, 0, W, H);
    ctx.drawImage(overlay, 0, 0, W, H);
    if (!showLine) return;
    var g = ctx.createLinearGradient(sx - 90, 0, sx, 0);
    g.addColorStop(0, 'rgba(160,110,255,0)'); g.addColorStop(0.7, 'rgba(160,110,255,0.16)'); g.addColorStop(1, 'rgba(120,230,255,0.32)');
    ctx.fillStyle = g; ctx.fillRect(sx - 90, 0, 90, H);
    ctx.fillStyle = 'rgba(190,240,255,0.95)'; ctx.fillRect(sx - 1, 0, 2, H);
    ctx.fillStyle = 'rgba(255,120,220,0.5)'; ctx.fillRect(sx + 2, 0, 1, H);   // chromatic fringe
  }

  function frame(now) {
    if (!running) return;
    if (!passStart) passStart = now;
    var el = now - passStart;
    if (el < PASS_MS) {
      var f = el / PASS_MS, e = f < 0.5 ? 2 * f * f : 1 - Math.pow(-2 * f + 2, 2) / 2;
      var sx = e * (W + 4);
      classifyUpTo(sx); draw(sx, true); readout(f, false);
    } else if (el < PASS_MS + HOLD_MS) {
      classifyUpTo(W + 10); draw(0, false); readout(1, true);
    } else {
      mi = (mi + 1) % MARKERS.length; build(); passStart = now;
    }
    requestAnimationFrame(frame);
  }

  function start() { if (running || !visible || document.hidden) return; running = true; requestAnimationFrame(frame); }
  function stop() { running = false; }
  function rebuild() { build(); passStart = 0; if (REDUCED) { classifyUpTo(W + 10); draw(0, false); readout(1, true); } }

  if (!build()) return;
  setText(ui.mag, MAG_LABELS[magIdx]);
  window.addEventListener('pci:zoom', function (e) { magIdx = e.detail; setText(ui.mag, MAG_LABELS[magIdx]); rebuild(); });
  var rt;
  window.addEventListener('resize', function () { clearTimeout(rt); rt = setTimeout(rebuild, 150); }, { passive: true });
  if (REDUCED) { rebuild(); return; }

  document.addEventListener('visibilitychange', function () { if (document.hidden) stop(); else start(); });
  if ('IntersectionObserver' in window) {
    new IntersectionObserver(function (en) { visible = en[0].isIntersecting; if (visible) start(); else stop(); }).observe(canvas);
  } else start();
})();
