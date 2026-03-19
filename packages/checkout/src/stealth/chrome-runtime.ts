// ---- Chrome runtime patches ----
// window.chrome, Notification, vendor, outerDimensions, cdc_ cleanup.

import type { SessionFingerprint } from "./fingerprint.js";

export function buildChromeRuntimeScript(fp: SessionFingerprint): string {
  return `
    // --- window.chrome ---
    if (!window.chrome) {
      window.chrome = {};
    }
    if (!window.chrome.app) {
      window.chrome.app = {
        isInstalled: false,
        InstallState: { DISABLED: 'disabled', INSTALLED: 'installed', NOT_INSTALLED: 'not_installed' },
        RunningState: { CANNOT_RUN: 'cannot_run', READY_TO_RUN: 'ready_to_run', RUNNING: 'running' },
        getDetails: function() { return null; },
        getIsInstalled: function() { return false; },
        installState: function(cb) { if (cb) cb('not_installed'); },
      };
    }
    if (!window.chrome.csi) {
      window.chrome.csi = function() {
        return {
          startE: Date.now(),
          onloadT: Date.now() + 100 + Math.floor(Math.random() * 200),
          pageT: 300 + Math.floor(Math.random() * 500),
          tran: 15,
        };
      };
    }
    if (!window.chrome.loadTimes) {
      window.chrome.loadTimes = function() {
        return {
          commitLoadTime: Date.now() / 1000,
          connectionInfo: 'h2',
          finishDocumentLoadTime: Date.now() / 1000 + 0.1,
          finishLoadTime: Date.now() / 1000 + 0.3,
          firstPaintAfterLoadTime: 0,
          firstPaintTime: Date.now() / 1000 + 0.05,
          navigationType: 'Other',
          npnNegotiatedProtocol: 'h2',
          requestTime: Date.now() / 1000 - 0.5,
          startLoadTime: Date.now() / 1000 - 0.3,
          wasAlternateProtocolAvailable: false,
          wasFetchedViaSpdy: true,
          wasNpnNegotiated: true,
        };
      };
    }
    if (!window.chrome.runtime) {
      window.chrome.runtime = {
        PNaCl: true,
        OnInstalledReason: {
          CHROME_UPDATE: 'chrome_update',
          INSTALL: 'install',
          SHARED_MODULE_UPDATE: 'shared_module_update',
          UPDATE: 'update',
        },
        OnRestartRequiredReason: {
          APP_UPDATE: 'app_update',
          OS_UPDATE: 'os_update',
          PERIODIC: 'periodic',
        },
        RequestUpdateCheckStatus: {
          NO_UPDATE: 'no_update',
          THROTTLED: 'throttled',
          UPDATE_AVAILABLE: 'update_available',
        },
        connect: function() {
          throw new Error('Could not establish connection. Receiving end does not exist.');
        },
        sendMessage: function() {
          throw new Error('Could not establish connection. Receiving end does not exist.');
        },
        id: undefined,
      };
    }

    // --- Notification.permission ---
    (function() {
      const origDesc = Object.getOwnPropertyDescriptor(Notification, 'permission');
      if (origDesc) {
        Object.defineProperty(Notification, 'permission', {
          get: () => 'default',
          configurable: true,
        });
      }
    })();

    // --- navigator.vendor ---
    Object.defineProperty(navigator, 'vendor', {
      get: () => ${JSON.stringify(fp.vendor)},
      configurable: true,
    });

    // --- window.outerWidth / outerHeight ---
    (function() {
      const chromeOffset = 74 + Math.floor(${fp.seed} % 38); // 74-112 pixels
      const sideOffset = Math.floor(${fp.seed} % 16);         // 0-16 pixels
      Object.defineProperty(window, 'outerHeight', {
        get: () => window.innerHeight + chromeOffset,
        configurable: true,
      });
      Object.defineProperty(window, 'outerWidth', {
        get: () => window.innerWidth + sideOffset,
        configurable: true,
      });
    })();

    // --- screen properties ---
    Object.defineProperty(screen, 'width', { get: () => ${fp.screen.width}, configurable: true });
    Object.defineProperty(screen, 'height', { get: () => ${fp.screen.height}, configurable: true });
    Object.defineProperty(screen, 'availWidth', { get: () => ${fp.screen.width}, configurable: true });
    Object.defineProperty(screen, 'availHeight', { get: () => ${fp.screen.height - 40}, configurable: true });
    Object.defineProperty(screen, 'colorDepth', { get: () => ${fp.screen.colorDepth}, configurable: true });
    Object.defineProperty(screen, 'pixelDepth', { get: () => ${fp.screen.colorDepth}, configurable: true });

    // --- Remove Chromedriver artifacts ---
    (function() {
      const keys = Object.getOwnPropertyNames(document);
      for (const key of keys) {
        if (key.startsWith('cdc_') || key.startsWith('$cdc_')) {
          try { delete document[key]; } catch(e) {}
        }
      }
    })();
  `;
}
