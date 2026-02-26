import type { CHECKOUT_STEPS } from "./task.js";

export type CheckoutStep = (typeof CHECKOUT_STEPS)[keyof typeof CHECKOUT_STEPS];

// ---- Step tracker for agent → CheckoutStep mapping ----

export class StepTracker {
  currentStep: string = "navigate";

  /**
   * Called from onStepFinish callback. Inspects tool calls to infer the current
   * checkout step for backward-compatible failedStep reporting.
   */
  update(
    toolCalls: ReadonlyArray<{ toolName: string; input?: unknown }>,
    pageUrl?: string,
  ): void {
    for (const call of toolCalls) {
      const name = call.toolName;

      // Custom tools → direct mapping
      if (name === "fillShippingInfo") {
        this.currentStep = "fill-shipping";
        continue;
      }
      if (name === "fillCardFields") {
        this.currentStep = "fill-card";
        continue;
      }
      if (name === "fillBillingAddress") {
        this.currentStep = "fill-billing";
        continue;
      }

      // Built-in act tool → pattern match on instruction
      if (name === "act") {
        const input = call.input as { action?: string } | undefined;
        const action = (input?.action ?? "").toLowerCase();
        this.inferFromAction(action);
        continue;
      }

      // Built-in goto → navigation
      if (name === "goto") {
        this.currentStep = "navigate";
        continue;
      }
    }

    // URL-based secondary signal
    if (pageUrl) {
      this.inferFromUrl(pageUrl);
    }
  }

  /** Direct set during known phases (e.g., initial navigation). */
  setStep(step: string): void {
    this.currentStep = step;
  }

  private inferFromAction(action: string): void {
    if (/add\s*to\s*cart|add\s*to\s*bag|add\s*to\s*basket/i.test(action)) {
      this.currentStep = "add-to-cart";
      return;
    }
    if (/checkout|proceed/i.test(action)) {
      this.currentStep = "proceed-to-checkout";
      return;
    }
    if (/dismiss|popup|modal|overlay|cookie|banner/i.test(action)) {
      this.currentStep = "dismiss-popups";
      return;
    }
    if (/shipping\s*option|shipping\s*method|delivery/i.test(action)) {
      this.currentStep = "select-shipping";
      return;
    }
    if (/express\s*pay|shop\s*pay|apple\s*pay|google\s*pay|paypal/i.test(action)) {
      this.currentStep = "avoid-express-pay";
      return;
    }
    if (/place\s*order|submit\s*order|complete\s*purchase|confirm\s*order/i.test(action)) {
      this.currentStep = "place-order";
      return;
    }
    if (/guest|skip\s*login|continue\s*as\s*guest/i.test(action)) {
      this.currentStep = "proceed-to-checkout";
      return;
    }
  }

  private inferFromUrl(url: string): void {
    const lower = url.toLowerCase();
    if (lower.includes("/cart")) {
      if (this.currentStep === "navigate") {
        this.currentStep = "add-to-cart";
      }
    } else if (
      lower.includes("/checkout") ||
      lower.includes("/checkouts/")
    ) {
      // Only upgrade if we haven't reached shipping yet
      if (
        this.currentStep === "navigate" ||
        this.currentStep === "add-to-cart" ||
        this.currentStep === "proceed-to-checkout"
      ) {
        this.currentStep = "proceed-to-checkout";
      }
    } else if (lower.includes("/confirmation") || lower.includes("/thank")) {
      this.currentStep = "verify-confirmation";
    }
  }
}
