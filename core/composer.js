/* Social Composer — spec-driven frame renderer shared by the node render core and the browser
 * preview. UMD: sets globalThis.SOCIAL_COMPOSER in the browser, module.exports in Node.
 * Depends on engine.js (INTERCEPT_TEAMS) — load it first.
 */
(function (root, factory) {
  const E = (typeof module !== 'undefined' && module.exports) ? require('./engine.js') : root.INTERCEPT_TEAMS;
  const api = factory(E);
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.SOCIAL_COMPOSER = api;
})(typeof self !== 'undefined' ? self : globalThis, function (E) {
  // Proven "dense complete cluster" defaults (New Hire — Jeff Lewis render.cjs CONFIGS[0]).
  // Client rule: dense COMPLETE clusters, tight spiral, saturated stroke — NO thin grey wisps.
  const DEFAULT_MOTION = {
    seed: 11,
    modes: ['flarepop', 'coolsweep'],
    strings: 2,
    cluster: { wan: 175, open: 11, op: 0.11, wt: 1.10, r0: 70, depth: 380, flow: 0 },
    position: { biasX: 0.16, biasY: 0.12 },
    movement: { intensity: 0.85, tumble: 1, driftX: 1, driftY: 1, breathe: 1, spin: 0 },
    speed: { loopSec: 8 },
  };

  // Lazy dual require/root-global lookup (same pattern as this module's own UMD wrapper above),
  // resolved at CALL time rather than at module-load time — so browser pages that never load
  // motion-presets.js (the frozen preview/index.html, any legacy-spec-only page) keep working:
  // they only ever hit this path when a spec actually carries motion.style/motion.preset.
  function getMotionPresets() {
    if (typeof module !== 'undefined' && module.exports) return require('./motion-presets.js');
    const r = typeof self !== 'undefined' ? self : globalThis;
    return r.MOTION_PRESETS;
  }

  // The dispatched style name for a spec: style wins over engine when both are present; engine
  // (when present) is validated elsewhere to always equal 'keyline' — it never carries a style of
  // its own beyond that frozen legacy alias.
  function resolveStyle(spec) {
    const m = spec.motion || {};
    return m.style || 'keyline';
  }

  function mergeMotion(spec) {
    const m = spec.motion || {};

    // Legacy path — EXACTLY the original Phase 1/2 algorithm, untouched. This is what keeps
    // existing specs (no style/preset fields) byte-identical (scripts/verify-legacy-regression.cjs).
    if (m.style == null && m.preset == null) {
      return {
        seed: m.seed != null ? m.seed : DEFAULT_MOTION.seed,
        modes: m.modes || DEFAULT_MOTION.modes,
        strings: m.strings != null ? m.strings : DEFAULT_MOTION.strings,
        cluster: Object.assign({}, DEFAULT_MOTION.cluster, m.cluster),
        position: Object.assign({}, DEFAULT_MOTION.position, m.position),
        movement: Object.assign({}, DEFAULT_MOTION.movement, m.movement),
        speed: Object.assign({}, DEFAULT_MOTION.speed, m.speed),
      };
    }

    // Preset-resolution path: DEFAULT_MOTION < resolvePreset(style, preset, ground) < m's
    // explicit per-group fields.
    const style = m.style || 'keyline';
    const ground = spec.bg === 'carbon' ? 'carbon' : 'halo';
    const MP = getMotionPresets();
    const preset = (MP && typeof MP.resolvePreset === 'function')
      ? MP.resolvePreset(style, m.preset || 'standard', ground)
      : {};

    const merged = {
      seed: m.seed != null ? m.seed : (preset.seed != null ? preset.seed : DEFAULT_MOTION.seed),
      modes: m.modes || preset.modes || DEFAULT_MOTION.modes,
      strings: m.strings != null ? m.strings : (preset.strings != null ? preset.strings : DEFAULT_MOTION.strings),
      cluster: Object.assign({}, DEFAULT_MOTION.cluster, preset.cluster, m.cluster),
      position: Object.assign({}, DEFAULT_MOTION.position, preset.position, m.position),
      movement: Object.assign({}, DEFAULT_MOTION.movement, preset.movement, m.movement),
      speed: Object.assign({}, DEFAULT_MOTION.speed, preset.speed, m.speed),
    };

    // Style-specific scalar passthrough (e.g. fritzoid's tileBase/wavesPerLoop/inkAlpha): any
    // preset field not already part of the fixed keyline-shaped merge above
    // survives onto the merged object as-is, with an explicit spec.motion field of the same name
    // winning over the preset value. Keeps mergeMotion style-agnostic instead of hardcoding
    // fritzoid's field names here.
    const KNOWN = new Set(['seed', 'modes', 'strings', 'cluster', 'position', 'movement', 'speed', 'style', 'preset']);
    Object.keys(preset).forEach((key) => {
      if (KNOWN.has(key)) return;
      merged[key] = m[key] != null ? m[key] : preset[key];
    });
    Object.keys(m).forEach((key) => {
      if (KNOWN.has(key)) return;
      if (merged[key] === undefined) merged[key] = m[key];
    });

    return merged;
  }

  function ease(u) { return u <= 0 ? 0 : u >= 1 ? 1 : 0.5 - 0.5 * Math.cos(Math.PI * u); }

  // Lazy dual require/root-global lookup for the fritzoid renderer — same pattern as
  // getMotionPresets() above — resolved at CALL time so pages that never load fritzoid.js (any
  // keyline-only preview, the frozen preview/index.html) never need it.
  function getFritzoid() {
    if (typeof module !== 'undefined' && module.exports) {
      try { return require('./fritzoid.js'); }
      catch (e) { throw new Error('load src/fritzoid.js before composer.js'); }
    }
    const r = typeof self !== 'undefined' ? self : globalThis;
    if (!r.INTERCEPT_FRITZOID) throw new Error('load src/fritzoid.js before composer.js');
    return r.INTERCEPT_FRITZOID;
  }

  // The two procedural backgrounds added 2026-07-30. Loaded through the SAME lazy dual
  // require/root-global lookup as getFritzoid above, resolved at CALL time — so a page that only ever
  // renders keyline (the frozen preview/index.html, any legacy-spec-only page) never has to load them.
  // Each is background-only: they contribute no layer treatment, so drawLayers' keyline branch handles
  // their content exactly as it does today.
  const BG_STYLE_MODULES = {
    terrace: { file: './terrace.js', global: 'INTERCEPT_TERRACE', build: 'buildTerrace', draw: 'drawTerraceAt' },
    ashlar: { file: './ashlar.js', global: 'INTERCEPT_ASHLAR', build: 'buildAshlar', draw: 'drawAshlarAt' },
  };

  function getBgStyleModule(style) {
    const d = BG_STYLE_MODULES[style];
    if (!d) return null;
    if (typeof module !== 'undefined' && module.exports) {
      try { return require(d.file); }
      catch (e) { throw new Error(`load src/${style}.js before composer.js`); }
    }
    const r = typeof self !== 'undefined' ? self : globalThis;
    if (!r[d.global]) throw new Error(`load src/${style}.js before composer.js`);
    return r[d.global];
  }

  // Build the static look + geometry once per spec (independent of t).
  function buildComposer(spec) {
    const style = resolveStyle(spec);
    const m = mergeMotion(spec);

    // terrace / ashlar: background-only styles. buildX resolves everything seeded + time-independent
    // once; the merged motion `m` carries their scalars via mergeMotion's style-agnostic passthrough.
    if (BG_STYLE_MODULES[style]) {
      const d = BG_STYLE_MODULES[style];
      const Mod = getBgStyleModule(style);
      const state = Mod[d.build](spec, m);
      return { spec, m, style, state };
    }

    if (style === 'fritzoid') {
      const Fritzoid = getFritzoid();
      // Fritzoid is fully ink-first (Phase 16 / 16-01) — the scheduled colored glitch was removed,
      // so there is no glitch-avoidance wiring anymore: buildFritzoid reads only the merged motion
      // (seed/tileBase/wavesPerLoop/inkAlpha/speed) to build the ambient tile field + accent shimmer.
      const state = Fritzoid.buildFritzoid(spec, m);
      return { spec, m, style, state };
    }

    const rand = E.rng(m.seed >>> 0);
    const look = E.makeLook(rand, { bg: spec.bg || 'halo', modes: m.modes, strings: m.strings });
    look.P.wan = m.cluster.wan;
    look.P.depth = m.cluster.depth;
    // FLOW / LOOSENESS (Phase 16, NEWT-06) — additive keyline-ribbon knob. flow in [0,1] (default 0)
    // rides through the same cluster group as op/wt/open/r0; engine.buildOps sums a seeded, smooth,
    // low-frequency meander onto each ribbon's STATIC shape when flow>0 (never touching loop time, so
    // the seam is unaffected). flowSeed = the look's motion seed so the meander is deterministic +
    // per-string-distinct. flow===0 => buildOps skips the meander entirely => byte-identical (the
    // legacy-regression guarantee); the `|| 0` also keeps any spec whose cluster predates this field safe.
    look.P.flow = m.cluster.flow || 0;
    look.P.flowSeed = (m.seed >>> 0);
    look.STRINGS.forEach((s, i) => {
      s.open = m.cluster.open * (0.85 + 0.3 * (i / Math.max(1, look.STRINGS.length - 1)));
      s.op = m.cluster.op;
      s.weight = m.cluster.wt;
      s.r0 = m.cluster.r0 + i * 30;
    });
    const ops = E.buildOps(look.P, look.STRINGS, look.anchors, spec.size.w, spec.size.h);
    const v = E.verts(look.lean);
    return { spec, m, look, ops, v, style };
  }

  function drawBackground(ctx, C, t) {
    // BG-VIDEO/BG-IMAGE gate (v1.2.5 + v1.3, additive) — when EITHER spec.backgroundVideo OR
    // spec.backgroundImage is present, the procedural background (keyline OR fritzoid) is SKIPPED and
    // the canvas is left TRANSPARENT, so the text/layers compose over alpha; the export path
    // (src/render-core.cjs) then composites the image base and/or the muted Frotion loop under the
    // transparent frames with ffmpeg. Strictly gated on those two fields: when BOTH are ABSENT this
    // branch is never taken and the existing drawBackground below runs byte-for-byte unchanged (the
    // byte-identity guarantee — scripts/verify-legacy-regression.cjs). clearRect (not a fill) is what
    // makes the frame carry alpha=0 where there is no content — node canvas emits that alpha in its PNG
    // frames. Also resets the reused render-core canvas each frame.
    if (C.spec.backgroundVideo || C.spec.backgroundImage) {
      const W = C.spec.size.w, H = C.spec.size.h;
      ctx.clearRect(0, 0, W, H);
      return;
    }
    if (C.style === 'fritzoid') {
      const Fritzoid = getFritzoid();
      Fritzoid.drawFritzoidBackground(ctx, C.state, t);
      return;
    }
    // terrace / ashlar are addressed in tN, not raw t: loopSec stays owned by the merged motion here
    // (so the Transitions loop-duration slider retimes them for free) instead of being copied into
    // each style's state. tN is the same pure-function-of-loop-position contract every other style and
    // primitive in this file uses, which is what makes tN=1 reproduce tN=0 exactly.
    if (BG_STYLE_MODULES[C.style]) {
      const d = BG_STYLE_MODULES[C.style];
      const Mod = getBgStyleModule(C.style);
      Mod[d.draw](ctx, C.state, (t / C.m.speed.loopSec) % 1);
      return;
    }
    const { spec, m, look, ops, v } = C;
    const W = spec.size.w, H = spec.size.h;
    const tN = (t / m.speed.loopSec) % 1;
    const P = Object.assign({}, look.P);
    P.rx = look.P.rx + E.evalChan(look.motion.rx, tN) * m.movement.intensity * m.movement.tumble;
    P.ry = look.P.ry + E.evalChan(look.motion.ry, tN) * m.movement.intensity * m.movement.tumble;
    P.rz = look.P.rz + E.evalChan(look.motion.rz, tN) * m.movement.intensity * 0.7 + m.movement.spin * 360 * tN;
    const dx = E.evalChan(look.motion.tx, tN) * W * m.movement.intensity * m.movement.driftX + m.position.biasX * W;
    const dy = E.evalChan(look.motion.ty, tN) * H * m.movement.intensity * m.movement.driftY + m.position.biasY * H;
    const zoom = 1 + E.evalChan(look.motion.zoom, tN) * m.movement.intensity * m.movement.breathe;
    ctx.fillStyle = (spec.bg === 'carbon') ? '#0a0a0f' : '#ffffff';
    ctx.fillRect(0, 0, W, H);
    for (const o of ops) E.drawOp(ctx, o, v, P, W, H, dx, dy, zoom);
  }

  // Subtle DEFAULT_FLOAT (px drift amplitude / scale-amplitude fraction) applied to any layer that
  // doesn't author its own `float` — sane default; Phase 10 tunes per-layer/per-template.
  const DEFAULT_FLOAT = { driftX: 6, driftY: 8, breathe: 0.006, harmonic: 1 };

  // Deterministic per-layer hash in [0,1) — same house sine-hash technique as fritzoid.js's `ns`,
  // but kept LOCAL (not imported) so the keyline path never depends on fritzoid.js being loaded —
  // getFritzoid() above is lazy specifically so keyline-only pages (the frozen preview/index.html,
  // any keyline-only preview) never need to load it; the keyline branch of drawLayers must keep
  // that guarantee.
  function layerHash(seed, i) {
    const v = Math.sin(seed * 12.9898 + i * 78.233 + 1.618) * 43758.5453;
    return v - Math.floor(v);
  }

  // Shared loop-safe in-place-motion transform (Phase 9, LOOP-01/02) — the ONE mechanism both the
  // keyline branch of drawLayers AND drawLayersFritzoid call for per-layer content drift, so the
  // endpoint-zero sine formulas are never duplicated/forked between styles. Returns {dx, dy, s}:
  // a px offset + uniform scale that is a pure function of tN = (t/loopSec) % 1, EXACTLY dx=0/
  // dy=0/s=1 at tN=0 (and tN=1, since tN wraps to exactly 0 there) — the frame-0 settled-identity /
  // whole-frame loop-seam guarantee holds by construction, not as a per-style special case.
  function floatTransform(C, layerIndex, tN) {
    const l = (C.spec.layers || [])[layerIndex] || {};
    const f = Object.assign({}, DEFAULT_FLOAT, l.float);
    const seed = (C.m && C.m.seed != null ? C.m.seed : 0) >>> 0;

    // Seeded per-layer depth variation (amplitude scale + drift sign + harmonic pick) so photo
    // vs copy don't move in lockstep — NEVER a constant phase term (that would make the offset
    // non-zero at tN=0 and break the seam/poster guarantee).
    const hv = layerHash(seed, layerIndex);
    const ampScale = 0.7 + hv * 0.6; // ~[0.7, 1.3]
    const sign = hv < 0.5 ? -1 : 1;
    const harmonic = (l.float && l.float.harmonic != null) ? f.harmonic : (hv < 0.4 ? 2 : 1);

    // Endpoint-zero sine forms ONLY (house sine-easing rule): 0 at tN=0 AND tN=1.
    const a = 2 * Math.PI * tN * harmonic;
    const axis = f.axis || 'xy';
    const dx = axis === 'y' ? 0 : sign * f.driftX * ampScale * Math.sin(a);
    const dy = axis === 'x' ? 0 : sign * f.driftY * ampScale * Math.sin(a);
    const s = 1 + f.breathe * ampScale * (1 - Math.cos(2 * Math.PI * tN)) / 2;
    return { dx, dy, s };
  }

  // Loop-safe per-beat visibility (Phase 10, LOOP-04 — the cycling carousel addition). Returns the
  // LITERAL 1 (byte-transparent) when spec.beatCycle is absent or layerIndex isn't a cycle member —
  // e.g. New Hire, the base sample, all legacy fixtures, and non-cycle layers like the carousel's
  // lockup are entirely unaffected (see scripts/verify-legacy-regression.cjs). For a cycle member at
  // cycle index k (its position in beatCycle.layers), N = beatCycle.layers.length, this is a pure
  // function of tN only (same house rule as floatTransform: NEVER a constant phase term) —
  // center phase c = k/N; cyclic signed distance d = raw - Math.round(raw) where raw = tN - c (so
  // |d| is the shortest distance around the loop from tN to this beat's center, in [0, 0.5]).
  // Envelope: alpha=1 for |d| <= dwell (full plateau); a raised-cosine ease 0.5+0.5*cos(pi*(|d|-
  // dwell)/fade) for dwell < |d| < dwell+fade (fade>0); else 0. fade===0 degenerates to a hard cut
  // (1 if |d|<=dwell else 0). Because this is pure-tN, drawFrame(0) === drawFrame(loopSec) holds for
  // a beat-cycle spec exactly as it does for floatTransform — no special-casing needed. At tN=0,
  // beat 0 (c=0) has |d|=0 -> alpha=1; every other member has cyclic distance >= 1/N, and
  // composition-spec.js's validated invariant (2*dwell+fade <= 1/N) guarantees 1/N >= dwell+fade, so
  // those members are already fully faded (alpha=0) — frame 0 is beat-1 ALONE.
  function beatCycleAlpha(C, layerIndex, tN) {
    const bc = C.spec.beatCycle;
    if (!bc) return 1;
    const layer = (C.spec.layers || [])[layerIndex];
    const name = layer && layer.name;
    const k = bc.layers.indexOf(name);
    if (k < 0) return 1;

    const N = bc.layers.length;
    const c = k / N;
    const raw = tN - c;
    const d = raw - Math.round(raw);
    const ad = Math.abs(d);
    const dwell = bc.dwell, fade = bc.fade;

    if (ad <= dwell) return 1;
    if (fade > 0 && ad < dwell + fade) {
      return 0.5 + 0.5 * Math.cos(Math.PI * (ad - dwell) / fade);
    }
    return 0;
  }

  // Loop-safe odometer / count-up alpha (Phase 12, NEWT-01 — the Stat template). A DISTINCT additive
  // primitive (its own spec field, export, gate + count-up ordering semantics) that REUSES beatCycle's
  // proven cyclic-distance raised-cosine envelope — exactly as wordReveal reuses the raised-cosine shape
  // (do NOT modify beatCycleAlpha). Returns the LITERAL 1 (byte-transparent) when spec.odometer is
  // absent OR layerIndex isn't a member — so every legacy/New Hire/carousel/quote/hot-take render and
  // every non-member layer is entirely unaffected (see scripts/verify-legacy-regression.cjs). Pure
  // function of tN only (same house rule as beatCycleAlpha / floatTransform: NEVER a constant phase
  // term — that would break the seam). ORDER is load-bearing: member 0 is the REST / FINAL figure
  // (center c=0), members 1..N-1 are the ascending count-up frames.
  //
  // ROLL SPEED (`od.rollSpan`, additive-optional, default 1 => byte-identical): the fraction of the
  // loop the count-up occupies. The roll ENDS at the seam, so the members are laid out BACKWARD from
  // tN=1 in uniform steps of `step = rollSpan/N`: member k (k>=1) centers at c = 1 - (N-k)*step, and
  // member 0 (the final figure) centers at c = 0 (=~ 1, one step after the last roll frame). Every
  // consecutive gap is exactly `step`, so the loop-safety algebra is unchanged with 1/N generalized to
  // `step` — composition-spec.js validates 2*dwell + fade <= rollSpan/N. At rollSpan=1 this collapses
  // to c = k/N EXACTLY (the original placement), which is why an absent rollSpan is byte-transparent.
  //
  // Below 1 the REST member (k=0) also takes a WIDE, ASYMMETRIC plateau: forward into the loop it holds
  // full alpha right up to frame-1's fade-in, backward it keeps the normal dwell so it still crossfades
  // in off the last roll frame. That hold is REQUIRED, not cosmetic — the roll members only cover
  // `rollSpan` of the loop, so a symmetric dwell on member 0 would leave the hero number BLANK for the
  // whole non-roll stretch. Net effect: the number rests on its final value for (1 - rollSpan) of the
  // loop, then rolls fast through 1..N-1 and lands back on the final figure at the seam. At rollSpan=1
  // the members tile the entire loop, there is no gap to fill, and this widening is skipped entirely.
  //
  // At tN=0, member 0 has distance 0 -> alpha=1; every roll member (k>=1) has cyclic distance >= step >=
  // dwell+fade, so those are already fully faded (alpha=0) — frame 0 is the FINAL figure ALONE (the
  // poster) and, since tN wraps to exactly 0 at t=loopSec, the seam is byte-exact.
  function odometerAlpha(C, layerIndex, tN) {
    const od = C.spec.odometer;
    if (!od) return 1;
    const layer = (C.spec.layers || [])[layerIndex];
    const name = layer && layer.name;
    const k = od.layers.indexOf(name);
    if (k < 0) return 1;

    const N = od.layers.length;
    const dwell = od.dwell != null ? od.dwell : ODOMETER_DEFAULTS.dwell;
    const fade = od.fade != null ? od.fade : ODOMETER_DEFAULTS.fade;
    const rollSpan = od.rollSpan != null ? od.rollSpan : ODOMETER_DEFAULTS.rollSpan;
    const step = rollSpan / N;

    // Raised-cosine shoulder: 1 at the plateau edge, 0 at plateau+fade (shared by both branches).
    const shoulder = (dist, plateau) => {
      if (dist <= plateau) return 1;
      if (fade > 0 && dist < plateau + fade) return 0.5 + 0.5 * Math.cos(Math.PI * (dist - plateau) / fade);
      return 0;
    };

    // The REST member's wide forward hold (compressed roll only). Measured as a FORWARD cyclic distance,
    // not the symmetric |d| — the hold runs most of the way around the loop, well past the |d| <= 0.5
    // fold. It ends exactly where frame-1 starts fading in, so the two crossfade.
    if (k === 0 && rollSpan < 1) {
      const fwd = tN - Math.floor(tN);                                  // (tN - 0) mod 1
      const hold = Math.max(dwell, 1 - rollSpan + step - dwell - fade); // = frame-1's fade-in onset
      const a = shoulder(fwd, hold);
      if (a > 0) return a;
      return shoulder(1 - fwd, dwell); // the seam side: crossfade in off frame-(N-1)
    }

    // At rollSpan=1 use the ORIGINAL `k/N` expression verbatim, not the algebraically-equal backward
    // walk: `1 - (N-k)*(1/N)` lands one ULP off `k/N` (e.g. 0.09999999999999998 vs 0.1), which flips
    // the `<=` at an exact plateau boundary. Same center, different bits — and byte-identity on the
    // default path is the whole point of the additive freeze.
    const c = (rollSpan === 1) ? (k / N) : (k === 0 ? 0 : 1 - (N - k) * step);
    const raw = tN - c;
    const d = raw - Math.round(raw);
    return shoulder(Math.abs(d), dwell);
  }

  // Loop-safe CTA-pulse + date-ticker transform (Phase 12, NEWT-04 — the Event template). Returns the
  // identity { scale: 1, dx: 0, dy: 0 } (byte-transparent) when spec.pulse is absent, when layerIndex
  // isn't a pulse.members[].name, AND — by the endpoint-zero forms below — at tN=0 and tN=1. For a
  // member, reads { scaleAmp, driftX, driftY, harmonic } (PULSE_DEFAULTS fill omitted fields; harmonic
  // is a validated positive integer) and returns:
  //   scale = 1 + scaleAmp * (1 - cos(2π·h·tN)) / 2   // 1 at tN=0/1, peaks h times across the loop
  //   dx    = driftX * sin(2π·h·tN)                    // 0 at tN=0/1
  //   dy    = driftY * sin(2π·h·tN)                    // 0 at tN=0/1
  // These are endpoint-zero forms ONLY (house sine-easing rule) — identity at tN=0 AND tN=1 for any
  // integer harmonic, so the poster and the whole-frame loop seam are byte-exact (same construction
  // proven for floatTransform/beatCycleAlpha). Pure function of tN (NEVER a constant phase term). The
  // CTA member typically uses a scale pulse; the date member a small vertical tick (driftY) — but a
  // member may combine both. Scale is about the frame center (the SAME convention floatTransform's
  // breathe uses); keep amplitudes modest so off-center drift-while-scaling reads as a subtle pulse.
  function pulseTransform(C, layerIndex, tN) {
    const pu = C.spec.pulse;
    if (!pu) return { scale: 1, dx: 0, dy: 0 };
    const layer = (C.spec.layers || [])[layerIndex];
    const name = layer && layer.name;
    const mem = (pu.members || []).find((mm) => mm && mm.name === name);
    if (!mem) return { scale: 1, dx: 0, dy: 0 };

    const scaleAmp = mem.scaleAmp != null ? mem.scaleAmp : PULSE_DEFAULTS.scaleAmp;
    const driftX = mem.driftX != null ? mem.driftX : PULSE_DEFAULTS.driftX;
    const driftY = mem.driftY != null ? mem.driftY : PULSE_DEFAULTS.driftY;
    const harmonic = mem.harmonic != null ? mem.harmonic : PULSE_DEFAULTS.harmonic;

    const a = 2 * Math.PI * harmonic * tN;
    const scale = 1 + scaleAmp * (1 - Math.cos(a)) / 2; // endpoint-zero: 1 at tN=0 and tN=1
    const dx = driftX * Math.sin(a);                    // endpoint-zero: 0 at tN=0 and tN=1
    const dy = driftY * Math.sin(a);                    // endpoint-zero: 0 at tN=0 and tN=1
    return { scale, dx, dy };
  }

  // Phase 11 additive-primitive defaults — MUST stay in lockstep with the same-named constants in
  // src/composition-spec.js (its loop-interior validation invariant is proven against exactly these).
  const WORD_REVEAL_DEFAULTS = { floor: 0.15, dipW: 0.08, sweepSpan: 0.6, hold: 0.2 };
  // Phase 12 additive-primitive defaults — MUST stay in lockstep with the same-named constants in
  // src/composition-spec.js (its loop-safety invariant / member validation is proven against exactly
  // these). ODOMETER_DEFAULTS feed odometerAlpha's dwell/fade/rollSpan; PULSE_DEFAULTS are benign zeros
  // / harmonic 1 so an under-specified pulse member contributes NOTHING (never an unrequested pulse).
  // rollSpan default 1 = the count-up spread across the WHOLE loop (the original placement), so an
  // omitted rollSpan is byte-transparent.
  const ODOMETER_DEFAULTS = { dwell: 0.02, fade: 0.03, rollSpan: 1 };
  const PULSE_DEFAULTS = { scaleAmp: 0, driftX: 0, driftY: 0, harmonic: 1 };

  // Loop-safe word-by-word reveal alpha (Phase 11, NEWT-02 — the Quote template). Returns the LITERAL
  // 1 (byte-transparent) when spec.wordReveal is absent OR layerIndex isn't a reveal member — so every
  // legacy/New Hire/carousel render and every non-member layer is entirely unaffected (see
  // scripts/verify-legacy-regression.cjs). For member k (its position in wordReveal.layers), N =
  // wordReveal.layers.length, this is a pure function of tN only (same house rule as beatCycleAlpha /
  // floatTransform: NEVER a constant phase term — that would break the seam). Unlike beatCycleAlpha
  // (whose member 0 dips AT tN=0), the sweep lives entirely in the loop INTERIOR with a poster hold at
  // the seam: each member word gets a single raised-cosine alpha dip of half-width dipW centered at
  // phase c_k = hold + (k+0.5)*(sweepSpan/N), all inside (0,1). alpha = 1 - (1-floor)*(0.5+0.5*cos(pi*
  // |tN-c_k|/dipW)) for |tN-c_k| < dipW (floor at the center, 1 at the dip edge), else exactly 1. The
  // composition-spec.js loop-interior invariant (dipW <= hold AND hold+sweepSpan+dipW <= 1) guarantees
  // every dip window stays strictly inside (0,1), so alpha is provably EXACTLY 1 at tN=0 AND tN=1 for
  // every member — frame 0 is the full legible quote (poster) and, since tN wraps to exactly 0 at
  // t=loopSec, drawFrame(0) === drawFrame(loopSec) holds for a wordReveal spec exactly as it does for
  // beatCycleAlpha/floatTransform (no special-casing). Reads as a light sweeping word-by-word across
  // an always-present quote.
  function wordRevealAlpha(C, layerIndex, tN) {
    const wr = C.spec.wordReveal;
    if (!wr) return 1;
    const layer = (C.spec.layers || [])[layerIndex];
    const name = layer && layer.name;
    const k = wr.layers.indexOf(name);
    if (k < 0) return 1;

    const N = wr.layers.length;
    const floor = wr.floor != null ? wr.floor : WORD_REVEAL_DEFAULTS.floor;
    const dipW = wr.dipW != null ? wr.dipW : WORD_REVEAL_DEFAULTS.dipW;
    const sweepSpan = wr.sweepSpan != null ? wr.sweepSpan : WORD_REVEAL_DEFAULTS.sweepSpan;
    const hold = wr.hold != null ? wr.hold : WORD_REVEAL_DEFAULTS.hold;

    const c = hold + (k + 0.5) * (sweepSpan / N);
    const d = Math.abs(tN - c);
    if (d >= dipW || dipW <= 0) return 1;
    const dip = 0.5 + 0.5 * Math.cos(Math.PI * d / dipW); // 1 at center, 0 at |d|=dipW
    return 1 - (1 - floor) * dip;
  }

  // Fritzoid drawLayers — v1.1 LOOP-FIRST model (Phase 9, LOOP-01/02/03). Replaces v1's
  // accumulating-cell-CLIP reveal (a slow ~0.85s per-layer build-up from nothing — "clunky and
  // stalls", Jon 07-24): every layer with a loaded image is drawn PRESENT at full opacity on EVERY
  // frame (no entrance gate at all — l.in/l.rise/l.exit/l.exitDur/l.drift are ignored here, same as
  // the keyline branch; composition-spec.js keeps them only as tolerated legacy fields). Content
  // drift reuses the SAME floatTransform(C, layerIndex, tN) helper the keyline branch calls — one
  // shared in-place-motion mechanism for both styles. After all content is drawn, the fast
  // loop-resolving accent shimmer (src/fritzoid.js drawShimmer) is overlaid ONCE per frame as pure
  // decoration on top of already-present content — it is never the mechanism that brings content
  // in. Because content offset, shimmer, and the ambient background are all pure functions of
  // tN = (t/loopSec) % 1, drawFrame(0) === drawFrame(loopSec) holds for the WHOLE composited frame.
  function drawLayersFritzoid(ctx, C, images, t) {
    const { spec } = C;
    const W = spec.size.w, H = spec.size.h;
    const loopSec = (C.m && C.m.speed && C.m.speed.loopSec) || 8;
    const tN = (t / loopSec) % 1;

    (spec.layers || []).forEach((l, layerIndex) => {
      const img = images[l.name];
      if (!img) return;
      const { dx, dy, s } = floatTransform(C, layerIndex, tN);
      const p = pulseTransform(C, layerIndex, tN);

      ctx.save();
      // Additive per-layer alpha (beatCycle × wordReveal × odometer) + additive transform (float +
      // pulse). Every factor is the byte-transparent identity when its spec field is absent or the
      // layer isn't a member — odometerAlpha→1, pulseTransform→{scale:1,dx:0,dy:0} — so this body is
      // byte-identical to v1.1 for every existing render (verify-legacy-regression): X*1===X, X+0===X,
      // s*1===s. Content layers are NEVER clipped — the Hot-take statement stays fully legible on every
      // frame (its only motion is the animated background behind it, no foreground accent).
      ctx.globalAlpha = beatCycleAlpha(C, layerIndex, tN) * wordRevealAlpha(C, layerIndex, tN) * odometerAlpha(C, layerIndex, tN);
      ctx.translate(W / 2 + dx + p.dx, H / 2 + dy + p.dy);
      ctx.scale(s * p.scale, s * p.scale);
      ctx.drawImage(img, -W / 2, -H / 2, W, H);
      ctx.restore();
    });
    ctx.globalAlpha = 1;

    // Fast accent shimmer overlay — decoration on top of present content, loop-resolving via t.
    const Fritzoid = getFritzoid();
    if (typeof Fritzoid.drawShimmer === 'function') Fritzoid.drawShimmer(ctx, C.state, t, {});
  }

  // keyline drawLayers — v1.1 LOOP-FIRST in-place motion (Phase 9, LOOP-01/02). Replaces v1's
  // stage-in-from-blank/exit-fade model: every layer with a loaded image is drawn PRESENT at full
  // opacity on EVERY frame (no entrance gate, no exit fade — l.in/l.rise/l.exit/l.exitDur/l.drift
  // are ignored here; composition-spec.js keeps them only as tolerated legacy fields). The only
  // thing that varies with t is a small per-layer offset/scale that is a pure function of
  // tN = (t/loopSec) % 1 — EXACTLY 0 offset / 1 scale at tN=0, so frame 0 is the crisp settled
  // poster. Because tN wraps back to exactly 0 at t=loopSec (1 % 1 === 0 — the same mechanism
  // drawBackground already uses), the whole composited frame loops seamlessly:
  // drawFrame(0) === drawFrame(loopSec) byte-for-byte. Render output intentionally changes vs v1
  // (legacy goldens re-baselined, Plan 09-03). Content drift is computed by floatTransform (shared
  // with drawLayersFritzoid above — never a forked/duplicated sine formula).
  function drawLayers(ctx, C, images, t) {
    if (C.style === 'fritzoid') { drawLayersFritzoid(ctx, C, images, t); return; }
    const { spec } = C;
    const W = spec.size.w, H = spec.size.h;
    const loopSec = (C.m && C.m.speed && C.m.speed.loopSec) || 8;
    const tN = (t / loopSec) % 1;

    (spec.layers || []).forEach((l, i) => {
      const img = images[l.name];
      if (!img) return;
      const { dx, dy, s } = floatTransform(C, i, tN);
      const p = pulseTransform(C, i, tN);

      ctx.save();
      // Additive per-layer alpha (beatCycle × wordReveal × odometer) + additive transform (float +
      // pulse). Every factor is the byte-transparent identity when its spec field is absent or the
      // layer isn't a member — odometerAlpha→1, pulseTransform→{scale:1,dx:0,dy:0} — so this body is
      // byte-identical to v1.1 for every existing render (verify-legacy-regression): X*1===X, X+0===X,
      // s*1===s. Content layers are NEVER clipped — the Hot-take statement stays fully legible on every
      // frame (its only motion is the animated background behind it, no foreground accent).
      ctx.globalAlpha = beatCycleAlpha(C, i, tN) * wordRevealAlpha(C, i, tN) * odometerAlpha(C, i, tN);
      ctx.translate(W / 2 + dx + p.dx, H / 2 + dy + p.dy);
      ctx.scale(s * p.scale, s * p.scale);
      ctx.drawImage(img, -W / 2, -H / 2, W, H);
      ctx.restore();
    });
    ctx.globalAlpha = 1;
  }

  function drawFrame(ctx, C, images, t) {
    drawBackground(ctx, C, t);
    drawLayers(ctx, C, images, t);
  }

  return { DEFAULT_MOTION, mergeMotion, resolveStyle, ease, buildComposer, drawBackground, drawLayers, drawFrame, beatCycleAlpha, wordRevealAlpha, odometerAlpha, pulseTransform };
});
