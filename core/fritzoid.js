/* Fritzoid — the canon mark, sliced and chipped, reconfiguring in place.
 * UMD: sets globalThis.INTERCEPT_FRITZOID in the browser, module.exports in Node.
 * Depends on engine.js (INTERCEPT_TEAMS) for the seeded RNG — load it first.
 *
 * PORTED 2026-08-05 from `intercept-brand-kit/.fritz/generators/fritzoid-animator.html`
 * ("Fritzoid Animator — one mark, reconfiguring in place") per Jon: *"fritzoid should behave like
 * the latest fritzoid generator, not this grey vertical pattern thing. chips and slices should
 * appear and move in the same techniques."*
 *
 * This file previously held two wrong answers in a row. First a truchet tile field (a grid of
 * flipping triangles — a TEXTURE, and by 08-04 a coarser duplicate of fritzfield's own truchet
 * mode). Then a stack of angled bars, which took the words "angles, chips and slices" and invented
 * a composition around them instead of reading the generator. The generator does something specific
 * and it is not either of those:
 *
 *   THE MARK IS DRAWN, THEN CUT. One right triangle — the canon's own construction, vertical right
 *   edge, seated base, apex up — with horizontal SLOTS cut clean through it. What survives between
 *   the slots are REGISTERS, and the mark renders as one path, one trapezoid subpath per register.
 *   CHIPS are then seated on and under it from six archetypes with fixed placement rules: bars
 *   bridge a slice, the edge chip pins its right extreme to 324.005, the pixel clears the diagonal,
 *   the sliver sits below the tip line, blocks hug the right edge inside a register.
 *
 * Ported UNCHANGED, because these are the canon's construction and not free parameters: TRI /
 * RUN / xAt / MARK_BOX, BUDGET, ARCHETYPES, BLOCK_BUDGET, ZONES, slotInterval, registersFrom,
 * slotsLegal, all six SAMPLERS, chipLegal, reseat, the roster cast and its probabilities,
 * trianglePath, chipD, easeSine. Do not "tune" these here — fix them in the generator and re-port.
 *
 * chipLegal's `y < TIP_Y` clause is a BRAND rule wearing a bounds check's clothes: **the apex is
 * never covered.** It is applied to animated values exactly as to generated ones, so no in-between
 * frame can cut the apex, thin a register or breach the base corner.
 *
 * THE ANIMATION RULE, verbatim from the generator: *"The roster's KINDS are fixed for the life of
 * the design — animation resamples each element's numbers, it never swaps one archetype for
 * another."* The cast is decided once from the seed; what moves is every element's numbers.
 *
 * THE ONE ADAPTATION — and it is forced. The generator free-runs on wall-clock: each element holds a
 * from/to pair of legal values, travels between them on its own cadence, then picks a fresh target
 * forever. That can never return to its starting configuration, and every background in this app
 * must loop seamlessly. So the same technique is made periodic: each element gets a RING of `steps`
 * independently-sampled LEGAL targets, and eases around it with the generator's own easeSine. The
 * ring is cyclic, so the configuration at tN=1 IS the configuration at tN=0, by construction.
 * Elements share segment boundaries, which is the generator's own `sync: 100` mode; per-element
 * character comes from each having its own ring of targets. A short HOLD at each boundary is added
 * on top — a background wants settle points, and it is what keeps `state.waves` (the moving windows)
 * and the settled times between them meaningful for scripts/fritzoid-times.cjs.
 *
 * INK-FIRST: unchanged and gate-enforced. The generator paints the canon's colour palette and the
 * three channel hues; this file paints ONLY the low-saturation ground-appropriate inks below (the
 * colored glitch was removed 07-29 per Jon and scripts/verify-fritzoid.cjs asserts its absence).
 * Figure/ground is carried by ink VALUE instead of hue: the mark mid, under-chips darkest,
 * over-chips lightest so they read as chips taken out of it.
 *
 * SEAMLESS LOOP: every quantity is a pure function of tN = (t / loopSec) % 1 with no state persisted
 * across frames. The re-clamp passes that the generator runs statefully against "wherever the
 * neighbours are now" are run here against a per-frame SNAPSHOT of the eased values, which is the
 * same constraint resolved deterministically.
 *
 * STABLE INTROSPECTION CONTRACT: `state.waves` + `state.midFlipTime()` keep their truchet-era names
 * — scripts/fritzoid-times.cjs and scripts/verify-fritzoid.cjs consume them to pick "settled" vs
 * "mid-change" capture times, and both meanings survive. `triVerts` stays exported and canonical: it
 * is the sole apex-up vertex generator scripts/verify-brand-qa.cjs gates the app's geometry on, and
 * drawShimmer is a real caller.
 */
(function (root, factory) {
  const E = (typeof module !== 'undefined' && module.exports) ? require('./engine.js') : root.INTERCEPT_TEAMS;
  const api = factory(E);
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.INTERCEPT_FRITZOID = api;
})(typeof self !== 'undefined' ? self : globalThis, function (E) {

  // Ink palettes: low-saturation-only, ground-appropriate. Ordered dark -> light on halo and
  // light -> dark on carbon, so index 0 is always "most contrast against the ground".
  const HALO_INKS = ['#0a0a0f', '#26262d', '#45454c', '#6b6b73'];   // carbon-tone inks on halo ground
  const CARBON_INKS = ['#ffffff', '#e2e2e6', '#c2c2c9', '#9d9da6']; // halo/grey inks on carbon ground

  // ══ GEOMETRY — PORTED VERBATIM. The canon's construction: one right triangle with horizontal
  //    slots cut through it; right edge, diagonal slope, seated base and apex are structural.
  const LOCKUP_W = 324.005;
  const TRI = { xLeft: 259.277, xRight: 313.195, yBase: 63.8583, yApex: 0.4247 };
  TRI.h = TRI.yBase - TRI.yApex;
  TRI.w = TRI.xRight - TRI.xLeft;
  TRI.run = TRI.w / TRI.h;
  const RUN = 0.84999;
  const xAt = (y) => TRI.xLeft + TRI.run * (TRI.yBase - y);
  const MARK_BOX = { x: TRI.xLeft - 1, y: -1, w: +(LOCKUP_W - TRI.xLeft + 2).toFixed(3), h: 66.6 };

  const BUDGET = {
    gapWeights: [1, 2, 2], slotBandStep: 1.5, minRegister: 4.0,
    slotHeight: [1.6, 4.4], tipKeepout: 7.0, baseKeepout: 8.0,
  };
  const TIP_Y = TRI.yApex + BUDGET.tipKeepout;
  const ARCHETYPES = {
    barOuter: { layer: 'under', ground: 'dark', shape: 'wedge', w: [12, 27], h: [3.2, 7.6] },
    barInner: { layer: 'over', ground: 'base', shape: 'wedge', w: [8, 18], h: [3.2, 7.6] },
    pixel: { layer: 'under', ground: 'dark', shape: 'rect', w: [3.4, 9.5], h: [2.4, 6.2] },
    edge: { layer: 'under', ground: 'dark', shape: 'rect', w: [5.5, 10.5], h: [4.0, 8.0] },
    block: { layer: 'over', ground: 'base', shape: 'rect', w: [2.2, 6.8], h: [1.8, 4.6] },
    sliver: { layer: 'over', ground: 'base', shape: 'wedge', w: [2.4, 6.2], h: [2.4, 6.6] },
  };
  const BLOCK_BUDGET = { count: [5, 7], barPairChance: 0.55, extraBlocks: [0, 2], minSeparation: 0.8 };
  const ZONES = { blockFromRightEdge: [2.0, 16.0], pixelDepth: [1.0, 12.0], pixelDiagonalClearance: 2.0, sliverDepth: [0.6, 9.0] };

  // Brand palettes for COLOURED fritzoid, keyed to match fritzfield's PALETTES exactly so the app
  // has ONE palette vocabulary. Built from engine.js's `C` rather than re-typing the hexes, so the
  // channel colours have a single source. `ink` is the default and keeps the ink-first behaviour.
  const PALETTES = {
    ink: null,
    'fritz': [E.C.flarepop, E.C.wiretree, E.C.coolsweep],
    'flarepop-only': [E.C.flarepop],
    'wiretree-only': [E.C.wiretree],
    'coolsweep-only': [E.C.coolsweep],
    'hotcatch': [E.C.flarepop, E.C.coolsweep],
    'suedejacket': [E.C.flarepop, E.C.wiretree],
    'deepfield': [E.C.coolsweep, E.C.wiretree],
  };
  const PALETTE_KEYS = Object.keys(PALETTES);

  const DEFAULTS = {
    marks: 1,          // how many marks in the frame — the generator shows ONE
    markSize: 0.62,    // the mark box as a fraction of min(W,H)
    slices: 0,         // 0 = let the cast pick from BUDGET.gapWeights, else force 1-3
    chip: 1,           // scales the OPTIONAL archetypes' cast probabilities (1 = the canon's own)
    steps: 3,          // reconfigurations per loop
    inkAlpha: 0.16,
    // COLOUR (2026-08-05, Jon asked for colour controls). Default 'ink' keeps every existing spec,
    // golden and the ink-discipline gate exactly as they are; colour is opt-in.
    palette: 'ink',
    // PATTERN FILLS — the Weekly Pulse fritzoid patterns (src/fritzfield.js) painted INSIDE the
    // registers and/or chips instead of a flat fill. fritzfield is resolved lazily and only when
    // this is switched on, so fritzoid stays standalone for pages that never load it.
    fill: 'solid',        // 'solid' | 'pattern'
    fillTarget: 'mark',   // 'mark' | 'chips' | 'both'
    fillPattern: 'ov-nest',
    fillPalette: null,    // null => follow `palette`, or coolsweep-only when palette is 'ink'
    fillColorMode: 'diagonal',
    fillCell: 10,
    fillOpacity: null,    // null => derive from inkAlpha
  };
  // Fraction of each segment spent holding the current configuration before easing to the next.
  // The generator has no hold; this is the background adaptation (see the header).
  const HOLD = 0.35;

  // Lazy dual require/root-global lookup for fritzfield — the SAME pattern composer.js uses for its
  // style modules, resolved only when a pattern fill is actually asked for. Without this, every page
  // that loads fritzoid would have to load fritzfield too, and the frozen preview/index.html loads
  // neither by design.
  function getFritzField() {
    if (typeof module !== 'undefined' && module.exports) {
      try { return require('./fritzfield.js'); }
      catch (e) {
        if (e && e.code === 'MODULE_NOT_FOUND') throw new Error('fritzoid pattern fills need src/fritzfield.js');
        throw e;
      }
    }
    const r = typeof self !== 'undefined' ? self : globalThis;
    if (!r.INTERCEPT_FRITZFIELD) throw new Error('load src/fritzfield.js before src/fritzoid.js to use pattern fills');
    return r.INTERCEPT_FRITZFIELD;
  }

  const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
  const rf = (r, range) => range[0] + r() * (range[1] - range[0]);
  const easeSine = (p) => (1 - Math.cos(p * Math.PI)) / 2;
  function num(v, d) { return (typeof v === 'number' && isFinite(v)) ? v : d; }

  // ===== canonical right-angle triangle (PORT VERBATIM — fritz-pattern.html triVerts) =====
  // Apex-up; lean L/R is a horizontal MIRROR only, never a rotation. Sole vertex generator
  // scripts/verify-brand-qa.cjs gates on — do not change these two vertex sets.
  function triVerts(cellSize, dir) {
    const half = cellSize * 0.5;
    if (dir === 'right') return [[-half, -half], [-half, half], [half, half]];
    return [[half, -half], [half, half], [-half, half]];
  }

  // ===== deterministic hash noise (PORT VERBATIM — fritz-pattern.html/fritzoid-creator ns) =====
  function ns(x, y, s) {
    const a = Math.sin(x * 12.9898 + y * 78.233 + s) * 43758.5453;
    return a - Math.floor(a);
  }

  // ── slices (PORTED VERBATIM) ────────────────────────────────────────────────────────────────
  // A slot's legal interval given where the others currently sit. Expressed as a function so
  // generation and animation cannot drift apart.
  function slotInterval(slots, k) {
    const n = slots.length;
    const bottomRef = (k === 0) ? TRI.yBase : slots[k - 1].y - slots[k - 1].h;
    const topRef = (k === n - 1) ? TRI.yApex : slots[k + 1].y;
    const needAbove = (k === n - 1) ? BUDGET.tipKeepout : BUDGET.minRegister;
    return {
      min: Math.max(topRef + needAbove + slots[k].h, TIP_Y + slots[k].h),
      max: Math.min(bottomRef - BUDGET.minRegister, TRI.yBase - BUDGET.baseKeepout),
    };
  }
  function registersFrom(slots) {
    const regs = []; let y = TRI.yBase;
    for (const g of slots) { regs.push({ yBot: y, yTop: g.y }); y = g.y - g.h; }
    regs.push({ yBot: y, yTop: TRI.yApex });      // always lands on the apex
    return regs;
  }
  function slotsLegal(slots) {
    const regs = registersFrom(slots);
    for (const r of regs) if (r.yBot - r.yTop < BUDGET.minRegister - 0.01) return false;
    const top = regs[regs.length - 1];
    if (top.yBot - top.yTop < BUDGET.tipKeepout - 0.01) return false;
    for (const s of slots) {
      if (s.y - s.h < TIP_Y - 0.001) return false;
      if (s.y > TRI.yBase - BUDGET.baseKeepout + 0.001) return false;
      if (s.h < BUDGET.slotHeight[0] - 0.001 || s.h > BUDGET.slotHeight[1] + 0.001) return false;
    }
    return true;
  }

  // ── chips (SAMPLERS PORTED VERBATIM) ────────────────────────────────────────────────────────
  // ONE sampler per archetype, used both to cast the mark and to pick every animation target, so an
  // animated frame is constrained exactly as a generated one is.
  const SAMPLERS = {
    barOuter(r, ctx, el) {
      const slot = ctx.slots[Math.min(el.slotIdx, ctx.slots.length - 1)];
      const h = clamp(rf(r, ARCHETYPES.barOuter.h), 1.2, slot.h + 5.2);
      const w = rf(r, ARCHETYPES.barOuter.w);
      const x = clamp(TRI.xRight - w + rf(r, [3.5, 9.0]), TRI.xLeft + 2, TRI.xRight - 2);
      return { x, y: slot.y - slot.h - h, w: Math.min(w, TRI.xRight + 11 - x), h };
    },
    barInner(r, ctx, el) {
      const slot = ctx.slots[Math.min(el.slotIdx, ctx.slots.length - 1)];
      const h = clamp(rf(r, ARCHETYPES.barInner.h), 1.2, slot.h + 5.2);
      const w = rf(r, ARCHETYPES.barInner.w);
      const x = clamp(TRI.xRight - w, xAt(slot.y - slot.h) - 1, TRI.xRight - 3);
      return { x, y: slot.y - slot.h - h, w: TRI.xRight - x, h };
    },
    edge(r) {
      const w = rf(r, ARCHETYPES.edge.w), h = rf(r, ARCHETYPES.edge.h);
      const y = clamp(rf(r, [20, 44]), TRI.yApex + 6, TRI.yBase - h - 4);
      return { x: TRI.xRight + 10.81 - w, y, w, h };            // x + w = 324.005 exactly
    },
    pixel(r) {
      const w = rf(r, ARCHETYPES.pixel.w), h = rf(r, ARCHETYPES.pixel.h);
      const y = TIP_Y + rf(r, ZONES.pixelDepth);
      const maxX = xAt(y + h) - w - ZONES.pixelDiagonalClearance;
      if (maxX <= TRI.xLeft + 0.5) return null;
      return { x: clamp(rf(r, [TRI.xLeft + 1, TRI.xLeft + 20]), TRI.xLeft + 0.5, maxX), y, w, h };
    },
    sliver(r) {
      const w = rf(r, ARCHETYPES.sliver.w), h = rf(r, ARCHETYPES.sliver.h);
      const y = TIP_Y + rf(r, ZONES.sliverDepth);
      if (y + h >= TRI.yBase - 1) return null;
      return { x: clamp(xAt(y + h) + 0.8, TRI.xLeft, TRI.xRight - w - 0.6), y, w, h };
    },
    block(r, ctx, el) {
      const reg = ctx.regs[Math.min(el.regIdx, ctx.regs.length - 1)];
      const h = rf(r, ARCHETYPES.block.h);
      if (reg.yBot - reg.yTop < h + 2) return null;
      const y = reg.yTop + 1 + r() * (reg.yBot - reg.yTop - h - 2);
      const w = rf(r, ARCHETYPES.block.w);
      const nearMin = ZONES.blockFromRightEdge[0], nearMax = ZONES.blockFromRightEdge[1];
      const hiX = TRI.xRight - nearMin - w;
      const loX = Math.max(xAt(y + h) + 1.0, TRI.xRight - nearMax - w);
      if (loX > hiX) return null;
      return { x: loX + r() * (hiX - loX), y, w, h };
    },
  };

  /** Hard bounds on a chip (PORTED VERBATIM). Used on generated AND animated values alike. */
  function chipLegal(c) {
    if (!c || c.w <= 0 || c.h <= 0) return false;
    if (c.x < TRI.xLeft - 0.001) return false;
    if (c.x + c.w > LOCKUP_W + 0.001) return false;
    if (c.y < TIP_Y - 0.001) return false;              // the apex is never covered
    if (c.y + c.h > TRI.yBase + 0.001) return false;
    return true;
  }

  /** Keep a slot- or register-anchored chip in its seat after the slices move (PORTED VERBATIM). */
  function reseat(el, v, ctx) {
    v = Object.assign({}, v);
    if (el.kind === 'barOuter' || el.kind === 'barInner') {
      const sl = ctx.slots[Math.min(el.slotIdx, ctx.slots.length - 1)];
      v.y = sl.y - sl.h - v.h;
      if (el.kind === 'barInner') {
        v.x = clamp(v.x, xAt(sl.y - sl.h) - 1, TRI.xRight - 3); v.w = TRI.xRight - v.x;
      }
    } else if (el.kind === 'block') {
      const reg = ctx.regs[Math.min(el.regIdx, ctx.regs.length - 1)];
      v.y = clamp(v.y, reg.yTop + 1, Math.max(reg.yTop + 1, reg.yBot - v.h - 1));
      const nearMin = ZONES.blockFromRightEdge[0], nearMax = ZONES.blockFromRightEdge[1];
      const hi = TRI.xRight - nearMin - v.w;
      const lo = Math.max(xAt(v.y + v.h) + 1.0, TRI.xRight - nearMax - v.w);
      v.x = (lo <= hi) ? clamp(v.x, lo, hi) : v.x;
    } else if (el.kind === 'pixel') {
      v.x = Math.min(v.x, xAt(v.y + v.h) - v.w - ZONES.pixelDiagonalClearance);
    } else if (el.kind === 'sliver') {
      v.x = Math.max(v.x, xAt(v.y + v.h) + 0.8);
      v.x = Math.min(v.x, TRI.xRight - v.w - 0.6);
    } else if (el.kind === 'edge') {
      v.x = LOCKUP_W - v.w;                          // stays pinned to the right extreme
    }
    v.y = clamp(v.y, TIP_Y, TRI.yBase - v.h);
    return v;
  }

  /** Cast one mark: choose the slice count and the chip roster (PORTED, + the `chip` density knob
   *  and an optional forced slice count). The roster's KINDS are then fixed for life. */
  function castFromSeed(seed, chipDensity, forceSlots) {
    const r = E.rng(seed);
    for (let attempt = 0; attempt < 160; attempt++) {
      const nSlots = forceSlots || BUDGET.gapWeights[Math.floor(r() * BUDGET.gapWeights.length)];
      const hs = []; for (let i = 0; i < nSlots; i++) hs.push(+rf(r, BUDGET.slotHeight).toFixed(4));
      const lowest = TRI.yBase - BUDGET.baseKeepout;
      const highest = TIP_Y + BUDGET.minRegister;
      if (lowest <= highest) continue;
      const q = BUDGET.slotBandStep, edges = [];
      let guard = 0, ok = true;
      for (let i = 0; i < nSlots; i++) {
        let placed = false;
        while (!placed && guard++ < 300) {
          const y = +(Math.round((highest + r() * (lowest - highest)) / q) * q).toFixed(4);
          if (y < highest - 0.001 || y > lowest + 0.001) continue;
          if (edges.some((e, k) => Math.abs(y - e) < hs[k] + BUDGET.minRegister)) continue;
          edges.push(y); placed = true;
        }
        if (!placed) { ok = false; break; }
      }
      if (!ok) continue;
      const slots = edges.map((y, i) => ({ y, h: hs[i] })).sort((a, b) => b.y - a.y);
      if (!slotsLegal(slots)) continue;
      const regs = registersFrom(slots);

      // the roster, in the canon's own order and proportions
      const roster = [];
      const slotIdx = Math.floor(r() * slots.length);
      roster.push({ kind: 'barOuter', slotIdx });
      if (r() < BLOCK_BUDGET.barPairChance * chipDensity) roster.push({ kind: 'barInner', slotIdx });
      roster.push({ kind: 'edge' });
      if (r() < 0.85 * chipDensity) roster.push({ kind: 'pixel' });
      if (r() < 0.8 * chipDensity) roster.push({ kind: 'sliver' });
      const extra = Math.round(rf(r, BLOCK_BUDGET.extraBlocks));
      for (let i = 0; i < extra + 1; i++) roster.push({ kind: 'block', regIdx: Math.floor(r() * regs.length) });
      if (roster.length < BLOCK_BUDGET.count[0]) continue;

      const els = [];
      let bad = false;
      for (const spec of roster.slice(0, BLOCK_BUDGET.count[1])) {
        const a = ARCHETYPES[spec.kind];
        const el = Object.assign({}, spec, { layer: a.layer, ground: a.ground, shape: a.shape });
        const v = SAMPLERS[spec.kind](r, { slots, regs }, el);
        if (!chipLegal(v)) { bad = true; break; }
        el.v0 = v;
        els.push(el);
      }
      if (bad || els.length < BLOCK_BUDGET.count[0]) continue;
      // the right extreme must be touched or the lockup's painted box shifts
      if (!els.some((e) => Math.abs(e.v0.x + e.v0.w - LOCKUP_W) < 0.01)) continue;
      return { seed, slots, els, rand: r };
    }
    return null;
  }

  // ── the loop adaptation: a cyclic RING of legal targets per element ─────────────────────────
  //
  // The generator picks a fresh legal target whenever an element's timer expires, forever. Here the
  // targets are drawn UP FRONT — `steps` of them per element, indexed cyclically — using the very
  // same samplers and the same legality gate, so every ring entry is a configuration the generator
  // itself could have produced. Cyclic indexing is what closes the loop.
  function buildSlotRings(design, steps, r) {
    return design.slots.map((sl, k) => {
      const ring = [{ y: sl.y, h: sl.h }];
      const live = design.slots.map((s) => ({ y: s.y, h: s.h }));
      for (let i = 1; i < steps; i++) {
        let picked = ring[i - 1];
        for (let a = 0; a < 8; a++) {
          const h = rf(r, BUDGET.slotHeight);
          const probe = live.map((s, j) => (j === k ? { y: s.y, h } : { y: s.y, h: s.h }));
          const iv = slotInterval(probe, k);
          if (iv.min >= iv.max) continue;
          const y = iv.min + r() * (iv.max - iv.min);
          probe[k] = { y, h };
          if (slotsLegal(probe)) { picked = { y, h }; break; }
        }
        ring.push(picked);
        live[k] = { y: picked.y, h: picked.h };
      }
      return ring;
    });
  }

  function buildChipRings(design, steps, r) {
    return design.els.map((el) => {
      const ring = [el.v0];
      for (let i = 1; i < steps; i++) {
        let picked = ring[i - 1];
        for (let a = 0; a < 8; a++) {
          const cand = SAMPLERS[el.kind](r, { slots: design.slots, regs: registersFrom(design.slots) }, el);
          if (chipLegal(cand)) { picked = cand; break; }
        }
        ring.push(picked);
      }
      return ring;
    });
  }

  // Position on a cyclic ring at tN: hold, then ease with the generator's own easeSine.
  // At tN=0 and tN=1 the index lands on ring[0] with e=0, so the seam holds by construction.
  function ringAt(ring, tN, steps) {
    const u = clamp(tN, 0, 1) * steps;
    const i = Math.floor(u) % steps;
    const f = u - Math.floor(u);
    const e = easeSine(clamp((f - HOLD) / (1 - HOLD), 0, 1));
    return { a: ring[i], b: ring[(i + 1) % steps], e };
  }
  const lerp = (a, b, e) => a + (b - a) * e;

  // ── buildFritzoid: static (seed-only) state, built once per spec. ───────────────────────────
  function buildFritzoid(spec, resolved) {
    resolved = resolved || {};
    const W = spec.size.w, H = spec.size.h;
    const ground = (spec.bg === 'carbon' || spec.bg === 'graphite') ? 'carbon' : 'halo';
    const loopSec = (resolved.speed && resolved.speed.loopSec) || 8;
    const seed = (resolved.seed != null ? resolved.seed : 11) >>> 0;
    const inkAlpha = num(resolved.inkAlpha, DEFAULTS.inkAlpha);
    const steps = clamp(Math.round(num(resolved.steps, DEFAULTS.steps)), 2, 8);
    const chipDensity = clamp(num(resolved.chip, DEFAULTS.chip), 0, 1);
    const forceSlots = clamp(Math.round(num(resolved.slices, DEFAULTS.slices)), 0, 3);
    const markCount = clamp(Math.round(num(resolved.marks, DEFAULTS.marks)), 1, 4);
    const markSize = clamp(num(resolved.markSize, DEFAULTS.markSize), 0.15, 1.4);

    const inks = ground === 'carbon' ? CARBON_INKS : HALO_INKS;
    const groundColor = (spec.bg === 'graphite') ? '#26262d' : (ground === 'carbon' ? '#0a0a0f' : '#ffffff');
    const base = Math.min(W, H);
    const place = E.rng((seed ^ 0x5bf03) >>> 0);

    // COLOUR. 'ink' keeps the ink-first behaviour exactly; a brand palette recolours the mark and its
    // chips. The generator's rule is "colour CUTS, never blends" — a chip takes its next colour at a
    // configuration boundary rather than crossfading — so colour is indexed by the CURRENT segment,
    // and lands on index 0 at both tN=0 and tN=1 like every other quantity here.
    const paletteKey = PALETTES[resolved.palette] !== undefined ? resolved.palette : 'ink';
    const pal = PALETTES[paletteKey];
    const colored = !!pal;

    // Pattern fills. Resolved at BUILD time so drawing never touches module lookup.
    const fillMode = resolved.fill === 'pattern' ? 'pattern' : 'solid';
    const fillTarget = ['mark', 'chips', 'both'].indexOf(resolved.fillTarget) >= 0 ? resolved.fillTarget : 'mark';
    let field = null, fieldMod = null;
    if (fillMode === 'pattern') {
      fieldMod = getFritzField();
      const fillPalette = resolved.fillPalette || (colored ? paletteKey : 'coolsweep-only');
      field = fieldMod.buildFritzField({ size: { w: W, h: H }, bg: spec.bg }, {
        pattern: resolved.fillPattern || DEFAULTS.fillPattern,
        palette: fillPalette,
        colorMode: resolved.fillColorMode || DEFAULTS.fillColorMode,
        cell: clamp(Math.round(num(resolved.fillCell, DEFAULTS.fillCell)), 4, 40),
        // The pattern is INSIDE the mark, so it can sit far heavier than a wall-to-wall background
        // would: the shape does the restraint, the alpha does not have to.
        opacity: clamp(num(resolved.fillOpacity, Math.min(0.9, inkAlpha * 3.2)), 0.02, 1),
        seed,
        speed: { loopSec },
      });
    }

    const marks = [];
    for (let m = 0; m < markCount; m++) {
      // Each mark is an independent cast. A cast can legitimately fail its 160 attempts, so walk the
      // seed rather than silently dropping the mark.
      let design = null;
      for (let s = 0; s < 24 && !design; s++) design = castFromSeed((seed + m * 0x9E3779B1 + s * 7919) >>> 0, chipDensity, forceSlots);
      if (!design) continue;
      const r = design.rand;
      const slotRings = buildSlotRings(design, steps, r);
      const chipRings = buildChipRings(design, steps, r);
      const size = base * markSize * (m === 0 ? 1 : 0.42 + place() * 0.22);
      const scale = size / MARK_BOX.w;
      // The dominant mark sits on the position bias; satellites scatter around it.
      const bx = num((resolved.position || {}).biasX, 0.16);
      const by = num((resolved.position || {}).biasY, 0.12);
      const cx = m === 0 ? W / 2 + bx * W * 0.5 : W / 2 + (place() * 2 - 1) * W * 0.42;
      const cy = m === 0 ? H / 2 + by * H * 0.5 : H / 2 + (place() * 2 - 1) * H * 0.42;
      // Colour rings. Drawn ONLY when a brand palette is in play, so the ink default makes no extra
      // rng calls and its geometry is unchanged by this feature existing.
      let markColors = null, chipColors = null;
      if (colored) {
        markColors = [];
        for (let i = 0; i < steps; i++) markColors.push(pal[Math.floor(place() * pal.length) % pal.length]);
        chipColors = design.els.map(() => {
          const ring = [];
          for (let i = 0; i < steps; i++) ring.push(pal[Math.floor(place() * pal.length) % pal.length]);
          return ring;
        });
      }
      marks.push({
        design, slotRings, chipRings, scale, markColors, chipColors,
        // Canvas offset so the mark box centres on (cx, cy).
        ox: cx - (MARK_BOX.x + MARK_BOX.w / 2) * scale,
        oy: cy - (MARK_BOX.y + MARK_BOX.h / 2) * scale,
        inkMark: inks[1], inkUnder: inks[0], inkOver: inks[3],
      });
    }

    // Flattened reconfiguration schedule (seconds): one entry per transition window. The gaps
    // BETWEEN them are the holds, which is what scripts/fritzoid-times.cjs reads a settled time from.
    const waves = [];
    const slot = loopSec / steps;
    for (let i = 0; i < steps; i++) {
      waves.push({ start: +(i * slot + slot * HOLD).toFixed(4), dur: +(slot * (1 - HOLD)).toFixed(4) });
    }

    // Fast accent shimmer (Phase 9 / LOOP-03) — short seeded raised-cosine flourishes painted ON TOP
    // of already-present content by composer.js's drawLayersFritzoid. Ink-only; each pulse's window
    // is kept inside its own slot so it is clear of both loop seams by construction.
    const shimmerCount = 5, shimmerSlot = 1 / shimmerCount, shimmerPulses = [];
    for (let i = 0; i < shimmerCount; i++) {
      const width = shimmerSlot * (0.55 + place() * 0.25);
      const jitterMax = Math.max(0, shimmerSlot - width);
      const center = i * shimmerSlot + width / 2 + place() * jitterMax;
      const anchor = marks.length ? marks[Math.floor(place() * marks.length)] : null;
      shimmerPulses.push({
        center: +center.toFixed(4), width: +width.toFixed(4),
        cx: anchor ? anchor.ox + xAt(TRI.yBase * 0.5) * anchor.scale : (0.2 + place() * 0.6) * W,
        cy: anchor ? anchor.oy + TRI.yBase * 0.5 * anchor.scale : (0.2 + place() * 0.6) * H,
        size: base * 0.05 * (0.7 + place() * 1.1),
        dir: place() > 0.5 ? 'right' : 'left',
        ink: inks[Math.floor(place() * inks.length) % inks.length],
        maxAlpha: Math.min(0.42, inkAlpha * (3 + place() * 2)),
      });
    }

    return {
      W, H, loopSec, seed, ground, groundColor, inkAlpha, steps, marks, waves,
      palette: paletteKey, colored, fill: fillMode, fillTarget, field, fieldMod,
      shimmer: { pulses: shimmerPulses },
      midFlipTime() { return waves.length ? waves[0].start + waves[0].dur / 2 : null; },
    };
  }

  // Resolve one mark's live slots + chip values at tN. Pure function of tN: the generator's stateful
  // "re-clamp against wherever the neighbours are now" passes run here against a per-frame snapshot.
  function markStateAt(mk, tN, steps) {
    // Slices first — ease each, then re-clamp against the eased snapshot, because two slices
    // travelling at once can crowd each other mid-flight even when both endpoints are legal.
    const eased = mk.slotRings.map((ring) => {
      const { a, b, e } = ringAt(ring, tN, steps);
      return { y: lerp(a.y, b.y, e), h: lerp(a.h, b.h, e) };
    });
    const slots = eased.map((s) => ({ y: s.y, h: s.h }));
    for (let k = 0; k < slots.length; k++) {
      const iv = slotInterval(slots, k);
      if (iv.min < iv.max) slots[k].y = clamp(slots[k].y, iv.min, iv.max);
    }
    // Last-ditch: never render an illegal slice set — fall back to the ring's own legal entry.
    let live = slots;
    if (!slotsLegal(slots)) {
      const i = Math.floor(clamp(tN, 0, 1) * steps) % steps;
      live = mk.slotRings.map((ring) => ({ y: ring[i].y, h: ring[i].h }));
    }
    const regs = registersFrom(live);
    const ctx = { slots: live, regs };

    const chips = mk.design.els.map((el, i) => {
      const { a, b, e } = ringAt(mk.chipRings[i], tN, steps);
      let v = { x: lerp(a.x, b.x, e), y: lerp(a.y, b.y, e), w: lerp(a.w, b.w, e), h: lerp(a.h, b.h, e) };
      v = reseat(el, v, ctx);
      if (!chipLegal(v)) {
        const seated = reseat(el, a, ctx);
        v = chipLegal(seated) ? seated : a;
      }
      return { el, v };
    });
    return { regs, chips };
  }

  // The triangle-with-slices as ONE path, one trapezoid subpath per register (PORTED).
  // addRegisters/addChip only EMIT subpaths — they never call beginPath — so the same tracing can
  // build a fill path or a clip region covering several shapes at once (that is what lets a pattern
  // fill cost one field draw instead of one per chip).
  function addRegisters(ctx2d, regs, mk) {
    for (const reg of regs) {
      const xb = xAt(reg.yBot), xt = xAt(reg.yTop);
      ctx2d.moveTo(mk.ox + xb * mk.scale, mk.oy + reg.yBot * mk.scale);
      ctx2d.lineTo(mk.ox + TRI.xRight * mk.scale, mk.oy + reg.yBot * mk.scale);
      ctx2d.lineTo(mk.ox + TRI.xRight * mk.scale, mk.oy + reg.yTop * mk.scale);
      ctx2d.lineTo(mk.ox + xt * mk.scale, mk.oy + reg.yTop * mk.scale);
      ctx2d.closePath();
    }
  }

  // A chip: `rect` archetypes are rectangles; `wedge` archetypes carry the mark's own diagonal on
  // their left edge (PORTED — chipD's inset = min(RUN*h, w)).
  function addChip(ctx2d, el, v, mk) {
    const X = (x) => mk.ox + x * mk.scale, Y = (y) => mk.oy + y * mk.scale;
    if (el.shape === 'rect') {
      ctx2d.rect(X(v.x), Y(v.y), v.w * mk.scale, v.h * mk.scale);
      return;
    }
    const inset = Math.min(RUN * v.h, v.w);
    ctx2d.moveTo(X(v.x), Y(v.y + v.h));
    ctx2d.lineTo(X(v.x + v.w), Y(v.y + v.h));
    ctx2d.lineTo(X(v.x + v.w), Y(v.y));
    ctx2d.lineTo(X(v.x + inset), Y(v.y));
    ctx2d.closePath();
  }

  // drawFritzoidBackground(ctx, state, t): pure canvas 2D API — no DOM, no offscreen canvas, no CSS
  // — so it runs identically under node-canvas and Chrome.
  function drawFritzoidBackground(ctx, state, t) {
    const { W, H, loopSec, marks, groundColor, inkAlpha, steps, colored } = state;
    const tN = (t / loopSec) % 1;
    // Which segment we are in — colour CUTS on this boundary rather than blending across it.
    const seg = Math.floor(clamp(tN, 0, 1) * steps) % steps;
    const patMark = state.fill === 'pattern' && (state.fillTarget === 'mark' || state.fillTarget === 'both');
    const patChips = state.fill === 'pattern' && (state.fillTarget === 'chips' || state.fillTarget === 'both');

    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = 'source-over';
    ctx.fillStyle = groundColor;
    ctx.fillRect(0, 0, W, H);

    for (const mk of marks) {
      const { regs, chips } = markStateAt(mk, tN, steps);
      const markFill = colored ? mk.markColors[seg] : mk.inkMark;
      const chipFill = (i, el) => (colored ? mk.chipColors[i][seg] : (el.layer === 'under' ? mk.inkUnder : mk.inkOver));

      // under-layer chips, then the sliced mark, then over-layer chips — the canon's draw order.
      ctx.globalAlpha = inkAlpha;
      chips.forEach(({ el, v }, i) => {
        if (el.layer !== 'under' || patChips) return;
        ctx.fillStyle = chipFill(i, el); ctx.beginPath(); addChip(ctx, el, v, mk); ctx.fill();
      });
      if (!patMark) {
        ctx.fillStyle = markFill; ctx.beginPath(); addRegisters(ctx, regs, mk); ctx.fill();
      }
      chips.forEach(({ el, v }, i) => {
        if (el.layer !== 'over' || patChips) return;
        ctx.fillStyle = chipFill(i, el); ctx.beginPath(); addChip(ctx, el, v, mk); ctx.fill();
      });

      // PATTERN FILL — the shapes become a clip region and the Weekly Pulse field is drawn inside it
      // ONCE, rather than once per chip. drawFritzFieldAt lays its own ground down first, which
      // inside a clip is exactly what "fill this shape with the pattern" means.
      //
      // Registers and chips are two SEPARATE passes on purpose. Putting them in one clip path looked
      // fine — the chips punched neat holes in the pattern — but only because ctx.rect() winds
      // clockwise while the register trapezoids wind the other way, so the nonzero rule cancelled
      // them. That is an accident of winding order, not a decision, and it would flip the moment a
      // register's vertex order changed or a renderer resolved the rule differently. Two passes cost
      // one extra field draw and mean exactly what they say.
      if (patMark) {
        ctx.save();
        ctx.beginPath(); addRegisters(ctx, regs, mk); ctx.clip();
        state.fieldMod.drawFritzFieldAt(ctx, state.field, tN);
        ctx.restore();
      }
      if (patChips) {
        ctx.save();
        ctx.beginPath(); chips.forEach(({ el, v }) => addChip(ctx, el, v, mk)); ctx.clip();
        state.fieldMod.drawFritzFieldAt(ctx, state.field, tN);
        ctx.restore();
      }
    }
    ctx.globalAlpha = 1;
  }

  // drawShimmer(ctx, state, t, opts): fast, loop-resolving accent shimmer painted ON TOP of
  // already-present content. Pure function of tN with no persisted state. Ink-first, gated by a
  // sin(pi*tN) seam-guard that is exactly 0 at both loop endpoints.
  function drawShimmer(ctx, state, t, opts) {
    opts = opts || {};
    const loopSec = state.loopSec || 8;
    const tN = (t / loopSec) % 1;
    const shimmer = state.shimmer;
    if (!shimmer || !Array.isArray(shimmer.pulses) || !shimmer.pulses.length) return;

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

  return {
    DEFAULTS, PALETTES, PALETTE_KEYS, buildFritzoid, drawFritzoidBackground, drawShimmer, triVerts, ns,
    // Exported for the gates + anyone re-porting from the generator.
    TRI, TIP_Y, MARK_BOX, ARCHETYPES, BUDGET, ZONES, chipLegal, slotsLegal, registersFrom,
    castFromSeed, markStateAt, easeSine, xAt,
  };
});
