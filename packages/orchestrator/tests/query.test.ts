import { describe, it, expect, vi } from "vitest";

// ---- Mock external packages ----

vi.mock("@bloon/x402", () => ({
  detectRoute: vi.fn(),
}));

vi.mock("@bloon/checkout", () => ({
  discoverProduct: vi.fn(),
}));

import { detectRoute } from "@bloon/x402";
import { discoverProduct } from "@bloon/checkout";
import { query } from "../src/query.js";

const mockedDetectRoute = vi.mocked(detectRoute);
const mockedDiscoverProduct = vi.mocked(discoverProduct);

// ---- Tests ----

describe("query", () => {
  it("query x402 URL returns empty options and required_fields", async () => {
    mockedDetectRoute.mockResolvedValue({
      route: "x402",
      requirements: {
        scheme: "exact",
        network: "eip155:84532",
        maxAmountRequired: "0.50",
        payTo: "0x" + "e".repeat(40),
        asset: "USDC",
        description: "Echo API",
      },
    });

    const result = await query({ url: "https://x402.example.com/api" });

    expect(result.route).toBe("x402");
    expect(result.product.name).toBe("Echo API");
    expect(result.product.price).toBe("0.50");
    expect(result.options).toEqual([]);
    expect(result.required_fields).toEqual([]);
    expect(result.discovery_method).toBe("x402");
  });

  it("query browserbase URL returns product info + options + required_fields", async () => {
    mockedDetectRoute.mockResolvedValue({ route: "browserbase" });
    mockedDiscoverProduct.mockResolvedValue({
      name: "Cool Sneakers",
      price: "89.99",
      image_url: "https://shop.example.com/img.jpg",
      method: "scrape",
      options: [
        { name: "Color", values: ["White", "Black"] },
        { name: "Size", values: ["9", "10", "11"] },
      ],
    });

    const result = await query({ url: "https://shop.example.com/sneakers" });

    expect(result.route).toBe("browserbase");
    expect(result.product.name).toBe("Cool Sneakers");
    expect(result.product.price).toBe("89.99");
    expect(result.options).toHaveLength(2);
    expect(result.options[0].name).toBe("Color");
    // 9 standard shipping fields + 1 selections field
    expect(result.required_fields).toHaveLength(10);
    expect(result.required_fields.find((f) => f.field === "selections")).toBeDefined();
  });

  it("query browserbase URL without options has no selections in required_fields", async () => {
    mockedDetectRoute.mockResolvedValue({ route: "browserbase" });
    mockedDiscoverProduct.mockResolvedValue({
      name: "Simple Widget",
      price: "10.00",
      method: "scrape",
      options: [],
    });

    const result = await query({ url: "https://shop.example.com/widget" });

    expect(result.required_fields.find((f) => f.field === "selections")).toBeUndefined();
    // 9 standard shipping fields
    expect(result.required_fields).toHaveLength(9);
  });

  it("query invalid URL throws INVALID_URL", async () => {
    await expect(query({ url: "not-a-url" })).rejects.toThrow(
      expect.objectContaining({ code: "INVALID_URL" }),
    );
  });

  it("query with discovery failure throws QUERY_FAILED", async () => {
    mockedDetectRoute.mockResolvedValue({ route: "browserbase" });
    mockedDiscoverProduct.mockRejectedValue(new Error("Network timeout"));

    await expect(
      query({ url: "https://shop.example.com/timeout" }),
    ).rejects.toThrow(expect.objectContaining({ code: "QUERY_FAILED" }));
  });
});
