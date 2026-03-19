// ---- WebGL fingerprint patches ----
// Override GPU vendor/renderer, add noise to readPixels.

import type { SessionFingerprint } from "./fingerprint.js";

export function buildWebglPatchScript(fp: SessionFingerprint): string {
  return `
    (function() {
      var VENDOR = ${JSON.stringify(fp.gpuVendor)};
      var RENDERER = ${JSON.stringify(fp.gpuRenderer)};
      var NOISE_SEED = ${fp.webglNoiseSeed};

      // Simple xorshift32 PRNG
      var prngState = NOISE_SEED;
      function xorshift() {
        prngState ^= prngState << 13;
        prngState ^= prngState >> 17;
        prngState ^= prngState << 5;
        return (prngState >>> 0) / 4294967296;
      }

      // Extension constants
      var UNMASKED_VENDOR = 0x9245;
      var UNMASKED_RENDERER = 0x9246;

      function patchContext(proto) {
        if (!proto) return;

        // --- getParameter ---
        var origGetParam = proto.getParameter;
        proto.getParameter = function(param) {
          if (param === UNMASKED_VENDOR) return VENDOR;
          if (param === UNMASKED_RENDERER) return RENDERER;
          return origGetParam.call(this, param);
        };

        // --- getExtension ---
        var origGetExt = proto.getExtension;
        proto.getExtension = function(name) {
          var ext = origGetExt.call(this, name);
          if (name === 'WEBGL_debug_renderer_info' && ext) {
            return {
              UNMASKED_VENDOR_WEBGL: UNMASKED_VENDOR,
              UNMASKED_RENDERER_WEBGL: UNMASKED_RENDERER,
            };
          }
          return ext;
        };

        // --- readPixels noise ---
        var origReadPixels = proto.readPixels;
        proto.readPixels = function() {
          origReadPixels.apply(this, arguments);
          // arguments[6] is the output array
          var pixels = arguments[6];
          if (pixels && pixels.length) {
            // Add ±1 noise to ~0.1% of pixels
            var len = pixels.length;
            var step = Math.max(1, Math.floor(len / 1000));
            for (var i = 0; i < len; i += step) {
              if (xorshift() < 0.5) {
                pixels[i] = Math.min(255, Math.max(0, pixels[i] + (xorshift() > 0.5 ? 1 : -1)));
              }
            }
          }
        };
      }

      // Patch both WebGL1 and WebGL2
      if (typeof WebGLRenderingContext !== 'undefined') {
        patchContext(WebGLRenderingContext.prototype);
      }
      if (typeof WebGL2RenderingContext !== 'undefined') {
        patchContext(WebGL2RenderingContext.prototype);
      }
    })();
  `;
}
