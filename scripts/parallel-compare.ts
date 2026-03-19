/**
 * Compare Parallel.ai Extract API vs Task API (lite vs base).
 * Usage: pnpm tsx scripts/parallel-compare.ts
 */
import "dotenv/config";

const KEY = process.env.PARALLEL_API_KEY!;
if (!KEY) { console.error("PARALLEL_API_KEY required"); process.exit(1); }

const urls = [
  "https://www.allbirds.com/products/mens-tree-runners",
  "https://bombas.com/products/mens-tri-block-ankle-sock",
  "https://www.amazon.com/dp/B0D5CPLR2R",
  "https://www.target.com/p/stanley-quencher-h2-0-flowstate-tumbler-40oz/-/A-87790795",
];

// ---- Extract API ----

async function testExtract(url: string): Promise<void> {
  const start = Date.now();
  const res = await fetch("https://api.parallel.ai/v1beta/extract", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": KEY,
      "parallel-beta": "search-extract-2025-10-10",
    },
    body: JSON.stringify({
      urls: [url],
      objective: "Product name, current price, brand, available sizes and colors",
      excerpts: true,
      full_content: false,
    }),
    signal: AbortSignal.timeout(30_000),
  });

  const elapsed = ((Date.now() - start) / 1000).toFixed(1);

  if (!res.ok) {
    console.log(`    FAILED (${res.status}) — ${elapsed}s`);
    return;
  }

  const data = await res.json() as { results?: Array<{ title?: string; excerpts?: string[] }> };
  const r = data.results?.[0];

  if (!r) {
    console.log(`    No result — ${elapsed}s`);
    return;
  }

  console.log(`    Title: ${r.title ?? "(none)"}`);
  console.log(`    Excerpts: ${r.excerpts?.length ?? 0}`);
  if (r.excerpts?.[0]) {
    console.log(`    First: ${r.excerpts[0].slice(0, 120)}...`);
  }
  console.log(`    Time: ${elapsed}s`);
}

// ---- Task API ----

interface TaskContent {
  name?: string;
  price?: string;
  brand?: string;
  currency?: string;
  options?: Array<{ name: string; values: string[] }>;
}

async function testTask(url: string, processor: string): Promise<void> {
  const start = Date.now();

  const createRes = await fetch("https://api.parallel.ai/v1/tasks/runs", {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-api-key": KEY },
    body: JSON.stringify({
      task_spec: {
        objective: `Extract product name, price, and brand from: ${url}`,
        output_schema: {
          type: "json",
          json_schema: {
            type: "object",
            properties: {
              name: { type: "string" },
              price: { type: "string" },
              brand: { type: "string" },
            },
            required: ["name", "price"],
          },
        },
      },
      input: { url },
      processor,
    }),
    signal: AbortSignal.timeout(15_000),
  });

  if (!createRes.ok) {
    const body = await createRes.text();
    console.log(`    CREATE FAILED (${createRes.status}): ${body.slice(0, 120)}`);
    return;
  }

  const { run_id } = await createRes.json() as { run_id: string };

  // Poll for up to 120s
  const deadline = Date.now() + 120_000;
  while (Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, 5000));

    let pollRes: Response;
    try {
      pollRes = await fetch(`https://api.parallel.ai/v1/tasks/runs/${run_id}/result`, {
        headers: { "x-api-key": KEY },
        signal: AbortSignal.timeout(10_000),
      });
    } catch { continue; }

    if (!pollRes.ok) continue;

    const result = await pollRes.json() as {
      run: { status: string };
      output?: { content?: TaskContent };
    };

    if (result.run.status === "completed" && result.output?.content) {
      const elapsed = ((Date.now() - start) / 1000).toFixed(1);
      const c = result.output.content;
      console.log(`    Name:  ${c.name ?? "(none)"}`);
      console.log(`    Price: ${c.price ?? "(none)"}`);
      console.log(`    Brand: ${c.brand ?? "(none)"}`);
      console.log(`    Time:  ${elapsed}s`);
      return;
    }

    if (result.run.status === "failed") {
      const elapsed = ((Date.now() - start) / 1000).toFixed(1);
      console.log(`    FAILED — ${elapsed}s`);
      return;
    }
  }

  console.log(`    TIMEOUT (>120s)`);
}

// ---- Main ----

async function main() {
  console.log("╔══════════════════════════════════════════════╗");
  console.log("║  Parallel.ai — Extract vs Task (lite/base)  ║");
  console.log("╚══════════════════════════════════════════════╝\n");

  for (const url of urls) {
    const domain = new URL(url).hostname.replace("www.", "");
    console.log(`\n━━━ ${domain} ━━━`);
    console.log(`URL: ${url}\n`);

    console.log("  [Extract API]");
    await testExtract(url);

    console.log("  [Task API — lite]");
    await testTask(url, "lite");

    console.log("  [Task API — base]");
    await testTask(url, "base");
  }
}

main().catch(console.error);
