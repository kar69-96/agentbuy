import "dotenv/config";

const KEY = process.env.PARALLEL_API_KEY!;
const runId = "trun_55a6b0bc6ae74eed80af728b9f35d01f";

async function main() {
  const start = Date.now();
  const deadline = Date.now() + 150_000;

  while (Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, 5000));
    try {
      const res = await fetch(
        `https://api.parallel.ai/v1/tasks/runs/${runId}/result`,
        { headers: { "x-api-key": KEY }, signal: AbortSignal.timeout(10_000) },
      );
      if (!res.ok) { console.log(`[${((Date.now() - start) / 1000).toFixed(0)}s] polling...`); continue; }

      const d = (await res.json()) as Record<string, unknown>;
      const run = d.run as Record<string, unknown> | undefined;
      const output = d.output as Record<string, unknown> | undefined;

      if (run?.status === "completed") {
        console.log(`Completed in ${((Date.now() - start) / 1000).toFixed(1)}s\n`);
        console.log(JSON.stringify(output?.content, null, 2));

        const basis = output?.basis as Array<Record<string, unknown>> | undefined;
        const optBasis = basis?.find((b) => b.field === "options");
        if (optBasis) {
          console.log(`\nOptions confidence: ${optBasis.confidence}`);
          console.log(`Reasoning: ${String(optBasis.reasoning).slice(0, 400)}`);
        }
        return;
      }
      if (run?.status === "failed") { console.log("FAILED"); return; }
      console.log(`[${((Date.now() - start) / 1000).toFixed(0)}s] ${run?.status}...`);
    } catch { continue; }
  }
  console.log("TIMEOUT");
}

main().catch(console.error);
