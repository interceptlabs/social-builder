/* WebCodecs MP4 exporter — the static-app replacement for the server's /api/export (node-canvas +
 * ffmpeg). Re-uses the SAME browser composer + the SAME rasterized plate canvases the live preview
 * uses, so the exported MP4 is frame-for-frame what the preview shows. Encodes H.264 in the browser
 * via VideoEncoder and muxes to a real .mp4 with the vendored mp4-muxer (global Mp4Muxer).
 *
 * Background parity with the composer's drawBackground gate:
 *   - procedural (keyline / fritzoid): drawFrame() paints ground + layers.
 *   - backgroundVideo / backgroundImage: the composer leaves the frame TRANSPARENT, so here we paint
 *     base color -> (image) -> (video @opacity) UNDER, then drawLayers() the transparent copy on top —
 *     exactly what render-core.cjs did with ffmpeg, but on a 2D canvas.
 *
 * Chromium-only by design (WebCodecs). isSupported() lets the UI degrade gracefully elsewhere.
 *
 * Sets globalThis.WEBCODECS_EXPORT.
 */
(function (root) {
  'use strict';

  function isSupported() {
    return typeof root.VideoEncoder === 'function' &&
           typeof root.VideoFrame === 'function' &&
           typeof root.Mp4Muxer !== 'undefined';
  }

  // Prefer High@L4.0/4.2 (covers up to 1920x1080 and 1080x1920), fall back through Main/Baseline.
  var CODEC_CANDIDATES = ['avc1.640028', 'avc1.64002A', 'avc1.4D0028', 'avc1.42E01F'];

  function pickCodec(W, H, fps) {
    var base = { width: W, height: H, framerate: fps, bitrate: bitrateFor(W, H, fps), avc: { format: 'avc' } };
    return (function next(i) {
      if (i >= CODEC_CANDIDATES.length) return Promise.resolve(null);
      var cfg = Object.assign({}, base, { codec: CODEC_CANDIDATES[i] });
      return root.VideoEncoder.isConfigSupported(cfg).then(function (res) {
        return (res && res.supported) ? cfg : next(i + 1);
      }).catch(function () { return next(i + 1); });
    })(0);
  }

  function bitrateFor(W, H, fps) {
    // ~0.12 bits/px/frame — visually clean for flat brand graphics without bloating the file.
    return Math.round(W * H * fps * 0.12);
  }

  // Seek a muted <video> to an exact time and resolve when the frame is presentable. requestVideoFrame-
  // Callback gives us the true decoded frame; fall back to the 'seeked' event. (Retained as the
  // fallback path for browsers without requestVideoFrameCallback — the fast path pre-decodes instead.)
  function seekVideo(video, time) {
    return new Promise(function (resolve) {
      var done = false;
      function finish() { if (!done) { done = true; resolve(); } }
      try { video.currentTime = time; } catch (e) { finish(); return; }
      if (typeof video.requestVideoFrameCallback === 'function') {
        video.requestVideoFrameCallback(function () { finish(); });
        setTimeout(finish, 200);
      } else {
        video.addEventListener('seeked', finish, { once: true });
        setTimeout(finish, 200);
      }
    });
  }

  // Pre-decode a loop ONCE by playing it through and grabbing every presented frame via
  // requestVideoFrameCallback (no mp4 demuxer, no per-frame seeking). Returns a sorted array of
  // { t, bmp } (mediaTime + ImageBitmap). Cached by src so repeated exports of the same loop are
  // instant. This is the fix for the old per-frame seek bottleneck (~0.5s/frame -> one ~loop-length
  // pass, then compositing is synchronous and fast).
  var _loopCache = {};
  function decodeLoopFrames(video) {
    var key = video.currentSrc || video.src;
    if (_loopCache[key]) return Promise.resolve(_loopCache[key]);
    if (typeof video.requestVideoFrameCallback !== 'function') return Promise.resolve(null); // fallback to seeking

    return new Promise(function (resolve) {
      var pending = [];      // { t, bmpPromise }
      var lastT = -1, settled = false;
      function stop() {
        if (settled) return; settled = true;
        try { video.pause(); } catch (e) {}
        Promise.all(pending.map(function (p) { return p.bmpPromise.then(function (bmp) { return { t: p.t, bmp: bmp }; }); }))
          .then(function (frames) {
            frames.sort(function (a, b) { return a.t - b.t; });
            _loopCache[key] = frames;
            resolve(frames);
          });
      }
      function onFrame(now, meta) {
        var mt = (meta && typeof meta.mediaTime === 'number') ? meta.mediaTime : video.currentTime;
        // A wrap (mediaTime went backwards) or reaching the end = one full loop captured.
        if (pending.length && mt < lastT - 1e-3) { stop(); return; }
        pending.push({ t: mt, bmpPromise: createImageBitmap(video) });
        lastT = mt;
        if (mt >= (video.duration || Infinity) - (1 / 60)) { stop(); return; }
        video.requestVideoFrameCallback(onFrame);
      }
      try { video.pause(); video.currentTime = 0; } catch (e) {}
      video.loop = true; video.muted = true;
      var pr = video.play();
      if (pr && pr.catch) pr.catch(function () {});
      video.requestVideoFrameCallback(onFrame);
      setTimeout(stop, ((video.duration || 8) * 1000) + 1500); // safety cap
    });
  }

  // Nearest decoded frame to time tv (seconds) in a sorted [{t,bmp}] array.
  function pickFrame(frames, tv) {
    if (!frames || !frames.length) return null;
    var lo = 0, hi = frames.length - 1;
    if (tv <= frames[0].t) return frames[0].bmp;
    if (tv >= frames[hi].t) return frames[hi].bmp;
    while (lo < hi) {
      var mid = (lo + hi) >> 1;
      if (frames[mid].t < tv) lo = mid + 1; else hi = mid;
    }
    var a = frames[Math.max(0, lo - 1)], b = frames[lo];
    return (Math.abs(a.t - tv) <= Math.abs(b.t - tv)) ? a.bmp : b.bmp;
  }

  function coverDraw(ctx, media, W, H, mw, mh) {
    var ir = mw / mh, br = W / H, dw, dh, dx, dy;
    if (ir > br) { dh = H; dw = dh * ir; dx = -(dw - W) / 2; dy = 0; }
    else { dw = W; dh = dw / ir; dx = 0; dy = -(dh - H) / 2; }
    ctx.drawImage(media, dx, dy, dw, dh);
  }

  /* exportMp4(spec, images, opts) -> Promise<Blob(video/mp4)>
   *   images : { name -> canvas } from PLATE_RENDERER (same map the preview draws)
   *   opts.bgVideo   : { el:<video>, opacity:Number } muted, loaded loop (optional)
   *   opts.bgImage   : { el:<img> } (optional)
   *   opts.baseColor : base under a video/image loop (default manifest base #0a0a0f)
   *   opts.onProgress: fn(0..1)
   */
  function exportMp4(spec, images, opts) {
    opts = opts || {};
    if (!isSupported()) return Promise.reject(new Error('WebCodecs MP4 export needs a Chromium browser (Chrome / Edge / Arc).'));

    var W = spec.size.w, H = spec.size.h;
    var fps = spec.fps || 30;
    var loopSec = (spec.motion && spec.motion.speed && spec.motion.speed.loopSec) || spec.dur || 8;
    var dur = spec.dur || loopSec;
    var totalFrames = Math.max(1, Math.round(dur * fps));
    var onProgress = opts.onProgress || function () {};

    var C = root.SOCIAL_COMPOSER.buildComposer(spec);
    var canvas = document.createElement('canvas');
    canvas.width = W; canvas.height = H;
    var ctx = canvas.getContext('2d', { alpha: false });

    var hasMediaBg = !!(spec.backgroundVideo || spec.backgroundImage);
    var baseColor = opts.baseColor || '#0a0a0f';
    var bgVideo = opts.bgVideo && opts.bgVideo.el ? opts.bgVideo : null;
    var bgImage = opts.bgImage && opts.bgImage.el ? opts.bgImage : null;

    return pickCodec(W, H, fps).then(function (cfg) {
      if (!cfg) throw new Error('No supported H.264 encoder configuration for ' + W + 'x' + H + '.');

      var muxer = new root.Mp4Muxer.Muxer({
        target: new root.Mp4Muxer.ArrayBufferTarget(),
        video: { codec: 'avc', width: W, height: H, frameRate: fps },
        fastStart: 'in-memory',
      });
      var encodeError = null;
      var encoder = new root.VideoEncoder({
        output: function (chunk, meta) { muxer.addVideoChunk(chunk, meta); },
        error: function (e) { encodeError = e; },
      });
      encoder.configure(cfg);

      var frameDur = 1e6 / fps;
      // Pre-decode the loop ONCE (fast path). loopFrames === null => fall back to per-frame seeking.
      var predecode = bgVideo ? decodeLoopFrames(bgVideo.el) : Promise.resolve(null);

      return predecode.then(function (loopFrames) {
        var vidDur = (bgVideo && bgVideo.el.duration) ? bgVideo.el.duration : 1;

        // Draw the media background for time t; async only in the seek-fallback case.
        function drawBg(t) {
          ctx.fillStyle = baseColor;
          ctx.fillRect(0, 0, W, H);
          if (bgImage) coverDraw(ctx, bgImage.el, W, H, bgImage.el.naturalWidth, bgImage.el.naturalHeight);
          if (!bgVideo) return Promise.resolve();
          var vt = t % vidDur;
          if (loopFrames) {
            var bmp = pickFrame(loopFrames, vt);
            if (bmp) {
              ctx.save();
              ctx.globalAlpha = (bgVideo.opacity != null ? bgVideo.opacity : 0.32);
              coverDraw(ctx, bmp, W, H, bmp.width, bmp.height);
              ctx.restore();
            }
            return Promise.resolve();
          }
          return seekVideo(bgVideo.el, vt).then(function () {
            ctx.save();
            ctx.globalAlpha = (bgVideo.opacity != null ? bgVideo.opacity : 0.32);
            coverDraw(ctx, bgVideo.el, W, H, bgVideo.el.videoWidth, bgVideo.el.videoHeight);
            ctx.restore();
          });
        }

        var i = 0;
        function step() {
          if (encodeError) return Promise.reject(encodeError);
          if (i >= totalFrames) return Promise.resolve();
          var t = i / fps;

          var pre = hasMediaBg
            ? drawBg(t).then(function () { root.SOCIAL_COMPOSER.drawLayers(ctx, C, images, t); })
            : (root.SOCIAL_COMPOSER.drawFrame(ctx, C, images, t), Promise.resolve());

          return pre.then(function () {
            var frame = new root.VideoFrame(canvas, { timestamp: Math.round(i * frameDur), duration: Math.round(frameDur) });
            encoder.encode(frame, { keyFrame: (i % Math.round(fps) === 0) });
            frame.close();
            onProgress((i + 1) / totalFrames);
            i++;
            if (encoder.encodeQueueSize > 6) {
              return new Promise(function (r) { setTimeout(r, 0); }).then(step);
            }
            return step();
          });
        }

        return step()
          .then(function () { return encoder.flush(); })
          .then(function () {
            if (encodeError) throw encodeError;
            muxer.finalize();
            return new Blob([muxer.target.buffer], { type: 'video/mp4' });
          });
      });
    });
  }

  // Poster: the settled frame-0 still (matches the loop-first poster contract) as a PNG blob.
  function posterPng(spec, images, opts) {
    opts = opts || {};
    var W = spec.size.w, H = spec.size.h;
    var C = root.SOCIAL_COMPOSER.buildComposer(spec);
    var canvas = document.createElement('canvas');
    canvas.width = W; canvas.height = H;
    var ctx = canvas.getContext('2d', { alpha: false });
    var hasMediaBg = !!(spec.backgroundVideo || spec.backgroundImage);
    var pre = Promise.resolve();
    if (hasMediaBg) {
      ctx.fillStyle = opts.baseColor || '#0a0a0f';
      ctx.fillRect(0, 0, W, H);
      if (opts.bgImage && opts.bgImage.el) coverDraw(ctx, opts.bgImage.el, W, H, opts.bgImage.el.naturalWidth, opts.bgImage.el.naturalHeight);
      if (opts.bgVideo && opts.bgVideo.el) {
        pre = seekVideo(opts.bgVideo.el, 0).then(function () {
          ctx.save(); ctx.globalAlpha = (opts.bgVideo.opacity != null ? opts.bgVideo.opacity : 0.32);
          coverDraw(ctx, opts.bgVideo.el, W, H, opts.bgVideo.el.videoWidth, opts.bgVideo.el.videoHeight); ctx.restore();
        });
      }
      pre = pre.then(function () { root.SOCIAL_COMPOSER.drawLayers(ctx, C, images, 0); });
    } else {
      root.SOCIAL_COMPOSER.drawFrame(ctx, C, images, 0);
    }
    return pre.then(function () {
      return new Promise(function (resolve) { canvas.toBlob(function (b) { resolve(b); }, 'image/png'); });
    });
  }

  // ---- MediaRecorder fallback (non-Chromium: Safari / Firefox) --------------------------------

  // Real-time capture via canvas.captureStream() + MediaRecorder. Non-deterministic timing (records
  // in real time, may drop frames), but it lets browsers WITHOUT WebCodecs still export video. Picks
  // the best available container: Safari may give real mp4/h264; Firefox gives webm (vp9/vp8).
  function recorderSupported() {
    return typeof root.MediaRecorder !== 'undefined' &&
           typeof document.createElement('canvas').captureStream === 'function';
  }

  function exportRecorded(spec, images, opts) {
    opts = opts || {};
    if (!recorderSupported()) return Promise.reject(new Error('This browser cannot export video (no WebCodecs and no MediaRecorder).'));

    var W = spec.size.w, H = spec.size.h, fps = spec.fps || 30;
    var loopSec = (spec.motion && spec.motion.speed && spec.motion.speed.loopSec) || spec.dur || 8;
    var dur = spec.dur || loopSec;
    var onProgress = opts.onProgress || function () {};
    var C = root.SOCIAL_COMPOSER.buildComposer(spec);
    var canvas = document.createElement('canvas'); canvas.width = W; canvas.height = H;
    var ctx = canvas.getContext('2d', { alpha: false });
    var hasMediaBg = !!(spec.backgroundVideo || spec.backgroundImage);
    var baseColor = opts.baseColor || '#0a0a0f';
    var bgVideo = opts.bgVideo && opts.bgVideo.el ? opts.bgVideo : null;
    var bgImage = opts.bgImage && opts.bgImage.el ? opts.bgImage : null;

    var mimes = ['video/mp4;codecs=avc1', 'video/webm;codecs=vp9', 'video/webm;codecs=vp8', 'video/webm'];
    var mime = '';
    for (var mi = 0; mi < mimes.length; mi++) {
      try { if (root.MediaRecorder.isTypeSupported(mimes[mi])) { mime = mimes[mi]; break; } } catch (e) {}
    }
    var stream = canvas.captureStream(fps);
    var rec = new root.MediaRecorder(stream, mime ? { mimeType: mime, videoBitsPerSecond: bitrateFor(W, H, fps) } : undefined);
    var chunks = [];
    rec.ondataavailable = function (e) { if (e.data && e.data.size) chunks.push(e.data); };

    function drawAt(t) {
      if (hasMediaBg) {
        ctx.fillStyle = baseColor; ctx.fillRect(0, 0, W, H);
        if (bgImage) coverDraw(ctx, bgImage.el, W, H, bgImage.el.naturalWidth, bgImage.el.naturalHeight);
        if (bgVideo) {
          ctx.save(); ctx.globalAlpha = (bgVideo.opacity != null ? bgVideo.opacity : 0.32);
          coverDraw(ctx, bgVideo.el, W, H, bgVideo.el.videoWidth, bgVideo.el.videoHeight); ctx.restore();
        }
        root.SOCIAL_COMPOSER.drawLayers(ctx, C, images, t);
      } else {
        root.SOCIAL_COMPOSER.drawFrame(ctx, C, images, t);
      }
    }

    return new Promise(function (resolve, reject) {
      rec.onerror = function (e) { reject((e && e.error) || new Error('recording failed')); };
      rec.onstop = function () { resolve(new Blob(chunks, { type: (mime.split(';')[0]) || 'video/webm' })); };
      if (bgVideo) { try { bgVideo.el.currentTime = 0; bgVideo.el.loop = true; bgVideo.el.play(); } catch (e) {} }
      drawAt(0);
      rec.start();
      var start = performance.now();
      function tick(now) {
        var t = (now - start) / 1000;
        if (t >= dur) { drawAt(dur); onProgress(1); setTimeout(function () { try { rec.stop(); } catch (e) {} }, 80); return; }
        drawAt(t); onProgress(t / dur);
        requestAnimationFrame(tick);
      }
      requestAnimationFrame(tick);
    });
  }

  // Unified entry: real mp4 via WebCodecs where available, else recorded webm/mp4.
  function exportVideo(spec, images, opts) {
    return isSupported() ? exportMp4(spec, images, opts) : exportRecorded(spec, images, opts);
  }

  root.WEBCODECS_EXPORT = {
    isSupported: isSupported,
    recorderSupported: recorderSupported,
    exportMp4: exportMp4,
    exportRecorded: exportRecorded,
    exportVideo: exportVideo,
    posterPng: posterPng,
  };
})(typeof self !== 'undefined' ? self : this);
