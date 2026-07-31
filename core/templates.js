/* Template registry (browser) — loads the UNMODIFIED server template modules (templates-src/*.cjs)
 * verbatim, so the composition specs are byte-identical to what the Node pipeline produced. No hand-
 * porting: each .cjs only `require`s ratios.js. We evaluate each module with a minimal require/module
 * shim and register module.exports by its .name.
 *
 * Exposes globalThis.SOCIAL_TEMPLATES = {
 *   load(): Promise<void>,                 // must resolve before expand()/list()
 *   list(): [{ name, label, slots:[{key,type,default}], defaultGround, hasPhoto }],
 *   get(name): moduleExports,
 *   expand(name, slots, opts): spec,       // thin wrapper over the module's expand()
 * }
 */
(function (root) {
  'use strict';

  var TEMPLATE_NAMES = ['new-hire', 'carousel', 'quote', 'hot-take', 'event'];
  var LABELS = {
    'new-hire': 'New Hire', 'carousel': 'Carousel', 'quote': 'Quote',
    'hot-take': 'Hot Take', 'event': 'Event',
  };

  // brand-rules stub — the only export imported is ON_TOKEN_HEX (an allowlist Set); text-palette.cjs
  // imports it but does not consult it inside expand(). Provided verbatim so the import never throws.
  var ON_TOKEN_HEX = new Set([
    '#ff00e5', '#1a7aff', '#00d862', '#ffffff', '#0a0a0f',
    '#26262d', '#45454c', '#6b6b73', '#e2e2e6', '#c2c2c9', '#9d9da6',
    '#8846c9', '#1dabc1', '#5154c4', '#ff44f9', '#ffa9f8', '#ff52f9',
    '#3a3a4a', '#b9b9c6',
  ]);

  function shimRequire(path) {
    if (/ratios/.test(path)) return root.INTERCEPT_RATIOS;
    if (/engine/.test(path)) return root.INTERCEPT_TEAMS;
    if (/brand-rules/.test(path)) return { ON_TOKEN_HEX: ON_TOKEN_HEX };
    throw new Error('template shim: unexpected require("' + path + '")');
  }

  var _registry = null;

  function evalModule(src, name) {
    var module = { exports: {} };
    // eslint-disable-next-line no-new-func
    var fn = new Function('require', 'module', 'exports', src + '\n//# sourceURL=templates-src/' + name + '.cjs');
    fn(shimRequire, module, module.exports);
    return module.exports;
  }

  // Derive the UI content fields from the module's `defaults`. String-valued slots become text inputs;
  // structural keys (lockup/ground/theme/lockupInk) and non-string slots are skipped for the field UI
  // but still flow through as defaults. Arrays (e.g. carousel beats) are exposed as a JSON textarea.
  var SKIP_FIELDS = { lockup: 1, ground: 1, theme: 1, lockupInk: 1, colors: 1, sizeScales: 1 };
  function fieldsFor(defaults) {
    var out = [];
    Object.keys(defaults || {}).forEach(function (k) {
      if (SKIP_FIELDS[k]) return;
      var v = defaults[k];
      if (typeof v === 'string') out.push({ key: k, type: v.length > 40 ? 'textarea' : 'text', def: v });
      else if (typeof v === 'number') out.push({ key: k, type: 'text', def: String(v) });
      else if (Array.isArray(v) || (v && typeof v === 'object')) out.push({ key: k, type: 'json', def: JSON.stringify(v, null, 2) });
    });
    return out;
  }

  // Brand text-color palette (Phase-14 text-palette.cjs) — loaded verbatim via the same shim, exposed
  // as SOCIAL_PALETTE for the builder's per-slot color swatches + size range.
  function loadPalette() {
    if (root.SOCIAL_PALETTE) return Promise.resolve();
    return fetch('templates-src/text-palette.cjs').then(function (r) { return r.text(); }).then(function (src) {
      var mod = evalModule(src, 'text-palette');
      root.SOCIAL_PALETTE = {
        swatches: mod.swatchList(),
        resolve: mod.resolveColor,
        sizeRange: mod.SIZE_SCALE_RANGE,
      };
    }).catch(function () { root.SOCIAL_PALETTE = { swatches: [], resolve: function () {}, sizeRange: { min: 0.6, max: 1.6, default: 1 } }; });
  }

  function load() {
    if (_registry) return loadPalette();
    return loadPalette().then(function () { return Promise.all(TEMPLATE_NAMES.map(function (name) {
      return fetch('templates-src/' + name + '.cjs').then(function (r) {
        if (!r.ok) throw new Error('failed to load template ' + name + ' (' + r.status + ')');
        return r.text();
      }).then(function (src) {
        var mod = evalModule(src, name);
        return { name: name, mod: mod };
      });
    })).then(function (loaded) {
      _registry = {};
      loaded.forEach(function (entry) {
        var mod = entry.mod;
        _registry[entry.name] = {
          name: entry.name,
          label: LABELS[entry.name] || entry.name,
          mod: mod,
          defaults: mod.defaults || {},
          fields: fieldsFor(mod.defaults || {}),
          defaultGround: (mod.defaults && mod.defaults.ground) || 'halo',
          hasPhoto: !!(mod.defaults && 'photo' in mod.defaults),
        };
      });
    });
    });
  }

  function list() {
    return TEMPLATE_NAMES.filter(function (n) { return _registry && _registry[n]; })
      .map(function (n) {
        var t = _registry[n];
        return { name: t.name, label: t.label, slots: t.fields, defaultGround: t.defaultGround, hasPhoto: t.hasPhoto };
      });
  }

  function get(name) { return _registry && _registry[name]; }

  function expand(name, slots, opts) {
    var t = get(name);
    if (!t) throw new Error('unknown template: ' + name);
    return t.mod.expand(slots || {}, opts || {});
  }

  root.SOCIAL_TEMPLATES = { load: load, list: list, get: get, expand: expand, defaults: function (n) { var t = get(n); return t ? t.defaults : {}; } };
})(typeof self !== 'undefined' ? self : this);
