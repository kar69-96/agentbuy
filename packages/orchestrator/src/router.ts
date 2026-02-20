import { type PaymentRoute, type X402Requirements } from "@proxo/core";
import { detectRoute } from "@proxo/x402";

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
