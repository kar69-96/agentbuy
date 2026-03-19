/**
 * Live Parallel.ai Task API test against real product URLs.
 * Usage: pnpm tsx scripts/parallel-live.ts
 *
 * Uses Task API with JSON schema for structured output.
 * Polls /result endpoint for completed output with citations + confidence.
 */
import "dotenv/config";

const PARALLEL_API_KEY = process.env.PARALLEL_API_KEY;
if (!PARALLEL_API_KEY) {
  console.error("PARALLEL_API_KEY is required. Add it to .env");
  process.exit(1);
}

const urls = [
  "https://www.allbirds.com/products/mens-tree-runners",
  "https://bombas.com/products/mens-tri-block-ankle-sock",
  "https://www.amazon.com/dp/B0D5CPLR2R",
  "https://www.target.com/p/stanley-quencher-h2-0-flowstate-tumbler-40oz/-/A-87790795",
];

const PRODUCT_SCHEMA = {
  type: "json" as const,
  json_schema: {
    type: "object",
    properties: {
      name: { type: "string" },
      price: { type: "string" },
      brand: { type: "string" },
      currency: { type: "string" },
      options: {
        type: "array",
        items: {
          type: "object",
          properties: {
            name: { type: "string" },
            values: { type: "array", items: { type: "string" } },
          },
        },
      },
    },
    required: ["name", "price"],
  },
};

interface TaskResult {
  run: { run_id: string; status: string };
  output?: {
    type: string;
    content?: {
      name?: string;
      price?: string;
      brand?: string;
      currency?: string;
      options?: Array<{ name: string; values: string[] }>;
    };
    basis?: Array<{
      field: string;
      confidence: string;
      reasoning: string;
    }>;
  };
}

async function testParallel(url: string): Promise<void> {
  const start = Date.now();
  const domain = new URL(url).hostname.replace("www.", "");

  // 1. Create task run
  const createRes = await fetch("https://api.parallel.ai/v1/tasks/runs", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": PARALLEL_API_KEY!,
    },
    body: JSON.stringify({
      task_spec: {
        objective: `Extract structured product data from this product page: ${url}`,
        output_schema: PRODUCT_SCHEMA,
      },
      input: { url },
      processor: "base",
    }),
    signal: AbortSignal.timeout(15_000),
  });

  if (!createRes.ok) {
    const body = await createRes.text();
    console.log(`  CREATE FAILED (${createRes.status}): ${body.slice(0, 200)}`);
    return;
  }

  const run = (await createRes.json()) as { run_id: string };
  console.log(`  Run: ${run.run_id}`);

  // 2. Poll /result (blocks until complete)
  const deadline = Date.now() + 90_000;
  while (Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, 5000));

    let pollRes: Response;
    try {
      pollRes = await fetch(
        `https://api.parallel.ai/v1/tasks/runs/${run.run_id}/result`,
        {
          headers: { "x-api-key": PARALLEL_API_KEY! },
          signal: AbortSignal.timeout(15_000),
        },
      );
    } catch {
      continue;
    }

    if (!pollRes.ok) continue;

    const result = (await pollRes.json()) as TaskResult;

    if (result.run.status === "completed" && result.output?.content) {
      const elapsed = ((Date.now() - start) / 1000).toFixed(1);
      const c = result.output.content;

      console.log(`  Name:     ${c.name ?? "(none)"}`);
      console.log(`  Price:    ${c.price ?? "(none)"}`);
      console.log(`  Brand:    ${c.brand ?? "(none)"}`);
      console.log(`  Currency: ${c.currency ?? "(none)"}`);
      console.log(`  Options:  ${c.options?.length ?? 0} groups`);
      for (const opt of c.options ?? []) {
        console.log(`    - ${opt.name}: ${opt.values.length} values`);
      }

      // Show confidence per field
      if (result.output.basis) {
        const conf = result.output.basis
          .map((b) => `${b.field}=${b.confidence}`)
          .join(", ");
        console.log(`  Confidence: ${conf}`);
      }

      console.log(`  Time:     ${elapsed}s`);
      return;
    }

    if (result.run.status === "failed") {
      const elapsed = ((Date.now() - start) / 1000).toFixed(1);
      console.log(`  FAILED after ${elapsed}s`);
      return;
    }
  }

  const elapsed = ((Date.now() - start) / 1000).toFixed(1);
  console.log(`  TIMEOUT after ${elapsed}s`);
}

// ---- Main ----

async function main() {
  console.log("=== Parallel.ai Task API (structured output) ===\n");

  for (const url of urls) {
    const domain = new URL(url).hostname.replace("www.", "");
    console.log(`\n--- ${domain} ---`);
    console.log(`URL: ${url}`);
    await testParallel(url);
  }
}

main().catch(console.error);
