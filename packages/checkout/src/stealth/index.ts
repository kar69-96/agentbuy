// ---- Stealth injection module ----
// Replicates advancedStealth at the JS injection layer.
// Produces a single self-contained script injected via addInitScript.

import type { Page } from "@browserbasehq/stagehand";
import { generateFingerprint } from "./fingerprint.js";
import type { SessionFingerprint } from "./fingerprint.js";
import { buildNavigatorPatchScript } from "./navigator-patches.js";
import { buildChromeRuntimeScript } from "./chrome-runtime.js";
import { buildUaConsistencyScript } from "./ua-consistency.js";
import { buildWebglPatchScript } from "./webgl-patches.js";
import { buildCanvasPatchScript } from "./canvas-patches.js";
import { buildAudioPatchScript } from "./audio-patches.js";
import { buildIframePatchScript } from "./iframe-patches.js";

export type { SessionFingerprint } from "./fingerprint.js";
export { generateFingerprint } from "./fingerprint.js";

/**
 * Build the complete stealth script as a single JS string.
 * Each module is wrapped in try/catch so one failure doesn't break others.
 */
export function buildStealthScript(fp: SessionFingerprint): string {
  const modules = [
    { name: "navigator", script: buildNavigatorPatchScript(fp) },
    { name: "chrome-runtime", script: buildChromeRuntimeScript(fp) },
    { name: "ua-consistency", script: buildUaConsistencyScript(fp) },
    { name: "webgl", script: buildWebglPatchScript(fp) },
    { name: "canvas", script: buildCanvasPatchScript(fp) },
    { name: "audio", script: buildAudioPatchScript(fp) },
    { name: "iframe", script: buildIframePatchScript(fp) },
  ];

  const wrapped = modules
    .map((m) => `  try {\n    // --- ${m.name} ---\n${m.script}\n  } catch(__e) {}`)
    .join("\n\n");

  return `(function() {\n  'use strict';\n${wrapped}\n})();`;
}

/**
 * Inject stealth patches into a Stagehand Page.
 * Must be called AFTER stagehand.init() and BEFORE first navigation.
 */
export async function injectStealth(page: Page): Promise<SessionFingerprint> {
  const fp = generateFingerprint();
  const script = buildStealthScript(fp);

  // Inject JS patches — runs before any page script on every navigation
  await page.addInitScript({ content: script });

  // Set HTTP-level User-Agent to match JS-level override
  try {
    await page.sendCDP("Network.setUserAgentOverride", {
      userAgent: fp.userAgent,
      platform: fp.platform,
      acceptLanguage: fp.languages.join(", "),
    });
  } catch {
    // CDP may not be available in all contexts — non-fatal
  }

  console.log(`  [stealth] injected (seed=${fp.seed}, gpu=${fp.gpuRenderer.slice(0, 40)}...)`);
  return fp;
}

/**
 * Inject stealth patches into a Playwright BrowserContext.
 * Used by the crawling adapter. Context-level = covers all pages.
 * Accepts any object with addInitScript + setExtraHTTPHeaders (duck-typed
 * to avoid depending on playwright-core in the checkout package).
 */
export async function injectStealthPlaywright(
  context: {
    addInitScript(script: { content: string }): Promise<void>;
    setExtraHTTPHeaders?(headers: Record<string, string>): Promise<void>;
  },
): Promise<SessionFingerprint> {
  const fp = generateFingerprint();
  const script = buildStealthScript(fp);

  await context.addInitScript({ content: script });

  // Set UA header at context level
  try {
    if (context.setExtraHTTPHeaders) {
      await context.setExtraHTTPHeaders({
        "User-Agent": fp.userAgent,
        "Accept-Language": fp.languages.join(", "),
      });
    }
  } catch {
    // Non-fatal
  }

  return fp;
}
