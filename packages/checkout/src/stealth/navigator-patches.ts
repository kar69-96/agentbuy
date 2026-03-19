// ---- Navigator property patches ----
// Highest-impact stealth: webdriver, plugins, mimeTypes, permissions, hardware.

import type { SessionFingerprint } from "./fingerprint.js";

export function buildNavigatorPatchScript(fp: SessionFingerprint): string {
  return `
    // --- navigator.webdriver → undefined ---
    Object.defineProperty(navigator, 'webdriver', {
      get: () => undefined,
      configurable: true,
    });

    // --- navigator.languages ---
    Object.defineProperty(navigator, 'languages', {
      get: () => Object.freeze(${JSON.stringify(fp.languages)}),
      configurable: true,
    });

    // --- navigator.hardwareConcurrency ---
    Object.defineProperty(navigator, 'hardwareConcurrency', {
      get: () => ${fp.hardwareConcurrency},
      configurable: true,
    });

    // --- navigator.deviceMemory ---
    Object.defineProperty(navigator, 'deviceMemory', {
      get: () => ${fp.deviceMemory},
      configurable: true,
    });

    // --- navigator.maxTouchPoints ---
    Object.defineProperty(navigator, 'maxTouchPoints', {
      get: () => ${fp.maxTouchPoints},
      configurable: true,
    });

    // --- navigator.plugins (realistic Chrome plugin list) ---
    (function() {
      const pluginData = [
        { name: 'PDF Viewer', filename: 'internal-pdf-viewer', description: 'Portable Document Format',
          mimeTypes: [
            { type: 'application/pdf', suffixes: 'pdf', description: 'Portable Document Format' },
          ]
        },
        { name: 'Chrome PDF Plugin', filename: 'internal-pdf-viewer', description: 'Portable Document Format',
          mimeTypes: [
            { type: 'application/x-google-chrome-pdf', suffixes: 'pdf', description: 'Portable Document Format' },
          ]
        },
        { name: 'Chrome PDF Viewer', filename: 'mhjfbmdgcfjbbpaeojofohoefgiehjai', description: '',
          mimeTypes: [
            { type: 'application/pdf', suffixes: 'pdf', description: '' },
          ]
        },
        { name: 'Native Client', filename: 'internal-nacl-plugin', description: '',
          mimeTypes: [
            { type: 'application/x-nacl', suffixes: '', description: 'Native Client Executable' },
            { type: 'application/x-pnacl', suffixes: '', description: 'Portable Native Client Executable' },
          ]
        },
      ];

      const mimeArr = [];
      const pluginArr = [];

      for (const pd of pluginData) {
        const plugin = Object.create(Plugin.prototype);
        Object.defineProperties(plugin, {
          name: { value: pd.name, enumerable: true },
          filename: { value: pd.filename, enumerable: true },
          description: { value: pd.description, enumerable: true },
          length: { value: pd.mimeTypes.length, enumerable: true },
        });

        for (let i = 0; i < pd.mimeTypes.length; i++) {
          const mt = Object.create(MimeType.prototype);
          Object.defineProperties(mt, {
            type: { value: pd.mimeTypes[i].type, enumerable: true },
            suffixes: { value: pd.mimeTypes[i].suffixes, enumerable: true },
            description: { value: pd.mimeTypes[i].description, enumerable: true },
            enabledPlugin: { value: plugin, enumerable: true },
          });
          Object.defineProperty(plugin, i, { value: mt, enumerable: false });
          Object.defineProperty(plugin, pd.mimeTypes[i].type, { value: mt, enumerable: false });
          mimeArr.push(mt);
        }
        pluginArr.push(plugin);
      }

      // Build PluginArray
      const fakePlugins = Object.create(PluginArray.prototype);
      for (let i = 0; i < pluginArr.length; i++) {
        Object.defineProperty(fakePlugins, i, { value: pluginArr[i], enumerable: true });
        Object.defineProperty(fakePlugins, pluginArr[i].name, { value: pluginArr[i], enumerable: false });
      }
      Object.defineProperty(fakePlugins, 'length', { value: pluginArr.length, enumerable: true });
      Object.defineProperty(fakePlugins, 'item', { value: function(i) { return pluginArr[i] || null; } });
      Object.defineProperty(fakePlugins, 'namedItem', { value: function(n) { return pluginArr.find(p => p.name === n) || null; } });
      Object.defineProperty(fakePlugins, 'refresh', { value: function() {} });

      // Build MimeTypeArray
      const fakeMimes = Object.create(MimeTypeArray.prototype);
      for (let i = 0; i < mimeArr.length; i++) {
        Object.defineProperty(fakeMimes, i, { value: mimeArr[i], enumerable: true });
        Object.defineProperty(fakeMimes, mimeArr[i].type, { value: mimeArr[i], enumerable: false });
      }
      Object.defineProperty(fakeMimes, 'length', { value: mimeArr.length, enumerable: true });
      Object.defineProperty(fakeMimes, 'item', { value: function(i) { return mimeArr[i] || null; } });
      Object.defineProperty(fakeMimes, 'namedItem', { value: function(n) { return mimeArr.find(m => m.type === n) || null; } });

      Object.defineProperty(navigator, 'plugins', { get: () => fakePlugins, configurable: true });
      Object.defineProperty(navigator, 'mimeTypes', { get: () => fakeMimes, configurable: true });
    })();

    // --- navigator.permissions.query ---
    (function() {
      const originalQuery = navigator.permissions.query.bind(navigator.permissions);
      navigator.permissions.query = function(descriptor) {
        if (descriptor.name === 'notifications') {
          return Promise.resolve({ state: 'prompt', onchange: null });
        }
        return originalQuery(descriptor);
      };
    })();

    // --- navigator.connection ---
    (function() {
      if (navigator.connection) {
        try {
          Object.defineProperty(navigator.connection, 'rtt', { get: () => 50, configurable: true });
          Object.defineProperty(navigator.connection, 'downlink', { get: () => 10, configurable: true });
          Object.defineProperty(navigator.connection, 'effectiveType', { get: () => '4g', configurable: true });
          Object.defineProperty(navigator.connection, 'saveData', { get: () => false, configurable: true });
        } catch(e) {}
      }
    })();
  `;
}
