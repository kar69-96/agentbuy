/**
 * Head-to-head: Exa vs Parallel Task API on variant pricing.
 * Tests products where options have DIFFERENT prices.
 * Usage: pnpm tsx scripts/variant-battle.ts
 */
import "dotenv/config";
import { discoverViaExa } from "../packages/crawling/src/exa-extract.js";

const PARALLEL_KEY = process.env.PARALLEL_API_KEY!;

// Products with known variant price differences
const tests = [
  {
    name: "Stanley Tumbler (30oz vs 40oz)",
    url: "https://www.target.com/p/stanley-quencher-h2-0-flowstate-tumbler-40oz/-/A-87790795",
  },
  {
    name: "Bombas Socks (single vs 6-pack vs 12-pack)",
    url: "https://bombas.com/products/mens-tri-block-ankle-sock",
  },
  {
    name: "Nike Dunk Low (sizes have different prices on resale)",
    url: "https://www.nike.com/t/dunk-low-retro-mens-shoes-76ZnMk/DD1391-100",
  },
];

// ---- Exa ----

async function testExa(url: string): Promise<void> {
  const start = Date.now();
  const result = await discoverViaExa(url);
  const elapsed = ((Date.now() - start) / 1000).toFixed(1);

  if (!result) {
    console.log(`    Result: NULL (${elapsed}s)`);
    return;
  }

  console.log(`    Name:    ${result.name}`);
  console.log(`    Price:   ${result.price}`);
  console.log(`    Options: ${result.options.length} groups`);
  for (const opt of result.options) {
    if (opt.prices && Object.keys(opt.prices).length > 0) {
      console.log(`    - ${opt.name}: ${opt.values.length} values, ${Object.keys(opt.prices).length} with prices`);
      const sample = Object.entries(opt.prices).slice(0, 3);
      for (const [val, price] of sample) {
        console.log(`        ${val}: $${price}`);
      }
      if (Object.keys(opt.prices).length > 3) console.log(`        ... +${Object.keys(opt.prices).length - 3} more`);
    } else {
      console.log(`    - ${opt.name}: ${opt.values.length} values (no per-value prices)`);
    }
  }
  console.log(`    Time:    ${elapsed}s`);
}

// ---- Parallel Task API (lite) ----

async function testParallel(url: string): Promise<void> {
  const start = Date.now();

  const createRes = await fetch("https://api.parallel.ai/v1/tasks/runs", {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-api-key": PARALLEL_KEY },
    body: JSON.stringify({
      task_spec: {
        objective: `For this product page (${url}), find ALL available options (Size, Color, Pack Size, etc.) and the PRICE for each individual option value. Different sizes or colors may have different prices. Report each value with its specific price.`,
        output_schema: {
          type: "json",
          json_schema: {
            type: "object",
            properties: {
              name: { type: "string" },
              base_price: { type: "string" },
              options: {
                type: "array",
                items: {
                  type: "object",
                  properties: {
                    name: { type: "string" },
                    values: {
                      type: "array",
                      items: {
                        type: "object",
                        properties: {
                          value: { type: "string" },
                          price: { type: "string" },
                        },
                      },
                    },
                  },
                },
              },
            },
            required: ["name", "base_price", "options"],
          },
        },
      },
      input: { url },
      processor: "lite",
    }),
    signal: AbortSignal.timeout(15_000),
  });

  if (!createRes.ok) {
    const body = await createRes.text();
    console.log(`    CREATE FAILED: ${body.slice(0, 150)}`);
    return;
  }

  const { run_id } = (await createRes.json()) as { run_id: string };

  // Poll for up to 150s
  const deadline = Date.now() + 150_000;
  while (Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, 5000));
    let pollRes: Response;
    try {
      pollRes = await fetch(`https://api.parallel.ai/v1/tasks/runs/${run_id}/result`, {
        headers: { "x-api-key": PARALLEL_KEY },
        signal: AbortSignal.timeout(10_000),
      });
    } catch { continue; }
    if (!pollRes.ok) continue;

    const d = (await pollRes.json()) as {
      run: { status: string };
      output?: {
        content?: {
          name?: string;
          base_price?: string;
          options?: Array<{
            name: string;
            values: Array<{ value: string; price: string }>;
          }>;
        };
        basis?: Array<{ field: string; confidence: string; reasoning: string }>;
      };
    };

    if (d.run.status === "completed" && d.output?.content) {
      const elapsed = ((Date.now() - start) / 1000).toFixed(1);
      const c = d.output.content;

      console.log(`    Name:    ${c.name ?? "(none)"}`);
      console.log(`    Price:   ${c.base_price ?? "(none)"}`);
      console.log(`    Options: ${c.options?.length ?? 0} groups`);
      for (const opt of c.options ?? []) {
        const uniquePrices = new Set(opt.values.map((v) => v.price));
        console.log(`    - ${opt.name}: ${opt.values.length} values, ${uniquePrices.size} unique prices`);
        for (const v of opt.values.slice(0, 4)) {
          console.log(`        ${v.value}: ${v.price}`);
        }
        if (opt.values.length > 4) console.log(`        ... +${opt.values.length - 4} more`);
      }

      const optBasis = d.output.basis?.find((b) => b.field === "options");
      if (optBasis) console.log(`    Confidence: ${optBasis.confidence}`);
      console.log(`    Time:    ${elapsed}s`);
      return;
    }

    if (d.run.status === "failed") {
      console.log(`    FAILED (${((Date.now() - start) / 1000).toFixed(1)}s)`);
      return;
    }
  }
  console.log(`    TIMEOUT (>150s)`);
}

// ---- Main ----

async function main() {
  for (const test of tests) {
    console.log(`\n${"═".repeat(60)}`);
    console.log(`${test.name}`);
    console.log(`URL: ${test.url}`);
    console.log("═".repeat(60));

    console.log("\n  [Exa]");
    await testExa(test.url);

    console.log("\n  [Parallel lite]");
    await testParallel(test.url);
  }
}

main().catch(console.error);
