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
  };
  function isTextSlot(template, key) { return (TEXT_SLOTS[template] || []).indexOf(key) !== -1; }

  var State = {
    templateName: null,
    ratio: '1x1',
    ground: 'halo',
    style: 'keyline',
    preset: 'standard',
    // Fritz Field selections. Absent => fritzfield.js DEFAULTS (ov-nest / coolsweep-only / sweep —
    // Jon's deck pick). These are DESIGN choices, so they survive a preset change; a preset only moves
    // intensity.
    pattern: 'ov-nest',
    palette: 'coolsweep-only',
    animate: 'sweep',
    // Fritzoid mark size in px at 1080. Deliberately a NARROW range: 10 is the deck's spec and the
    // floor, 15 the ceiling. Past ~15 a 'densely packed field' stops being dense and starts being a
    // tiled motif, which is a different thing and not what this style is for.
    fieldCell: 10,
    // Fritzoid's DESIGN knobs (rebuilt 2026-08-05 — the canon mark sliced and chipped, ported from
    // the fritzoid-animator generator; the old truchet tileBase/wavesPerLoop described a tile grid
    // that no longer exists). There is deliberately NO angle or slice-width control: the triangle's
    // slope, right edge, base and apex keepout are the canon's construction, not user surface.
    // `fzInk`/`fzSteps` are INTENSITY knobs, so they track the chosen preset until the user moves
    // them — see buildFritzoidControls. fzSlices 0 = let the cast pick (BUDGET.gapWeights).
    fzMarks: 1, fzSize: 0.62, fzSlices: 0, fzSteps: 3, fzChip: 1, fzInk: 0.16,
    // Colour + pattern fills (2026-08-05). 'ink' is the default so nothing existing changes; the
    // pulse patterns come from the same fritzfield library the Fritz Field style uses.
    fzPalette: 'ink', fzFill: 'solid', fzTarget: 'mark', fzPattern: 'ov-nest',
    // Ribbon's knobs. Same split: count/length/width/laps/cluster-size are DESIGN choices and hold
    // their values; slither and twist are intensity, so they track the preset until touched.
    rbCount: 3, rbBody: 0.34, rbWidth: 96, rbTravel: 1, rbSlither: 0.6, rbTwist: 0.5, rbScale: 1,
    // Glide defaults ON at a moderate value — Jon: "this should be a slow moving motion graphic", and
    // glide is what makes a whole-lap crawl read slow for most of the loop.
    rbTilt: 0.7, rbWind: 0.6, rbGlide: 0.45,
    // Where the whole cluster sits, as a fraction of the frame. Defaults match what the old
    // position-bias placement produced, so switching to explicit control doesn't jump the design.
    rbX: 0.58, rbY: 0.54,
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
    bgVideoFile: null,    // { url, name } for a USER-UPLOADED loop (vs bgLoopId = a bundled one)
    photoOriginal: null,  // last uploaded photo (data URL), pre-matting
    matteOn: false,       // remove-background toggle for photo templates
    noPhoto: false,       // explicit "no photo at all" — omits the photo layer entirely
    spec: null,
    images: null,
    composer: null,
    raf: 0,
    t0: 0,
    rendering: false,
    pendingRefresh: false,
    // Carousel PDF (2026-08-13) — a sequence of { template, content, colors, sizes } snapshots, each
    // one page of a multi-page PDF (core/pdf-export.js). Canvas/background/style/logo are SHARED
    // (read live off State at export time, same as the single-design export) — only template+content
    // vary per frame, matching how the prior one-off carousel PDF was actually built (same style,
    // different copy per slide). editingFrameIndex, when set, means the Template/Content panels above
    // are currently bound to State.frames[editingFrameIndex] rather than a free-standing scratch
    // design — see syncEditingFrame().
    frames: [],
    editingFrameIndex: null,
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

  // NOTE: every single-select chip row REPAINTS itself inside its own onPick (see the pickers below).
  // renderChipRow paints the active state from `activeVal` at render time only, so without that
  // repaint the highlight stays on the previously-active chip and the panel misreports the live state.
  // Only the background row used to do this; the ratio/ground/logo/style/preset rows did not, which
  // went unnoticed while style was a 2-chip choice.
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
      function (r) { State.ratio = r; refresh(); buildRatioPicker(); });
  }

  function buildGroundPicker() {
    renderChipRow(el('ground-picker'),
      [{ label: 'Halo', value: 'halo' }, { label: 'Graphite', value: 'graphite' }, { label: 'Carbon', value: 'carbon' }],
      State.ground,
      function (g) { State.ground = g; refresh(); buildGroundPicker(); });
  }

  function buildLogoPicker() {
    renderChipRow(el('logo-picker'),
      [{ label: 'Auto', value: 'auto' }, { label: 'Dark logo', value: 'dark' }, { label: 'Light logo', value: 'light' }],
      State.logo,
      function (v) { State.logo = v; refresh(); buildLogoPicker(); });
  }

  // Resolve the lockup ink. 'auto' picks correctly per background so the mark never sinks into it:
  // dark video loop -> white; image -> follow the chosen text tone; procedural -> follow the ground.
  function resolveLogoInk() {
    if (State.logo === 'dark') return 'carbon';
    if (State.logo === 'light') return 'halo';
    if (State.bgLoopId || State.bgVideoFile) return 'halo';
    if (State.bgImage) return (State.bgImage.ink === 'light') ? 'halo' : 'carbon';
    return (State.ground === 'carbon') ? 'halo' : 'carbon';
  }

  // Procedural backgrounds. Keyline = the spiral line ribbons; Fritzoid = the ambient truchet tile
  // field; Fritz Field = the densely-packed Fritzoid pattern library from the Weekly Pulse deck, which
  // carries all 17 of the generator's pattern modes behind its own Pattern / Palette / Animation
  // pickers. Values are the spec's motion.style strings, validated by composition-spec.js.
  // `Ribbons` (2026-08-05) is keyline's travelling sibling — finite ribbons with a head and a tail
  // crawling around their own circuits in a cluster, instead of keyline's static spirals with an
  // orbiting camera. Keyline is kept: every existing spec and golden renders from it.
  var STYLES = [
    { label: 'Keyline', value: 'keyline' },
    { label: 'Ribbons', value: 'ribbon' },
    { label: 'Fritzoid', value: 'fritzoid' },
    { label: 'Fritz Field', value: 'fritzfield' },
  ];

  // Human labels for the generator's own mode names — the values must stay the generator's strings so
  // a design can be moved between this app, the browser tool and the deck library by name.
  var PATTERN_LABELS = {
    'truchet': 'Truchet', 'pinwheel': 'Pinwheel', 'diamond': 'Diamond', 'herringbone': 'Herringbone',
    'quilt': 'Quilt', 'scatter': 'Scatter', 'radial': 'Radial', 'wave': 'Wave',
    'ov-stack': 'Stack', 'ov-fan': 'Fan', 'ov-nest': 'Nest', 'ov-mirror': 'Mirror', 'ov-cross': 'Cross',
    'ov-shingle': 'Shingle', 'ov-weave': 'Weave', 'ov-cascade': 'Cascade', 'ov-kaleidoscope': 'Kaleidoscope',
  };
  var PALETTE_LABELS = {
    'fritz': 'Fritz (3)', 'flarepop-only': 'Flarepop', 'wiretree-only': 'Wiretree',
    'coolsweep-only': 'Coolsweep', 'hotcatch': 'Hotcatch', 'suedejacket': 'Suedejacket', 'deepfield': 'Deepfield',
  };
  var ANIMATE_LABELS = { 'still': 'Still', 'pulse': 'Pulse', 'sweep': 'Sweep', 'ripple': 'Ripple' };

  function buildStylePicker() {
    renderChipRow(el('style-picker'), STYLES, State.style,
      function (s) { State.style = s; refresh(); buildStylePicker(); });
    renderChipRow(el('preset-picker'),
      [{ label: 'Subtle', value: 'subtle' }, { label: 'Standard', value: 'standard' }, { label: 'Bold', value: 'bold' }],
      State.preset,
      function (p) { State.preset = p; refresh(); buildStylePicker(); });
    buildFieldPickers();
  }

  // Pattern / Palette / Animation — only offered for Fritz Field, because they mean nothing to the
  // other styles ("only offer what works").
  // The procedural style is SKIPPED entirely when a video or image background is present (the composer
  // leaves the frame transparent and the media shows through), so offering its controls then would be
  // offering something that does nothing — hide the whole block instead. "Only offer what works."
  function syncProceduralVisibility() {
    var pc = el('procedural-controls');
    if (pc) pc.classList.toggle('hidden', !!(State.bgLoopId || State.bgVideoFile || State.bgImage));
    var fz = el('fritzoid-controls');
    if (fz && State.style !== 'fritzoid') fz.classList.add('hidden');
    var rb = el('ribbon-controls');
    if (rb && State.style !== 'ribbon') rb.classList.add('hidden');
  }

  var INT = function (v) { return parseInt(v, 10); };
  var FLT = function (v) { return parseFloat(v); };
  var N2 = function (v) { return Number(v).toFixed(2); };
  var PX = function (v) { return v + 'px'; };
  var STR = function (v) { return String(v); };

  // Wire a block of range sliders to State keys. Each descriptor is
  // [inputId, stateKey, format, parse, presetField?] — a descriptor with a presetField is an
  // INTENSITY knob: it tracks the resolved preset (so moving Intensity visibly moves it) right up
  // until the user drags it, after which their value sticks. Design knobs have no presetField and
  // simply hold. This is the "only offer what works, always a way back" rule applied to sliders:
  // a control that silently overrode the preset it sits under would misreport the live state.
  function wireSliders(descriptors, presetValues) {
    descriptors.forEach(function (d) {
      var input = el(d[0]), out = el(d[0] + '-val');
      if (!input) return;
      if (!input.__wired) {
        input.__wired = true;
        input.addEventListener('input', function () {
          input.__touched = true;
          State[d[1]] = d[3](input.value);
          if (out) out.textContent = d[2](State[d[1]]);
          scheduleRefresh();
        });
      }
      if (d[4] && !input.__touched && presetValues && presetValues[d[4]] != null) State[d[1]] = presetValues[d[4]];
      input.value = String(State[d[1]]);
      if (out) out.textContent = d[2](State[d[1]]);
    });
  }

  function resolvedPreset(style) {
    var MP = window.MOTION_PRESETS;
    if (!MP || typeof MP.resolvePreset !== 'function') return {};
    return MP.resolvePreset(style, State.preset, State.ground === 'halo' ? 'halo' : 'carbon') || {};
  }

  // Fritzoid's own controls. It is locked ink-only (Jon, 07-29: the coloured glitch was removed), so
  // it gets no palette. Rebuilt 2026-08-05 with the style itself: the knobs are how many marks, how
  // big, how many slices cut them, how heavily they are chipped and how often they reconfigure.
  // NOT offered, on purpose: the triangle's angle, right edge, base and apex keepout. Those are the
  // canon's construction ported from the generator — a slider on them would just be a slider for
  // drawing the mark wrong.
  function buildFritzoidControls() {
    var wrap = el('fritzoid-controls');
    if (!wrap) return;
    wrap.classList.toggle('hidden', State.style !== 'fritzoid');
    if (State.style !== 'fritzoid') return;
    // The weight slider tracks the preset while the mark is INK, but a brand palette needs a very
    // different default: colour at ink alpha is a pastel wash, which is the opposite of why you'd
    // pick colour. So when a palette is in play the tracked value comes from COLOUR_WEIGHT instead —
    // still overridable, and still snapping back if you return to ink.
    var COLOUR_WEIGHT = 0.55;
    var pre = resolvedPreset('fritzoid');
    if (State.fzPalette !== 'ink') pre = Object.assign({}, pre, { inkAlpha: COLOUR_WEIGHT });
    wireSliders([
      ['fz-marks', 'fzMarks', STR, INT],
      ['fz-size', 'fzSize', N2, FLT],
      ['fz-slices', 'fzSlices', function (v) { return Number(v) === 0 ? 'auto' : String(v); }, INT],
      ['fz-steps', 'fzSteps', STR, INT, 'steps'],
      ['fz-chip', 'fzChip', N2, FLT],
      ['fz-ink', 'fzInk', N2, FLT, 'inkAlpha'],
    ], pre);

    var FZ = window.INTERCEPT_FRITZOID;
    renderChipRow(el('fz-palette-picker'),
      (FZ ? FZ.PALETTE_KEYS : ['ink']).map(function (v) { return { label: v === 'ink' ? 'Ink' : (PALETTE_LABELS[v] || v), value: v }; }),
      State.fzPalette,
      function (v) { State.fzPalette = v; refresh(); buildFritzoidControls(); });

    renderChipRow(el('fz-fill-picker'),
      [{ label: 'Solid', value: 'solid' }, { label: 'Pulse pattern', value: 'pattern' }],
      State.fzFill,
      function (v) { State.fzFill = v; refresh(); buildFritzoidControls(); });

    // Pattern-only controls stay hidden on a solid fill — offering "pattern on: mark/chips" when
    // there is no pattern would be offering something that does nothing.
    var pw = el('fz-pattern-controls');
    if (pw) pw.classList.toggle('hidden', State.fzFill !== 'pattern');
    if (State.fzFill !== 'pattern') return;

    renderChipRow(el('fz-target-picker'),
      [{ label: 'Mark', value: 'mark' }, { label: 'Chips', value: 'chips' }, { label: 'Both', value: 'both' }],
      State.fzTarget,
      function (v) { State.fzTarget = v; refresh(); buildFritzoidControls(); });

    var FF = window.INTERCEPT_FRITZFIELD;
    if (FF) {
      renderChipRow(el('fz-pattern-picker'),
        FF.PATTERNS.map(function (v) { return { label: PATTERN_LABELS[v] || v, value: v }; }),
        State.fzPattern,
        function (v) { State.fzPattern = v; refresh(); buildFritzoidControls(); });
    }
  }

  // Ribbon's controls — the shape of the crawl.
  function buildRibbonControls() {
    var wrap = el('ribbon-controls');
    if (!wrap) return;
    wrap.classList.toggle('hidden', State.style !== 'ribbon');
    if (State.style !== 'ribbon') return;
    wireSliders([
      ['rb-count', 'rbCount', STR, INT],
      ['rb-body', 'rbBody', N2, FLT],
      ['rb-width', 'rbWidth', PX, INT],
      ['rb-travel', 'rbTravel', function (v) { return v + (Number(v) === 1 ? ' lap' : ' laps'); }, INT],
      ['rb-slither', 'rbSlither', N2, FLT, 'slither'],
      ['rb-twist', 'rbTwist', N2, FLT, 'twist'],
      ['rb-scale', 'rbScale', N2, FLT],
      ['rb-tilt', 'rbTilt', N2, FLT],
      ['rb-wind', 'rbWind', N2, FLT],
      ['rb-glide', 'rbGlide', function (v) { return Number(v) === 0 ? 'off' : Number(v).toFixed(2); }, FLT],
      ['rb-x', 'rbX', N2, FLT],
      ['rb-y', 'rbY', N2, FLT],
    ], resolvedPreset('ribbon'));

    // LAP TIME — the ribbons' real speed control, and the only one that can go slower rather than
    // faster. `travel` has to be a whole number of laps (the loop seam depends on the head coming
    // home), so it bottoms out at one lap and cannot express "slower"; lap time has no floor. It
    // writes the composition's loopSec through the SAME setLoopSec path the Transitions panel uses,
    // and records the override so buildSpec re-applies it — one value, two places to reach it, no
    // second source of truth. syncTransitionControls() then pulls that panel back into agreement.
    var lt = el('rb-laptime'), ltOut = el('rb-laptime-val');
    if (lt) {
      if (!lt.__wired) {
        lt.__wired = true;
        lt.addEventListener('input', function () {
          var sec = parseFloat(lt.value);
          State.timingOverrides.loopSec = sec;
          setLoopSec(sec);
          if (ltOut) ltOut.textContent = sec.toFixed(1) + 's';
          syncTransitionControls();
        });
      }
      var liveLoop = (State.spec && State.spec.motion && State.spec.motion.speed && State.spec.motion.speed.loopSec)
        || State.timingOverrides.loopSec || 8;
      lt.value = String(liveLoop);
      if (ltOut) ltOut.textContent = Number(liveLoop).toFixed(1) + 's';
    }

    // Nine-point placement, so "put them in a corner" is one click rather than two slider hunts. The
    // chips WRITE the X/Y sliders (they are the same value), so the panel never disagrees with itself.
    var PLACES = [
      ['↖', 0.16, 0.16], ['↑', 0.5, 0.16], ['↗', 0.84, 0.16],
      ['←', 0.16, 0.5], ['·', 0.5, 0.5], ['→', 0.84, 0.5],
      ['↙', 0.16, 0.84], ['↓', 0.5, 0.84], ['↘', 0.84, 0.84],
    ];
    var here = PLACES.filter(function (p) {
      return Math.abs(p[1] - State.rbX) < 0.02 && Math.abs(p[2] - State.rbY) < 0.02;
    })[0];
    renderChipRow(el('rb-place-picker'),
      PLACES.map(function (p) { return { label: p[0], value: p[0] }; }),
      here ? here[0] : null,
      function (v) {
        var p = PLACES.filter(function (q) { return q[0] === v; })[0];
        State.rbX = p[1]; State.rbY = p[2];
        refresh(); buildRibbonControls();
      });
  }

  function buildFieldPickers() {
    syncProceduralVisibility();
    buildFritzoidControls();
    buildRibbonControls();
    var wrap = el('field-controls');
    if (!wrap) return;
    var on = State.style === 'fritzfield';
    wrap.classList.toggle('hidden', !on);
    if (!on) return;
    var FF = window.INTERCEPT_FRITZFIELD;
    if (!FF) return;
    renderChipRow(el('pattern-picker'),
      FF.PATTERNS.map(function (v) { return { label: PATTERN_LABELS[v] || v, value: v }; }),
      State.pattern,
      function (v) { State.pattern = v; refresh(); buildFieldPickers(); });
    renderChipRow(el('palette-picker'),
      FF.PALETTE_KEYS.map(function (v) { return { label: PALETTE_LABELS[v] || v, value: v }; }),
      State.palette,
      function (v) { State.palette = v; refresh(); buildFieldPickers(); });
    renderChipRow(el('animate-picker'),
      FF.ANIMATIONS.map(function (v) { return { label: ANIMATE_LABELS[v] || v, value: v }; }),
      State.animate,
      function (v) { State.animate = v; refresh(); buildFieldPickers(); });
    var cell = el('field-cell'), cellOut = el('field-cell-val');
    if (cell && !cell.__wired) {
      cell.__wired = true;
      cell.addEventListener('input', function () {
        State.fieldCell = parseInt(cell.value, 10) || 10;
        if (cellOut) cellOut.textContent = State.fieldCell + 'px';
        scheduleRefresh();
      });
    }
    if (cell) cell.value = String(State.fieldCell);
    if (cellOut) cellOut.textContent = State.fieldCell + 'px';
  }

  function buildBgPicker() {
    var items = [{ label: 'None (procedural)', value: '__none__' }];
    BG_MANIFEST.loops.forEach(function (l) { items.push({ label: l.label, value: l.id }); });
    items.push({ label: 'Video…', value: '__video__' });
    items.push({ label: 'Image…', value: '__image__' });
    var active = State.bgImage ? '__image__' : (State.bgVideoFile ? '__video__' : (State.bgLoopId || '__none__'));
    renderChipRow(el('bg-picker'), items, active, function (v) {
      // The two upload chips only open the picker; state changes once a file is actually chosen.
      if (v === '__image__') { el('bg-image-file').click(); return; }
      if (v === '__video__') { el('bg-video-file').click(); return; }
      State.bgImage = null;
      releaseVideoFile();
      State.bgLoopId = (v === '__none__') ? null : v;
      var loop = BG_MANIFEST.loops.filter(function (l) { return l.id === State.bgLoopId; })[0];
      if (loop && loop.defaultOpacity != null) { State.bgOpacity = loop.defaultOpacity; el('bg-opacity').value = String(loop.defaultOpacity); el('bg-opacity-val').textContent = loop.defaultOpacity.toFixed(2); }
      el('bg-opacity-wrap').classList.toggle('hidden', !State.bgLoopId);
      el('bg-image-controls').classList.add('hidden');
      refresh();
      buildBgPicker(); // reflect active state
    });
    syncProceduralVisibility();
  }

  // Object URLs for an uploaded loop are revoked when it is replaced or cleared — without this every
  // upload leaks the whole file for the life of the page.
  function releaseVideoFile() {
    if (State.bgVideoFile && State.bgVideoFile.url) {
      try { URL.revokeObjectURL(State.bgVideoFile.url); } catch (e) {}
    }
    State.bgVideoFile = null;
    var st = el('bg-media-status'); if (st) st.textContent = '';
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
        file.disabled = State.noPhoto;
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
        cb.disabled = State.noPhoto;
        cb.addEventListener('change', function () { State.matteOn = cb.checked; applyPhoto(); });
        toggleRow.appendChild(cb);
        toggleRow.appendChild(document.createTextNode(' Remove background (person cutout)'));
        field.appendChild(toggleRow);
        // "No photo" is an explicit choice — distinct from "haven't uploaded one yet," which keeps
        // the template's placeholder showing. Checking it drops the photo layer entirely (buildSlots
        // sends slots.photo:null; expand() omits the layer); unchecking falls back to the placeholder.
        var noPhotoRow = document.createElement('label');
        noPhotoRow.className = 'matte-toggle';
        var noPhotoCb = document.createElement('input'); noPhotoCb.type = 'checkbox'; noPhotoCb.checked = State.noPhoto;
        noPhotoCb.addEventListener('change', function () {
          State.noPhoto = noPhotoCb.checked;
          file.disabled = State.noPhoto; cb.disabled = State.noPhoto;
          if (State.noPhoto) { State.photoOriginal = null; if (el('photo-status')) el('photo-status').textContent = ''; }
          refresh();
        });
        noPhotoRow.appendChild(noPhotoCb);
        noPhotoRow.appendChild(document.createTextNode(' No photo'));
        field.appendChild(noPhotoRow);
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
          ta.addEventListener('input', function () { maybeRefreshSlotControls(f.key, jctrls); });
          renderSlotControls(f.key, jctrls);
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
        ta2.addEventListener('input', function () {
          State.content[f.key] = ta2.value;
          maybeRefreshSlotControls(f.key, ctrls);
          scheduleRefresh();
        });
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

  // ---- per-line text colour + per-slot size --------------------------------------------------------
  //
  // PER-LINE COLOUR ONLY. State.colors[slot] is ALWAYS an array of (brand hex | null), one entry per
  // authored line — or the key is absent when every line is default. There is deliberately NO
  // whole-slot string form any more.
  //
  // That dual representation was the bug behind "a colour change happens on hard return": the render
  // layer (plates.html applyTextControls) gives the two shapes DIFFERENT meanings — a STRING colours the
  // entire slot element, an ARRAY colours line i and leaves unlisted lines at the template default. So
  // the instant a return flipped the stored shape, every line the string had been colouring silently
  // dropped back to default. One shape, one meaning, no flip.
  //
  // Splitting a line INHERITS the colour of the line it came out of, so pressing Enter never changes
  // what is already on screen.

  // Last known good line count per slot — used only to ride out a transient JSON parse failure while a
  // json slot (new-hire greeting / carousel beats) is mid-edit, so the rows don't churn.
  var lastLineCount = {};

  // The lines a slot's colour array indexes. Carousel `beats` is special: the render layer applies a
  // per-line array to EVERY beat, so the row count is the MAX line count across the beats (normally 1 —
  // one swatch that colours every beat). new-hire `greeting` is a 2-element array whose elements ARE its
  // two display lines. Everything else splits its textarea value on \n.
  function slotLineCount(slot) {
    var v = State.content[slot];
    var arr = null;
    if (Array.isArray(v)) arr = v;
    else if (typeof v === 'string' && v.charAt(0) === '[') {
      try { var parsed = JSON.parse(v); if (Array.isArray(parsed)) arr = parsed; }
      catch (e) { return lastLineCount[slot] || 1; }   // mid-edit JSON: hold the current row count
    }
    var n;
    if (arr && slot === 'beats') {
      n = 1;
      arr.forEach(function (b) { n = Math.max(n, String(b == null ? '' : b).split('\n').length); });
    } else if (arr) {
      n = Math.max(1, arr.length);
    } else {
      n = Math.max(1, String(v == null ? '' : v).split('\n').length);
    }
    lastLineCount[slot] = n;
    return n;
  }

  // Normalise the stored colours to exactly n entries. Migrates a legacy whole-slot string by giving
  // EVERY line that colour (so the switch to arrays is visually invisible); grows by inheriting the line
  // above (a split keeps its colour); truncates on shrink.
  function colorsFor(slot, n) {
    var c = State.colors[slot];
    var arr;
    if (Array.isArray(c)) arr = c.slice();
    else if (typeof c === 'string' && c) { arr = []; for (var i = 0; i < n; i++) arr.push(c); }
    else arr = [];
    while (arr.length < n) arr.push(arr.length ? arr[arr.length - 1] : null);
    arr.length = n;
    return arr;
  }

  function storeColors(slot, arr) {
    var any = arr.some(function (x) { return !!x; });
    if (any) State.colors[slot] = arr.slice(); else delete State.colors[slot];
  }

  function markActiveSwatch(sw, hex) {
    Array.prototype.forEach.call(sw.children, function (b) {
      b.classList.toggle('active', b.getAttribute('data-hex') === (hex || ''));
    });
  }

  // One row of brand-palette swatches (first = "Default"). onPick receives (hex|null, swatchContainer)
  // so the caller can repaint the active state IN PLACE rather than rebuilding the row — rebuilding on
  // every click is what made the picker feel wonky (it dropped hover/focus mid-interaction).
  function swatchRow(labelText, activeHex, onPick) {
    var pal = window.SOCIAL_PALETTE || { swatches: [] };
    var row = document.createElement('div');
    row.className = 'slot-controls';
    if (labelText) {
      var lb = document.createElement('span');
      lb.className = 'line-label';
      lb.textContent = labelText;
      row.appendChild(lb);
    }
    var sw = document.createElement('div'); sw.className = 'swatches';
    function add(hex, label, extraClass) {
      var b = document.createElement('button');
      b.type = 'button';
      b.className = 'swatch' + (extraClass ? ' ' + extraClass : '');
      if (hex) b.style.background = hex;
      b.title = label;
      b.setAttribute('data-hex', hex || '');
      b.addEventListener('click', function () { onPick(hex || null, sw); });
      sw.appendChild(b);
    }
    add('', 'Default', 'default');
    pal.swatches.forEach(function (sc) { add(sc.hex, sc.label); });
    markActiveSwatch(sw, activeHex);
    row.appendChild(sw);
    return row;
  }

  // A compact per-slot size multiplier ("A" + slider). Size stays PER SLOT — only colour is per line.
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

  // Build one swatch row per line, plus the slot's size row. Also PERSISTS the normalised array: if a
  // hard return grew the line count, the stored array has to grow with it before the next render, or the
  // new line would render at the default and the colour would appear to change.
  function renderSlotControls(slot, container) {
    var n = slotLineCount(slot);
    var arr = colorsFor(slot, n);
    storeColors(slot, arr);
    container.innerHTML = '';
    container.setAttribute('data-lines', String(n));
    for (var i = 0; i < n; i++) {
      container.appendChild((function (idx) {
        return swatchRow('L' + (idx + 1), arr[idx] || '', function (hex, sw) {
          arr[idx] = hex;
          storeColors(slot, arr);
          markActiveSwatch(sw, hex);
          scheduleRefresh();
        });
      })(i));
    }
    var srow = document.createElement('div'); srow.className = 'slot-controls';
    var slb = document.createElement('span'); slb.className = 'line-label'; slb.textContent = 'size';
    srow.appendChild(slb);
    srow.appendChild(sizeControl(slot));
    container.appendChild(srow);
  }

  // Rebuild a slot's rows ONLY when its line count changed. Rebuilding on every keystroke is the other
  // half of the wonkiness — it threw away the swatch DOM (and any hover/active state) while typing.
  function maybeRefreshSlotControls(slot, container) {
    var n = slotLineCount(slot);
    if (container.getAttribute('data-lines') === String(n)) return;
    renderSlotControls(slot, container);
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

  // Module-default content for a template (the same seeding selectTemplate() has always done),
  // extracted so the Carousel PDF frame editor (editFrame(), below) can re-seed a frame's content
  // when its per-frame template changes, without duplicating this loop.
  function defaultContentFor(name) {
    var t = window.SOCIAL_TEMPLATES.get(name);
    var content = {};
    t.fields.forEach(function (f) {
      if (f.type === 'json') { try { content[f.key] = JSON.parse(f.def); } catch (e) { content[f.key] = f.def; } }
      else if (f.key !== 'photo') content[f.key] = f.def;
    });
    return content;
  }

  function selectTemplate(name) {
    State.templateName = name;
    var t = window.SOCIAL_TEMPLATES.get(name);
    // Seed content + ground from the module defaults (each field's own default is applied in build).
    State.content = defaultContentFor(name);
    State.colors = {};
    State.sizes = {};
    State.photoOriginal = null;
    State.noPhoto = false;
    State.matteOn = false;
    // A different template has a different timing SHAPE (odometer vs wordReveal vs beatCycle vs pulse),
    // so drop the per-move overrides — a stale one must not ride onto the new template. loopSec is
    // shared by all six, so it survives the switch.
    State.timingOverrides = { wordReveal: {}, odometer: {}, beatCycle: {}, pulse: {}, loopSec: State.timingOverrides.loopSec };
    State.ground = t.defaultGround || 'halo';
    buildTemplatePicker();
    buildGroundPicker();
    buildContentFields();
    syncEditingFrame();
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
    if (State.noPhoto) slots.photo = null;
    else if (State.content.photo) slots.photo = State.content.photo;
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
    var darkText = State.bgLoopId || State.bgVideoFile || (State.bgImage && State.bgImage.ink === 'light');
    if (darkText) { opts.theme = 'dark'; slots.theme = 'dark'; }
    // Fritz Field design choices ride motion as style-specific passthrough fields (the same mechanism
    // fritzoid's tileBase/inkAlpha use), so expand() needs no per-style knowledge.
    var spec = safeExpand(State.templateName, slots, opts);
    if (State.style === 'fritzfield') {
      spec.motion.pattern = State.pattern;
      spec.motion.palette = State.palette;
      spec.motion.animate = State.animate;
      // Explicit user choice — set AFTER expand so it wins over the preset's own `cell`.
      spec.motion.cell = State.fieldCell;
    }
    if (State.style === 'fritzoid') {
      spec.motion.marks = State.fzMarks;
      spec.motion.markSize = State.fzSize;
      spec.motion.slices = State.fzSlices;
      spec.motion.steps = State.fzSteps;
      spec.motion.chip = State.fzChip;
      spec.motion.inkAlpha = State.fzInk;
      spec.motion.palette = State.fzPalette;
      spec.motion.fill = State.fzFill;
      spec.motion.fillTarget = State.fzTarget;
      spec.motion.fillPattern = State.fzPattern;
    }
    if (State.style === 'ribbon') {
      spec.motion.ribbons = State.rbCount;
      spec.motion.body = State.rbBody;
      spec.motion.width = State.rbWidth;
      spec.motion.travel = State.rbTravel;
      spec.motion.slither = State.rbSlither;
      spec.motion.twist = State.rbTwist;
      spec.motion.scale = State.rbScale;
      spec.motion.tilt = State.rbTilt;
      spec.motion.wind = State.rbWind;
      spec.motion.glide = State.rbGlide;
      spec.motion.originX = State.rbX;
      spec.motion.originY = State.rbY;
    }
    if (State.bgVideoFile) spec.backgroundVideo = { src: State.bgVideoFile.url, opacity: State.bgOpacity };
    if (State.bgLoopId) spec.backgroundVideo = { loop: State.bgLoopId, opacity: State.bgOpacity };
    if (State.bgImage) spec.backgroundImage = { src: State.bgImage.url, fit: State.bgImage.fit || 'cover' };
    applyTimingOverrides(spec);
    return spec;
  }

  // ---- Carousel PDF: frame management ------------------------------------------------------------
  //
  // A "frame" is a { template, content, colors, sizes } snapshot — everything buildSpec() reads that
  // ISN'T shared canvas/background/style state. Building a spec for a frame reuses buildSpec() itself
  // (rather than re-implementing its ~60 lines of style/background/timing wiring): swap State's four
  // per-template fields to the frame's values, call buildSpec(), swap them back. buildSpec() is fully
  // synchronous, so this is safe with no risk of another caller observing the swapped-in values.

  function cloneJSON(v) { return v == null ? v : JSON.parse(JSON.stringify(v)); }

  function buildSpecForFrame(frame) {
    var savedName = State.templateName, savedContent = State.content;
    var savedColors = State.colors, savedSizes = State.sizes;
    State.templateName = frame.template;
    State.content = frame.content;
    State.colors = frame.colors || {};
    State.sizes = frame.sizes || {};
    var spec;
    try { spec = buildSpec(); }
    finally {
      State.templateName = savedName; State.content = savedContent;
      State.colors = savedColors; State.sizes = savedSizes;
    }
    return spec;
  }

  // Mirrors the live Template/Content panels back into the frame being edited (if any) — the single
  // integration point every content/template change passes through (called from refresh(), which
  // scheduleRefresh() and every picker's onClick both funnel into).
  function syncEditingFrame() {
    var i = State.editingFrameIndex;
    if (i == null) return;
    if (!State.frames[i]) { State.editingFrameIndex = null; return; }
    State.frames[i] = {
      template: State.templateName,
      content: cloneJSON(State.content),
      colors: cloneJSON(State.colors),
      sizes: cloneJSON(State.sizes),
    };
    buildFrameList();
  }

  function frameSummary(frame) {
    var t = window.SOCIAL_TEMPLATES.get(frame.template);
    var label = (t && t.label) || frame.template;
    var firstKey = t && t.fields && t.fields[0] && t.fields[0].key;
    var rawVal = firstKey ? frame.content[firstKey] : '';
    var text = Array.isArray(rawVal) ? rawVal.join(' ') : String(rawVal == null ? '' : rawVal);
    text = text.replace(/\n/g, ' ').trim().slice(0, 44);
    return label + (text ? ' — ' + text : '');
  }

  function btnEl(label, onClick, extraClass) {
    var b = document.createElement('button');
    b.type = 'button'; b.className = 'btn tiny' + (extraClass ? ' ' + extraClass : '');
    b.textContent = label;
    b.addEventListener('click', onClick);
    return b;
  }

  function buildFrameEditBanner() {
    var banner = el('frame-edit-banner');
    banner.innerHTML = '';
    if (State.editingFrameIndex == null) { banner.classList.add('hidden'); return; }
    banner.classList.remove('hidden');
    var span = document.createElement('span');
    span.textContent = 'Editing Frame ' + (State.editingFrameIndex + 1) + ' — Template/Content changes above save into it.';
    banner.appendChild(span);
    banner.appendChild(btnEl('Done', function () {
      State.editingFrameIndex = null;
      buildFrameEditBanner();
      buildFrameList();
    }));
  }

  function buildFrameList() {
    var wrap = el('frame-list');
    wrap.innerHTML = '';
    State.frames.forEach(function (frame, i) {
      var row = document.createElement('div');
      row.className = 'frame-row' + (State.editingFrameIndex === i ? ' active' : '');
      var num = document.createElement('span'); num.className = 'frame-num'; num.textContent = String(i + 1);
      var label = document.createElement('span'); label.className = 'frame-label'; label.textContent = frameSummary(frame);
      row.appendChild(num);
      row.appendChild(label);
      row.appendChild(btnEl('Edit', function () { editFrame(i); }));
      var up = btnEl('↑', function () { moveFrame(i, -1); }); up.disabled = i === 0;
      var down = btnEl('↓', function () { moveFrame(i, 1); }); down.disabled = i === State.frames.length - 1;
      row.appendChild(up);
      row.appendChild(down);
      row.appendChild(btnEl('Remove', function () { removeFrame(i); }));
      wrap.appendChild(row);
    });
    el('export-pdf-carousel').disabled = State.frames.length === 0 || !window.PDF_EXPORT.isSupported();
  }

  // Snapshot whatever the Template/Content panels currently hold as a new frame — the low-friction
  // path: configure a post as usual, add it, tweak the template/content for the next slide, add
  // again. Mirrors exactly how the prior one-off carousel PDF was actually built by hand.
  function addFrameFromCurrent() {
    State.frames.push({
      template: State.templateName,
      content: cloneJSON(State.content),
      colors: cloneJSON(State.colors),
      sizes: cloneJSON(State.sizes),
    });
    buildFrameList();
  }

  // Load a saved frame back into the live Template/Content panels for editing. Deliberately reuses
  // those SAME panels (rather than a parallel per-frame field UI) — one tested implementation of
  // text/textarea/json/photo fields + per-line colour/size, not two to keep in sync.
  function editFrame(i) {
    var frame = State.frames[i];
    if (!frame) return;
    State.templateName = frame.template;
    State.content = cloneJSON(frame.content);
    State.colors = cloneJSON(frame.colors || {});
    State.sizes = cloneJSON(frame.sizes || {});
    State.photoOriginal = null; State.matteOn = false; State.noPhoto = false;
    State.editingFrameIndex = i;
    buildTemplatePicker();
    buildContentFields();
    buildFrameEditBanner();
    buildFrameList();
    refresh();
  }

  function moveFrame(i, delta) {
    var j = i + delta;
    if (j < 0 || j >= State.frames.length) return;
    var tmp = State.frames[i]; State.frames[i] = State.frames[j]; State.frames[j] = tmp;
    if (State.editingFrameIndex === i) State.editingFrameIndex = j;
    else if (State.editingFrameIndex === j) State.editingFrameIndex = i;
    buildFrameList();
  }

  function removeFrame(i) {
    State.frames.splice(i, 1);
    if (State.editingFrameIndex === i) State.editingFrameIndex = null;
    else if (State.editingFrameIndex != null && State.editingFrameIndex > i) State.editingFrameIndex--;
    buildFrameEditBanner();
    buildFrameList();
  }

  // ---- transitions (timing) --------------------------------------------------------------------
  //
  // Per-template loop-safe TIMING sliders: loop duration for every template, plus the per-move timing
  // the current spec actually carries (quote wordReveal, carousel beatCycle,
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
    // Max raised 16 -> 40s (2026-08-05). Loop duration is the ONLY continuous speed control the
    // procedural backgrounds have — a ribbon's lap count has to stay a whole number for the seam to
    // close — so a 16s ceiling was also a floor on how slow a background could move. The ribbon panel
    // drives this same value through setLoopSec, so the two stay in step.
    list.push({ id: 'tr-loopsec', label: 'Loop duration', min: 2, max: 40, step: 0.5, value: loopSec, kind: 'loopSec', fmt: function (v) { return v.toFixed(1) + 's'; } });

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
        list.push({ id: 'tr-cta-amp', label: 'CTA pulse amount', min: 0, max: 0.3, step: 0.01, value: cta.scaleAmp != null ? cta.scaleAmp : 0.05, kind: 'pulse', member: 'cta', field: 'scaleAmp' });
        list.push({ id: 'tr-cta-harm', label: 'CTA pulses / loop', min: 1, max: 6, step: 1, value: cta.harmonic != null ? cta.harmonic : 2, kind: 'pulse', member: 'cta', field: 'harmonic' });
      }
      if (date) {
        list.push({ id: 'tr-date-drift', label: 'Date tick', min: 0, max: 24, step: 1, value: date.driftY != null ? date.driftY : 6, kind: 'pulse', member: 'date', field: 'driftY' });
        list.push({ id: 'tr-date-harm', label: 'Date ticks / loop', min: 1, max: 6, step: 1, value: date.harmonic != null ? date.harmonic : 3, kind: 'pulse', member: 'date', field: 'harmonic' });
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
    // Every structural/content change funnels through here (directly or via scheduleRefresh), so this
    // is the one place that reliably mirrors a live edit back into the Carousel PDF frame being
    // edited, if any (see State.editingFrameIndex / syncEditingFrame()).
    syncEditingFrame();
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
      // Two sources: a BUNDLED loop (by id, resolved to assets/backgrounds/<id>.mp4) or a user UPLOAD
      // (an object URL carried on spec.backgroundVideo.src). Keyed by the same data-loop attribute so
      // the element is only re-loaded when the source actually changes.
      var key = spec.backgroundVideo.src || spec.backgroundVideo.loop;
      var wanted = spec.backgroundVideo.src || ('assets/backgrounds/' + spec.backgroundVideo.loop + '.mp4');
      if (v.getAttribute('data-loop') !== key) {
        v.src = wanted; v.setAttribute('data-loop', key);
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

  // ---- PDF export (lossless; core/pdf-export.js) --------------------------------------------------
  //
  // Single-frame "Export PDF" — the current design (whatever's live in the preview) as a 1-page PDF.
  // Independent of the Carousel PDF below: this always exports the free-standing design in the main
  // panels, never the frames list.
  function doExportPdf() {
    if (!window.PDF_EXPORT.isSupported()) {
      setStatus('This browser can’t export a lossless PDF (no CompressionStream — try a recent Chrome/Edge/Firefox/Safari).', 'err');
      return;
    }
    var btn = el('export-pdf'); btn.disabled = true;
    setStatus('Rendering PDF…');
    withPausedPreview(function () {
      return ensureBgReady().then(function () {
        return window.PDF_EXPORT.renderFrame(State.templateName, State.spec, exportOpts());
      }).then(function (canvas) {
        var rgb = window.PDF_EXPORT.canvasToRGB(canvas);
        return window.PDF_EXPORT.buildPdf([{ width: canvas.width, height: canvas.height, rgb: rgb }]);
      }).then(function (blob) { download(blob, filename('pdf')); setStatus('Saved ' + filename('pdf'), 'ok'); });
    }).catch(function (e) { setStatus('PDF failed: ' + (e && e.message), 'err'); console.error(e); })
      .finally(function () { btn.disabled = false; });
  }

  function carouselFilename() {
    return ['intercept-carousel', State.ratio, State.bgLoopId ? State.bgLoopId : State.style].join('-') + '.pdf';
  }

  // Carousel PDF — every frame in State.frames, in order, one PDF page each, sharing the CURRENT
  // canvas/background/style/logo settings (only template+content vary per frame; see
  // buildSpecForFrame()). ensureBgReady() only needs to run once: every frame's background comes from
  // the same shared <video>/<img> element.
  function doExportPdfCarousel() {
    if (!window.PDF_EXPORT.isSupported()) {
      setStatus('This browser can’t export a lossless PDF (no CompressionStream — try a recent Chrome/Edge/Firefox/Safari).', 'err');
      return;
    }
    if (!State.frames.length) { setStatus('Add at least one frame first.', 'err'); return; }
    var btn = el('export-pdf-carousel'); btn.disabled = true;
    var progress = el('pdf-progress'); progress.classList.remove('hidden'); progress.value = 0;
    setStatus('Rendering carousel PDF (0/' + State.frames.length + ')…');
    var opts = exportOpts();
    var frameList = State.frames.slice();          // snapshot: unaffected by edits mid-export
    withPausedPreview(function () {
      return ensureBgReady().then(function () {
        var pages = [];
        function next(i) {
          if (i >= frameList.length) return Promise.resolve();
          var spec = buildSpecForFrame(frameList[i]);
          return window.PDF_EXPORT.renderFrame(frameList[i].template, spec, opts).then(function (canvas) {
            pages.push({ width: canvas.width, height: canvas.height, rgb: window.PDF_EXPORT.canvasToRGB(canvas) });
            progress.value = (i + 1) / frameList.length;
            setStatus('Rendering carousel PDF (' + (i + 1) + '/' + frameList.length + ')…');
            return next(i + 1);
          });
        }
        return next(0).then(function () { return window.PDF_EXPORT.buildPdf(pages); });
      }).then(function (blob) {
        var name = carouselFilename();
        download(blob, name);
        setStatus('Saved ' + name + ' (' + frameList.length + ' frames)', 'ok');
      });
    }).catch(function (e) { setStatus('Carousel PDF failed: ' + (e && e.message), 'err'); console.error(e); })
      .finally(function () { btn.disabled = false; progress.classList.add('hidden'); });
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
    el('export-pdf').addEventListener('click', doExportPdf);
    el('frame-add').addEventListener('click', addFrameFromCurrent);
    el('export-pdf-carousel').addEventListener('click', doExportPdfCarousel);
    buildFrameList();
    buildFrameEditBanner();
    if (!window.PDF_EXPORT.isSupported()) {
      el('export-pdf').disabled = true;
      el('export-pdf-carousel').disabled = true;
    }

    el('bg-video-file').addEventListener('change', function () {
      var f = this.files && this.files[0]; this.value = '';
      if (!f) return;
      releaseVideoFile();
      State.bgVideoFile = { url: URL.createObjectURL(f), name: f.name };
      State.bgLoopId = null;
      State.bgImage = null;
      el('bg-opacity-wrap').classList.remove('hidden');   // an uploaded loop takes the same opacity control
      el('bg-image-controls').classList.add('hidden');
      var st = el('bg-media-status');
      if (st) st.textContent = f.name + ' · ' + (f.size / 1e6).toFixed(1) + ' MB';
      buildBgPicker();
      refresh();
    });

    // Disclosure sections. Open state persists per section so the panel comes back the way it was left.
    Array.prototype.forEach.call(document.querySelectorAll('.sec-head'), function (h) {
      var sec = h.parentNode, key = 'sb.sec.' + sec.getAttribute('data-sec');
      var stored = null;
      try { stored = localStorage.getItem(key); } catch (e) {}
      if (stored !== null) h.setAttribute('aria-expanded', stored);
      sec.classList.toggle('collapsed', h.getAttribute('aria-expanded') !== 'true');
      h.addEventListener('click', function () {
        var open = h.getAttribute('aria-expanded') !== 'true';
        h.setAttribute('aria-expanded', open ? 'true' : 'false');
        sec.classList.toggle('collapsed', !open);
        try { localStorage.setItem(key, open ? 'true' : 'false'); } catch (e) {}
      });
    });

    el('bg-image-file').addEventListener('change', function () {
      var f = this.files && this.files[0]; if (!f) return;
      var reader = new FileReader();
      reader.onload = function () {
        State.bgImage = { url: reader.result, fit: 'cover', ink: 'dark' };
        State.bgLoopId = null;
        releaseVideoFile();
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
