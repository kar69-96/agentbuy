// ---- Canvas fingerprint patches ----
// Add imperceptible LSB noise to canvas output for unique fingerprints.

import type { SessionFingerprint } from "./fingerprint.js";

export function buildCanvasPatchScript(fp: SessionFingerprint): string {
  return `
    (function() {
      var SEED = ${fp.canvasNoiseSeed};

      // xorshift32 PRNG — deterministic per session
      var state = SEED;
      function xorshift() {
        state ^= state << 13;
        state ^= state >> 17;
        state ^= state << 5;
        return (state >>> 0) / 4294967296;
      }

      // Add LSB noise to pixel data (imperceptible, ~0.1% of pixels)
      function addNoise(data) {
        if (!data || !data.length) return;
        var step = Math.max(4, Math.floor(data.length / 1000));
        for (var i = 0; i < data.length; i += step) {
          if (xorshift() < 0.5) {
            // Flip LSB of one RGBA component
            var channel = i + Math.floor(xorshift() * 3); // R, G, or B (not alpha)
            if (channel < data.length) {
              data[channel] = data[channel] ^ 1;
            }
          }
        }
      }

      // --- toDataURL ---
      var origToDataURL = HTMLCanvasElement.prototype.toDataURL;
      HTMLCanvasElement.prototype.toDataURL = function() {
        try {
          var ctx = this.getContext('2d');
          if (ctx && this.width > 0 && this.height > 0) {
            var imageData = ctx.getImageData(0, 0, this.width, this.height);
            addNoise(imageData.data);
            ctx.putImageData(imageData, 0, 0);
          }
        } catch(e) {
          // Canvas may be tainted (cross-origin) — skip noise
        }
        return origToDataURL.apply(this, arguments);
      };

      // --- toBlob ---
      var origToBlob = HTMLCanvasElement.prototype.toBlob;
      HTMLCanvasElement.prototype.toBlob = function() {
        try {
          var ctx = this.getContext('2d');
          if (ctx && this.width > 0 && this.height > 0) {
            var imageData = ctx.getImageData(0, 0, this.width, this.height);
            addNoise(imageData.data);
            ctx.putImageData(imageData, 0, 0);
          }
        } catch(e) {}
        return origToBlob.apply(this, arguments);
      };

      // --- getImageData ---
      var origGetImageData = CanvasRenderingContext2D.prototype.getImageData;
      CanvasRenderingContext2D.prototype.getImageData = function() {
        var result = origGetImageData.apply(this, arguments);
        addNoise(result.data);
        return result;
      };
    })();
  `;
}
