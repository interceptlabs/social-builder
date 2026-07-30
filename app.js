/* Intercept Social Builder — static app controller.
 *
 * No server. Flow: pick template/format/ground/motion/background + edit content -> build a composition
 * spec via the verbatim server template module -> render each plate in-browser (PLATE_RENDERER) ->
 * animate with the verbatim composer (SOCIAL_COMPOSER) in a rAF loop -> export a real .mp4 with
 * WebCodecs (WEBCODECS_EXPORT). The preview and the export consume the SAME plate canvases, so what
 * you see is what you get.
 */
(function () {
  'use strict';

  var RATIOS = window.INTERCEPT_RATIOS.RATIOS;
  var RATIO_KEYS = window.INTERCEPT_RATIOS.RATIO_KEYS;

  var BG_MANIFEST = { loops: [], base: '#0a0a0f' };

  var State = {
    templateName: null,
    ratio: '1x1',
    ground: 'halo',
    style: 'keyline',
    preset: 'standard',
    logo: 'auto',         // lockup treatment: 'auto' (per background) | 'dark' | 'light'
    content: {},          // slot -> value (strings; 'json' fields hold parsed objects)
    colors: {},           // slot -> resolved brand hex (advanced control; absent = template default)
    sizes: {},            // slot -> font-size multiplier (advanced control; absent/1 = default)
    bgLoopId: null,       // null = procedural background
    bgOpacity: 0.32,
    bgImage: null,        // { url, fit:'cover'|'contain', ink:'light'|'dark' } | null
    photoOriginal: null,  // last uploaded photo (data URL), pre-matting
    matteOn: false,       // remove-background toggle for photo templates
    spec: null,
    images: null,
    composer: null,
    raf: 0,
    t0: 0,
    rendering: false,
    pendingRefresh: false,
  };

  function el(id) { return document.getElementById(id); }
  function setStatus(msg, cls) { var s = el('export-status'); s.textContent = msg || ''; s.className = 'status' + (cls ? ' ' + cls : ''); }

  // ---- pickers ---------------------------------------------------------------------------------

  function chip(label, active, onClick) {
    var b = document.createElement('button');
    b.className = 'chip' + (active ? ' active' : '');
    b.type = 'button';
    b.textContent = label;
    b.setAttribute('aria-pressed', active ? 'true' : 'false');
    b.addEventListener('click', onClick);
    return b;
  }

  function renderChipRow(container, items, activeVal, onPick) {
    container.innerHTML = '';
    items.forEach(function (it) {
      container.appendChild(chip(it.label, it.value === activeVal, function () { onPick(it.value); }));
    });
  }

  function buildTemplatePicker() {
    var list = window.SOCIAL_TEMPLATES.list();
    renderChipRow(el('template-picker'),
      list.map(function (t) { return { label: t.label, value: t.name }; }),
      State.templateName,
      function (name) { selectTemplate(name); });
  }

  function buildRatioPicker() {
    var labels = { '1x1': '1:1 Square', '4x5': '4:5 Portrait', '9x16': '9:16 Story', '16x9': '16:9 Wide' };
    renderChipRow(el('ratio-picker'),
      RATIO_KEYS.map(function (r) { return { label: labels[r] || r, value: r }; }),
      State.ratio,
      function (r) { State.ratio = r; refresh(); });
  }

  function buildGroundPicker() {
    renderChipRow(el('ground-picker'),
      [{ label: 'Halo (light)', value: 'halo' }, { label: 'Carbon (dark)', value: 'carbon' }],
      State.ground,
      function (g) { State.ground = g; refresh(); });
  }

  function buildLogoPicker() {
    renderChipRow(el('logo-picker'),
      [{ label: 'Auto', value: 'auto' }, { label: 'Dark logo', value: 'dark' }, { label: 'Light logo', value: 'light' }],
      State.logo,
      function (v) { State.logo = v; refresh(); });
  }

  // Resolve the lockup ink. 'auto' picks correctly per background so the mark never sinks into it:
  // dark video loop -> white; image -> follow the chosen text tone; procedural -> follow the ground.
  function resolveLogoInk() {
    if (State.logo === 'dark') return 'carbon';
    if (State.logo === 'light') return 'halo';
    if (State.bgLoopId) return 'halo';
    if (State.bgImage) return (State.bgImage.ink === 'light') ? 'halo' : 'carbon';
    return (State.ground === 'carbon') ? 'halo' : 'carbon';
  }

  function buildStylePicker() {
    renderChipRow(el('style-picker'),
      [{ label: 'Keyline', value: 'keyline' }, { label: 'Fritzoid', value: 'fritzoid' }],
      State.style,
      function (s) { State.style = s; refresh(); });
    renderChipRow(el('preset-picker'),
      [{ label: 'Subtle', value: 'subtle' }, { label: 'Standard', value: 'standard' }, { label: 'Bold', value: 'bold' }],
      State.preset,
      function (p) { State.preset = p; refresh(); });
  }

  function buildBgPicker() {
    var items = [{ label: 'None (procedural)', value: '__none__' }];
    BG_MANIFEST.loops.forEach(function (l) { items.push({ label: l.label, value: l.id }); });
    items.push({ label: 'Image…', value: '__image__' });
    var active = State.bgImage ? '__image__' : (State.bgLoopId || '__none__');
    renderChipRow(el('bg-picker'), items, active, function (v) {
      if (v === '__image__') { el('bg-image-file').click(); return; } // state changes once a file is chosen
      State.bgImage = null;
      State.bgLoopId = (v === '__none__') ? null : v;
      var loop = BG_MANIFEST.loops.filter(function (l) { return l.id === State.bgLoopId; })[0];
      if (loop && loop.defaultOpacity != null) { State.bgOpacity = loop.defaultOpacity; el('bg-opacity').value = String(loop.defaultOpacity); el('bg-opacity-val').textContent = loop.defaultOpacity.toFixed(2); }
      el('bg-opacity-wrap').classList.toggle('hidden', !State.bgLoopId);
      el('bg-image-controls').classList.add('hidden');
      refresh();
      buildBgPicker(); // reflect active state
    });
  }

  function buildImageControls() {
    renderChipRow(el('bg-image-fit'),
      [{ label: 'Cover', value: 'cover' }, { label: 'Contain', value: 'contain' }],
      State.bgImage ? State.bgImage.fit : 'cover',
      function (f) { if (State.bgImage) { State.bgImage.fit = f; buildImageControls(); refresh(); } });
    renderChipRow(el('bg-image-ink'),
      [{ label: 'Dark text', value: 'dark' }, { label: 'Light text', value: 'light' }],
      State.bgImage ? State.bgImage.ink : 'dark',
      function (k) { if (State.bgImage) { State.bgImage.ink = k; buildImageControls(); refresh(); } });
  }

  // ---- content fields --------------------------------------------------------------------------

  function buildContentFields() {
    var t = window.SOCIAL_TEMPLATES.get(State.templateName);
    var wrap = el('content-fields');
    wrap.innerHTML = '';
    t.fields.forEach(function (f) {
      var field = document.createElement('div');
      field.className = 'field' + (f.type === 'json' ? ' mono' : '');
      var label = document.createElement('label');
      label.textContent = f.key.replace(/[-_]/g, ' ');
      field.appendChild(label);

      if (f.key === 'photo') {
        var file = document.createElement('input');
        file.type = 'file'; file.accept = 'image/*';
        file.addEventListener('change', function () {
          var fl = file.files && file.files[0];
          if (!fl) return;
          var reader = new FileReader();
          reader.onload = function () { State.photoOriginal = reader.result; applyPhoto(); };
          reader.readAsDataURL(fl);
        });
        field.appendChild(file);
        var toggleRow = document.createElement('label');
        toggleRow.className = 'matte-toggle';
        var cb = document.createElement('input'); cb.type = 'checkbox'; cb.checked = State.matteOn;
        cb.addEventListener('change', function () { State.matteOn = cb.checked; applyPhoto(); });
        toggleRow.appendChild(cb);
        toggleRow.appendChild(document.createTextNode(' Remove background (person cutout)'));
        field.appendChild(toggleRow);
        var pstatus = document.createElement('div');
        pstatus.className = 'file-btn'; pstatus.id = 'photo-status';
        field.appendChild(pstatus);
      } else if (f.type === 'textarea' || f.type === 'json') {
        var ta = document.createElement('textarea');
        ta.value = (f.type === 'json') ? f.def : (State.content[f.key] != null ? State.content[f.key] : f.def);
        field.appendChild(ta);
        if (f.type === 'textarea') {
          var ctrls = document.createElement('div'); field.appendChild(ctrls);
          ta.addEventListener('input', function () { State.content[f.key] = ta.value; renderSlotControls(f.key, ctrls); scheduleRefresh(); });
          renderSlotControls(f.key, ctrls);
        } else {
          ta.addEventListener('input', function () { State.content[f.key] = ta.value; scheduleRefresh(); });
        }
      } else {
        var input = document.createElement('input');
        input.type = 'text';
        input.value = State.content[f.key] != null ? State.content[f.key] : f.def;
        field.appendChild(input);
        var ctrls2 = document.createElement('div'); field.appendChild(ctrls2);
        input.addEventListener('input', function () { State.content[f.key] = input.value; renderSlotControls(f.key, ctrls2); scheduleRefresh(); });
        renderSlotControls(f.key, ctrls2);
      }
      wrap.appendChild(field);
    });
  }

  // Per-slot color swatches (brand palette) + a compact size multiplier. Colors resolve to brand hex
  // via SOCIAL_PALETTE and ride the content JSON (spec.slots.colors / .sizeScales) into plates.html's
  // applyTextControls — the exact contract the server builder used.
  // A row of brand-palette swatches (first = "default") that reports the picked hex (or null).
  function swatchRow(labelText, activeHex, onPick) {
    var pal = window.SOCIAL_PALETTE || { swatches: [] };
    var row = document.createElement('div');
    row.className = 'slot-controls';
    if (labelText) { var lb = document.createElement('span'); lb.className = 'line-label'; lb.textContent = labelText; row.appendChild(lb); }
    var sw = document.createElement('div'); sw.className = 'swatches';
    var def = document.createElement('button');
    def.type = 'button'; def.className = 'swatch default'; def.title = 'Default'; def.setAttribute('data-hex', '');
    def.addEventListener('click', function () { onPick(null); });
    sw.appendChild(def);
    pal.swatches.forEach(function (s) {
      var b = document.createElement('button');
      b.type = 'button'; b.className = 'swatch'; b.style.background = s.hex; b.title = s.label; b.setAttribute('data-hex', s.hex);
      b.addEventListener('click', function () { onPick(s.hex); });
      sw.appendChild(b);
    });
    Array.prototype.forEach.call(sw.children, function (b) { b.classList.toggle('active', b.getAttribute('data-hex') === (activeHex || '')); });
    row.appendChild(sw);
    return row;
  }

  // A compact per-slot size multiplier ("A" + slider).
  function sizeControl(slot) {
    var pal = window.SOCIAL_PALETTE || { sizeRange: { min: 0.6, max: 1.6 } };
    var wrap = document.createElement('label'); wrap.className = 'size-mini'; wrap.textContent = 'A';
    var size = document.createElement('input');
    size.type = 'range'; size.min = String(pal.sizeRange.min); size.max = String(pal.sizeRange.max);
    size.step = '0.05'; size.value = String(State.sizes[slot] || 1);
    size.addEventListener('input', function () {
      var v = parseFloat(size.value);
      if (Math.abs(v - 1) < 1e-6) delete State.sizes[slot]; else State.sizes[slot] = v;
      scheduleRefresh();
    });
    wrap.appendChild(size);
    return wrap;
  }

  // Per-slot color + size controls, PER-LINE when the slot's copy has \n returns (LINE 1 / LINE 2 …,
  // matching the old builder). State.colors[slot] is a single hex (whole slot) OR an array of hex|null
  // (one per authored \n-line); both ride the spec.slots.colors contract plates.html applyTextControls
  // reads. Rebuilds live as the copy's line count changes.
  function renderSlotControls(slot, container) {
    container.innerHTML = '';
    var val = State.content[slot] != null ? String(State.content[slot]) : '';
    var lines = val.split('\n');

    if (lines.length <= 1) {
      var cur = typeof State.colors[slot] === 'string' ? State.colors[slot]
              : (Array.isArray(State.colors[slot]) ? State.colors[slot][0] : '');
      var row = swatchRow('', cur, function (hex) {
        if (hex) State.colors[slot] = hex; else delete State.colors[slot];
        renderSlotControls(slot, container); scheduleRefresh();
      });
      row.appendChild(sizeControl(slot));
      container.appendChild(row);
      return;
    }

    var arr = Array.isArray(State.colors[slot]) ? State.colors[slot].slice()
            : (typeof State.colors[slot] === 'string' ? [State.colors[slot]] : []);
    while (arr.length < lines.length) arr.push(null);
    arr.length = lines.length;
    lines.forEach(function (_, i) {
      container.appendChild(swatchRow('L' + (i + 1), arr[i] || '', function (hex) {
        arr[i] = hex || null;
        if (arr.every(function (x) { return !x; })) delete State.colors[slot]; else State.colors[slot] = arr.slice();
        renderSlotControls(slot, container); scheduleRefresh();
      }));
    });
    var srow = document.createElement('div'); srow.className = 'slot-controls';
    var slb = document.createElement('span'); slb.className = 'line-label'; slb.textContent = 'size'; srow.appendChild(slb);
    srow.appendChild(sizeControl(slot));
    container.appendChild(srow);
  }

  // Photo pipeline: apply the current photo to the spec, optionally removing its background in-browser
  // (MediaPipe, lazy-loaded). Toggling the checkbox re-derives from the ORIGINAL upload each time.
  function applyPhoto() {
    var ps = el('photo-status');
    if (!State.photoOriginal) { delete State.content.photo; refresh(); return; }
    if (!State.matteOn) { State.content.photo = State.photoOriginal; if (ps) ps.textContent = ''; refresh(); return; }
    if (ps) ps.textContent = 'Removing background… (first run downloads the model, ~9 MB)';
    window.MATTING.removeBackgroundFromUrl(State.photoOriginal).then(function (url) {
      State.content.photo = url; if (el('photo-status')) el('photo-status').textContent = 'Background removed.'; refresh();
    }).catch(function (e) {
      State.content.photo = State.photoOriginal;
      if (el('photo-status')) el('photo-status').textContent = 'Cutout failed (' + (e && e.message || e) + ') — using original.';
      refresh();
    });
  }

  function selectTemplate(name) {
    State.templateName = name;
    var t = window.SOCIAL_TEMPLATES.get(name);
    // Seed content + ground from the module defaults (each field's own default is applied in build).
    State.content = {};
    State.colors = {};
    State.sizes = {};
    State.photoOriginal = null;
    State.matteOn = false;
    t.fields.forEach(function (f) {
      if (f.type === 'json') { try { State.content[f.key] = JSON.parse(f.def); } catch (e) { State.content[f.key] = f.def; } }
      else if (f.key !== 'photo') State.content[f.key] = f.def;
    });
    State.ground = t.defaultGround || 'halo';
    buildTemplatePicker();
    buildGroundPicker();
    buildContentFields();
    refresh();
  }

  // ---- spec build ------------------------------------------------------------------------------

  function buildSlots() {
    var t = window.SOCIAL_TEMPLATES.get(State.templateName);
    var slots = Object.assign({}, t.defaults);
    t.fields.forEach(function (f) {
      var v = State.content[f.key];
      if (v == null) return;
      if (f.type === 'json') { try { slots[f.key] = (typeof v === 'string') ? JSON.parse(v) : v; } catch (e) {} }
      else slots[f.key] = v;
    });
    slots.ground = State.ground;
    if (State.content.photo) slots.photo = State.content.photo;
    // Advanced controls -> the exact content-JSON contract plates.html applyTextControls reads.
    var colors = {}, sizes = {};
    Object.keys(State.colors).forEach(function (k) { if (State.colors[k]) colors[k] = State.colors[k]; });
    Object.keys(State.sizes).forEach(function (k) { if (State.sizes[k] && State.sizes[k] !== 1) sizes[k] = State.sizes[k]; });
    if (Object.keys(colors).length) slots.colors = colors;
    if (Object.keys(sizes).length) slots.sizeScales = sizes;
    // Lockup ink: always explicit (Auto resolves per background; Dark/Light force it) so the mark
    // defaults correctly and is user-overridable.
    slots.lockupInk = resolveLogoInk();
    return slots;
  }

  // expand(), tolerating templates that don't accept a theme opt (only Quote does today).
  function safeExpand(name, slots, opts) {
    try { return window.SOCIAL_TEMPLATES.expand(name, slots, opts); }
    catch (e) {
      if (opts.theme && /theme/.test(String(e && e.message))) {
        var o2 = Object.assign({}, opts); delete o2.theme;
        var s2 = Object.assign({}, slots); delete s2.theme;
        return window.SOCIAL_TEMPLATES.expand(name, s2, o2);
      }
      throw e;
    }
  }

  function buildSpec() {
    var slots = buildSlots();
    var opts = { style: State.style, preset: State.preset, ratio: State.ratio, ground: State.ground };
    // On-dark text treatment where the template supports it (Quote): always over a video loop, and over
    // an image when the user chose light text.
    var darkText = State.bgLoopId || (State.bgImage && State.bgImage.ink === 'light');
    if (darkText) { opts.theme = 'dark'; slots.theme = 'dark'; }
    var spec = safeExpand(State.templateName, slots, opts);
    if (State.bgLoopId) spec.backgroundVideo = { loop: State.bgLoopId, opacity: State.bgOpacity };
    if (State.bgImage) spec.backgroundImage = { src: State.bgImage.url, fit: State.bgImage.fit || 'cover' };
    return spec;
  }

  // ---- render + preview ------------------------------------------------------------------------

  var refreshTimer = 0;
  function scheduleRefresh() {
    clearTimeout(refreshTimer);
    refreshTimer = setTimeout(refresh, 220);
  }

  function refresh() {
    if (State.rendering) { State.pendingRefresh = true; return; }
    State.rendering = true;
    var spec;
    try { spec = buildSpec(); }
    catch (e) { State.rendering = false; setStatus('Spec error: ' + (e && e.message), 'err'); return; }
    State.spec = spec;
    setStatus('Rendering plates…');
    window.PLATE_RENDERER.renderPlates(State.templateName, spec).then(function (images) {
      State.images = images;
      State.composer = window.SOCIAL_COMPOSER.buildComposer(spec);
      sizeCanvas(spec);
      manageBg(spec);
      updateMeta(spec);
      startPreview();
      setStatus('', '');
      State.rendering = false;
      if (State.pendingRefresh) { State.pendingRefresh = false; refresh(); }
    }).catch(function (e) {
      State.rendering = false;
      setStatus('Render failed: ' + (e && e.message), 'err');
      console.error(e);
    });
  }

  function sizeCanvas(spec) {
    var c = el('preview-canvas');
    c.width = spec.size.w; c.height = spec.size.h;
  }

  function updateMeta(spec) {
    el('meta-dims').textContent = spec.size.w + '×' + spec.size.h + ' · ' + (spec.fps || 30) + 'fps · ' + (spec.dur || 8) + 's';
    el('meta-note').textContent = State.bgLoopId ? ('bg: ' + State.bgLoopId) : (State.style + '/' + State.preset);
  }

  function manageBg(spec) {
    var v = el('bg-video'), img = el('bg-image');
    if (spec.backgroundVideo) {
      var wanted = 'assets/backgrounds/' + spec.backgroundVideo.loop + '.mp4';
      if (v.getAttribute('data-loop') !== spec.backgroundVideo.loop) {
        v.src = wanted; v.setAttribute('data-loop', spec.backgroundVideo.loop);
        v.load();
      }
      v.style.opacity = String(spec.backgroundVideo.opacity);
      v.classList.remove('hidden');
      var pr = v.play(); if (pr && pr.catch) pr.catch(function () {});
    } else {
      v.pause(); v.classList.add('hidden'); v.removeAttribute('data-loop');
    }
    if (spec.backgroundImage) {
      if (img.getAttribute('src') !== spec.backgroundImage.src) img.src = spec.backgroundImage.src;
      img.classList.toggle('fit-contain', spec.backgroundImage.fit === 'contain');
      img.classList.remove('hidden');
    } else {
      img.classList.add('hidden'); img.removeAttribute('src');
    }
    el('preview-wrap').style.background = (spec.backgroundVideo || spec.backgroundImage) ? BG_MANIFEST.base : 'transparent';
  }

  function startPreview() {
    cancelAnimationFrame(State.raf);
    var canvas = el('preview-canvas');
    var ctx = canvas.getContext('2d');
    var loopSec = (State.spec.motion && State.spec.motion.speed && State.spec.motion.speed.loopSec) || State.spec.dur || 8;
    State.t0 = performance.now();
    (function frame(now) {
      var t = ((now - State.t0) / 1000) % loopSec;
      // Canvas is transparent where the composer clears (video/image bg) so the <video> shows through.
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      window.SOCIAL_COMPOSER.drawFrame(ctx, State.composer, State.images, t);
      State.raf = requestAnimationFrame(frame);
    })(State.t0);
  }

  // ---- export ----------------------------------------------------------------------------------

  function filename(ext) {
    return ['intercept', State.templateName, State.ratio, State.bgLoopId ? State.bgLoopId : State.style].join('-') + '.' + ext;
  }
  function download(blob, name) {
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a'); a.href = url; a.download = name; document.body.appendChild(a); a.click();
    setTimeout(function () { URL.revokeObjectURL(url); a.remove(); }, 1000);
  }

  function exportOpts() {
    var opts = { baseColor: BG_MANIFEST.base, onProgress: function (p) { var pr = el('export-progress'); pr.value = p; } };
    if (State.spec.backgroundVideo) {
      opts.bgVideo = { el: el('bg-video'), opacity: State.spec.backgroundVideo.opacity };
    }
    if (State.spec.backgroundImage) {
      opts.bgImage = { el: el('bg-image') };
    }
    return opts;
  }

  function withPausedPreview(fn) {
    cancelAnimationFrame(State.raf);
    var v = el('bg-video'); var wasPlaying = State.spec.backgroundVideo;
    if (wasPlaying) v.pause();
    return Promise.resolve()
      .then(fn)
      .finally(function () { if (wasPlaying) { var pr = v.play(); if (pr && pr.catch) pr.catch(function () {}); } startPreview(); });
  }

  function doExportMp4() {
    var wc = window.WEBCODECS_EXPORT;
    if (!wc.isSupported() && !wc.recorderSupported()) { setStatus('This browser can’t export video.', 'err'); return; }
    var willWebm = !wc.isSupported();
    var btn = el('export-mp4'); btn.disabled = true; el('export-poster').disabled = true;
    el('export-progress').classList.remove('hidden'); el('export-progress').value = 0;
    setStatus(willWebm ? 'Recording video (real-time)…' : 'Encoding MP4…');
    withPausedPreview(function () {
      return ensureBgReady().then(function () {
        return wc.exportVideo(State.spec, State.images, exportOpts());
      }).then(function (blob) {
        var ext = /mp4/.test(blob.type) ? 'mp4' : 'webm';
        download(blob, filename(ext));
        setStatus('Exported ' + filename(ext) + ' (' + (blob.size / 1e6).toFixed(1) + ' MB)', 'ok');
      });
    }).catch(function (e) { setStatus('Export failed: ' + (e && e.message), 'err'); console.error(e); })
      .finally(function () { btn.disabled = false; el('export-poster').disabled = false; el('export-progress').classList.add('hidden'); });
  }

  function doExportPoster() {
    var btn = el('export-poster'); btn.disabled = true;
    setStatus('Rendering poster…');
    withPausedPreview(function () {
      return ensureBgReady().then(function () {
        return window.WEBCODECS_EXPORT.posterPng(State.spec, State.images, exportOpts());
      }).then(function (blob) { download(blob, filename('png')); setStatus('Saved ' + filename('png'), 'ok'); });
    }).catch(function (e) { setStatus('Poster failed: ' + (e && e.message), 'err'); })
      .finally(function () { btn.disabled = false; });
  }

  // Ensure the bg media has decoded data before export reads it.
  function ensureBgReady() {
    var waits = [];
    if (State.spec.backgroundVideo) {
      var v = el('bg-video');
      if (v.readyState < 2) waits.push(new Promise(function (r) { v.addEventListener('loadeddata', r, { once: true }); setTimeout(r, 3000); }));
    }
    if (State.spec.backgroundImage) {
      var img = el('bg-image');
      if (!img.complete || !img.naturalWidth) waits.push(new Promise(function (r) { img.addEventListener('load', r, { once: true }); img.addEventListener('error', r, { once: true }); setTimeout(r, 3000); }));
    }
    return Promise.all(waits);
  }

  // ---- boot ------------------------------------------------------------------------------------

  function boot() {
    el('bg-opacity').addEventListener('input', function (e) {
      State.bgOpacity = parseFloat(e.target.value);
      el('bg-opacity-val').textContent = State.bgOpacity.toFixed(2);
      if (State.spec && State.spec.backgroundVideo) { State.spec.backgroundVideo.opacity = State.bgOpacity; el('bg-video').style.opacity = String(State.bgOpacity); }
    });
    el('export-mp4').addEventListener('click', doExportMp4);
    el('export-poster').addEventListener('click', doExportPoster);

    el('bg-image-file').addEventListener('change', function () {
      var f = this.files && this.files[0]; if (!f) return;
      var reader = new FileReader();
      reader.onload = function () {
        State.bgImage = { url: reader.result, fit: 'cover', ink: 'dark' };
        State.bgLoopId = null;
        el('bg-opacity-wrap').classList.add('hidden');
        el('bg-image-controls').classList.remove('hidden');
        buildImageControls();
        buildBgPicker();
        refresh();
      };
      reader.readAsDataURL(f);
      this.value = ''; // allow re-selecting the same file
    });

    Promise.all([
      window.SOCIAL_TEMPLATES.load(),
      fetch('assets/backgrounds/manifest.json').then(function (r) { return r.json(); }).then(function (m) { BG_MANIFEST = m; }).catch(function () {}),
    ]).then(function () {
      buildRatioPicker();
      buildStylePicker();
      buildLogoPicker();
      buildBgPicker();
      var list = window.SOCIAL_TEMPLATES.list();
      selectTemplate((list[0] && list[0].name) || 'quote');
      el('boot-msg').classList.add('hidden');
      var wc = window.WEBCODECS_EXPORT;
      if (!wc.isSupported()) {
        setStatus(wc.recorderSupported()
          ? 'Preview works. This browser will export .webm (real mp4 needs Chromium — Chrome / Edge / Arc).'
          : 'Preview works; video export needs a modern browser.', 'err');
      }
    }).catch(function (e) {
      el('boot-msg').textContent = 'Failed to load: ' + (e && e.message);
      console.error(e);
    });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})();
