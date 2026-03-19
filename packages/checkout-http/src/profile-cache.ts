/**
 * Read/write SiteProfile JSON files to disk.
 *
 * Profiles are stored at ~/.bloon/profiles/{domain}.json with
 * restricted permissions (0o700 directory, 0o600 files). Writes
 * are atomic (write to .tmp, rename) to prevent corruption on
 * crash or concurrent access.
 *
 * TTL-based staleness detection uses adaptive decay: each
 * invalidation halves the TTL (down to MIN_PROFILE_TTL_MS).
 */

import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import type { SiteProfile } from "@bloon/core";
import {
  DEFAULT_PROFILE_TTL_MS,
  MIN_PROFILE_TTL_MS,
} from "@bloon/core";

// ---- Directory helpers ----

/**
 * Returns the profiles directory path: ~/.bloon/profiles
 */
export function getProfileDir(): string {
  return path.join(os.homedir(), ".bloon", "profiles");
}

/**
 * Ensure the profiles directory exists with restricted permissions.
 */
function ensureProfileDir(): void {
  const dir = getProfileDir();
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  }
}

/**
 * Build the file path for a domain's profile.
 */
function profilePath(domain: string): string {
  // Sanitize domain to prevent path traversal
  const sanitized = domain.replace(/[^a-zA-Z0-9._-]/g, "_");
  return path.join(getProfileDir(), `${sanitized}.json`);
}

// ---- Read ----

/**
 * Load a cached SiteProfile for the given domain.
 *
 * @param domain - The domain to look up (e.g., "example.com")
 * @returns The parsed SiteProfile, or null if not found or unreadable
 */
export function loadProfile(domain: string): SiteProfile | null {
  const filePath = profilePath(domain);

  try {
    const raw = fs.readFileSync(filePath, "utf-8");
    const parsed: unknown = JSON.parse(raw);

    // Basic shape validation
    if (
      parsed !== null &&
      typeof parsed === "object" &&
      "domain" in parsed &&
      "endpoints" in parsed &&
      "staleness" in parsed
    ) {
      return parsed as SiteProfile;
    }

    return null;
  } catch {
    return null;
  }
}

// ---- Write ----

/**
 * Atomically save a SiteProfile to disk.
 *
 * Writes to a .tmp file first, then renames to prevent partial writes.
 *
 * @param profile - The SiteProfile to persist
 */
export function saveProfile(profile: SiteProfile): void {
  ensureProfileDir();

  const filePath = profilePath(profile.domain);
  const tmpPath = filePath + ".tmp";

  const json = JSON.stringify(profile, null, 2);

  fs.writeFileSync(tmpPath, json, { encoding: "utf-8", mode: 0o600 });
  fs.renameSync(tmpPath, filePath);
}

// ---- Staleness check ----

/**
 * Check whether a cached profile has exceeded its adaptive TTL.
 *
 * The TTL is stored in profile.staleness.currentTtlMs and decays
 * (halves) after each invalidation, with a floor of MIN_PROFILE_TTL_MS.
 *
 * @param profile - The SiteProfile to check
 * @returns true if the profile is stale and should be re-learned
 */
export function isProfileStale(profile: SiteProfile): boolean {
  const { staleness } = profile;
  const lastValidated = new Date(staleness.lastValidatedAt).getTime();

  if (isNaN(lastValidated)) {
    // Can't parse the timestamp -- treat as stale
    return true;
  }

  const ttl = Math.max(staleness.currentTtlMs, MIN_PROFILE_TTL_MS);
  const now = Date.now();

  return now - lastValidated > ttl;
}

// ---- Invalidation ----

/**
 * Delete a cached profile for the given domain.
 *
 * @param domain - The domain whose profile should be removed
 */
export function invalidateProfile(domain: string): void {
  const filePath = profilePath(domain);

  try {
    fs.unlinkSync(filePath);
  } catch {
    // File doesn't exist or already deleted -- no-op
  }
}
