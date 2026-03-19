// ---- User-Agent consistency patches ----
// Ensures UA string, Client Hints, and platform all match.

import type { SessionFingerprint } from "./fingerprint.js";

export function buildUaConsistencyScript(fp: SessionFingerprint): string {
  const uaPlatform = fp.platform === "Win32" ? "Windows" : "macOS";

  return `
    // --- navigator.userAgent ---
    Object.defineProperty(navigator, 'userAgent', {
      get: () => ${JSON.stringify(fp.userAgent)},
      configurable: true,
    });

    // --- navigator.appVersion ---
    Object.defineProperty(navigator, 'appVersion', {
      get: () => ${JSON.stringify(fp.userAgent.replace("Mozilla/", ""))},
      configurable: true,
    });

    // --- navigator.platform ---
    Object.defineProperty(navigator, 'platform', {
      get: () => ${JSON.stringify(fp.platform)},
      configurable: true,
    });

    // --- navigator.oscpu ---
    Object.defineProperty(navigator, 'oscpu', {
      get: () => ${fp.oscpu ? JSON.stringify(fp.oscpu) : "undefined"},
      configurable: true,
    });

    // --- navigator.userAgentData (Client Hints) ---
    (function() {
      const brands = [
        { brand: 'Google Chrome', version: ${JSON.stringify(fp.chromeVersion)} },
        { brand: 'Chromium', version: ${JSON.stringify(fp.chromeVersion)} },
        { brand: 'Not_A Brand', version: '24' },
      ];

      const uaData = {
        brands: brands,
        mobile: false,
        platform: ${JSON.stringify(uaPlatform)},
        getHighEntropyValues: function(hints) {
          return Promise.resolve({
            architecture: ${fp.platform === "Win32" ? '"x86"' : '"arm"'},
            bitness: '64',
            brands: brands,
            fullVersionList: brands.map(function(b) {
              return { brand: b.brand, version: b.version + '.0.0.0' };
            }),
            mobile: false,
            model: '',
            platform: ${JSON.stringify(uaPlatform)},
            platformVersion: ${fp.platform === "Win32" ? '"15.0.0"' : '"14.6.1"'},
            uaFullVersion: ${JSON.stringify(fp.chromeVersion)} + '.0.0.0',
            wow64: false,
          });
        },
        toJSON: function() {
          return { brands: brands, mobile: false, platform: ${JSON.stringify(uaPlatform)} };
        },
      };

      Object.defineProperty(navigator, 'userAgentData', {
        get: () => uaData,
        configurable: true,
      });
    })();
  `;
}
