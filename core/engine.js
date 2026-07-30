/* Intercept Teams loop engine — shared by the browser tool and the Node renderer.
 * UMD: sets globalThis.INTERCEPT_TEAMS in the browser, module.exports in Node.
 *
 * SEAMLESS LOOP: all motion is a sum of sines at INTEGER harmonics of the loop
 * period (sin(2*pi*k*t)), so every channel returns exactly to its start at t=1 →
 * the last frame meets the first with zero discontinuity. Random amplitudes/phases
 * (from a seed) make the wander look organic while staying perfectly periodic.
 */
(function (root, factory) {
  const api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.INTERCEPT_TEAMS = api;
})(typeof self !== 'undefined' ? self : globalThis, function () {
  const TAU = Math.PI * 2;

  const C = {
    flarepop: '#FF00E5', coolsweep: '#1A7AFF', wiretree: '#00D862', violet: '#9359FE',
    cyan: '#00D7F2', flareDeep: '#700063', bolt: '#F5C800', siren: '#F50041',
  };
  const MODES = {
    flarepop: {label: 'Flarepop', stops: [C.flarepop]},
    coolsweep: {label: 'Coolsweep', stops: [C.coolsweep]},
    wiretree: {label: 'Wiretree', stops: [C.wiretree]},
    aberration: {label: 'Aberration ⌁', stops: [C.flarepop, C.violet, C.cyan]},
    spectrum: {label: 'Spectrum ⌁', stops: [C.flarepop, C.coolsweep, C.wiretree]},
    flareCool: {label: 'Flare → Cool ⌁', stops: [C.flarepop, C.coolsweep]},
    coolWire: {label: 'Cool → Wire ⌁', stops: [C.coolsweep, C.wiretree]},
    wireFlare: {label: 'Wire → Flare ⌁', stops: [C.wiretree, C.flarepop]},
    flareFade: {label: 'Flare fade ⌁', stops: [C.flarepop, C.flareDeep]},
    ember: {label: 'Ember ⌁', stops: [C.bolt, C.siren]},
    pride: {label: 'Pride 🏳️‍🌈', stops: [C.siren, C.bolt, C.wiretree, C.coolsweep, C.violet, C.flarepop]},
  };
  const MODE_KEYS = Object.keys(MODES);
  const BG = {carbon: '#0a0a0f', halo: '#ffffff'};

  // seeded RNG (mulberry32) — same numbers in browser + node for a given seed
  function rng(seed) {
    let a = seed >>> 0;
    return function () {
      a |= 0; a = (a + 0x6D2B79F5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  const hex2rgb = (h) => [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)];
  function colorAt(stops, t) {
    if (stops.length === 1) return hex2rgb(stops[0]);
    const seg = Math.min(0.99999, Math.max(0, t)) * (stops.length - 1);
    const i = Math.floor(seg), u = seg - i, a = hex2rgb(stops[i]), b = hex2rgb(stops[i + 1]);
    return [a[0] + (b[0] - a[0]) * u, a[1] + (b[1] - a[1]) * u, a[2] + (b[2] - a[2]) * u].map(Math.round);
  }

  function verts(lean) {
    const w = 55 / 64, cx = (w + w) / 3, cy = (0 + 1 + 1) / 3;
    return [[w - cx, 0 - cy], [w - cx, 1 - cy], [0 - cx, 1 - cy]].map(([x, y]) => [x * lean, y]);
  }

  // closed Catmull-Rom loop through random 3D anchors (the pivot circuit)
  function genAnchors(rand) {
    const K = 4 + Math.floor(rand() * 3), a = [];
    for (let i = 0; i < K; i++) a.push([rand() * 2 - 1, rand() * 2 - 1, rand() * 2 - 1]);
    return a;
  }
  function crom(p0, p1, p2, p3, s) {
    const s2 = s * s, s3 = s2 * s, o = [];
    for (let d = 0; d < 3; d++)
      o[d] = 0.5 * (2 * p1[d] + (-p0[d] + p2[d]) * s + (2 * p0[d] - 5 * p1[d] + 4 * p2[d] - p3[d]) * s2 + (-p0[d] + 3 * p1[d] - 3 * p2[d] + p3[d]) * s3);
    return o;
  }
  function pathAt(anchors, u) {
    const n = anchors.length, f = u * n, i = Math.floor(f), s = f - i;
    return crom(anchors[(i - 1 + n) % n], anchors[i % n], anchors[(i + 1) % n], anchors[(i + 2) % n], s);
  }

  // Build the static keyline geometry (independent of viewpoint → built once per look).
  //
  // FLOW / LOOSENESS (Phase 16, NEWT-06) — additive. `P.flow` in [0,1] (default: absent/0). When
  // flow>0 a SEEDED, SMOOTH, LOW-FREQUENCY meander is summed onto each ribbon's SAMPLED point (its
  // r/theta) as a pure function of the arc-length parameter t=i/n. The underlying Archimedean-spiral
  // ACCUMULATION (theta+=dtheta; r+=b*dtheta) is left BYTE-for-byte unchanged — only the point we read
  // off it is displaced — so this perturbs the STATIC shape, never t/loop time: the loop seam
  // (drawFrame(0)===drawFrame(loopSec)) is untouched by construction (proven by verify-loop-seam).
  // Two incommensurate low frequencies per channel (radial + angular), seeded PER STRING from
  // P.flowSeed via the same mulberry32 `rng` used everywhere else, so the wander is deterministic and
  // each ribbon meanders differently → the concentric rings open into free-flowing, non-concentric
  // curves as flow rises (Jon: "more free flowing, not a blossom-type blob spiralling around").
  // BYTE-IDENTITY GUARD: when flow is absent/0 the entire meander is skipped (undefined>0 === false) —
  // no rng is drawn and lx/ly are exactly `r*cos(theta)`/`r*sin(theta)` as before, so every legacy /
  // flow-0 render is bit-for-bit unchanged (scripts/verify-legacy-regression.cjs, verify-flow.cjs).
  function buildOps(P, STRINGS, anchors, w, h) {
    const ops = [], n = Math.max(1, P.steps);
    const flow = P.flow > 0 ? P.flow : 0;
    STRINGS.forEach((s, k) => {
      const stops = MODES[s.mode].stops, b = s.open, uOff = k * 0.17, theta0 = k * P.spread;
      const tX = s.ptilt * Math.PI / 180, tY = s.ptilt * 0.6 * Math.PI / 180;
      const cX = Math.cos(tX), sX = Math.sin(tX), cY = Math.cos(tY), sY = Math.sin(tY);
      // Seeded per-string meander coefficients — drawn ONLY when flow>0, so flow=0 makes zero rng
      // calls and stays byte-identical. Incommensurate low frequencies = cycles over the whole arc.
      let mf = null;
      if (flow > 0) {
        const fr = rng((((P.flowSeed >>> 0) + k * 0x9E3779B1) >>> 0) + 1);
        mf = {
          rf1: 1.3 + fr() * 1.1, rf2: 2.7 + fr() * 1.7, rp1: fr() * TAU, rp2: fr() * TAU,
          tf1: 0.9 + fr() * 0.9, tf2: 2.1 + fr() * 1.5, tp1: fr() * TAU, tp2: fr() * TAU,
        };
      }
      let theta = theta0, r = s.r0;
      for (let i = 0; i < n; i++) {
        const t = i / n, u = ((t * P.wt) + uOff) % 1, pv = pathAt(anchors, u);
        const ax = w / 2 + pv[0] * P.wan, ay = h / 2 + pv[1] * P.wan * 0.8, az = pv[2] * P.depth;
        let rr = r, th = theta;
        if (mf) {
          // Radial wander PROPORTIONAL to radius (opens the tight concentric rings into free curves)
          // plus a modest angular wander; summed incommensurate sines → smooth, non-repeating meander.
          const mR = Math.sin(TAU * mf.rf1 * t + mf.rp1) + 0.55 * Math.sin(TAU * mf.rf2 * t + mf.rp2);
          const mT = Math.sin(TAU * mf.tf1 * t + mf.tp1) + 0.55 * Math.sin(TAU * mf.tf2 * t + mf.tp2);
          rr = r + flow * 0.45 * r * mR;
          th = theta + flow * 0.8 * mT;
        }
        const lx = rr * Math.cos(th), ly = rr * Math.sin(th);
        const ly2 = ly * cX, lz1 = ly * sX;
        const lx3 = lx * cY + lz1 * sY, lz3 = -lx * sY + lz1 * cY;
        const ang = theta * s.spin, size = P.s0 + (P.s1 - P.s0) * t;
        const [cr, cg, cb] = colorAt(stops, t);
        ops.push({x: ax + lx3, y: ay + ly2, z: az + lz3, ang, size, r: cr, g: cg, b: cb, wt: s.weight, op: s.op});
        const dtheta = P.gap / Math.sqrt(r * r + b * b + 1e-6);
        theta += dtheta; r += b * dtheta;
      }
    });
    return ops;
  }

  // ── seamless motion ──────────────────────────────────────────────────────
  // A "channel" = a few integer-harmonic sines. eval at t in [0,1) → periodic value.
  function genMotion(rand) {
    const chan = (nHarm, maxAmp) => {
      const h = [];
      for (let k = 1; k <= nHarm; k++) h.push({k, amp: (maxAmp * (0.45 + 0.55 * rand())) / k, ph: rand() * TAU});
      return h;
    };
    return {
      rx: chan(2, 16 + rand() * 10),  // tilt about X  (deg)
      ry: chan(2, 20 + rand() * 12),  // turn about Y  (deg)
      rz: chan(2, 5 + rand() * 6),    // spin about Z  (deg)
      tx: chan(2, 0.035),             // drift on X (fraction of W)
      ty: chan(2, 0.03),              // drift on Y (fraction of H)
      zoom: chan(1, 0.05),            // gentle Z breathing (scale)
    };
  }
  function evalChan(ch, t) {
    let v = 0;
    for (const {k, amp, ph} of ch) v += amp * Math.sin(TAU * k * t + ph);
    return v;
  }

  // 3D rotate (rz→rx→ry) + perspective, then apply loop drift (dx,dy) and zoom.
  function project(x, y, z, P, w, h, dx, dy, zoom) {
    const rx = P.rx * Math.PI / 180, ry = P.ry * Math.PI / 180, rz = P.rz * Math.PI / 180;
    const cz = Math.cos(rz), sz = Math.sin(rz);
    let X = x * cz - y * sz, Y = x * sz + y * cz, Z = z;
    const cx2 = Math.cos(rx), sx2 = Math.sin(rx);
    let Y2 = Y * cx2 - Z * sx2, Z2 = Y * sx2 + Z * cx2;
    const cy2 = Math.cos(ry), sy2 = Math.sin(ry);
    let X3 = X * cy2 + Z2 * sy2, Z3 = -X * sy2 + Z2 * cy2;
    const f = P.focal; let d = f - Z3; const dmin = f * 0.2; if (d < dmin) d = dmin;
    const s = (f / d) * zoom;
    return [w / 2 + X3 * s + dx, h / 2 + Y2 * s + dy];
  }

  function drawOp(c, o, v, P, w, h, dx, dy, zoom) {
    const ca = Math.cos(o.ang), sa = Math.sin(o.ang);
    c.beginPath();
    for (let j = 0; j < 3; j++) {
      const sx = v[j][0] * o.size, sy = v[j][1] * o.size;
      const wx = (o.x + sx * ca - sy * sa) - w / 2, wy = (o.y + sx * sa + sy * ca) - h / 2;
      const p = project(wx, wy, o.z || 0, P, w, h, dx, dy, zoom);
      j ? c.lineTo(p[0], p[1]) : c.moveTo(p[0], p[1]);
    }
    c.closePath();
    c.strokeStyle = `rgba(${o.r},${o.g},${o.b},${o.op})`;
    c.lineWidth = o.wt; c.lineJoin = 'round'; c.stroke();
  }

  /** Paint one loop frame. `st` = {P (base), STRINGS, anchors, motion, lean, ops, v}.
   *  tNorm in [0,1). Mutates a working copy of viewpoint; never the base. */
  function drawFrame(ctx, st, w, h, tNorm, motionScale) {
    const ms = motionScale == null ? 1 : motionScale;
    const P = Object.assign({}, st.P);
    P.rx = st.P.rx + evalChan(st.motion.rx, tNorm) * ms;
    P.ry = st.P.ry + evalChan(st.motion.ry, tNorm) * ms;
    P.rz = st.P.rz + evalChan(st.motion.rz, tNorm) * ms;
    const dx = evalChan(st.motion.tx, tNorm) * w * ms;
    const dy = evalChan(st.motion.ty, tNorm) * h * ms;
    const zoom = 1 + evalChan(st.motion.zoom, tNorm) * ms;

    ctx.fillStyle = BG[st.P.bg]; ctx.fillRect(0, 0, w, h);
    for (const o of st.ops) drawOp(ctx, o, st.v, P, w, h, dx, dy, zoom);
  }

  // Curated "always-good" look from a seeded RNG (identical in browser + node).
  function makeLook(rand, opts) {
    opts = opts || {};
    const P = {
      steps: 3040, gap: 1.6, s0: 224, s1: 129, spread: 1.6,
      wan: Math.round((340 + rand() * 120) / 5) * 5,
      wt: +(0.6 + rand() * 1.2).toFixed(1),
      rx: Math.round((rand() * 2 - 1) * 28),   // base viewpoint; motion oscillates around it
      ry: Math.round((rand() * 2 - 1) * 28),
      rz: Math.round((rand() * 2 - 1) * 8),
      depth: Math.round((460 + rand() * 620) / 10) * 10,
      focal: Math.round((1250 + rand() * 650) / 50) * 50,
      bg: opts.bg || 'halo',
    };
    const lean = rand() < 0.5 ? -1 : 1;
    const nStrings = opts.strings || 2;
    const STRINGS = [];
    for (let k = 0; k < nStrings; k++) {
      const mode = opts.modes ? opts.modes[k % opts.modes.length] : MODE_KEYS[Math.floor(rand() * MODE_KEYS.length)];
      STRINGS.push({
        mode,
        op: +(0.18 + rand() * 0.3).toFixed(2),
        open: +(10 + rand() * 30).toFixed(1),
        r0: Math.round(20 + rand() * 180),
        spin: +(0.12 + rand() * 0.38).toFixed(2),
        ptilt: Math.round((rand() < 0.5 ? -1 : 1) * (24 + rand() * 40)),
        weight: +(0.55 + rand() * 0.35).toFixed(2),
      });
    }
    const anchors = genAnchors(rand);
    const motion = genMotion(rand);
    return {P, STRINGS, lean, anchors, motion};
  }

  return {TAU, C, MODES, MODE_KEYS, BG, rng, genAnchors, genMotion, evalChan, buildOps, verts, project, drawOp, drawFrame, makeLook};
});
