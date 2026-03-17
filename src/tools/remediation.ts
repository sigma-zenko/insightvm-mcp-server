import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { InsightVMClient } from "../services/insightvm-client.js";
import { Solution, Ticket } from "../types.js";

// Reference object returned by /vulnerabilities/{id}/solutions — just IDs and links
interface SolutionReference {
  id?: string;
  links?: Array<{ rel: string; href: string }>;
}

export function registerRemediationTools(server: McpServer, client: InsightVMClient): void {

  // ── Get remediation solutions ─────────────────────────────────────────────
  // This tool lives in both assets.ts (as a quick lookup) and here as a richer version.
  // The version here replaces the one in assets.ts for the remediation module.

  server.registerTool(
    "insightvm_get_solution_detail",
    {
      title: "Get Solution Detail",
      description: `Returns full detail for a specific remediation solution including type, affected platforms, time estimate, and step-by-step instructions.

Args:
  - solution_id (string): The solution ID (obtained from insightvm_get_remediation)
  - include_steps (boolean): Include detailed step text (default: true)`,
      inputSchema: z.object({
        solution_id: z.string().min(1),
        include_steps: z.boolean().default(true),
      }).strict(),
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    async ({ solution_id, include_steps }) => {
      const solution = await client.get<Solution>(`/solutions/${solution_id}`);
      const output = {
        id: solution.id,
        summary: solution.summary,
        type: solution.type,
        appliesTo: solution.appliesTo,
        estimate: solution.estimate,
        additionalInformation: solution.additionalInformation,
        ...(include_steps && solution.steps?.text ? { steps: solution.steps.text } : {}),
      };
      return { content: [{ type: "text" as const, text: JSON.stringify(output, null, 2) }] };
    }
  );

  // ── Get remediation for a vulnerability ───────────────────────────────────

  server.registerTool(
    "insightvm_get_remediation",
    {
      title: "Get Remediation Solutions",
      description: `Returns available remediation options for a specific vulnerability with full solution detail.

BUG-012 fix: The InsightVM endpoint GET /api/3/vulnerabilities/{id}/solutions returns hypermedia references only (IDs and links) — not full solution objects. This tool performs the required follow-up fetch for each solution ID from GET /api/3/solutions/{id} and merges all fields.

Args:
  - vuln_id (string): The vulnerability ID (e.g. "http-options-method-enabled")
  - include_steps (boolean): Include step-by-step remediation instructions (default: false)

Returns JSON:
  {
    "vuln_id": string,
    "solutions": [
      {
        "id": string,
        "type": string,
        "summary": string,
        "appliesTo": string,
        "estimate": string,
        "additionalInformation": string,
        "steps": string  (only when include_steps is true)
      }
    ]
  }`,
      inputSchema: z.object({
        vuln_id: z.string().min(1).describe("Vulnerability ID string"),
        include_steps: z.boolean().default(false).describe("Include step-by-step remediation instructions"),
      }).strict(),
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    async ({ vuln_id, include_steps }) => {
      // Step 1: fetch the solution references (returns IDs + links only, not full objects)
      const refsResponse = await client.get<{ resources: SolutionReference[] }>(
        `/vulnerabilities/${vuln_id}/solutions`
      );

      const refs = refsResponse.resources ?? [];

      if (refs.length === 0) {
        return {
          content: [{
            type: "text" as const,
            text: JSON.stringify({ vuln_id, solutions: [], message: "No remediation solutions found for this vulnerability." }, null, 2),
          }],
        };
      }

      // Step 2: fetch full solution detail for each ID — 10 concurrent
      const batchSize = 10;
      const solutions: unknown[] = [];

      for (let i = 0; i < refs.length; i += batchSize) {
        const batch = refs.slice(i, i + batchSize);
        const details = await Promise.all(
          batch.map(async (ref) => {
            // Extract solution ID — may be in ref.id or extractable from the href link
            const solutionId = ref.id ?? extractIdFromLinks(ref.links);

            if (!solutionId) {
              return { error: "Could not determine solution ID from reference", ref };
            }

            try {
              const detail = await client.get<Solution>(`/solutions/${solutionId}`);
              return {
                id: detail.id ?? solutionId,
                type: detail.type,
                summary: detail.summary,
                appliesTo: detail.appliesTo,
                estimate: detail.estimate,
                additionalInformation: detail.additionalInformation,
                ...(include_steps && detail.steps?.text ? { steps: detail.steps.text } : {}),
              };
            } catch (err) {
              return {
                id: solutionId,
                fetchError: err instanceof Error ? err.message : String(err),
              };
            }
          })
        );
        solutions.push(...details);
      }

      return {
        content: [{
          type: "text" as const,
          text: JSON.stringify({ vuln_id, solutions }, null, 2),
        }],
      };
    }
  );

  // ── List remediation tickets ──────────────────────────────────────────────

  server.registerTool(
    "insightvm_list_tickets",
    {
      title: "List Remediation Tickets",
      description: `Returns remediation tickets from InsightVM's built-in ticketing system. Only applicable if your organisation uses InsightVM native ticketing. Returns empty list if not in use.

Args:
  - page (number): Zero-based page number (default: 0)
  - size (number): Results per page, max 100 (default: 25)`,
      inputSchema: z.object({
        page: z.number().int().min(0).default(0),
        size: z.number().int().min(1).max(100).default(25),
      }).strict(),
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    async ({ page, size }) => {
      const response = await client.get<{
        resources: Ticket[];
        page: { totalResources: number };
      }>("/tickets", { page, size });

      const output = {
        total: response.page?.totalResources ?? 0,
        tickets: (response.resources ?? []).map((t) => ({
          id: t.id,
          name: t.name,
          state: t.state,
          priority: t.priority,
          assetCount: t.assetCount,
          openedBy: t.openedBy,
          openedTime: t.openedTime,
        })),
      };

      return { content: [{ type: "text" as const, text: JSON.stringify(output, null, 2) }] };
    }
  );
}

// ── Helpers ───────────────────────────────────────────────────────────────────

// Extract solution ID from HATEOAS self link if ref.id is absent
function extractIdFromLinks(links?: Array<{ rel: string; href: string }>): string | undefined {
  const self = links?.find((l) => l.rel === "self");
  if (!self?.href) return undefined;
  // href is typically: .../api/3/solutions/{id}
  const parts = self.href.split("/");
  return parts[parts.length - 1] || undefined;
}
