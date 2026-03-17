import { InsightVMConfig } from "../types.js";

/**
 * Loads configuration from environment variables.
 * All values are injected at startup — nothing is hardcoded.
 *
 * Required environment variables:
 *   INSIGHTVM_HOST        - Console hostname or IP
 *   INSIGHTVM_PORT        - Console port (default: 3780)
 *   INSIGHTVM_USERNAME    - Service account username
 *   INSIGHTVM_PASSWORD    - Service account password
 *   INSIGHTVM_OWNED_SITE_ID - Site ID this MCP has full ownership over
 *
 * Optional environment variables:
 *   INSIGHTVM_VERIFY_SSL  - Set to "false" to disable SSL verification (dev only)
 *   INSIGHTVM_PORT_EXCLUSIONS - Comma-separated list of known-good port numbers
 */
export function loadConfig(): InsightVMConfig {
  const required = [
    "INSIGHTVM_HOST",
    "INSIGHTVM_USERNAME",
    "INSIGHTVM_PASSWORD",
    "INSIGHTVM_OWNED_SITE_ID",
  ];

  const missing = required.filter((k) => !process.env[k]);
  if (missing.length > 0) {
    throw new Error(
      `Missing required environment variables: ${missing.join(", ")}\n` +
      "Set these before starting the MCP server."
    );
  }

  const portExclusions = (process.env.INSIGHTVM_PORT_EXCLUSIONS ?? "")
    .split(",")
    .map((p) => p.trim())
    .filter(Boolean)
    .map((p) => {
      const n = parseInt(p, 10);
      if (isNaN(n) || n < 1 || n > 65535) {
        throw new Error(`Invalid port in INSIGHTVM_PORT_EXCLUSIONS: "${p}"`);
      }
      return n;
    });

  return {
    host: process.env.INSIGHTVM_HOST!,
    port: parseInt(process.env.INSIGHTVM_PORT ?? "3780", 10),
    username: process.env.INSIGHTVM_USERNAME!,
    password: process.env.INSIGHTVM_PASSWORD!,
    ownedSiteId: process.env.INSIGHTVM_OWNED_SITE_ID!,
    verifySsl: process.env.INSIGHTVM_VERIFY_SSL !== "false",
    portExclusions,
  };
}
