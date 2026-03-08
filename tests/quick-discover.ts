import "dotenv/config";
import { discoverProduct } from "@bloon/checkout";

const url = process.argv[2] || "https://www.allbirds.com/products/mens-tree-runners";

async function main() {
  console.log("Testing URL:", url);
  console.log("---");

  try {
    const result = await discoverProduct(url);
    if (result) {
      console.log("Name:", result.name);
      console.log("Price:", result.price);
      console.log("Method:", result.method);
      if (result.options?.length) {
        for (const opt of result.options) {
          console.log(`  ${opt.name}: [${opt.values.join(", ")}]`);
          if (opt.prices) {
            console.log(`    Prices:`, opt.prices);
          }
        }
      }
    } else {
      console.log("Result: null (no product data extracted)");
    }
  } catch (err) {
    console.error("Error:", (err as Error).message);
  }
}

main();
