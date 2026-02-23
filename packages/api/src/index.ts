import { serve } from "@hono/node-server";
import { getPort } from "@proxo/core";
import { createApp } from "./server.js";

const app = createApp();
const port = getPort();

serve({ fetch: app.fetch, port }, () => {
  console.log(`Proxo listening on http://localhost:${port}`);
});
