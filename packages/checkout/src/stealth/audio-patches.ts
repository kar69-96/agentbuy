// ---- Audio fingerprint patches ----
// Override AudioContext latency + add noise to frequency/channel data.

import type { SessionFingerprint } from "./fingerprint.js";

export function buildAudioPatchScript(fp: SessionFingerprint): string {
  return `
    (function() {
      var BASE_LATENCY = ${fp.audioBaseLatency};
      var NOISE_SEED = ${fp.audioNoiseSeed};

      var state = NOISE_SEED;
      function xorshift() {
        state ^= state << 13;
        state ^= state >> 17;
        state ^= state << 5;
        return (state >>> 0) / 4294967296;
      }

      // --- AudioContext.baseLatency / outputLatency ---
      if (typeof AudioContext !== 'undefined') {
        var OrigAudioContext = AudioContext;
        window.AudioContext = function() {
          var ctx = new OrigAudioContext();
          try {
            Object.defineProperty(ctx, 'baseLatency', {
              get: function() { return BASE_LATENCY; },
              configurable: true,
            });
            Object.defineProperty(ctx, 'outputLatency', {
              get: function() { return BASE_LATENCY * 0.8; },
              configurable: true,
            });
          } catch(e) {}
          return ctx;
        };
        window.AudioContext.prototype = OrigAudioContext.prototype;
        Object.defineProperty(window, 'AudioContext', { writable: true, configurable: true });
      }

      // --- AnalyserNode.getFloatFrequencyData noise ---
      if (typeof AnalyserNode !== 'undefined') {
        var origGetFloat = AnalyserNode.prototype.getFloatFrequencyData;
        AnalyserNode.prototype.getFloatFrequencyData = function(array) {
          origGetFloat.call(this, array);
          if (array && array.length) {
            for (var i = 0; i < array.length; i += 10) {
              array[i] += (xorshift() - 0.5) * 0.0002;
            }
          }
        };
      }

      // --- AudioBuffer.getChannelData noise ---
      if (typeof AudioBuffer !== 'undefined') {
        var origGetChannel = AudioBuffer.prototype.getChannelData;
        AudioBuffer.prototype.getChannelData = function(channel) {
          var data = origGetChannel.call(this, channel);
          // Only add noise on first access per buffer (avoid compounding)
          if (!this.__stealthNoised) {
            this.__stealthNoised = true;
            for (var i = 0; i < data.length; i += 100) {
              data[i] += (xorshift() - 0.5) * 0.0001;
            }
          }
          return data;
        };
      }

      // --- OfflineAudioContext ---
      if (typeof OfflineAudioContext !== 'undefined') {
        var OrigOffline = OfflineAudioContext;
        window.OfflineAudioContext = function() {
          var ctx = new (Function.prototype.bind.apply(OrigOffline, [null].concat(Array.from(arguments))))();
          return ctx;
        };
        window.OfflineAudioContext.prototype = OrigOffline.prototype;
        Object.defineProperty(window, 'OfflineAudioContext', { writable: true, configurable: true });
      }
    })();
  `;
}
