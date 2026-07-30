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

  // Which TEXT slots each template exposes for the per-slot text variables (COLOR, SIZE and hard \n
  // LINE BREAKS). These keys match the applyTextControls() map keys in each templates/<t>/plates.html
  // (14-01's slot map) EXACTLY, so a chosen colour/size lands on the right element(s) — and they match
  // the server builder's own TEXT_SLOTS map, so the static app offers the same set. Structural slots
  // (photo, lockup, ground) are deliberately absent: they get no text controls.
  var TEXT_SLOTS = {
    'new-hire': ['greeting', 'name', 'role'],
    'quote': ['quote', 'attribution', 'role'],
    'carousel': ['beats'],
    'hot-take': ['statement'],
    'stat': ['metric', 'support'],
    'event': ['title', 'date', 'cta'],
  };
  function isTextSlot(template, key) { return (TEXT_SLOTS[template] || []).indexOf(key) !== -1; }

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
    // Transitions-panel TIMING overrides. buildSpec() re-expands from scratch on every structural
    // change (copy/colour/ratio/background), which emits each template's DEFAULT timing — so a user's
    // tweaks are re-applied (and re-clamped against the fresh spec) afterwards instead of being lost.
    timingOverrides: { wordReveal: {}, odometer: {}, beatCycle: {}, pulse: {}, loopSec: null },
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
      } else if (f.type === 'json') {
        // Structural (array/object) slot — edited as JSON. Carousel's `beats` is still a TEXT slot for
        // colour/size purposes (its lines are array entries, not \n-separated), so it gets whole-slot
        // controls even though the copy itself is edited as JSON.
        var ta = document.createElement('textarea');
        ta.value = f.def;
        field.appendChild(ta);
        ta.addEventListener('input', function () { State.content[f.key] = ta.value; scheduleRefresh(); });
        if (isTextSlot(State.templateName, f.key)) {
          var jctrls = document.createElement('div'); field.appendChild(jctrls);
          renderSlotControls(f.key, jctrls, true);
        }
      } else if (isTextSlot(State.templateName, f.key) || f.type === 'textarea') {
        // EVERY text slot is a multi-line textarea — the render layer honours \n as a hard <br> in every
        // slot (14-01), so a single-line <input> would silently withhold line breaks (and per-line
        // colours) from the short slots (name / metric / date / CTA …). Same contract as the server
        // builder: Enter = line break.
        var ta2 = document.createElement('textarea');
        ta2.rows = (f.type === 'textarea') ? 3 : 2;
        ta2.value = State.content[f.key] != null ? State.content[f.key] : f.def;
        field.appendChild(ta2);
        var hint = document.createElement('p');
        hint.className = 'hint';
        hint.textContent = 'Enter = line break.';
        field.appendChild(hint);
        var ctrls = document.createElement('div'); field.appendChild(ctrls);
        ta2.addEventListener('input', function () { State.content[f.key] = ta2.value; renderSlotControls(f.key, ctrls); scheduleRefresh(); });
        renderSlotControls(f.key, ctrls);
      } else {
        var input = document.createElement('input');
        input.type = 'text';
        input.value = State.content[f.key] != null ? State.content[f.key] : f.def;
        field.appendChild(input);
        input.addEventListener('input', function () { State.content[f.key] = input.value; scheduleRefresh(); });
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
  function renderSlotControls(slot, container, wholeOnly) {
    container.innerHTML = '';
    var val = State.content[slot] != null ? String(State.content[slot]) : '';
    var lines = wholeOnly ? [val] : val.split('\n');

    if (lines.length <= 1) {
      var cur = typeof State.colors[slot] === 'string' ? State.colors[slot]
              : (Array.isArray(State.colors[slot]) ? State.colors[slot][0] : '');
      var row = swatchRow('', cur, function (hex) {
        if (hex) State.colors[slot] = hex; else delete State.colors[slot];
        renderSlotControls(slot, container, wholeOnly); scheduleRefresh();
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
        renderSlotControls(slot, container, wholeOnly); scheduleRefresh();
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
    // Race a timeout. MediaPipe needs WebGL; where the GPU context can't be created it logs the failure
    // to the console and its promise NEVER settles, so the .catch below never runs and the UI sits on
    // "Removing background…" forever with the photo apparently doing nothing. Always settle.
    var matte = Promise.race([
      window.MATTING.removeBackgroundFromUrl(State.photoOriginal),
      new Promise(function (_, rej) {
        setTimeout(function () { rej(new Error('timed out — WebGL/model unavailable')); }, 45000);
      }),
    ]);
    matte.then(function (url) {
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
    // A different template has a different timing SHAPE (odometer vs wordReveal vs beatCycle vs pulse),
    // so drop the per-move overrides — a stale one must not ride onto the new template. loopSec is
    // shared by all six, so it survives the switch.
    State.timingOverrides = { wordReveal: {}, odometer: {}, beatCycle: {}, pulse: {}, loopSec: State.timingOverrides.loopSec };
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
    applyTimingOverrides(spec);
    return spec;
  }

  // ---- transitions (timing) --------------------------------------------------------------------
  //
  // Per-template loop-safe TIMING sliders: loop duration for every template, plus the per-move timing
  // the current spec actually carries (stat odometer, quote wordReveal, carousel beatCycle, event
  // pulse). Every slider is CLAMPED to the loop-safe range from the composition-spec contract, read
  // against the LIVE spec's N, so a seam-breaking value can't be produced. Timing does NOT change the
  // captured plates — the composer reads these fields live — so a change mutates State.spec and
  // rebuilds the composer only, with NO plate re-render.

  function clampNum(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }
  function round4(x) { return Math.round(x * 10000) / 10000; }

  // The roll-speed (rollSpan) floor: each count-up value must land on enough sampled frames to read as
  // a value rather than a blur. Below ~3 frames per value the roll degrades (the loop/poster/seam
  // invariants still hold — it just stops reading as a count-up), so the slider stops there.
  // Rounded UP to a whole 0.01 — the slider's own step — so the floor is never BELOW the sampling
  // bound and the template's default rollSpan still lands on an exact step (an <input type=range>
  // snaps to min + k*step, so a ragged min would silently shift the default off its own value).
  function minRollSpan(spec) {
    var N = (spec.odometer && spec.odometer.layers && spec.odometer.layers.length) || 1;
    var fps = spec.fps || 30;
    var loopSec = (spec.motion && spec.motion.speed && spec.motion.speed.loopSec) || spec.dur || 8;
    return Math.min(1, Math.max(0.02, Math.ceil(3 * N / (fps * loopSec) * 100) / 100));
  }

  // Clamp a wordReveal/odometer/beatCycle field against the LIVE spec's loop-safe invariants. Coupled
  // fields are clamped against each other's CURRENT value, so the spec stays valid whichever slider
  // moves and whatever N is.
  function clampTiming(spec, group, field, value) {
    var v = Number(value);
    if (!isFinite(v)) v = 0;
    if (group === 'wordReveal') {
      var wr = spec.wordReveal || {};
      var dipW = wr.dipW != null ? wr.dipW : 0.08;
      var sweepSpan = wr.sweepSpan != null ? wr.sweepSpan : 0.6;
      var hold = wr.hold != null ? wr.hold : 0.2;
      // invariants: floor in [0,1); dipW <= hold; hold + sweepSpan + dipW <= 1; sweepSpan > 0.
      if (field === 'floor') return round4(clampNum(v, 0, 0.95));
      if (field === 'dipW') return round4(clampNum(v, 0, Math.max(0, Math.min(hold, 1 - hold - sweepSpan))));
      if (field === 'hold') return round4(clampNum(v, dipW, Math.max(dipW, 1 - sweepSpan - dipW)));
      if (field === 'sweepSpan') return round4(clampNum(v, 0.02, Math.max(0.02, 1 - hold - dipW)));
    }
    if (group === 'odometer' || group === 'beatCycle') {
      var g = spec[group] || {};
      var N = (g.layers && g.layers.length) || 1;
      // The one-at-a-time bound is 2*dwell + fade <= rollSpan/N. beatCycle has no rollSpan, so its
      // members tile the whole loop and the bound is the classic 1/N.
      var span = (group === 'odometer' && g.rollSpan != null) ? g.rollSpan : 1;
      var dwell = g.dwell != null ? g.dwell : 0.02;
      var fade = g.fade != null ? g.fade : 0.03;
      // rollSpan is bounded only by the sampling floor and 1. It does NOT have to respect the current
      // dwell/fade, because narrowing it RESCALES them proportionally (see setRollSpan) — the same
      // fraction-of-slot relationship the template's own defaults are built on. Clamping the span
      // against them instead would let a wide digit dwell jam the roll-speed slider partway.
      if (field === 'rollSpan') return round4(clampNum(v, minRollSpan(spec), 1));
      var inv = span / N;
      if (field === 'dwell') {
        var maxDwell = Math.max(0, (inv - fade) / 2);
        var nd = clampNum(v, 0, maxDwell);
        if (nd + fade <= 0) nd = Math.min(maxDwell, 0.001);
        return round4(nd);
      }
      if (field === 'fade') {
        var maxFade = Math.max(0, inv - 2 * dwell);
        var nf = clampNum(v, 0, maxFade);
        if (dwell + nf <= 0) nf = Math.min(maxFade, 0.001);
        return round4(nf);
      }
    }
    return round4(v);
  }

  // Clamp a pulse member field. harmonic MUST be a positive integer (endpoint safety — a non-integer
  // breaks the loop seam).
  function clampPulse(field, value) {
    var v = Number(value);
    if (!isFinite(v)) v = 0;
    if (field === 'harmonic') return Math.max(1, Math.min(6, Math.round(v)));
    if (field === 'scaleAmp') return round4(clampNum(v, 0, 0.3));
    if (field === 'driftY') return Math.round(clampNum(v, 0, 24));
    return v;
  }

  // Descriptors for the CURRENT spec. Loop duration is always present; a per-move control only appears
  // for the timing field the spec actually carries (e.g. no odometer sliders for a non-numeric metric).
  function transitionControlsFor(spec) {
    var list = [];
    var loopSec = (spec.motion && spec.motion.speed && spec.motion.speed.loopSec) || spec.dur || 8;
    list.push({ id: 'tr-loopsec', label: 'Loop duration', min: 2, max: 16, step: 0.5, value: loopSec, kind: 'loopSec', fmt: function (v) { return v.toFixed(1) + 's'; } });

    if (spec.odometer) {
      var od = spec.odometer;
      var N = (od.layers && od.layers.length) || 1;
      // ROLL SPEED first — it is the knob that decides whether the count-up reads as an odometer. Shown
      // as the roll's real duration in seconds (what you actually perceive), not the raw loop fraction.
      list.push({
        id: 'tr-od-span', label: 'Stat — roll speed', min: minRollSpan(spec), max: 1, step: 0.01,
        value: od.rollSpan != null ? od.rollSpan : 1, kind: 'odometer', field: 'rollSpan',
        // Read loopSec LIVE, not from the closure: the Loop-duration slider changes it without
        // re-rendering this panel, and a stale value would mis-report the roll's real duration.
        fmt: function (v) {
          var L = (State.spec && State.spec.motion && State.spec.motion.speed && State.spec.motion.speed.loopSec) || loopSec;
          return (v * L).toFixed(2) + 's roll · ' + (v * L / N * 1000).toFixed(0) + 'ms/value';
        },
      });
      list.push({ id: 'tr-od-dwell', label: 'Stat — digit dwell', min: 0, max: round4(1 / N), step: 0.001, value: od.dwell != null ? od.dwell : 0.02, kind: 'odometer', field: 'dwell', fmt: function (v) { return v.toFixed(3); } });
      list.push({ id: 'tr-od-fade', label: 'Stat — digit crossfade', min: 0, max: round4(1 / N), step: 0.001, value: od.fade != null ? od.fade : 0.03, kind: 'odometer', field: 'fade', fmt: function (v) { return v.toFixed(3); } });
    }
    if (spec.wordReveal) {
      var wr = spec.wordReveal;
      list.push({ id: 'tr-wr-hold', label: 'Quote — reveal hold', min: 0, max: 0.5, step: 0.01, value: wr.hold != null ? wr.hold : 0.2, kind: 'wordReveal', field: 'hold' });
      list.push({ id: 'tr-wr-sweep', label: 'Quote — sweep span', min: 0.1, max: 0.9, step: 0.02, value: wr.sweepSpan != null ? wr.sweepSpan : 0.6, kind: 'wordReveal', field: 'sweepSpan' });
      list.push({ id: 'tr-wr-dipw', label: 'Quote — dip width', min: 0, max: 0.4, step: 0.01, value: wr.dipW != null ? wr.dipW : 0.08, kind: 'wordReveal', field: 'dipW' });
      list.push({ id: 'tr-wr-floor', label: 'Quote — dip floor (min opacity)', min: 0, max: 0.9, step: 0.05, value: wr.floor != null ? wr.floor : 0.15, kind: 'wordReveal', field: 'floor' });
    }
    if (spec.beatCycle) {
      var bc = spec.beatCycle;
      list.push({ id: 'tr-bc-dwell', label: 'Carousel — beat dwell', min: 0, max: 0.2, step: 0.005, value: bc.dwell != null ? bc.dwell : 0.09, kind: 'beatCycle', field: 'dwell' });
      list.push({ id: 'tr-bc-fade', label: 'Carousel — beat crossfade', min: 0, max: 0.2, step: 0.005, value: bc.fade != null ? bc.fade : 0.06, kind: 'beatCycle', field: 'fade' });
    }
    if (spec.pulse && spec.pulse.members) {
      var cta = null, date = null;
      spec.pulse.members.forEach(function (m) { if (m.name === 'cta') cta = m; if (m.name === 'date') date = m; });
      if (cta) {
        list.push({ id: 'tr-cta-amp', label: 'Event — CTA pulse amount', min: 0, max: 0.3, step: 0.01, value: cta.scaleAmp != null ? cta.scaleAmp : 0.05, kind: 'pulse', member: 'cta', field: 'scaleAmp' });
        list.push({ id: 'tr-cta-harm', label: 'Event — CTA pulses / loop', min: 1, max: 6, step: 1, value: cta.harmonic != null ? cta.harmonic : 2, kind: 'pulse', member: 'cta', field: 'harmonic' });
      }
      if (date) {
        list.push({ id: 'tr-date-drift', label: 'Event — date tick', min: 0, max: 24, step: 1, value: date.driftY != null ? date.driftY : 6, kind: 'pulse', member: 'date', field: 'driftY' });
        list.push({ id: 'tr-date-harm', label: 'Event — date ticks / loop', min: 1, max: 6, step: 1, value: date.harmonic != null ? date.harmonic : 3, kind: 'pulse', member: 'date', field: 'harmonic' });
      }
    }
    return list;
  }

  var TRANSITION_DESCRIPTORS = [];

  function fmtTiming(d, v) {
    if (d.fmt) return d.fmt(Number(v));
    if (d.field === 'harmonic') return String(Math.round(v)) + '×';
    if (d.field === 'driftY') return String(Math.round(v)) + 'px';
    return Number(v).toFixed(2);
  }

  function renderTransitionControls() {
    var container = el('transition-controls');
    if (!container || !State.spec) return;
    TRANSITION_DESCRIPTORS = transitionControlsFor(State.spec);
    container.innerHTML = '';
    TRANSITION_DESCRIPTORS.forEach(function (d) {
      var row = document.createElement('div');
      row.className = 'slider-row wide';
      var lb = document.createElement('label');
      lb.setAttribute('for', d.id);
      lb.textContent = d.label;
      var input = document.createElement('input');
      input.type = 'range'; input.id = d.id;
      input.min = String(d.min); input.max = String(d.max); input.step = String(d.step);
      input.value = String(d.value);
      var out = document.createElement('output');
      out.id = d.id + '-value';
      out.textContent = fmtTiming(d, d.value);
      input.addEventListener('input', function () { onTransitionInput(d, parseFloat(input.value)); });
      row.appendChild(lb); row.appendChild(input); row.appendChild(out);
      container.appendChild(row);
    });
  }

  function onTransitionInput(d, rawValue) {
    if (!State.spec) return;
    var applied;
    if (d.kind === 'loopSec') {
      applied = Math.round(clampNum(Number(rawValue), 2, 16) * 10) / 10;
      setLoopSec(applied);
      State.timingOverrides.loopSec = applied;
    } else if (d.kind === 'pulse') {
      applied = clampPulse(d.field, rawValue);
      var mem = null;
      State.spec.pulse.members.forEach(function (m) { if (m.name === d.member) mem = m; });
      if (mem) mem[d.field] = applied;
      State.timingOverrides.pulse[d.member + '::' + d.field] = applied;
      rebuildComposer();
    } else if (d.kind === 'odometer' && d.field === 'rollSpan') {
      applied = setRollSpan(clampTiming(State.spec, 'odometer', 'rollSpan', rawValue));
    } else {
      applied = clampTiming(State.spec, d.kind, d.field, rawValue);
      State.spec[d.kind] = Object.assign({}, State.spec[d.kind]);
      State.spec[d.kind][d.field] = applied;
      State.timingOverrides[d.kind][d.field] = applied;
      rebuildComposer();
    }
    // Reflect the clamp on this slider and refresh coupled siblings — clamping one field can shift the
    // allowed range of the others (and rollSpan rescales the whole dwell/fade budget).
    syncTransitionControls();
  }

  // Roll speed. Each digit's dwell/fade are a FRACTION OF ITS OWN SLOT (rollSpan/N) — that is how the
  // template derives its defaults — so changing the span rescales them by the same ratio. This also
  // keeps the loop-safe invariant satisfied for free: if 2*dwell + fade <= span/N held before, scaling
  // dwell/fade by r = span'/span gives r*(2*dwell + fade) <= r*span/N = span'/N.
  function setRollSpan(span) {
    var od = State.spec.odometer;
    if (!od) return span;
    var prev = od.rollSpan != null ? od.rollSpan : 1;
    var r = prev > 0 ? (span / prev) : 1;
    var next = Object.assign({}, od, { rollSpan: span });
    var N = (od.layers && od.layers.length) || 1;
    var dwell = od.dwell != null ? od.dwell : 0.02;
    var fade = od.fade != null ? od.fade : 0.03;
    next.dwell = round4(dwell * r);
    next.fade = round4(fade * r);
    // round4 can nudge the pair just over the bound at tiny spans — trim the crossfade if so.
    var overshoot = (2 * next.dwell + next.fade) - span / N;
    if (overshoot > 0) next.fade = round4(Math.max(0, next.fade - overshoot));
    State.spec.odometer = next;
    State.timingOverrides.odometer.rollSpan = span;
    State.timingOverrides.odometer.dwell = next.dwell;
    State.timingOverrides.odometer.fade = next.fade;
    rebuildComposer();
    return span;
  }

  // Loop duration drives BOTH motion.speed.loopSec and spec.dur (dur === loopSec: one clean loop), and
  // restarts the preview clock so the new period takes effect immediately.
  function setLoopSec(sec) {
    if (!State.spec) return;
    State.spec.motion = Object.assign({}, State.spec.motion);
    State.spec.motion.speed = Object.assign({}, State.spec.motion.speed, { loopSec: sec });
    State.spec.dur = sec;
    rebuildComposer();
    updateMeta(State.spec);
    // NOTE: the roll-speed floor depends on loopSec (frames per value), but the slider's `min` is left
    // alone here on purpose. Raising it would clamp the <input>'s value above the rollSpan the spec
    // actually holds, so the thumb and the readout would disagree with the render. clampTiming()
    // recomputes the floor LIVE on the next drag instead, which self-corrects and stays reversible.
    startPreview();
  }

  function rebuildComposer() {
    if (!State.spec || !State.images) return;
    State.composer = window.SOCIAL_COMPOSER.buildComposer(State.spec);
  }

  // Re-read every slider from the live spec (values may have been clamped, and a rollSpan change
  // rescales the dwell/fade ceilings) without rebuilding the DOM and losing the drag.
  function syncTransitionControls() {
    if (!State.spec) return;
    TRANSITION_DESCRIPTORS.forEach(function (d) {
      var input = el(d.id), out = el(d.id + '-value');
      if (!input) return;
      var v = readTransitionValue(d, State.spec);
      if (v == null) return;
      if (d.field === 'dwell' || d.field === 'fade') input.max = String(round4(maxFor(State.spec, d)));
      // Deliberately NOT touching a rollSpan slider's `min` here: an <input type=range> clamps its own
      // value to min, so raising it (loopSec dropped -> fewer frames per value) would push the thumb
      // above the rollSpan the spec actually holds and the thumb would contradict the readout. The
      // floor is enforced in ONE place — clampTiming(), which recomputes it live on the next drag.
      input.value = String(v);
      if (out) out.textContent = fmtTiming(d, v);
    });
  }

  function maxFor(spec, d) {
    var g = spec[d.kind] || {};
    var N = (g.layers && g.layers.length) || 1;
    var span = (d.kind === 'odometer' && g.rollSpan != null) ? g.rollSpan : 1;
    return Math.max(0.001, span / N);
  }

  function readTransitionValue(d, spec) {
    if (d.kind === 'loopSec') return (spec.motion && spec.motion.speed && spec.motion.speed.loopSec) || spec.dur || 8;
    if (d.kind === 'pulse') {
      var mem = null;
      ((spec.pulse && spec.pulse.members) || []).forEach(function (m) { if (m.name === d.member) mem = m; });
      return mem ? (mem[d.field] != null ? mem[d.field] : 0) : null;
    }
    var g = spec[d.kind];
    if (!g) return null;
    return g[d.field] != null ? g[d.field] : null;
  }

  // Re-apply (and RE-CLAMP) the active timing overrides onto a freshly-expanded spec. expand() emits
  // each template's DEFAULT timing, so a structural refresh (colour/size/copy/ratio change) would
  // otherwise silently drop the user's tweaks. Re-clamping against the FRESH spec means an override
  // that is no longer loop-safe (N changed with the copy) is narrowed rather than breaking the seam.
  function applyTimingOverrides(spec) {
    var to = State.timingOverrides;
    if (to.loopSec != null && spec.motion && spec.motion.speed) {
      spec.motion.speed.loopSec = to.loopSec;
      spec.dur = to.loopSec;
    }
    // rollSpan FIRST — it sets the dwell/fade budget the others are clamped against.
    if (spec.odometer && to.odometer.rollSpan != null) {
      spec.odometer.rollSpan = clampTiming(spec, 'odometer', 'rollSpan', to.odometer.rollSpan);
    }
    ['wordReveal', 'odometer', 'beatCycle'].forEach(function (group) {
      if (!spec[group]) return;
      Object.keys(to[group]).forEach(function (field) {
        if (field === 'rollSpan') return; // already applied
        spec[group][field] = clampTiming(spec, group, field, to[group][field]);
      });
    });
    if (spec.pulse && spec.pulse.members) {
      Object.keys(to.pulse).forEach(function (compound) {
        var parts = compound.split('::');
        spec.pulse.members.forEach(function (m) {
          if (m.name === parts[0]) m[parts[1]] = clampPulse(parts[1], to.pulse[compound]);
        });
      });
    }
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
      renderTransitionControls();
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
