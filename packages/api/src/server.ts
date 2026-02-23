import { Hono } from "hono";
import { walletsRoutes } from "./routes/wallets.js";
import { buyRoutes } from "./routes/buy.js";
import { confirmRoutes } from "./routes/confirm.js";
import { fundRoutes } from "./routes/fund.js";
import { errorHandler } from "./error-handler.js";

export function createApp(): Hono {
  const app = new Hono();

  app.route("/api/wallets", walletsRoutes);
  app.route("/api", buyRoutes);
  app.route("/api", confirmRoutes);
  app.route("/fund", fundRoutes);

  app.onError(errorHandler);

  return app;
}
