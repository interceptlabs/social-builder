/* In-browser photo background removal — the static-app replacement for the server's /api/matte
 * (Python RMBG). Uses MediaPipe Selfie Segmentation (vendored locally under vendor/mediapipe/, no
 * CDN — CSP-safe on the Intercept host). Everything is lazy-loaded: the ~9MB wasm + 244KB model only
 * download when the user first asks to remove a background, so initial page load is unaffected.
 *
 * removeBackground(HTMLImageElement) -> Promise<dataURL(png, transparent where not-person)>.
 *
 * Sets globalThis.MATTING. Optimized for portraits (New Hire / Carousel heroes); it segments a PERSON,
 * so non-person subjects won't cut cleanly — those should use a pre-cut PNG.
 */
(function (root) {
  'use strict';

  var _segP = null;

  // Absolute base = the directory the app is served from (root locally, root behind /social-builder).
  // Using absolute URLs makes the dynamic import (which resolves relative to THIS script's core/ dir)
  // and MediaPipe's internal wasm/model fetches (which resolve relative to the document) agree.
  function appBase() { return new URL('.', document.baseURI).href; }

  var CDN = 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.18/';
  var CDN_MODEL = 'https://storage.googleapis.com/mediapipe-models/image_segmenter/selfie_segmenter/float16/latest/selfie_segmenter.tflite';

  // Build a segmenter from a given source (bundle .mjs + wasm dir + model). Two sources are tried in
  // order: the locally-vendored copy (self-contained, offline) and, if that 404s (e.g. a lean deploy
  // that omitted the ~9MB wasm because the host pipeline can't carry it), the jsdelivr CDN.
  function buildFrom(bundleUrl, wasmDir, modelUrl) {
    return import(bundleUrl).then(function (vision) {
      return vision.FilesetResolver.forVisionTasks(wasmDir).then(function (fileset) {
        return vision.ImageSegmenter.createFromOptions(fileset, {
          baseOptions: { modelAssetPath: modelUrl },
          runningMode: 'IMAGE',
          outputConfidenceMasks: true,
          outputCategoryMask: false,
        });
      });
    });
  }

  // Lazy-create the ImageSegmenter (only on first use). Local vendored files first, CDN fallback.
  function getSegmenter() {
    if (_segP) return _segP;
    var base = appBase();
    _segP = buildFrom(base + 'vendor/mediapipe/vision_bundle.mjs', base + 'vendor/mediapipe/wasm', base + 'vendor/mediapipe/selfie_segmenter.tflite')
      .catch(function () { return buildFrom(CDN + 'vision_bundle.mjs', CDN + 'wasm', CDN_MODEL); })
      .catch(function (e) { _segP = null; throw e; });
    return _segP;
  }

  // Build the transparent PNG from an image + its confidence mask. The mask (model resolution) is
  // painted as ALPHA into a small canvas, then bilinear-scaled up and composited over the photo with
  // 'destination-in' — a smooth feathered cutout with no per-pixel JS loop over the full image.
  function composite(img, mask) {
    var W = img.naturalWidth || img.width, H = img.naturalHeight || img.height;
    var mw = mask.width, mh = mask.height;
    var conf = mask.getAsFloat32Array();

    var maskCanvas = document.createElement('canvas');
    maskCanvas.width = mw; maskCanvas.height = mh;
    var mctx = maskCanvas.getContext('2d');
    var mimg = mctx.createImageData(mw, mh);
    var d = mimg.data;
    for (var i = 0; i < mw * mh; i++) {
      var a = conf[i]; a = a < 0 ? 0 : (a > 1 ? 1 : a);
      // Slight contrast on the alpha so semi-transparent halo pixels resolve cleaner without hard edges.
      a = a <= 0.5 ? (a * a * 2) : (1 - (1 - a) * (1 - a) * 2);
      var o = i * 4; d[o] = 255; d[o + 1] = 255; d[o + 2] = 255; d[o + 3] = Math.round(a * 255);
    }
    mctx.putImageData(mimg, 0, 0);

    var out = document.createElement('canvas');
    out.width = W; out.height = H;
    var octx = out.getContext('2d');
    octx.imageSmoothingEnabled = true; octx.imageSmoothingQuality = 'high';
    octx.drawImage(img, 0, 0, W, H);
    octx.globalCompositeOperation = 'destination-in';
    octx.drawImage(maskCanvas, 0, 0, W, H);
    octx.globalCompositeOperation = 'source-over';
    return out.toDataURL('image/png');
  }

  function removeBackground(img) {
    return getSegmenter().then(function (seg) {
      return new Promise(function (resolve, reject) {
        try {
          // Callback form: the result (and its masks) are only valid inside the callback, so we build
          // the output here before MediaPipe frees them.
          seg.segment(img, function (result) {
            try {
              var masks = result && result.confidenceMasks;
              if (!masks || !masks.length) { reject(new Error('segmentation produced no mask')); return; }
              resolve(composite(img, masks[0]));
            } catch (e) { reject(e); }
          });
        } catch (e) {
          // Older/newer API shape: synchronous return.
          try {
            var result2 = seg.segment(img);
            var m2 = result2 && result2.confidenceMasks;
            if (!m2 || !m2.length) { reject(new Error('segmentation produced no mask')); return; }
            var url = composite(img, m2[0]);
            if (result2.close) result2.close();
            resolve(url);
          } catch (e2) { reject(e2); }
        }
      });
    });
  }

  function loadImage(src) {
    return new Promise(function (resolve, reject) {
      var img = new Image();
      img.onload = function () { resolve(img); };
      img.onerror = function () { reject(new Error('could not load image')); };
      img.src = src;
    });
  }

  // Convenience: from a data URL / object URL straight to a matted data URL.
  function removeBackgroundFromUrl(src) {
    return loadImage(src).then(function (img) { return removeBackground(img); });
  }

  root.MATTING = {
    removeBackground: removeBackground,
    removeBackgroundFromUrl: removeBackgroundFromUrl,
    warmup: getSegmenter,
    available: function () { return typeof root.WebAssembly === 'object'; },
  };
})(typeof self !== 'undefined' ? self : this);
