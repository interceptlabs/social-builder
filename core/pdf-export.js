/* Lossless PDF export — the static-app's PDF/Carousel-PDF pipeline. Hand-rolled PDF container +
 * the browser's native CompressionStream('deflate') for the image streams. No PNG, no JPEG: a
 * standard PDF-export path (Pillow, most libraries' "high quality" presets) silently re-encodes
 * embedded images as JPEG, which mosquito-noises this brand's hard-edged triangle fields and crisp
 * type — a real, visible problem for this brand's visual language specifically (learned building the
 * one-off 5-slide carousel PDF in intercept-linkedin-creative-judgment, which hand-rolled the same
 * FlateDecode-only technique in ~100 lines of Python + stdlib zlib for a single script; here it's a
 * permanent feature, so it is a proper module instead, but the LOSSLESS requirement is identical).
 *
 * Rendering technique (also ported from that prior art): every frame is rendered from the REAL
 * plates.html + composer.js/procedural-background pipeline — never a re-interpretation — at 2x pixel
 * density (supersampling: PLATE_RENDERER.renderPlates(...,scale) + an outer canvas pre-scaled the
 * same amount), then downsampled to the design's native 1x resolution with the canvas's own
 * high-quality image smoothing before embedding. This is sharper on text and triangle edges than a
 * native 1x canvas render — Canvas2D's own anti-aliasing at 1x is not as clean.
 *
 * Frame 0 is the poster (this tool's existing loop-first convention, same as Poster PNG / the MP4
 * exporter's first frame): animated backgrounds (keyline/ribbon/fritzoid/fritzfield) are captured at
 * t=0 — no separate "which frame to freeze" logic needed for the PDF path either.
 *
 * Sets globalThis.PDF_EXPORT.
 */
(function (root) {
  'use strict';

  // CompressionStream (RFC-1950 zlib-wrapped 'deflate', NOT 'deflate-raw') is what PDF's
  // /FlateDecode filter expects. Chromium/Firefox/Safari all ship it as of this writing; gate on it
  // explicitly (mirroring the WebCodecs isSupported() gate already in export-webcodecs.js) rather than
  // silently falling back to a lossy re-encode.
  function isSupported() {
    return typeof root.CompressionStream === 'function';
  }

  // ---- frame rendering (mirrors export-webcodecs.js's posterPng, parameterized by `scale`) --------

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

  function coverDraw(ctx, media, W, H, mw, mh) {
    var ir = mw / mh, br = W / H, dw, dh, dx, dy;
    if (ir > br) { dh = H; dw = dh * ir; dx = -(dw - W) / 2; dy = 0; }
    else { dw = W; dh = dw / ir; dx = 0; dy = -(dh - H) / 2; }
    ctx.drawImage(media, dx, dy, dw, dh);
  }

  // renderFrame(templateName, spec, opts) -> Promise<canvas>  (native spec.size, fully opaque RGB)
  //   opts.scale     : supersample factor (default 2)
  //   opts.baseColor : base under a video/image bg (default manifest base #0a0a0f)
  //   opts.bgVideo   : { el, opacity } — same shape app.js's exportOpts() already builds
  //   opts.bgImage   : { el }
  function renderFrame(templateName, spec, opts) {
    opts = opts || {};
    var scale = opts.scale > 0 ? opts.scale : 2;
    var W = spec.size.w, H = spec.size.h;
    return root.PLATE_RENDERER.renderPlates(templateName, spec, scale).then(function (images) {
      var C = root.SOCIAL_COMPOSER.buildComposer(spec);
      var big = document.createElement('canvas');
      big.width = Math.round(W * scale); big.height = Math.round(H * scale);
      var bctx = big.getContext('2d', { alpha: false });
      bctx.scale(scale, scale);
      var hasMediaBg = !!(spec.backgroundVideo || spec.backgroundImage);
      var pre = Promise.resolve();
      if (hasMediaBg) {
        bctx.fillStyle = opts.baseColor || '#0a0a0f';
        bctx.fillRect(0, 0, W, H);
        if (opts.bgImage && opts.bgImage.el) {
          coverDraw(bctx, opts.bgImage.el, W, H, opts.bgImage.el.naturalWidth, opts.bgImage.el.naturalHeight);
        }
        if (opts.bgVideo && opts.bgVideo.el) {
          pre = seekVideo(opts.bgVideo.el, 0).then(function () {
            bctx.save();
            bctx.globalAlpha = (opts.bgVideo.opacity != null ? opts.bgVideo.opacity : 0.32);
            coverDraw(bctx, opts.bgVideo.el, W, H, opts.bgVideo.el.videoWidth, opts.bgVideo.el.videoHeight);
            bctx.restore();
          });
        }
        pre = pre.then(function () { root.SOCIAL_COMPOSER.drawLayers(bctx, C, images, 0); });
      } else {
        root.SOCIAL_COMPOSER.drawFrame(bctx, C, images, 0);
      }
      return pre.then(function () {
        // Downsample big (W*scale x H*scale) -> native (W,H). This high-quality resample is the
        // "then downsample" half of supersampling — cleaner anti-aliasing on text/triangle edges than
        // a native 1x canvas render produces on its own.
        var out = document.createElement('canvas');
        out.width = W; out.height = H;
        var octx = out.getContext('2d', { alpha: false });
        octx.imageSmoothingEnabled = true;
        try { octx.imageSmoothingQuality = 'high'; } catch (e) {}
        octx.drawImage(big, 0, 0, W, H);
        return out;
      });
    });
  }

  // Raw, tightly-packed RGB8 bytes (no filter bytes, no row padding) — exactly what a PDF
  // /FlateDecode image stream with no /DecodeParms Predictor expects. The canvas was obtained with
  // {alpha:false}, so every source alpha byte is 255 and dropping it is lossless.
  function canvasToRGB(canvas) {
    var ctx = canvas.getContext('2d', { alpha: false });
    var W = canvas.width, H = canvas.height;
    var data = ctx.getImageData(0, 0, W, H).data;
    var rgb = new Uint8Array(W * H * 3);
    var j = 0;
    for (var i = 0; i < data.length; i += 4) { rgb[j++] = data[i]; rgb[j++] = data[i + 1]; rgb[j++] = data[i + 2]; }
    return rgb;
  }

  // zlib-wrapped deflate of raw bytes (RFC 1950 around RFC 1951) — the exact stream format PDF's
  // /FlateDecode filter reads. NOTE: format MUST be 'deflate', not 'deflate-raw' (which omits the
  // zlib header/Adler32 trailer that/FlateDecode requires).
  function deflate(bytes) {
    var cs = new root.CompressionStream('deflate');
    var writer = cs.writable.getWriter();
    writer.write(bytes);
    writer.close();
    return new Response(cs.readable).arrayBuffer().then(function (buf) { return new Uint8Array(buf); });
  }

  // ---- PDF container -------------------------------------------------------------------------------

  // Physical page size for one design pixel. 96 — the CSS-pixel-to-inch definition (1px = 1/96in) —
  // is the semantically honest choice here: plates.html's own CSS is authored in raw px, so treating
  // a design pixel as a CSS pixel (rather than picking an arbitrary print DPI) is the least-invented
  // mapping. Physical page size otherwise doesn't matter for how LinkedIn's document viewer renders a
  // PDF — it scales each page to fit, carrying through only the aspect ratio.
  var PX_PER_INCH = 96;
  var PT_PER_INCH = 72;

  function pad10(n) { var s = String(Math.max(0, n | 0)); while (s.length < 10) s = '0' + s; return s; }

  // buildPdf(frames) -> Promise<Blob('application/pdf')>
  //   frames: [{ width, height, rgb: Uint8Array(width*height*3) }], one PDF page per entry, in order.
  function buildPdf(frames) {
    if (!frames || !frames.length) return Promise.reject(new Error('buildPdf: no frames'));
    var enc = new TextEncoder();
    return Promise.all(frames.map(function (f) { return deflate(f.rgb); })).then(function (deflated) {
      var parts = [];             // Uint8Array pieces, concatenated into the final Blob
      var pos = 0;
      var offsets = {};           // object number -> byte offset (for the xref table)

      function raw(u8) { parts.push(u8); pos += u8.length; }
      function str(s) { raw(enc.encode(s)); }
      function beginObj(n) { offsets[n] = pos; str(n + ' 0 obj\n'); }
      function endObj() { str('endobj\n'); }

      var n = frames.length;
      // Object numbers: 1 Catalog, 2 Pages; per frame i (0-based): page=3+3i, content=4+3i, image=5+3i.
      var kids = [];
      for (var i = 0; i < n; i++) kids.push((3 + i * 3) + ' 0 R');

      str('%PDF-1.4\n');
      raw(new Uint8Array([0x25, 0xE2, 0xE3, 0xCF, 0xD3, 0x0A])); // binary marker comment, per spec 7.5.2

      beginObj(1);
      str('<< /Type /Catalog /Pages 2 0 R >>\n');
      endObj();

      beginObj(2);
      str('<< /Type /Pages /Kids [' + kids.join(' ') + '] /Count ' + n + ' >>\n');
      endObj();

      for (i = 0; i < n; i++) {
        var f = frames[i], img = deflated[i];
        var pageNum = 3 + i * 3, contentNum = 4 + i * 3, imageNum = 5 + i * 3;
        var wPt = Math.round((f.width / PX_PER_INCH) * PT_PER_INCH * 100) / 100;
        var hPt = Math.round((f.height / PX_PER_INCH) * PT_PER_INCH * 100) / 100;
        var content = 'q ' + wPt + ' 0 0 ' + hPt + ' 0 0 cm /Im0 Do Q';
        var contentBytes = enc.encode(content);

        beginObj(pageNum);
        str('<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ' + wPt + ' ' + hPt + '] ' +
          '/Resources << /XObject << /Im0 ' + imageNum + ' 0 R >> >> /Contents ' + contentNum + ' 0 R >>\n');
        endObj();

        beginObj(contentNum);
        str('<< /Length ' + contentBytes.length + ' >>\nstream\n');
        raw(contentBytes);
        str('\nendstream\n');
        endObj();

        beginObj(imageNum);
        str('<< /Type /XObject /Subtype /Image /Width ' + f.width + ' /Height ' + f.height +
          ' /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /FlateDecode /Length ' + img.length + ' >>\nstream\n');
        raw(img);
        str('\nendstream\n');
        endObj();
      }

      var totalObjs = 2 + n * 3;
      var xrefOffset = pos;
      str('xref\n0 ' + (totalObjs + 1) + '\n');
      str('0000000000 65535 f\r\n');
      for (var o = 1; o <= totalObjs; o++) str(pad10(offsets[o] || 0) + ' 00000 n\r\n');
      str('trailer\n<< /Size ' + (totalObjs + 1) + ' /Root 1 0 R >>\nstartxref\n' + xrefOffset + '\n%%EOF');

      return new Blob(parts, { type: 'application/pdf' });
    });
  }

  root.PDF_EXPORT = {
    isSupported: isSupported,
    renderFrame: renderFrame,
    canvasToRGB: canvasToRGB,
    buildPdf: buildPdf,
  };
})(typeof self !== 'undefined' ? self : this);
