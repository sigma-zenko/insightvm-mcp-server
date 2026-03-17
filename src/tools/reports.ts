import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { InsightVMClient } from "../services/insightvm-client.js";
import { Report, ReportCreatePayload, ReportHistory } from "../types.js";

export function registerReportTools(server: McpServer, client: InsightVMClient): void {

  // ── List reports ──────────────────────────────────────────────────────────

  server.registerTool(
    "insightvm_list_reports",
    {
      title: "List Reports",
      description: `Returns all report definitions available to the service account, including report name, format, template, and last updated time.

Args:
  - page (number): Zero-based page number (default: 0)
  - size (number): Results per page, max 100 (default: 25)

Returns JSON list of report objects.`,
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
        resources: Report[];
        page: { totalResources: number };
      }>("/reports", { page, size });

      const output = {
        total: response.page?.totalResources ?? 0,
        reports: (response.resources ?? []).map((r) => ({
          id: r.id,
          name: r.name,
          format: r.format,
          template: r.template,
          status: r.status,
          lastUpdated: r.lastUpdated,
        })),
      };

      return { content: [{ type: "text" as const, text: JSON.stringify(output, null, 2) }] };
    }
  );

  // ── Create report ─────────────────────────────────────────────────────────

  server.registerTool(
    "insightvm_create_report",
    {
      title: "Create Report",
      description: `Creates a new report definition. Does not generate the report immediately — use insightvm_generate_report after creation.

Args:
  - name (string): Report name
  - format (string): Output format — "pdf", "csv", "xml", "html", "rtf", "text"
  - template_id (string): ID of the report template to use
  - site_ids (array of numbers, optional): Scope report to specific sites
  - asset_group_ids (array of numbers, optional): Scope report to asset groups
  - asset_ids (array of numbers, optional): Scope report to specific assets

Returns JSON with the new report ID.`,
      inputSchema: z.object({
        name: z.string().min(1).describe("Report name"),
        format: z.enum(["pdf", "csv", "xml", "html", "rtf", "text"]).describe("Output format"),
        template_id: z.string().min(1).describe("Report template ID"),
        site_ids: z.array(z.number().int().positive()).optional().describe("Scope to specific site IDs"),
        asset_group_ids: z.array(z.number().int().positive()).optional().describe("Scope to asset group IDs"),
        asset_ids: z.array(z.number().int().positive()).optional().describe("Scope to specific asset IDs"),
      }).strict(),
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: false,
      },
    },
    async ({ name, format, template_id, site_ids, asset_group_ids, asset_ids }) => {
      const payload: ReportCreatePayload = {
        name,
        format,
        template: { id: template_id },
      };

      if (site_ids || asset_group_ids || asset_ids) {
        payload.scope = {};
        if (site_ids) payload.scope.sites = site_ids;
        if (asset_group_ids) payload.scope.assetGroups = asset_group_ids;
        if (asset_ids) payload.scope.assets = asset_ids;
      }

      const result = await client.post<{ id: number }>("/reports", payload);
      const output = {
        report_id: result.id,
        message: `Report definition created. Use insightvm_generate_report with report_id ${result.id} to generate it.`,
      };

      return { content: [{ type: "text" as const, text: JSON.stringify(output, null, 2) }] };
    }
  );

  // ── Generate report ───────────────────────────────────────────────────────

  server.registerTool(
    "insightvm_generate_report",
    {
      title: "Generate Report",
      description: `Triggers generation of a previously created report definition. Generation runs asynchronously — use insightvm_get_report_history to check when it is complete.

Args:
  - report_id (number): The numeric report ID to generate

Returns JSON confirming the generation request was accepted.`,
      inputSchema: z.object({
        report_id: z.number().int().positive().describe("Numeric report ID"),
      }).strict(),
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: false,
      },
    },
    async ({ report_id }) => {
      await client.post(`/reports/${report_id}/generate`);
      return {
        content: [{
          type: "text" as const,
          text: JSON.stringify({
            report_id,
            message: "Report generation started. Use insightvm_get_report_history to check status.",
          }, null, 2),
        }],
      };
    }
  );

  // ── Get report history ────────────────────────────────────────────────────

  server.registerTool(
    "insightvm_get_report_history",
    {
      title: "Get Report History",
      description: `Returns the generation history for a report, including status and completion time of each run. Use this to confirm a report is ready before retrieving its output.

Args:
  - report_id (number): The numeric report ID

Returns JSON list of report runs with instance ID, status, and generated timestamp.`,
      inputSchema: z.object({
        report_id: z.number().int().positive().describe("Numeric report ID"),
      }).strict(),
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    async ({ report_id }) => {
      const response = await client.get<{
        resources: ReportHistory[];
      }>(`/reports/${report_id}/history`);

      return {
        content: [{
          type: "text" as const,
          text: JSON.stringify({ report_id, history: response.resources ?? [] }, null, 2),
        }],
      };
    }
  );

  // ── Get report output ─────────────────────────────────────────────────────

  server.registerTool(
    "insightvm_get_report_output",
    {
      title: "Get Report Output",
      description: `Retrieves the output of a completed report run. Confirm the report status is "complete" using insightvm_get_report_history before calling this.

Args:
  - report_id (number): The numeric report ID
  - instance_id (number): The specific run instance ID from report history

Returns the report content as text. Large reports will be truncated — download directly from the console for full output.`,
      inputSchema: z.object({
        report_id: z.number().int().positive().describe("Numeric report ID"),
        instance_id: z.number().int().positive().describe("Report run instance ID from history"),
      }).strict(),
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    async ({ report_id, instance_id }) => {
      const output = await client.get<string>(
        `/reports/${report_id}/history/${instance_id}/output`
      );

      const text = typeof output === "string" ? output : JSON.stringify(output, null, 2);
      const truncated = text.length > 50_000
        ? text.slice(0, 50_000) + "\n\n[Output truncated. Download the full report from the InsightVM console.]"
        : text;

      return { content: [{ type: "text" as const, text: truncated }] };
    }
  );
}
