/* Fritzoid — seeded truchet ambient triangle-pattern background + fast accent shimmer.
 * UMD: sets globalThis.INTERCEPT_FRITZOID in the browser, module.exports in Node.
 * Depends on engine.js (INTERCEPT_TEAMS) for the seeded RNG — load it first.
 *
 * INK-FIRST (07-29, Phase 16 / 16-01): fritzoid is fully ink-first — it paints ONLY the
 * low-saturation, ground-appropriate ink palette below (every entry's max(r,g,b)-min(r,g,b) sits
 * well under the ink-discipline ceiling). There is NO colored channel-hue flash ANYWHERE: the old
 * scheduled slice/block glitch (a screen-blend + flarepop/wiretree/coolsweep channel split ported
 * from intercept-lockup-animated.html) has been REMOVED ENTIRELY per Jon ("fritzoid has a colored
 * glitch in its animation. remove this."). Only the seeded truchet sparse-wave ambient tile field
 * + the shimmer flourishes (also ink-only) remain.
 *
 * Ported vocabulary (adapted to seeded deterministic canvas code — see 03-02 plan context):
 *   - triVerts/ns: intercept-brand-kit/.fritz/generators/fritz-pattern.html (verbatim geometry +
 *     hash-noise functions).
 *
 * SEAMLESS LOOP: every quantity drawFritzoidBackground reads is a pure function of
 * tN = (t / loopSec) % 1 (recomputed fresh each call — no state persists across frames), so the
 * frame at tN=0 is bit-identical no matter which real t produced it (t=0, t=loopSec, t=k*loopSec,
 * ...) — same invariant as engine.js's keyline motion.
 *
 * LOOP-SAFE TILE FLIPS: each truchet wave event contributes exactly TWO passes (a forward pass +
 * a later return pass, same origin/radius/speed) to every tile it touches, so a tile's flip COUNT
 * over one full loop is always even -> it is back in its starting lean by tN=1, by construction
 * (tileStateAt's running parity), not by a hand-authored "avoid the seam" special case.
 *
 * FAST ACCENT SHIMMER (Phase 9 / LOOP-03, 09-02): replaces the old per-layer slow cell-clip reveal
 * (a ~0.85s accumulating CLIP that brought each layer in from nothing — "clunky and stalls", Jon
 * 07-24). Content is now present at frame 0 (composer.js's drawLayersFritzoid); drawShimmer is a
 * decoration layer painted ON TOP of already-present content — a handful of SHORT, seeded
 * raised-cosine triangle flourishes (an order of magnitude quicker than the old build-up), apex-up,
 * ink-first (no channel hues anywhere in fritzoid). Like the ambient background, drawShimmer is a
 * pure function of tN = (t/loopSec) % 1 with no persisted state, and is forced to exactly 0 at
 * tN=0 and tN=1 (loop seam) by a sin(pi*tN) guard multiplied into every pulse's alpha, on top of
 * pulse centers already being placed with a margin that keeps them clear of both seams.
 */
(function (root, factory) {
  const E = (typeof module !== 'undefined' && module.exports) ? require('./engine.js') : root.INTERCEPT_TEAMS;
  const api = factory(E);
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.INTERCEPT_FRITZOID = api;
})(typeof self !== 'undefined' ? self : globalThis, function (E) {

  // Ink palettes: low-saturation-only, ground-appropriate (Fritz "ink-first" rule — fritzoid uses
  // NO channel hues anywhere; the entire tile field + shimmer stay ink-only). Each entry's
  // max(r,g,b)-min(r,g,b) stays comfortably under the ink-discipline gate's 24 ceiling.
  const HALO_INKS = ['#0a0a0f', '#26262d', '#45454c', '#6b6b73'];   // carbon-tone inks on halo ground
  const CARBON_INKS = ['#ffffff', '#e2e2e6', '#c2c2c9', '#9d9da6']; // halo/grey inks on carbon ground

  // ===== canonical right-angle triangle (PORT VERBATIM — fritz-pattern.html triVerts) =====
  // Apex-up; lean L/R is a horizontal MIRROR only, never a rotation.
  function triVerts(cellSize, dir) {
    const half = cellSize * 0.5;
    if (dir === 'right') return [[-half, -half], [-half, half], [half, half]];
    return [[half, -half], [half, half], [-half, half]];
  }
  function flipDir(dir) { return dir === 'right' ? 'left' : 'right'; }

  // ===== deterministic hash noise (PORT VERBATIM — fritz-pattern.html/fritzoid-creator ns) =====
  function ns(x, y, s) {
    const a = Math.sin(x * 12.9898 + y * 78.233 + s) * 43758.5453;
    return a - Math.floor(a);
  }

  // ── buildFritzoid: static (seed-only) state, built once per spec — like buildComposer's look. ──
  function buildFritzoid(spec, resolved) {
    resolved = resolved || {};
    const W = spec.size.w, H = spec.size.h;
    // graphite is a GREY carbon — same dark-ground ink set, different fill (see VALID_GROUNDS).
    const ground = (spec.bg === 'carbon' || spec.bg === 'graphite') ? 'carbon' : 'halo';
    const loopSec = (resolved.speed && resolved.speed.loopSec) || 8;
    const seed = (resolved.seed != null ? resolved.seed : 11) >>> 0;
    const tileBase = resolved.tileBase || 84;
    const wavesPerLoop = Math.max(1, resolved.wavesPerLoop || 2);
    const inkAlpha = resolved.inkAlpha != null ? resolved.inkAlpha : 0.08;

    const rand = E.rng(seed);
    const inks = ground === 'carbon' ? CARBON_INKS : HALO_INKS;
    const groundColor = (spec.bg === 'graphite') ? '#26262d' : (ground === 'carbon' ? '#0a0a0f' : '#ffffff');

    // -- 1. Designed clusters (dominant ~40% of frame + 1-2 satellites) + a clear center copy
    //    zone, mirroring the keyline's designed-cluster philosophy (Jon's brief: "designed
    //    clusters... leaving clear copy zones", not wall-to-wall texture).
    const clusterCount = 2 + (rand() < 0.45 ? 1 : 0); // 2 or 3
    const clusters = [];
    for (let i = 0; i < clusterCount; i++) {
      const dominant = i === 0;
      const rx = (dominant ? 0.32 + rand() * 0.08 : 0.15 + rand() * 0.09) * W;
      const ry = (dominant ? 0.28 + rand() * 0.08 : 0.13 + rand() * 0.09) * H;
      const angle = (i / clusterCount) * Math.PI * 2 + rand() * 0.9;
      const dist = dominant ? 0.30 + rand() * 0.06 : 0.38 + rand() * 0.10;
      clusters.push({
        cx: W / 2 + Math.cos(angle) * dist * W,
        cy: H / 2 + Math.sin(angle) * dist * H,
        rx, ry,
      });
    }
    const copyZone = { x0: W * 0.225, y0: H * 0.225, x1: W * 0.775, y1: H * 0.775 };

    // -- 2. Grid of candidate tile cells -> keep only cells inside a cluster and outside the copy
    //    zone; mixed sizes (0.5x/1x/2x tileBase) and a seeded base lean per cell.
    const cols = Math.ceil(W / tileBase) + 2;
    const rows = Math.ceil(H / tileBase) + 2;
    const tiles = [];
    for (let row = -1; row <= rows; row++) {
      for (let col = -1; col <= cols; col++) {
        const cx = col * tileBase + tileBase / 2;
        const cy = row * tileBase + tileBase / 2;
        if (cx < -tileBase || cx > W + tileBase || cy < -tileBase || cy > H + tileBase) continue;
        if (cx > copyZone.x0 && cx < copyZone.x1 && cy > copyZone.y0 && cy < copyZone.y1) continue;
        let inCluster = false;
        for (const c of clusters) {
          const dx = (cx - c.cx) / c.rx, dy = (cy - c.cy) / c.ry;
          if (dx * dx + dy * dy <= 1) { inCluster = true; break; }
        }
        if (!inCluster) continue;
        const sizeRoll = ns(col, row, seed + 50);
        const size = sizeRoll < 0.55 ? tileBase : (sizeRoll < 0.85 ? tileBase * 0.5 : tileBase * 2);
        const baseDir = ns(col, row, seed + 70) > 0.5 ? 'right' : 'left';
        const inkIdx = Math.floor(ns(col, row, seed + 90) * inks.length) % inks.length;
        tiles.push({ col, row, cx, cy, size, baseDir, ink: inks[inkIdx] });
      }
    }

    // -- 3. Truchet sparse-wave schedule. Each of `wavesPerLoop` waves contributes a forward pass
    //    + a later return pass (same origin/radius/speed) -> every touched tile flips an EVEN
    //    number of times per loop, so it is back in baseDir by tN=1 (LOOP INVARIANT, enforced by
    //    construction rather than by per-tile bookkeeping).
    const waveEvents = [];
    if (tiles.length) {
      const slot = loopSec / wavesPerLoop;
      for (let i = 0; i < wavesPerLoop; i++) {
        const origin = tiles[Math.floor(rand() * tiles.length)];
        const slotStart = i * slot;
        const flipDur = slot * (0.08 + rand() * 0.05);       // ~0.5-0.8s at loopSec=8/wavesPerLoop=2
        const travelWindow = slot * (0.08 + rand() * 0.06);  // time for the front to cross radius R
        const passAStart = slotStart + slot * (0.12 + rand() * 0.06);
        const passBStart = slotStart + slot * (0.60 + rand() * 0.08);
        const R = tileBase * (2 + rand() * 2); // wavefront extent — a local ripple, not whole-canvas
        const speed = R / travelWindow;
        waveEvents.push({ origin, speed, R, flipDur, travelWindow, passes: [passAStart, passBStart] });
      }
    }

    // Flattened, gate/introspection-friendly wave schedule (seconds): one entry per pass, spanning
    // the full window in which ANY touched tile could be actively mid-squash (delay 0 .. R/speed,
    // plus the squash's own duration).
    const waves = [];
    waveEvents.forEach((ev) => {
      ev.passes.forEach((p) => waves.push({ start: +p.toFixed(4), dur: +(ev.travelWindow + ev.flipDur).toFixed(4) }));
    });

    // -- 4. Fast accent shimmer schedule (LOOP-03 replacement for the old slow per-layer cell-clip
    //    reveal): a handful of SHORT seeded raised-cosine flourishes spread one-per-slot across the
    //    loop (evenly-spaced slot + jitter), each a single small apex-up triangle accent anchored to
    //    a real tile position when tiles exist. Ink-only — no channel hues (fritzoid has no glitch).
    //    Pulse width stays a small fraction of the loop (fast flourish, not a slow build), and each
    //    pulse's [center-width/2, center+width/2] window is kept fully inside its own slot -> clear
    //    of both loop seams by construction (drawShimmer also applies its own sin(pi*tN) guard).
    const shimmerCount = 5;
    const shimmerSlot = 1 / shimmerCount;
    const shimmerPool = tiles.length ? tiles : null;
    const shimmerPulses = [];
    for (let i = 0; i < shimmerCount; i++) {
      // Width is a healthy majority of its slot (fast flourish that still leaves brief quiet gaps
      // at slot edges for a sparkle feel, never a full-loop wall of texture).
      const width = shimmerSlot * (0.55 + rand() * 0.25); // ~55%-80% of the slot
      const slotStart = i * shimmerSlot;
      const jitterMax = Math.max(0, shimmerSlot - width);
      const center = slotStart + width / 2 + rand() * jitterMax;
      const anchor = shimmerPool ? shimmerPool[Math.floor(rand() * shimmerPool.length)] : null;
      const cx = anchor ? anchor.cx : (0.2 + rand() * 0.6) * W;
      const cy = anchor ? anchor.cy : (0.2 + rand() * 0.6) * H;
      const size = tileBase * (0.6 + rand() * 0.9);
      const dir = rand() > 0.5 ? 'right' : 'left';
      const inkIdx = Math.floor(rand() * inks.length) % inks.length;
      const maxAlpha = Math.min(0.42, inkAlpha * (3 + rand() * 2));
      shimmerPulses.push({
        center: +center.toFixed(4), width: +width.toFixed(4), cx, cy, size, dir,
        ink: inks[inkIdx], maxAlpha,
      });
    }
    const shimmer = { pulses: shimmerPulses };

    return {
      W, H, loopSec, seed, ground, tiles, waveEvents, waves,
      groundColor, inkAlpha, shimmer,
      // A real time (seconds, within [0, loopSec)) at which the seed-picked origin tile of the
      // first wave is actively mid-squash (delay 0 -> arrival === passes[0] exactly).
      midFlipTime() {
        if (!waveEvents.length) return null;
        const ev = waveEvents[0];
        return ev.passes[0] + ev.flipDur / 2;
      },
    };
  }

  // Per-tile lean + squash-scale at tSec (seconds within the loop) — a pure function of the wave
  // schedule + tSec, no persisted state, so it is automatically loop-safe (see file header).
  function tileStateAt(tile, waveEvents, tSec) {
    const hits = [];
    for (const ev of waveEvents) {
      const d = Math.hypot(tile.cx - ev.origin.cx, tile.cy - ev.origin.cy);
      if (d > ev.R) continue;
      const delay = d / ev.speed;
      for (const passStart of ev.passes) hits.push({ arrival: passStart + delay, flipDur: ev.flipDur });
    }
    hits.sort((a, b) => a.arrival - b.arrival);

    let parity = 0;
    for (const h of hits) {
      if (tSec < h.arrival) break;
      const end = h.arrival + h.flipDur;
      if (tSec < end) {
        const u = (tSec - h.arrival) / h.flipDur;
        const scaleX = Math.max(0.0001, Math.abs(Math.cos(Math.PI * u))); // sine-ease squash 1->0->1
        const dirParity = u < 0.5 ? parity : (parity ^ 1); // direction swaps at the squash midpoint
        return { dir: dirParity === 0 ? tile.baseDir : flipDir(tile.baseDir), scaleX };
      }
      parity ^= 1;
    }
    return { dir: parity === 0 ? tile.baseDir : flipDir(tile.baseDir), scaleX: 1 };
  }

  // drawFritzoidBackground(ctx, state, t): pure canvas 2D API (paths/clip/alpha/composite/
  // fillRect) — no DOM, no offscreen canvas creation, no CSS — runs identically under node-canvas
  // and Chrome.
  function drawFritzoidBackground(ctx, state, t) {
    const { W, H, loopSec, tiles, waveEvents, groundColor, inkAlpha } = state;
    const tN = (t / loopSec) % 1;
    const tSec = tN * loopSec;

    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = 'source-over';
    ctx.fillStyle = groundColor;
    ctx.fillRect(0, 0, W, H);

    for (const tile of tiles) {
      const st = tileStateAt(tile, waveEvents, tSec);
      const verts = triVerts(tile.size, st.dir);
      ctx.save();
      ctx.translate(tile.cx, tile.cy);
      ctx.scale(st.scaleX, 1);
      ctx.globalAlpha = inkAlpha;
      ctx.fillStyle = tile.ink;
      ctx.beginPath();
      ctx.moveTo(verts[0][0], verts[0][1]);
      ctx.lineTo(verts[1][0], verts[1][1]);
      ctx.lineTo(verts[2][0], verts[2][1]);
      ctx.closePath();
      ctx.fill();
      ctx.restore();
    }
    ctx.globalAlpha = 1;
  }

  // drawShimmer(ctx, state, t, opts): fast, loop-resolving accent shimmer painted ON TOP of
  // already-present content (composer.js's drawLayersFritzoid calls this once per frame, after
  // present-content drawing — see this file's header). Pure function of tN = (t/loopSec) % 1, no
  // persisted state — same seamless-loop invariant as drawFritzoidBackground. Ink-first: paints
  // only the ambient ink palette (never a channel hue) at low alpha scaled by a raised-cosine
  // envelope per pulse, itself gated by a sin(pi*tN) seam-guard that is exactly 0 at tN=0/1.
  function drawShimmer(ctx, state, t, opts) {
    opts = opts || {};
    const loopSec = state.loopSec || 8;
    const tN = (t / loopSec) % 1;
    const shimmer = state.shimmer;
    if (!shimmer || !Array.isArray(shimmer.pulses) || !shimmer.pulses.length) return;

    // Seam guard: sin(pi*tN) is exactly 0 at tN=0 and tN=1 (and >0 everywhere strictly between),
    // so squaring it and multiplying into every pulse's alpha forces an exact zero at both loop
    // endpoints regardless of where any individual pulse's window happens to sit.
    const seamGuard = Math.sin(Math.PI * tN);
    if (seamGuard <= 0) return;
    const seamGuardSq = seamGuard * seamGuard;

    ctx.save();
    ctx.globalCompositeOperation = 'source-over';

    shimmer.pulses.forEach((pulse) => {
      const half = pulse.width / 2;
      const lo = pulse.center - half, hi = pulse.center + half;
      if (tN < lo || tN > hi) return;
      const localU = (tN - lo) / pulse.width;
      const bump = (1 - Math.cos(2 * Math.PI * localU)) / 2; // 0 at pulse edges, 1 at its midpoint
      const alpha = bump * seamGuardSq * pulse.maxAlpha;
      if (alpha <= 0) return;

      const verts = triVerts(pulse.size, pulse.dir);
      ctx.globalAlpha = alpha;
      ctx.fillStyle = pulse.ink;
      ctx.beginPath();
      ctx.moveTo(pulse.cx + verts[0][0], pulse.cy + verts[0][1]);
      ctx.lineTo(pulse.cx + verts[1][0], pulse.cy + verts[1][1]);
      ctx.lineTo(pulse.cx + verts[2][0], pulse.cy + verts[2][1]);
      ctx.closePath();
      ctx.fill();
    });

    ctx.globalAlpha = 1;
    ctx.restore();
  }

  return { buildFritzoid, drawFritzoidBackground, drawShimmer, triVerts, ns };
});
