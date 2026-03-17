import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { InsightVMClient } from "../services/insightvm-client.js";
import { Solution, Ticket } from "../types.js";

export function registerRemediationTools(server: McpServer, client: InsightVMClient): void {

  // ── Get solution detail ───────────────────────────────────────────────────

  server.registerTool(
    "insightvm_get_solution_detail",
    {
      title: "Get Solution Detail",
      description: `Returns full detail for a specific remediation solution including type, affected platforms, time estimate, and step-by-step instructions.

Args:
  - solution_id (string): The solution ID (obtained from insightvm_get_remediation)
  - include_steps (boolean): Include detailed step text (default: true)

Returns JSON with complete solution properties.`,
      inputSchema: z.object({
        solution_id: z.string().min(1).describe("Solution ID string"),
        include_steps: z.boolean().default(true).describe("Include step-by-step instructions"),
      }).strict(),
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
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

  // ── List remediation tickets ──────────────────────────────────────────────

  server.registerTool(
    "insightvm_list_tickets",
    {
      title: "List Remediation Tickets",
      description: `Returns remediation tickets from InsightVM's built-in ticketing system. Only applicable if your organisation uses InsightVM native ticketing. Returns empty list if not in use.

Args:
  - page (number): Zero-based page number (default: 0)
  - size (number): Results per page, max 100 (default: 25)

Returns JSON list of tickets with id, name, state, priority, and asset count.`,
      inputSchema: z.object({
        page: z.number().int().min(0).default(0),
        size: z.number().int().min(1).max(100).default(25),
      }).strict(),
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
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
