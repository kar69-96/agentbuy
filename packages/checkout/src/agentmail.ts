/**
 * AgentMail integration for checkout email verification.
 *
 * Uses a fixed email address from AGENTMAIL_ADDRESS env var.
 * The same address is reused across all checkouts and account creations.
 * AgentMail API is only needed for polling verification codes.
 */
import { AgentMailClient } from "agentmail";

// ---- Singleton state ----

let client: AgentMailClient | null = null;

// ---- Initialization ----

function getClient(): AgentMailClient {
  if (!client) {
    const apiKey = process.env.AGENTMAIL_API_KEY;
    if (!apiKey) {
      throw new Error("AGENTMAIL_API_KEY is required for email verification");
    }
    client = new AgentMailClient({ apiKey });
  }
  return client;
}

/**
 * Get the fixed agent email address and inbox ID from env.
 * Returns null if AGENTMAIL_ADDRESS is not configured.
 */
export function getAgentInbox(): { inboxId: string; email: string } | null {
  const address = process.env.AGENTMAIL_ADDRESS;
  if (!address) return null;

  // Extract inbox ID (the local part before @)
  const inboxId = address.includes("@") ? address.split("@")[0]! : address;
  const email = address.includes("@") ? address : `${address}@agentmail.to`;

  return { inboxId, email };
}

/**
 * Return the agent email address, or null if not configured.
 */
export function getAgentEmail(): string | null {
  return getAgentInbox()?.email ?? null;
}

// ---- Verification code extraction ----

const CODE_PATTERNS = [
  /verification code[:\s]*(\w{4,8})/i,
  /\bcode[:\s]+(\w{4,8})\b/i,
  /\b(?:one-time|otp|passcode)[:\s]*(\w{4,8})\b/i,
  /\b(\d{4,8})\b/, // numeric codes (4-8 digits) — broadest, check last
];

function extractCode(text: string): string | null {
  for (const pattern of CODE_PATTERNS) {
    const match = text.match(pattern);
    if (match?.[1]) return match[1];
  }
  return null;
}

/**
 * Poll the inbox for a verification code arriving after `sinceTimestamp`.
 *
 * @param inboxId - Inbox to poll
 * @param sinceTimestamp - ISO 8601 timestamp; only messages after this are considered
 * @param timeoutMs - Max time to wait (default 60s)
 * @param pollIntervalMs - Interval between polls (default 4s)
 * @returns The extracted code, or null on timeout
 */
export async function pollForVerificationCode(
  inboxId: string,
  sinceTimestamp: string,
  timeoutMs = 60_000,
  pollIntervalMs = 4_000,
): Promise<string | null> {
  const am = getClient();
  const deadline = Date.now() + timeoutMs;

  console.log(
    `  [agentmail] polling for verification code (timeout=${timeoutMs}ms)`,
  );

  while (Date.now() < deadline) {
    try {
      const response = await am.inboxes.messages.list(inboxId, {
        after: new Date(sinceTimestamp),
        limit: 10,
      });

      for (const msg of response.messages ?? []) {
        // Fetch full message to get text body
        const full = await am.inboxes.messages.get(inboxId, msg.messageId);

        // Try extracted_text first (reply-only content), then full text body
        const body = full.extractedText ?? full.text ?? "";
        const code = extractCode(body);
        if (code) {
          console.log(`  [agentmail] found code: ${code}`);
          return code;
        }
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.log(`  [agentmail] poll error: ${msg.slice(0, 100)}`);
    }

    // Wait before next poll
    await new Promise((resolve) => setTimeout(resolve, pollIntervalMs));
  }

  console.log(`  [agentmail] timed out waiting for verification code`);
  return null;
}

// ---- Reset (for testing) ----

export function resetAgentMail(): void {
  client = null;
}
