// Liquid Glass: edge-lens refraction for elements marked [data-glass].
// Builds a per-element displacement map from a rounded-rect SDF (convex bezel
// that magnifies toward the rim, like a real lens), splits R/G/B at slightly
// different strengths for chromatic fringing, and applies it as a CSS
// backdrop-filter via an SVG filter. Chromium only; other engines keep the
// CSS frosted fallback.
(function () {
  var ua = navigator.userAgentData;
  var chromium = ua ? ua.brands.some(function (b) { return /Chromium/.test(b.brand); })
                    : /Chrome\//.test(navigator.userAgent);
  if (!chromium) return;
  if (window.matchMedia('(prefers-reduced-transparency: reduce)').matches) return;

  var NS = 'http://www.w3.org/2000/svg';
  var host = document.createElementNS(NS, 'svg');
  host.setAttribute('width', '0'); host.setAttribute('height', '0');
  host.setAttribute('aria-hidden', 'true');
  host.style.cssText = 'position:absolute;width:0;height:0;overflow:hidden';
  document.body.appendChild(host);

  var uid = 0;

  function radiusOf(el, w, h) {
    var r = parseFloat(getComputedStyle(el).borderTopLeftRadius) || 0;
    return Math.min(r, w / 2, h / 2);
  }

  // Signed distance to a rounded rectangle centred at the origin.
  function sdf(px, py, hw, hh, r) {
    var qx = Math.abs(px) - (hw - r), qy = Math.abs(py) - (hh - r);
    var ox = Math.max(qx, 0), oy = Math.max(qy, 0);
    return Math.sqrt(ox * ox + oy * oy) + Math.min(Math.max(qx, qy), 0) - r;
  }

  var mapCache = {};
  function buildMap(w, h, r, bezel) {
    var ck = w + ',' + h + ',' + r + ',' + bezel;
    if (mapCache[ck]) return mapCache[ck];
    var c = document.createElement('canvas');
    c.width = w; c.height = h;
    var ctx = c.getContext('2d');
    var img = ctx.createImageData(w, h);
    var d = img.data, hw = w / 2, hh = h / 2, e = 0.75;
    for (var y = 0; y < h; y++) {
      for (var x = 0; x < w; x++) {
        var i0 = (y * w + x) * 4;
        // Interior beyond the bezel never displaces: skip the SDF work.
        if (x > bezel && x < w - bezel && y > bezel && y < h - bezel) {
          d[i0] = 128; d[i0 + 1] = 128; d[i0 + 2] = 128; d[i0 + 3] = 255; continue;
        }
        var px = x + 0.5 - hw, py = y + 0.5 - hh;
        var dist = sdf(px, py, hw, hh, r);
        var inside = -dist, vx = 0, vy = 0;
        if (inside >= 0 && inside < bezel) {
          // Outward normal from the SDF gradient.
          var nx = sdf(px + e, py, hw, hh, r) - sdf(px - e, py, hw, hh, r);
          var ny = sdf(px, py + e, hw, hh, r) - sdf(px, py - e, hw, hh, r);
          var len = Math.sqrt(nx * nx + ny * ny) || 1;
          var t = 1 - inside / bezel;                 // 1 at the rim, 0 at bezel depth
          var mag = Math.pow(t, 2.2);                 // convex profile: strongest at the rim
          vx = -nx / len * mag; vy = -ny / len * mag; // sample inward => magnify
        }
        var i = (y * w + x) * 4;
        d[i] = 128 + vx * 127; d[i + 1] = 128 + vy * 127; d[i + 2] = 128; d[i + 3] = 255;
      }
    }
    ctx.putImageData(img, 0, 0);
    return (mapCache[ck] = c.toDataURL());
  }

  function channel(id, src, scale, keep) {
    var m = { r: '1 0 0 0 0  0 0 0 0 0  0 0 0 0 0  0 0 0 1 0',
              g: '0 0 0 0 0  0 1 0 0 0  0 0 0 0 0  0 0 0 1 0',
              b: '0 0 0 0 0  0 0 0 0 0  0 0 1 0 0  0 0 0 1 0' }[keep];
    return '<feDisplacementMap in="' + src + '" in2="map" scale="' + scale.toFixed(1) +
           '" xChannelSelector="R" yChannelSelector="G" result="d' + keep + '"/>' +
           '<feColorMatrix in="d' + keep + '" type="matrix" values="' + m + '" result="c' + keep + '"/>';
  }

  function apply(el) {
    var rect = el.getBoundingClientRect();
    var w = Math.round(rect.width), h = Math.round(rect.height);
    if (w < 8 || h < 8) return;
    var key = w + 'x' + h;
    if (el.__lgKey === key) return;
    el.__lgKey = key;

    var r = radiusOf(el, w, h);
    var bezel = Math.max(8, Math.min(parseFloat(el.dataset.glassBezel) || Math.min(w, h) * 0.32, 40));
    var scale = parseFloat(el.dataset.glassScale) || 34;
    var blur = parseFloat(el.dataset.glassBlur) || 1.2;
    var sat = parseFloat(el.dataset.glassSaturate) || 1.7;
    var bright = parseFloat(el.dataset.glassBrightness) || 1;
    // Fresh id per rebuild: Chromium caches a backdrop filter by URL.
    if (el.__lgId) { var old = host.querySelector('#' + el.__lgId); if (old) old.remove(); }
    var id = el.__lgId = 'lg-' + (++uid);
    var f = document.createElementNS(NS, 'filter');
    f.setAttribute('id', id);
    f.setAttribute('x', '0'); f.setAttribute('y', '0');
    f.setAttribute('width', w); f.setAttribute('height', h);
    f.setAttribute('filterUnits', 'userSpaceOnUse');
    f.setAttribute('primitiveUnits', 'userSpaceOnUse');
    f.setAttribute('color-interpolation-filters', 'sRGB');
    f.innerHTML =
      '<feImage href="' + buildMap(w, h, r, bezel) + '" x="0" y="0" width="' + w + '" height="' + h + '" result="map" preserveAspectRatio="none"/>' +
      '<feGaussianBlur in="SourceGraphic" stdDeviation="' + blur + '" result="soft"/>' +
      '<feColorMatrix in="soft" type="saturate" values="' + sat + '" result="sat"/>' +
      '<feComponentTransfer in="sat" result="lit"><feFuncR type="linear" slope="' + bright + '"/><feFuncG type="linear" slope="' + bright + '"/><feFuncB type="linear" slope="' + bright + '"/></feComponentTransfer>' +
      channel(id, 'lit', scale, 'r') + channel(id, 'lit', scale * 1.08, 'g') + channel(id, 'lit', scale * 1.16, 'b') +
      '<feBlend in="cr" in2="cg" mode="screen" result="rg"/>' +
      '<feBlend in="rg" in2="cb" mode="screen"/>';
    host.appendChild(f);
    el.style.backdropFilter = 'url(#' + id + ')';
    el.classList.add('lg-live');
  }

  // Targets and per-type strength. Nav is dark glass (backdrop dimmed) so the
  // white wordmark stays legible over light content.
  var PRESETS = [
    ['.nav',                { scale: 52, bezel: 28, blur: 5, sat: 2.0, bright: 0.62 }],
    ['.btn-ghost',          { scale: 30, bezel: 14, blur: 1.0, sat: 1.8 }],
    ['.hero-badge',         { scale: 24, bezel: 12, blur: 0.8, sat: 1.8 }],
    ['.hero-stats, .zoom-slider-wrap', { scale: 30, bezel: 18, blur: 1.4, sat: 1.7 }],
    ['.feat-card, .product-card, .edu-card, .about-card, .workflow-step', { scale: 26, bezel: 22, blur: 2.2, sat: 1.6 }]
  ];
  PRESETS.forEach(function (p) {
    document.querySelectorAll(p[0]).forEach(function (el) {
      if (el.dataset.glass !== undefined) return;
      el.dataset.glass = '';
      el.dataset.glassScale = p[1].scale; el.dataset.glassBezel = p[1].bezel;
      el.dataset.glassBlur = p[1].blur; el.dataset.glassSaturate = p[1].sat;
      if (p[1].bright) el.dataset.glassBrightness = p[1].bright;
    });
  });
  var els = Array.prototype.slice.call(document.querySelectorAll('[data-glass]'));
  var ro = 'ResizeObserver' in window &&
    new ResizeObserver(function (entries) { entries.forEach(function (en) { apply(en.target); }); });
  function start(el) { apply(el); if (ro) ro.observe(el); }
  // First screen renders immediately; everything below builds as it nears the viewport.
  var vh = window.innerHeight, later = [];
  els.forEach(function (el) {
    var b = el.getBoundingClientRect();
    if (getComputedStyle(el).position === 'fixed' || b.top < vh) start(el); else later.push(el);
  });
  if ('IntersectionObserver' in window) {
    var io = new IntersectionObserver(function (entries) {
      entries.forEach(function (en) { if (en.isIntersecting) { io.unobserve(en.target); start(en.target); } });
    }, { rootMargin: '600px 0px' });
    later.forEach(function (el) { io.observe(el); });
  } else later.forEach(start);
})();
