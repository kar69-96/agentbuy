import { type PaymentRoute, type X402Requirements } from "@bloon/core";
import { detectRoute } from "@bloon/x402";

export interface RouteDecision {
  route: PaymentRoute;
  requirements?: X402Requirements;
}

export async function routeOrder(url: string): Promise<RouteDecision> {
  const result = await detectRoute(url);
  return {
    route: result.route,
    requirements: result.requirements,
  };
}
