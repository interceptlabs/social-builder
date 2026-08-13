/* Browser plate renderer — the static-app replacement for the server's /api/expand plate capture.
 *
 * The shipped pipeline rendered each template's templates/<t>/plates.html with Puppeteer and
 * screenshotted one full-frame transparent PNG per [data-plate] element (isolated via ?only=). The
 * composer then stacks those PNGs with per-layer alpha/motion. This module does the SAME job with
 * ZERO server: it loads the UNMODIFIED plates.html in a hidden, full-size iframe (so the real CSS +
 * the file's own overflow-fit pass run exactly as they do server-side), waits for fonts + fit, then
 * transcribes each laid-out element onto its own full-frame transparent <canvas>.
 *
 * Why transcribe instead of html2canvas / SVG-foreignObject: the composed frame is exported through
 * WebCodecs (VideoEncoder reads canvas pixels). An SVG <img> that references <foreignObject> taints
 * the canvas (origin-clean=false) and makes VideoEncoder throw. Our plate content has NO foreignObject
 * (verified), and everything we draw here is fillText / a plain-SVG lockup bitmap / an <img> photo —
 * all origin-clean — so every plate canvas stays exportable.
 *
 * Output: { name -> HTMLCanvasElement } keyed by layer.name, each canvas === spec.size. Drop-in for
 * the `images` map drawFrame(ctx, C, images, t) consumes (ctx.drawImage accepts a canvas source).
 *
 * UMD-ish: sets globalThis.PLATE_RENDERER.
 */
(function (root) {
  'use strict';

  // ---- iframe lifecycle -----------------------------------------------------------------------

  // Build the plates.html query the shipped in-file injector understands (identical contract to the
  // server orchestrator: ?ratio / ?ground / ?theme / ?lockupInk / ?content=<encoded JSON>). We never
  // set ?only= — we want EVERY [data-plate] visible so we can transcribe each to its own canvas.
  function platesUrl(templateName, spec) {
    var slots = spec.slots || {};
    var params = new URLSearchParams();
    var ratio = spec.ratio || '1x1';
    if (ratio && ratio !== '1x1') params.set('ratio', ratio);
    if (spec.bg) params.set('ground', spec.bg);                 // 'halo' | 'carbon'
    if (spec.theme) params.set('theme', spec.theme);            // 'dark'
    if (slots.lockupInk) params.set('lockupInk', slots.lockupInk);
    // Content JSON — carries quote/name/role/etc + optional colors/sizeScales, like the server's
    // --content. A DATA-URL photo is STRIPPED here: a base64 image makes this query megabytes long and
    // the plate fetch dies with "Failed to fetch". The renderer draws the real photo into the plate's
    // photo box directly (see renderPlates -> drawPhoto override). A short photo PATH stays in.
    var contentSlots = slots;
    if (typeof slots.photo === 'string' && slots.photo.slice(0, 5) === 'data:') {
      contentSlots = Object.assign({}, slots); delete contentSlots.photo;
    }
    // Pre-encode the JSON before handing it to URLSearchParams — the shared plates.html injector reads
    // `?content=` and runs `decodeURIComponent(URLSearchParams.get('content'))`, i.e. it expects the
    // value to survive ONE URL-decode still encoded (matching the server orchestrator's
    // `content=${encodeURIComponent(JSON.stringify(...))}`). Setting the raw JSON here would decode
    // fully on the injector's read, and its extra decodeURIComponent would then throw `URI malformed`
    // on any literal '%' in the content (e.g. Stat's "87%" metric) — the injector swallows that, bails
    // before wiring runFit/__slotFitReport, and the plate transcribes blank. Encoding here keeps the
    // decode symmetric for all content (and plates.html stays byte-identical to the server copy).
    params.set('content', encodeURIComponent(JSON.stringify(contentSlots)));
    return 'templates/' + templateName + '/plates.html?' + params.toString();
  }

  // Load plates.html into a hidden iframe via fetch()+srcdoc (NOT iframe.src). Hosts commonly send
  // `X-Frame-Options: DENY` on every response (the Intercept Cloudflare host does), which blocks even
  // a same-origin iframe LOADED OVER HTTP — contentDocument comes back null. srcdoc documents are
  // inline, not HTTP-framed, so that header never applies. Two adjustments srcdoc requires:
  //   1. relative asset paths (fonts `../../assets/fonts`, the photo `assets/...`) have no natural base
  //      under about:srcdoc, so we inject `<base href="…/templates/<t>/">`.
  //   2. about:srcdoc has no location.search, and the file's injector scripts read the content/ratio/
  //      ground/theme from it — so we substitute every `location.search` with the real query literal.
  // Resolves once fonts are ready AND the file's overflow-fit pass has run (window.__slotFitReport).
  function openFrame(templateName, spec) {
    var W = spec.size.w, H = spec.size.h;
    var relUrl = platesUrl(templateName, spec);
    var absUrl = new URL(relUrl, document.baseURI).href;
    var queryStr = absUrl.indexOf('?') >= 0 ? absUrl.slice(absUrl.indexOf('?') + 1) : '';
    var baseHref = new URL('templates/' + templateName + '/', document.baseURI).href;

    return fetch(absUrl).then(function (r) {
      if (!r.ok) throw new Error('plates.html ' + r.status + ' for ' + templateName);
      return r.text();
    }).then(function (html) {
      html = injectBase(html, baseHref);
      // Replace location.search reads with the real query (JSON.stringify escapes it safely).
      html = html.split('location.search').join(JSON.stringify('?' + queryStr));
      // NOTE: a data-URL photo is stripped from the query (platesUrl) to keep the fetch small; the
      // renderer draws it directly into the plate's photo box (renderPlates passes it to drawPhoto),
      // using the placeholder <img>'s geometry.

      return new Promise(function (resolve, reject) {
        var iframe = document.createElement('iframe');
        iframe.setAttribute('aria-hidden', 'true');
        // Off-screen but fully laid out (NOT display:none — that would zero every getBoundingClientRect).
        iframe.style.cssText =
          'position:fixed;left:-100000px;top:0;border:0;margin:0;padding:0;' +
          'width:' + W + 'px;height:' + H + 'px;background:transparent;';
        iframe.setAttribute('width', String(W));
        iframe.setAttribute('height', String(H));

        var settled = false;
        function fail(err) { if (!settled) { settled = true; if (iframe.parentNode) iframe.parentNode.removeChild(iframe); reject(err); } }

        // Do NOT hang this off iframe.onload. Appending an iframe fires `load` for its initial
        // about:blank document BEFORE srcdoc is parsed; that document has no [data-plate] elements, so
        // transcribing it yields an all-transparent plate set — every layer blank, no error thrown.
        // The very first render tended to win the race and look fine, which is why this presented as
        // "it works on load, then everything vanishes the moment you touch a control".
        // Poll for the real srcdoc document instead.
        document.body.appendChild(iframe);
        iframe.srcdoc = html;

        whenPlateDoc(iframe).then(function (fr) {
          var win = fr.win, doc = fr.doc;
          var fontsReady = (doc.fonts && doc.fonts.ready) ? doc.fonts.ready : Promise.resolve();
          return fontsReady.then(function () {
            return settleFit(win);
          }).then(function () {
            return whenImagesReady(doc);
          }).then(function () {
            if (!settled) { settled = true; resolve({ iframe: iframe, win: win, doc: doc }); }
          });
        }).catch(fail);
        // Safety timeout — never hang the UI on a broken template. Generous so a throttled background
        // tab (timers clamped to ~1s) still completes rather than false-timing-out.
        setTimeout(function () { fail(new Error('plate render timed out for ' + templateName)); }, 20000);
      });
    });
  }

  // Resolve once the iframe holds the PARSED srcdoc document — identified by it actually containing
  // plate elements, which the placeholder about:blank document never does.
  function whenPlateDoc(iframe) {
    return new Promise(function (resolve, reject) {
      var tries = 0;
      (function poll() {
        var doc = iframe.contentDocument, win = iframe.contentWindow;
        if (doc && win && doc.querySelector('[data-plate]')) { resolve({ win: win, doc: doc }); return; }
        if (++tries > 400) { reject(new Error('plate document never parsed')); return; }   // 10s
        setTimeout(poll, 25);
      })();
    });
  }

  // Insert a <base> as the first child of <head> so the file's relative font/photo URLs resolve.
  function injectBase(html, href) {
    var tag = '<base href="' + href + '">';
    if (/<head[^>]*>/i.test(html)) return html.replace(/<head[^>]*>/i, function (m) { return m + tag; });
    return tag + html;
  }

  // The in-file fit pass sets window.__slotFitReport on document.fonts.ready. Resolve as soon as it
  // appears; a short setTimeout grace covers templates that carry no fit pass (they never set it).
  function settleFit(win) {
    return new Promise(function (resolve) {
      var tries = 0;
      (function poll() {
        if (win.__slotFitReport || tries >= 8) { resolve(); return; }
        tries++;
        setTimeout(poll, 40);
      })();
    });
  }

  // Wait for every <img> in the plate to finish loading (photo, lockup fallbacks) before rasterizing —
  // on a cold network load they aren't decoded yet, so measuring/drawing early yields blank images.
  function whenImagesReady(doc) {
    var imgs = Array.prototype.slice.call(doc.querySelectorAll('img'));
    var pending = imgs.filter(function (im) { return !(im.complete && im.naturalWidth); });
    if (!pending.length) return Promise.resolve();
    return Promise.all(pending.map(function (im) {
      return new Promise(function (res) {
        im.addEventListener('load', res, { once: true });
        im.addEventListener('error', res, { once: true });
        setTimeout(res, 4000);
      });
    }));
  }

  // ---- text transcription ---------------------------------------------------------------------

  // Split a text node into per-visual-line segments by scanning character offsets and grouping runs
  // whose client-rect top is (near) equal — this is how a browser-wrapped run becomes canvas lines
  // WITHOUT us reimplementing line-breaking. Returns [{ text, rect }] with rect === the line box.
  function lineSegments(win, node) {
    var text = node.nodeValue || '';
    if (!text.length) return [];
    var doc = node.ownerDocument;
    var segs = [];
    var start = 0, curTop = null, curRect = null;
    function flush(end) {
      if (end <= start) return;
      segs.push({ text: text.slice(start, end), rect: curRect });
    }
    for (var i = 0; i < text.length; i++) {
      var r = doc.createRange();
      r.setStart(node, i);
      r.setEnd(node, i + 1);
      var rects = r.getClientRects();
      if (!rects.length) continue;
      var rc = rects[rects.length - 1];
      if (curTop === null) { curTop = rc.top; curRect = cloneRect(rc); start = i; }
      else if (Math.abs(rc.top - curTop) > 1.5) {          // new line box
        flush(i);
        curTop = rc.top; curRect = cloneRect(rc); start = i;
      } else {
        curRect = unionRect(curRect, rc);
      }
    }
    flush(text.length);
    // Trim leading whitespace produced by wrapping (a wrapped line never renders its leading space).
    return segs.map(function (s) {
      var t = s.text.replace(/\s+$/,'');
      return { text: t, rect: s.rect };
    }).filter(function (s) { return s.text.length; });
  }

  function cloneRect(r) { return { left: r.left, top: r.top, right: r.right, bottom: r.bottom, width: r.width, height: r.height }; }
  function unionRect(a, b) {
    var left = Math.min(a.left, b.left), top = Math.min(a.top, b.top);
    var right = Math.max(a.right, b.right), bottom = Math.max(a.bottom, b.bottom);
    return { left: left, top: top, right: right, bottom: bottom, width: right - left, height: bottom - top };
  }

  // Compose a canvas font shorthand from a computed style.
  function fontOf(cs) {
    var style = cs.fontStyle && cs.fontStyle !== 'normal' ? cs.fontStyle + ' ' : '';
    var weight = cs.fontWeight && cs.fontWeight !== 'normal' ? cs.fontWeight + ' ' : '';
    return style + weight + cs.fontSize + ' ' + cs.fontFamily;
  }

  // Draw one element's TEXT (all descendant text nodes, honoring each node's own inherited color for
  // per-line / per-word color overrides). Baseline is derived from REAL font metrics so glyphs land
  // exactly on the CSS baseline regardless of font or line-height leading.
  function drawTextElement(ctx, win, el) {
    var doc = el.ownerDocument;
    var walker = doc.createTreeWalker(el, win.NodeFilter.SHOW_TEXT, null);
    var node;
    while ((node = walker.nextNode())) {
      if (!node.nodeValue || !node.nodeValue.trim()) continue;
      var parent = node.parentElement || el;
      var cs = win.getComputedStyle(parent);
      if (cs.visibility === 'hidden' || cs.display === 'none') continue;
      ctx.font = fontOf(cs);
      ctx.fillStyle = cs.color;
      try { ctx.letterSpacing = (cs.letterSpacing && cs.letterSpacing !== 'normal') ? cs.letterSpacing : '0px'; } catch (e) {}
      ctx.textAlign = 'left';
      ctx.textBaseline = 'alphabetic';
      var segs = lineSegments(win, node);
      for (var k = 0; k < segs.length; k++) {
        var seg = segs[k], rect = seg.rect;
        var m = ctx.measureText(seg.text);
        var natAsc = m.fontBoundingBoxAscent, natDesc = m.fontBoundingBoxDescent;
        // CSS centers the font's natural (ascent+descent) box within the line box (rect.height); the
        // leftover is leading, split top/bottom. Baseline = lineTop + leading/2 + ascent.
        var baseline;
        if (isFinite(natAsc) && isFinite(natDesc)) {
          var leading = rect.height - (natAsc + natDesc);
          baseline = rect.top + leading / 2 + natAsc;
        } else {
          baseline = rect.bottom - rect.height * 0.18;         // fallback if metrics unavailable
        }
        ctx.fillText(seg.text, rect.left, baseline);
      }
    }
    try { ctx.letterSpacing = '0px'; } catch (e) {}
  }

  // ---- lockup (plain-SVG bitmap, crisp, origin-clean) -----------------------------------------

  var _lockupCache = {};
  function svgToImage(svg) {
    return new Promise(function (resolve, reject) {
      var url = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg);
      var img = new Image();
      img.onload = function () { resolve(img); };
      img.onerror = function () { reject(new Error('lockup svg decode failed')); };
      img.src = url;
    });
  }

  // Rebuild the referenced <symbol> as a standalone plain SVG with currentColor set to the element's
  // computed color (the exact CSS color-swap the plates use), rasterize at 2x for AA, draw into rect.
  function drawLockup(ctx, win, el, doc) {
    var use = el.querySelector('use');
    if (!use) { drawTextElement(ctx, win, el); return Promise.resolve(); }
    var href = use.getAttribute('href') || use.getAttribute('xlink:href') || '';
    var symbol = href ? doc.querySelector(href) : null;
    if (!symbol) return Promise.resolve();
    var viewBox = symbol.getAttribute('viewBox') || '0 0 324 76';
    var color = win.getComputedStyle(el).color || '#0a0a0f';
    var rect = el.getBoundingClientRect();
    var svg = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="' + viewBox + '" ' +
      'width="' + Math.max(1, Math.round(rect.width * 2)) + '" height="' + Math.max(1, Math.round(rect.height * 2)) + '" ' +
      'style="color:' + color + '">' + symbol.innerHTML + '</svg>';
    var key = href + '|' + color + '|' + Math.round(rect.width) + 'x' + Math.round(rect.height);
    var p = _lockupCache[key] || (_lockupCache[key] = svgToImage(svg));
    return p.then(function (img) {
      ctx.drawImage(img, rect.left, rect.top, rect.width, rect.height);
    }).catch(function () { /* leave lockup blank rather than crash the whole render */ });
  }

  // ---- photo (new-hire / carousel) ------------------------------------------------------------

  // A photo plate is either an <img data-plate="photo"> (new-hire / carousel hero) OR a div whose
  // background-image is the (already matted) portrait. Both are same-origin -> origin-clean. We honor
  // object-fit (cover/contain) and any border-radius clip. An <img> already decoded in the iframe is
  // drawn directly (no re-fetch); a background-image URL is loaded fresh.
  function drawPhoto(ctx, win, el, overrideSrc) {
    var cs = win.getComputedStyle(el);
    var radius = parseFloat(cs.borderTopLeftRadius) || 0;
    var fit = cs.objectFit || 'cover';

    // Draw a FRESH image (whose load we control) into the plate. The rect is read at draw time —
    // critical because the photo box is often `width:auto; height:<fixed>` (e.g. new-hire .hero), so
    // its width is 0 until its own <img> has loaded. We first wait for the iframe's <img> to be ready
    // (correct geometry), then load a fresh copy of the same src and paint on ITS load — decoupling the
    // draw from the iframe element's flaky complete/naturalWidth timing.
    function paintSrc(src) {
      if (!src) return Promise.resolve();
      return new Promise(function (resolve) {
        var img = new Image();
        img.onload = function () {
          var rect = photoRect(img);
          if (img.naturalWidth && rect && rect.width >= 1 && rect.height >= 1) {
            ctx.save();
            roundedClip(ctx, rect, radius);
            if (fit === 'contain') containDraw(ctx, img, rect, img.naturalWidth, img.naturalHeight);
            else coverDraw(ctx, img, rect, img.naturalWidth, img.naturalHeight);
            ctx.restore();
          }
          resolve();
        };
        img.onerror = function () { resolve(); };
        img.src = src;
      });
    }

    // The photo box's live rect, or a fallback computed from the CSS box + the drawn image's aspect
    // when getBoundingClientRect reads 0 (absolute-positioned width:auto boxes do until their own <img>
    // loads — which is flaky in a srcdoc doc). Handles left/right/top/bottom anchoring.
    function photoRect(img) {
      var r = el.getBoundingClientRect();
      if (r.width >= 1 && r.height >= 1) return r;
      var doc = el.ownerDocument, root = doc.documentElement;
      var W = root.clientWidth || win.innerWidth, H = root.clientHeight || win.innerHeight;
      var h = parseFloat(cs.height) || 0, w = parseFloat(cs.width);
      if (!(w >= 1) && img.naturalHeight) w = h * (img.naturalWidth / img.naturalHeight);
      var cl = parseFloat(cs.left), cr = parseFloat(cs.right), ct = parseFloat(cs.top), cb = parseFloat(cs.bottom);
      var left = isFinite(cl) ? cl : (isFinite(cr) ? (W - cr - w) : 0);
      var top = isFinite(ct) ? ct : (isFinite(cb) ? (H - cb - h) : 0);
      return { left: left, top: top, width: w, height: h };
    }

    function elReady() {
      if (el.tagName !== 'IMG') return Promise.resolve();
      if (el.complete && el.naturalWidth) return Promise.resolve();
      return new Promise(function (res) {
        el.addEventListener('load', res, { once: true });
        el.addEventListener('error', res, { once: true });
        setTimeout(res, 5000);
      });
    }

    if (el.tagName === 'IMG') {
      // Wait for the placeholder <img> to load (correct width:auto geometry), then paint the real photo
      // — the uploaded data URL when provided, else the element's own src.
      return elReady().then(function () { return paintSrc(overrideSrc || el.currentSrc || el.src); });
    }
    var m = (cs.backgroundImage || '').match(/url\(["']?(.*?)["']?\)/);
    return m ? paintSrc(overrideSrc || m[1]) : Promise.resolve();
  }

  function roundedClip(ctx, rect, r) {
    if (!r) { ctx.beginPath(); ctx.rect(rect.left, rect.top, rect.width, rect.height); ctx.clip(); return; }
    r = Math.min(r, rect.width / 2, rect.height / 2);
    var x = rect.left, y = rect.top, w = rect.width, h = rect.height;
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
    ctx.clip();
  }

  function coverDraw(ctx, media, rect, mw, mh) {
    var ir = mw / mh, br = rect.width / rect.height, dw, dh, dx, dy;
    if (ir > br) { dh = rect.height; dw = dh * ir; dx = rect.left - (dw - rect.width) / 2; dy = rect.top; }
    else { dw = rect.width; dh = dw / ir; dx = rect.left; dy = rect.top - (dh - rect.height) / 2; }
    ctx.drawImage(media, dx, dy, dw, dh);
  }

  function containDraw(ctx, media, rect, mw, mh) {
    var ir = mw / mh, br = rect.width / rect.height, dw, dh, dx, dy;
    if (ir > br) { dw = rect.width; dh = dw / ir; dx = rect.left; dy = rect.top + (rect.height - dh) / 2; }
    else { dh = rect.height; dw = dh * ir; dx = rect.left + (rect.width - dw) / 2; dy = rect.top; }
    ctx.drawImage(media, dx, dy, dw, dh);
  }

  // ---- top-level: render every layer's plate ---------------------------------------------------

  function newPlateCanvas(W, H) {
    var c = document.createElement('canvas');
    c.width = W; c.height = H;
    return c;
  }

  function classifies(el) {
    if (el.querySelector('use') || el.querySelector('svg use')) return 'lockup';
    if (el.tagName === 'IMG' || el.querySelector('img')) return 'photo';
    var cs = el.ownerDocument.defaultView.getComputedStyle(el);
    if (cs.backgroundImage && cs.backgroundImage !== 'none') return 'photo';
    return 'text';
  }

  // Force-load the plate fonts into the MAIN document before rasterizing — drawTextElement draws onto
  // a main-doc canvas with ctx.font='… Instrument Sans'/'… Inter'/'… Geist Mono', and @font-face fonts
  // load lazily, so on a cold network load the first renders would otherwise fall back and some text
  // would vanish. Cached after the first call.
  var _fontsP = null;
  function ensureFonts() {
    if (_fontsP) return _fontsP;
    if (!document.fonts || !document.fonts.load) return (_fontsP = Promise.resolve());
    var specs = [];
    ['Instrument Sans', 'Inter', 'Geist Mono'].forEach(function (fam) {
      ['400', '500', '600', '700'].forEach(function (w) { specs.push(w + ' 40px "' + fam + '"'); });
    });
    _fontsP = Promise.all(specs.map(function (s) { try { return document.fonts.load(s).catch(function () {}); } catch (e) { return Promise.resolve(); } }))
      .then(function () { return document.fonts.ready; }).catch(function () {});
    return _fontsP;
  }

  // Public: renderPlates(templateName, spec, scale) -> Promise<{ name -> canvas }>
  //
  // `scale` (2026-08-13, PDF-CAROUSEL, additive) — OPTIONAL, default 1. Every plate canvas is
  // allocated at W*scale x H*scale device pixels and its context pre-scaled by `scale`, so every
  // existing draw call (drawTextElement/drawLockup/drawPhoto) — which all read LOGICAL (1x) rects
  // off the iframe via getBoundingClientRect — rasterizes at `scale`x pixel density with ZERO changes
  // to those functions or to the iframe's own layout (still opened at spec.size, unscaled: the iframe
  // is the CSS layout, not the capture resolution). This is the standard retina-canvas technique
  // (canvas.width = cssWidth*dpr; ctx.scale(dpr,dpr)), applied here so a caller (core/pdf-export.js)
  // can supersample a frame for a crisp downsample without touching plates.html or any style module.
  // scale=1 (the default, every existing call site) is BYTE-IDENTICAL to the pre-existing behaviour:
  // ctx.scale(1,1) is a no-op and Math.round(W*1)===W.
  function renderPlates(templateName, spec, scale) {
    scale = (typeof scale === 'number' && scale > 0) ? scale : 1;
    var W = spec.size.w, H = spec.size.h;
    var names = (spec.layers || []).map(function (l) { return l.name; });
    return ensureFonts().then(function () { return openFrame(templateName, spec); }).then(function (frame) {
      var doc = frame.doc, win = frame.win;
      var jobs = [];
      var images = {};
      names.forEach(function (name) {
        var el = doc.querySelector('[data-plate="' + cssEscape(name) + '"]');
        var canvas = newPlateCanvas(Math.round(W * scale), Math.round(H * scale));
        images[name] = canvas;
        if (!el) return;                                       // missing element -> transparent plate
        var ctx = canvas.getContext('2d');
        if (scale !== 1) ctx.scale(scale, scale);
        var kind = classifies(el);
        if (kind === 'lockup') jobs.push(drawLockup(ctx, win, el, doc));
        else if (kind === 'photo') {
          var ps = (spec.slots || {}).photo;
          var ov = (typeof ps === 'string' && ps.slice(0, 5) === 'data:') ? ps : null;
          jobs.push(drawPhoto(ctx, win, el, ov));
        } else { drawTextElement(ctx, win, el); }
      });
      return Promise.all(jobs).then(function () {
        if (frame.iframe && frame.iframe.parentNode) frame.iframe.parentNode.removeChild(frame.iframe);
        return images;
      });
    });
  }

  function cssEscape(s) { return String(s).replace(/"/g, '\\"'); }

  root.PLATE_RENDERER = { renderPlates: renderPlates, platesUrl: platesUrl };
})(typeof self !== 'undefined' ? self : this);
