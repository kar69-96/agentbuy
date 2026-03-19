// ---- Session fingerprint generation ----
// Produces a consistent identity per session, unique across sessions.
// All randomization derives from a single seed for internal consistency.

export interface SessionFingerprint {
  seed: number;
  userAgent: string;
  platform: "Win32" | "MacIntel";
  oscpu: string;
  vendor: string;
  languages: string[];
  hardwareConcurrency: number;
  deviceMemory: number;
  gpuVendor: string;
  gpuRenderer: string;
  screen: { width: number; height: number; colorDepth: number };
  maxTouchPoints: number;
  audioBaseLatency: number;
  canvasNoiseSeed: number;
  webglNoiseSeed: number;
  audioNoiseSeed: number;
  chromeVersion: string;
}

// Curated from real-world hardware — must look authentic
const GPU_PAIRS: Array<{ vendor: string; renderer: string }> = [
  { vendor: "Google Inc. (NVIDIA)", renderer: "ANGLE (NVIDIA, NVIDIA GeForce GTX 1080 Ti Direct3D11 vs_5_0 ps_5_0, D3D11)" },
  { vendor: "Google Inc. (NVIDIA)", renderer: "ANGLE (NVIDIA, NVIDIA GeForce RTX 3060 Direct3D11 vs_5_0 ps_5_0, D3D11)" },
  { vendor: "Google Inc. (NVIDIA)", renderer: "ANGLE (NVIDIA, NVIDIA GeForce RTX 3070 Direct3D11 vs_5_0 ps_5_0, D3D11)" },
  { vendor: "Google Inc. (NVIDIA)", renderer: "ANGLE (NVIDIA, NVIDIA GeForce RTX 4070 Direct3D11 vs_5_0 ps_5_0, D3D11)" },
  { vendor: "Google Inc. (AMD)", renderer: "ANGLE (AMD, AMD Radeon RX 580 Direct3D11 vs_5_0 ps_5_0, D3D11)" },
  { vendor: "Google Inc. (AMD)", renderer: "ANGLE (AMD, AMD Radeon RX 6700 XT Direct3D11 vs_5_0 ps_5_0, D3D11)" },
  { vendor: "Google Inc. (Intel)", renderer: "ANGLE (Intel, Intel(R) UHD Graphics 630 Direct3D11 vs_5_0 ps_5_0, D3D11)" },
  { vendor: "Google Inc. (Intel)", renderer: "ANGLE (Intel, Intel(R) Iris(R) Xe Graphics Direct3D11 vs_5_0 ps_5_0, D3D11)" },
  { vendor: "Google Inc. (Apple)", renderer: "ANGLE (Apple, Apple M1 Pro, OpenGL 4.1)" },
  { vendor: "Google Inc. (Apple)", renderer: "ANGLE (Apple, Apple M2, OpenGL 4.1)" },
];

const SCREENS = [
  { width: 1920, height: 1080, colorDepth: 24 },
  { width: 2560, height: 1440, colorDepth: 24 },
  { width: 1366, height: 768, colorDepth: 24 },
  { width: 1440, height: 900, colorDepth: 24 },
  { width: 1680, height: 1050, colorDepth: 24 },
  { width: 3840, height: 2160, colorDepth: 30 },
];

const HW_CONCURRENCY = [4, 6, 8, 12, 16];
const DEVICE_MEMORY = [4, 8];

// Simple xorshift32 for deterministic derivation from seed
function xorshift32(state: number): number {
  let x = state;
  x ^= x << 13;
  x ^= x >> 17;
  x ^= x << 5;
  return x >>> 0;
}

function pick<T>(arr: readonly T[], seed: number): T {
  return arr[seed % arr.length];
}

export const CHROME_VERSION = "131";

export function generateFingerprint(): SessionFingerprint {
  const seed = (Date.now() ^ (Math.random() * 0xffffffff)) >>> 0;

  const s1 = xorshift32(seed);
  const s2 = xorshift32(s1);
  const s3 = xorshift32(s2);
  const s4 = xorshift32(s3);
  const s5 = xorshift32(s4);
  const s6 = xorshift32(s5);
  const s7 = xorshift32(s6);

  // 70% Windows, 30% Mac
  const isWindows = (s1 % 10) < 7;
  const platform = isWindows ? "Win32" as const : "MacIntel" as const;
  const oscpu = isWindows ? "Windows NT 10.0; Win64; x64" : "";

  const platformUA = isWindows
    ? "Windows NT 10.0; Win64; x64"
    : "Macintosh; Intel Mac OS X 10_15_7";

  const gpu = pick(GPU_PAIRS, s2);
  const screen = pick(SCREENS, s3);

  // Audio latency: realistic range
  const audioBaseLatency = 0.005 + (s7 % 500) / 100000; // 0.005 - 0.01

  return {
    seed,
    userAgent: `Mozilla/5.0 (${platformUA}) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${CHROME_VERSION}.0.0.0 Safari/537.36`,
    platform,
    oscpu,
    vendor: "Google Inc.",
    languages: ["en-US", "en"],
    hardwareConcurrency: pick(HW_CONCURRENCY, s4),
    deviceMemory: pick(DEVICE_MEMORY, s5),
    gpuVendor: gpu.vendor,
    gpuRenderer: gpu.renderer,
    screen,
    maxTouchPoints: 0,
    audioBaseLatency,
    canvasNoiseSeed: xorshift32(s6),
    webglNoiseSeed: xorshift32(s7),
    audioNoiseSeed: xorshift32(xorshift32(s7)),
    chromeVersion: CHROME_VERSION,
  };
}
