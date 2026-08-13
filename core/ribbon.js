/* Ribbon — rolling ribbons travelling in a cluster.
 * UMD: sets globalThis.INTERCEPT_RIBBON in the browser, module.exports in Node.
 * Depends on engine.js (INTERCEPT_TEAMS) for the seeded RNG, colour ramp, Catmull-Rom circuit,
 * triangle vertices, projection and stroke — load it first.
 *
 * WHY THIS EXISTS (Jon, 2026-08-04): "the keyline movement is too 'hovery', it doesn't do much. It
 * should really be rolling ribbons moving in a cluster — like the ribbons have a beginning and end
 * and are moving around like snakes."
 *
 * That is a diagnosis of WHERE the motion lives, not of how strong it is. In `keyline` the geometry
 * is STATIC: engine.buildOps lays down two endless Archimedean spirals once, and every frame only
 * moves the CAMERA around them (rx/ry/rz tumble + drift + zoom). A camera orbiting a frozen object
 * reads as hovering no matter how far you push it, and the spirals have no ends to read as travel.
 *
 * Ribbon inverts that. The camera is nearly still; the GEOMETRY travels:
 *   - Each ribbon has a FINITE body — a window of arc length `body` with a tapered tail and a
 *     defined nose, so it has a beginning and an end you can actually see.
 *   - That window SLIDES along its own closed, seeded Catmull-Rom circuit, `travel` whole laps per
 *     loop, so the ribbon crawls head-first through the frame and comes home.
 *   - A travelling sine runs down the body's own arc parameter (`slither`), so the body follows the
 *     head through the turns the way a snake's does, instead of sliding rigidly.
 *   - The triangles roll about the direction of travel as they go (`twist`) — the "rolling" part.
 *   - Every circuit is centred on ONE cluster origin at different radii, so the ribbons interleave
 *     and read as a cluster rather than as separate decorations.
 *
 * ADDITIVE BY CONSTRUCTION: this is a new `motion.style` registered through composer.js's
 * BG_STYLE_MODULES extension point (the same one fritzfield uses). engine.js's buildOps/drawOp —
 * the frozen legacy core carrying the byte-identity guarantee — are READ here, never edited, and
 * the `keyline` style is untouched, so every existing spec and golden renders exactly as before.
 *
 * SEAMLESS LOOP: every quantity drawRibbonFieldAt reads is a pure function of tN in [0,1) with no
 * persisted state, and each tN-dependent term is periodic with period 1 BY CONSTRUCTION:
 *   - head position   (phase + travel*tN) % 1     — `travel` is a whole number of laps
 *   - body wave       TAU*(waves*s - drift*tN)    — `drift` is a whole number of wave passes
 *   - roll            TAU*(twists*s - roll*tN)    — `roll` is a whole number of turns
 *   - camera          engine.evalChan             — integer harmonics of the loop period
 * so tN=1 reproduces tN=0 exactly, the same invariant fritzoid and fritzfield hold.
 */
(function (root, factory) {
  const E = (typeof module !== 'undefined' && module.exports) ? require('./engine.js') : root.INTERCEPT_TEAMS;
  const api = factory(E);
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.INTERCEPT_RIBBON = api;
})(typeof self !== 'undefined' ? self : globalThis, function (E) {
  const TAU = Math.PI * 2;

  // The style's own knobs, and the full list of what a preset or a spec may pass through
  // (composer.js's mergeMotion forwards any non-keyline-shaped motion field verbatim). Anything a
  // caller omits falls through to these, so the style is usable from a bare { style: 'ribbon' }.
  const DEFAULTS = {
    ribbons: 3,      // how many bodies travel in the cluster
    body: 0.34,      // each body's length as a fraction of its own circuit
    width: 96,       // ribbon width in px at 1080 — kept SEPARATE from length (see below)
    travel: 1,       // whole laps of the circuit per loop — see the note on speed below
    slither: 0.6,    // amplitude of the travelling wave that runs down the body
    twist: 0.5,      // how hard the triangles roll about the direction of travel
    scale: 1,        // circuit size multiplier — how far each body ranges
    spread: 0.45,    // how far the circuits scatter from the cluster origin (0 = concentric)
    tilt: 0.7,       // how far each circuit is rotated out of the frame plane (0 = all coplanar)
    wind: 0.6,       // how hard the path climbs and dives through depth over a lap (0 = flat ring)
    // WHERE THE CLUSTER SITS, as a fraction of the frame: 0 = left/top edge, 1 = right/bottom.
    // null falls back to the shared position.biasX/biasY the keyline style uses, so a spec written
    // before these existed still places itself exactly as it did.
    originX: null,
    originY: null,
    // Pace WITHIN the loop. `travel` is whole laps and cannot be fractional (the seam depends on the
    // head coming home), so it is a coarse control; `glide` redistributes the pace inside the lap —
    // the body eases almost to a stop for part of the loop and covers ground in the rest. Average
    // speed is unchanged, apparent speed for most of the loop drops a lot. Defaults ON: Jon wants this
    // style to read as a slow-moving motion graphic, and a whole-lap crawl is the fastest it can go.
    glide: 0.45,
    camera: 0.3,     // how much of the keyline camera tumble survives — deliberately small
    segs: null,      // triangles per body; null = derived from `body` at a constant density
  };

  // Width is its OWN knob rather than keyline's `cluster.wan`, because the thing that decides
  // whether a body reads as a snake or as a blown scarf is its ASPECT — width against arc length —
  // and wan sets the cluster's wander radius, so tying them together made every ribbon fatten as
  // the cluster grew. At the defaults a body runs ~1:7, which crawls; ~1:4 flaps.
  // Per-ribbon path extent as a fraction of min(W,H) at scale 1. Smaller than the ring version's
  // 0.34 on purpose: a ring keeps every point at roughly one radius, so a body on it was always about
  // as visible as any other; a knot has LOBES that reach much further out, and a body occupying one
  // of them can sit entirely off-frame for seconds.
  const CIRCUIT_R = 0.28;
  const SCATTER_R = 0.15;   // how far circuit CENTRES scatter, same units — keeps the cluster tight
  // The shared position bias is damped here. keyline's biasX/Y were tuned against a wander radius
  // that only ever nudged a diffuse spiral; a ribbon cluster is a defined object of a known size, so
  // the full bias shoves most of it off the corner. Damping keeps the same "copy lives in the
  // opposite corner" intent without throwing the bodies out of frame.
  const BIAS_DAMP = 0.6;

  const SEG_DENSITY = 900;  // triangles per full circuit-length — sets how solid a body reads
  const SEG_MIN = 80, SEG_MAX = 460;

  function clamp(v, lo, hi) { return v < lo ? lo : (v > hi ? hi : v); }
  function num(v, d) { return (typeof v === 'number' && isFinite(v)) ? v : d; }
  // Raised-cosine ease, clamped — the house easing (composer.js `ease`, fritzoid's squash).
  function ease01(u) { return u <= 0 ? 0 : u >= 1 ? 1 : 0.5 - 0.5 * Math.cos(Math.PI * u); }

  // ── the path: a closed 3D HARMONIC KNOT, not a ring ────────────────────────────────────────
  //
  // Jon, twice: *"they should wind around more in 3d space"*, then *"still feels very donut like, I
  // expect these shapes to slither in multiple different directions in 3d space."* Two earlier
  // attempts failed for the same reason and it is worth stating plainly:
  //
  //   A RING IS A DONUT NO MATTER WHAT YOU DO TO IT. Anchors placed around a circle give a path
  //   whose angular sweep is MONOTONIC — it only ever goes one way round. Tilting that loop in 3D
  //   just shows you a tilted donut; rippling its z just corrugates the donut. The heading never
  //   reverses, so the eye reads "loop", every time.
  //
  // So the ring is gone. Each axis is now an independent sum of INTEGER-frequency cosines:
  //   x(s) = Σ a·cos(2π·k·s + φ)   and the same, with its OWN frequencies, for y and z.
  // Integer frequencies make the curve exactly periodic in s, so it still closes seamlessly with no
  // anchor bookkeeping at all. But because each axis picks DIFFERENT harmonics, the result is a knot
  // — figure-eights, trefoils, pretzels — whose heading genuinely reverses several times per lap.
  // That is what "slithering in multiple directions" actually requires: a path that doubles back.
  //
  // `wind` is the amount of higher-harmonic energy: at 0 the fundamentals dominate and you get a
  // plain (honest) ellipse; as it rises the curve knots up and wanders in more directions.
  function harmonicAxis(rand, wind, phase0) {
    const terms = [{ k: 1, a: 1, ph: phase0 == null ? rand() * TAU : phase0 }];
    const extra = 2 + Math.floor(rand() * 2);            // 2-3 higher harmonics
    for (let i = 0; i < extra; i++) {
      const k = 2 + Math.floor(rand() * 3);              // 2..4 — low enough to stay legible
      // Amplitude falls as 1/sqrt(k), not 1/k. Dividing by k made the higher harmonics so weak that
      // the fundamental still dominated and the path stayed a lightly-dented ellipse — which is what
      // the gate's donut self-proof caught: it scored no better than a tilted ring.
      terms.push({ k, a: wind * (0.55 + rand() * 0.85) / Math.sqrt(k), ph: rand() * TAU });
    }
    return terms;
  }
  function evalAxis(terms, s) {
    let v = 0;
    for (let i = 0; i < terms.length; i++) v += terms[i].a * Math.cos(TAU * terms[i].k * s + terms[i].ph);
    return v;
  }
  // Build one knot and normalise each axis to roughly unit range, so `scale` means the same thing
  // whatever harmonics were drawn.
  function knot(rand, wind) {
    const px = rand() * TAU;
    const c = {
      x: harmonicAxis(rand, wind, px),
      // The y fundamental is held near a quarter-turn from x's. Left fully random it can land in
      // phase and the base loop collapses to a straight line, which reads as a flapping ribbon on a
      // wire rather than a body following a path.
      y: harmonicAxis(rand, wind, px + Math.PI / 2 + (rand() - 0.5) * 0.9),
      z: harmonicAxis(rand, wind),
    };
    const mx = { x: 1e-6, y: 1e-6, z: 1e-6 };
    for (let i = 0; i < 256; i++) {
      const s = i / 256;
      mx.x = Math.max(mx.x, Math.abs(evalAxis(c.x, s)));
      mx.y = Math.max(mx.y, Math.abs(evalAxis(c.y, s)));
      mx.z = Math.max(mx.z, Math.abs(evalAxis(c.z, s)));
    }
    c.nx = 1 / mx.x; c.ny = 1 / mx.y; c.nz = 1 / mx.z;
    return c;
  }

  // A ZYX rotation, precomputed as nine components. Applied to the NORMALISED curve point, before the
  // per-ribbon sx/sy/sz scaling — rotating after a non-uniform scale shears the path instead of
  // turning it, which quietly flattens exactly the 3D character this is here to create.
  function rotComponents(rx, ry, rz) {
    const cx = Math.cos(rx), sx = Math.sin(rx);
    const cy = Math.cos(ry), sy = Math.sin(ry);
    const cz = Math.cos(rz), sz = Math.sin(rz);
    return {
      m00: cz * cy, m01: cz * sy * sx - sz * cx, m02: cz * sy * cx + sz * sx,
      m10: sz * cy, m11: sz * sy * sx + cz * cx, m12: sz * sy * cx - cz * sx,
      m20: -sy, m21: cy * sx, m22: cy * cx,
    };
  }

  // buildRibbonField(spec, m): everything seeded and time-independent, resolved ONCE per spec —
  // same contract as fritzfield's buildFritzField and fritzoid's buildFritzoid.
  function buildRibbonField(spec, m) {
    m = m || {};
    const W = spec.size.w, H = spec.size.h;
    const seed = (m.seed != null ? m.seed : 11) >>> 0;
    const ground = (spec.bg === 'carbon' || spec.bg === 'graphite') ? 'carbon' : 'halo';
    const groundColor = (spec.bg === 'graphite') ? '#26262d' : (ground === 'carbon' ? '#0a0a0f' : '#ffffff');

    const cluster = m.cluster || {};
    const position = m.position || {};
    const movement = m.movement || {};

    const count = clamp(Math.round(num(m.ribbons, DEFAULTS.ribbons)), 1, 8);
    const body = clamp(num(m.body, DEFAULTS.body), 0.04, 0.9);
    const width = clamp(num(m.width, DEFAULTS.width), 16, 260);
    // SPEED, and where it actually comes from (Jon: "I want the speed control to go lower, and you can
    // chop the high speed limit way down, this should be a slow moving motion graphic").
    //
    // A body's speed is (path length x travel) / loopSec. `travel` MUST be a whole number — the seam
    // depends on the head coming home, so a part-lap would not close — which means travel=1 is the
    // FLOOR and it cannot be the slow control. loopSec is the continuous one, and it has no floor at
    // all: a longer lap time is a slower ribbon, exactly. So the range here is chopped to 1-4 (the
    // high end was never useful for a background) and the app's ribbon panel drives lap time directly.
    const travel = clamp(Math.round(num(m.travel, DEFAULTS.travel)), 1, 4);
    // Clamped BELOW 1: at glide=1 the rate 1-glide*cos(2*pi*tN) touches zero and beyond it goes
    // negative, which would run the body backwards mid-loop instead of merely slowing it.
    const glide = clamp(num(m.glide, DEFAULTS.glide), 0, 0.95);
    const slither = clamp(num(m.slither, DEFAULTS.slither), 0, 1);
    const twist = clamp(num(m.twist, DEFAULTS.twist), 0, 1);
    const scale = clamp(num(m.scale, DEFAULTS.scale), 0.3, 2);
    const spread = clamp(num(m.spread, DEFAULTS.spread), 0, 1.5);
    const tilt = clamp(num(m.tilt, DEFAULTS.tilt), 0, 1);
    const wind = clamp(num(m.wind, DEFAULTS.wind), 0, 1);
    const camera = clamp(num(m.camera, DEFAULTS.camera), 0, 1);
    const segs = m.segs != null
      ? clamp(Math.round(m.segs), SEG_MIN, SEG_MAX)
      : clamp(Math.round(SEG_DENSITY * body), SEG_MIN, SEG_MAX);

    const op = num(cluster.op, 0.11);
    const wt = num(cluster.wt, 1.1);
    const modes = (m.modes && m.modes.length) ? m.modes : ['flarepop', 'coolsweep'];

    const rand = E.rng(seed);

    // One cluster origin every body orbits, shoved into frame by the shared position bias (the same
    // field keyline uses) so copy keeps the opposite corner.
    // Where the cluster sits AS A WHOLE. An explicit origin wins outright — it is an absolute place
    // on the canvas, so "put them in the bottom-left corner" means exactly that and is not filtered
    // through keyline's bias damping.
    const hasOrigin = m.originX != null || m.originY != null;
    const cx = m.originX != null
      ? clamp(num(m.originX, 0.5), -0.5, 1.5) * W
      : W / 2 + num(position.biasX, 0.16) * W * BIAS_DAMP;
    const cy = m.originY != null
      ? clamp(num(m.originY, 0.5), -0.5, 1.5) * H
      : H / 2 + num(position.biasY, 0.12) * H * BIAS_DAMP;
    const base = Math.min(W, H);

    // The viewpoint is resolved BEFORE the bodies because their depth has to be capped against the
    // focal length. engine.project divides by (focal - z) and floors that at 0.2*focal, so a body
    // diving near the camera can blow up 5x — which does not read as depth, it reads as a slab
    // suddenly filling the frame. Capping z keeps the near/far size ratio expressive but bounded.
    const P = {
      rx: Math.round((rand() * 2 - 1) * 18),
      ry: Math.round((rand() * 2 - 1) * 18),
      rz: Math.round((rand() * 2 - 1) * 6),
      // Shorter focal than keyline's on purpose: a knot only reads as three-dimensional if the near
      // and far passes differ in size. At keyline's long focal the perspective is nearly orthographic
      // and every depth excursion flattens back into the picture plane.
      focal: Math.round((820 + rand() * 460) / 20) * 20,
    };
    const Z_CAP = P.focal * 0.38;   // worst-case near-pass magnification ~1.6x

    const ribbons = [];
    for (let i = 0; i < count; i++) {
      const stops = E.MODES[modes[i % modes.length]] ? E.MODES[modes[i % modes.length]].stops : E.MODES.flarepop.stops;
      // Each body gets its OWN circuit, of a similar size, whose CENTRE sits a short way off the
      // cluster origin — rather than all of them orbiting one point at stepped radii. Concentric
      // radii made the outer bodies sweep arcs big enough to leave the frame for whole seconds at a
      // time; scattered centres of a similar radius keep the bodies overlapping and interleaving,
      // which is what makes a handful of ribbons read as one cluster.
      const ca = (i / count) * TAU + rand() * 0.9;
      const cd = base * SCATTER_R * scale * spread * (0.45 + rand() * 0.75);
      const R = base * CIRCUIT_R * scale;
      // The knot already heads in several directions on its own; `tilt` then turns each one so no two
      // ribbons present the same face. Full range on all three axes — with a knot rather than a ring
      // there is no "spinning the donut" degenerate case left to avoid.
      ribbons.push({
        c: knot(rand, wind),
        R: rotComponents(
          tilt * (rand() * 2 - 1) * Math.PI,
          tilt * (rand() * 2 - 1) * Math.PI,
          tilt * (rand() * 2 - 1) * Math.PI,
        ),
        sx: R * (0.86 + rand() * 0.36),
        sy: R * (0.80 + rand() * 0.42),
        // Depth scale rises with `wind` — a path that dives needs somewhere to dive into, and at the
        // old flat-ring depth the winding only ever read as a wobble. Capped against the focal (see
        // Z_CAP) so a near pass reads as "closer", not as an exploding slab.
        sz: Math.min(Z_CAP, num(cluster.depth, 380) * (0.55 + rand() * 0.6) * (0.6 + wind)),
        cx: cx + Math.cos(ca) * cd,
        cy: cy + Math.sin(ca) * cd * 0.85,
        body: body * (0.8 + rand() * 0.45),
        // Heads start spread around the circuit so they enter and leave the frame at different times.
        phase: (i / count) + rand() * (0.6 / count),
        travel,
        glide,
        segs,
        // Travelling body wave. `waves` = how many undulations sit on the body at once; `drift` =
        // whole passes of that wave down the body per loop (integer -> seam-safe).
        waves: 1.5 + rand() * 2,
        drift: 1 + Math.floor(rand() * 2),
        wavePhase: rand() * TAU,
        lat: base * (0.030 + rand() * 0.035),
        slither,
        // Roll about the direction of travel — the "rolling" in rolling ribbons. `twists` stays
        // BELOW one full turn along the body: past that the ribbon passes through edge-on more than
        // once and each crossing pinches into a hard bow-tie, which reads as a crease, not a roll.
        twists: 0.18 + rand() * 0.5,
        roll: 1 + Math.floor(rand() * 2),
        twist,
        size: width * (base / 1080) * (0.82 + rand() * 0.4),
        stops, op, wt,
        // Tail feathers away over a long run; the nose ends short, so the body reads directional.
        tailFrac: 0.34 + rand() * 0.16,
        noseFrac: 0.05 + rand() * 0.05,
      });
    }

    // The base tilt (P) was resolved above, before the bodies, so their depth could be capped
    // against its focal length. The per-frame tumble is scaled right down by `camera`: with the
    // geometry now travelling and knotting on its own, a big camera orbit only muddies it.
    const motion = E.genMotion(rand);
    const camScale = camera * num(movement.intensity, 0.85);

    // Lean is drawn ONCE and used for the triangle vertices. It was briefly drawn twice — a `lean`
    // field nothing read, plus a second independent draw for verts — which is two rng calls and two
    // different answers to one question.
    const lean = rand() < 0.5 ? -1 : 1;

    return {
      W, H, ground, groundColor, seed, ribbons, P, motion, camScale, lean,
      v: E.verts(lean),
      // Introspection for the gates: where each head sits at a given tN, so a test can assert the
      // bodies actually travel (and come home at tN=1) without diffing pixels.
      origin: { x: cx, y: cy, explicit: hasOrigin },
      headAt(tN) { return ribbons.map((r) => ((headU(r, tN) % 1) + 1) % 1); },
    };
  }

  // Where a ribbon's HEAD sits on its path at tN. One definition, used by the renderer and by the
  // headAt() introspection the gates read, so the two cannot drift apart.
  //
  // `glide` warps the pace without touching the destination: subtracting sin(2*pi*tN)/(2*pi) leaves
  // the value at tN=0 and tN=1 untouched (sin is 0 at both), so the head still completes exactly
  // `travel` whole laps and the seam is unaffected. What changes is the rate,
  // travel*(1 - glide*cos(2*pi*tN)): at glide=0.9 it is 0.1x around tN=0/1 and 1.9x at mid-loop, so
  // the body barely creeps across the seam and covers its ground through the middle. That is how you
  // get a much slower-looking crawl out of a lap count that has to stay a whole number — and slow AT
  // the seam is the useful way round, because it is the moment a loop is most likely to give itself away.
  function headU(r, tN) {
    const warp = r.glide ? (tN - r.glide * Math.sin(TAU * tN) / TAU) : tN;
    return r.phase + r.travel * warp;
  }

  // A point on a ribbon's knot, in canvas coordinates + depth. Analytic and periodic, so `u` may sit
  // anywhere on the real line — no anchor indexing, no wrap bookkeeping.
  function pointAt(r, u) {
    const s = ((u % 1) + 1) % 1;
    const x0 = evalAxis(r.c.x, s) * r.c.nx;
    const y0 = evalAxis(r.c.y, s) * r.c.ny;
    const z0 = evalAxis(r.c.z, s) * r.c.nz;
    const R = r.R;
    const x = R.m00 * x0 + R.m01 * y0 + R.m02 * z0;
    const y = R.m10 * x0 + R.m11 * y0 + R.m12 * z0;
    const z = R.m20 * x0 + R.m21 * y0 + R.m22 * z0;
    return [r.cx + x * r.sx, r.cy + y * r.sy, z * r.sz];
  }

  // drawRibbonFieldAt(ctx, state, tN): pure canvas 2D — no DOM, no offscreen canvas, no CSS — so it
  // runs identically under node-canvas and Chrome (the parity requirement every style here holds).
  function drawRibbonFieldAt(ctx, state, tN) {
    const { W, H, ribbons, P, motion, camScale, v, groundColor } = state;

    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = 'source-over';
    ctx.fillStyle = groundColor;
    ctx.fillRect(0, 0, W, H);

    // The surviving sliver of camera life — enough that the cluster breathes, far too little to
    // read as the motion. All channels are integer harmonics, so they close at tN=1.
    const VP = {
      rx: P.rx + E.evalChan(motion.rx, tN) * camScale,
      ry: P.ry + E.evalChan(motion.ry, tN) * camScale,
      rz: P.rz + E.evalChan(motion.rz, tN) * camScale,
      focal: P.focal,
    };
    const dx = E.evalChan(motion.tx, tN) * W * camScale;
    const dy = E.evalChan(motion.ty, tN) * H * camScale;
    const zoom = 1 + E.evalChan(motion.zoom, tN) * camScale;

    for (const r of ribbons) {
      const uHead = headU(r, tN);
      const n = r.segs;
      const du = r.body / n;           // one segment of arc, used for the local tangent too
      for (let j = 0; j < n; j++) {
        const s = n === 1 ? 1 : j / (n - 1);   // 0 = tail tip, 1 = nose
        const u = uHead - r.body * (1 - s);

        const p0 = pointAt(r, u);
        const p1 = pointAt(r, u + du);
        const tx = p1[0] - p0[0], ty = p1[1] - p0[1];
        const tl = Math.hypot(tx, ty) || 1e-6;

        // Travelling wave down the body's OWN arc parameter: the body follows the head through the
        // turns rather than sliding along the circuit rigidly.
        const tail = ease01(s / r.tailFrac);
        const nose = ease01((1 - s) / r.noseFrac);
        const wave = Math.sin(TAU * (r.waves * s - r.drift * tN) + r.wavePhase);
        const lat = r.slither * r.lat * wave * tail;

        const x = p0[0] + (-ty / tl) * lat;
        const y = p0[1] + (tx / tl) * lat;
        const z = p0[2] + lat * 0.6;

        const ang = Math.atan2(ty, tx) + r.twist * TAU * (r.twists * s - r.roll * tN);
        const sizeEnv = tail * (0.30 + 0.70 * nose);
        const alphaEnv = tail * (0.30 + 0.70 * nose);
        if (sizeEnv <= 0 || alphaEnv <= 0) continue;

        const [cr, cg, cb] = E.colorAt(r.stops, s);
        E.drawOp(
          ctx,
          { x, y, z, ang, size: r.size * sizeEnv, r: cr, g: cg, b: cb, wt: r.wt, op: r.op * alphaEnv },
          v, VP, W, H, dx, dy, zoom,
        );
      }
    }
    ctx.globalAlpha = 1;
  }

  return { DEFAULTS, buildRibbonField, drawRibbonFieldAt, knot, evalAxis, rotComponents, pointAt };
});
