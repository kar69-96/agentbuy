// ---- iframe consistency patches ----
// Ensure child frame navigator properties match parent's patched values.

import type { SessionFingerprint } from "./fingerprint.js";

export function buildIframePatchScript(fp: SessionFingerprint): string {
  return `
    (function() {
      // Patch contentWindow to propagate stealth patches to same-origin iframes
      var origContentWindow = Object.getOwnPropertyDescriptor(
        HTMLIFrameElement.prototype, 'contentWindow'
      );

      if (origContentWindow && origContentWindow.get) {
        Object.defineProperty(HTMLIFrameElement.prototype, 'contentWindow', {
          get: function() {
            var win = origContentWindow.get.call(this);
            if (!win) return win;

            // Only patch same-origin iframes (cross-origin will throw)
            try {
              var nav = win.navigator;
              if (nav && nav.webdriver !== undefined) {
                // Apply minimal navigator patches to child frame
                try {
                  Object.defineProperty(nav, 'webdriver', {
                    get: function() { return undefined; },
                    configurable: true,
                  });
                } catch(e) {}
              }
              // Ensure plugins.length matches
              if (nav && nav.plugins && nav.plugins.length === 0) {
                // Child frame has empty plugins — detection vector.
                // We can't fully reconstruct PluginArray in child frames,
                // but we can override the length check.
                try {
                  Object.defineProperty(nav.plugins, 'length', {
                    get: function() { return 4; },
                    configurable: true,
                  });
                } catch(e) {}
              }
            } catch(e) {
              // Cross-origin — cannot access, which is expected
            }

            return win;
          },
          configurable: true,
        });
      }

      // Ensure window.self === window (top-frame identity)
      if (window.self !== window) {
        try {
          Object.defineProperty(window, 'self', {
            get: function() { return window; },
            configurable: true,
          });
        } catch(e) {}
      }
    })();
  `;
}
