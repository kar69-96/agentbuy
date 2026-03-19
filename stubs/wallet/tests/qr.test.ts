import { describe, it, expect } from "vitest";
import { PNG } from "pngjs";
import jsQR from "jsqr";
import { generateQR } from "../src/qr.js";

describe("generateQR", () => {
  const TEST_ADDRESS = "0x1234567890abcdef1234567890abcdef12345678";

  it("returns a valid base64 PNG data URL", async () => {
    const dataUrl = await generateQR(TEST_ADDRESS);
    expect(dataUrl).toMatch(/^data:image\/png;base64,/);

    const base64 = dataUrl.replace(/^data:image\/png;base64,/, "");
    const buffer = Buffer.from(base64, "base64");
    expect(buffer.length).toBeGreaterThan(0);
  });

  it("QR decodes back to the original address", async () => {
    const dataUrl = await generateQR(TEST_ADDRESS);
    const base64 = dataUrl.replace(/^data:image\/png;base64,/, "");
    const buffer = Buffer.from(base64, "base64");

    const png = PNG.sync.read(buffer);
    const code = jsQR(
      new Uint8ClampedArray(png.data),
      png.width,
      png.height,
    );

    expect(code).not.toBeNull();
    expect(code!.data).toBe(TEST_ADDRESS);
  });
});
