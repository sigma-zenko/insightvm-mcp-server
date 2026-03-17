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
      description: `Returns all report definitions available to the service account. Use the returned report IDs with insightvm_generate_report and insightvm_get_report_history.

Note: InsightVM returns 401 (not 404) when calling history or output endpoints for a report ID that does not exist. Always use insightvm_list_reports first to confirm the report ID is valid.

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
        name: z.string().min(1),
        format: z.enum(["pdf", "csv", "xml", "html", "rtf", "text"]),
        template_id: z.string().min(1),
        site_ids: z.array(z.number().int().positive()).optional(),
        asset_group_ids: z.array(z.number().int().positive()).optional(),
        asset_ids: z.array(z.number().int().positive()).optional(),
      }).strict(),
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
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
      return {
        content: [{
          type: "text" as const,
          text: JSON.stringify({
            report_id: result.id,
            message: `Report definition created. Use insightvm_generate_report with report_id ${result.id} to generate it.`,
          }, null, 2),
        }],
      };
    }
  );

  // ── Generate report ───────────────────────────────────────────────────────

  server.registerTool(
    "insightvm_generate_report",
    {
      title: "Generate Report",
      description: `Triggers generation of a previously created report definition. Generation runs asynchronously — use insightvm_get_report_history to check when it is complete.

Args:
  - report_id (number): The numeric report ID to generate`,
      inputSchema: z.object({
        report_id: z.number().int().positive(),
      }).strict(),
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
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
      description: `Returns the generation history for a report, including status and completion time of each run.

IMPORTANT: InsightVM returns a 401 error (not 404) when requesting history for a report ID that does not exist. Always confirm the report ID is valid using insightvm_list_reports before calling this tool.

Args:
  - report_id (number): The numeric report ID — must be a valid ID from insightvm_list_reports`,
      inputSchema: z.object({
        report_id: z.number().int().positive(),
      }).strict(),
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    async ({ report_id }) => {
      // BUG-013 fix: pre-validate the report exists before fetching history.
      // InsightVM returns 401 (not 404) for non-existent report IDs on this endpoint.
      try {
        await client.get<Report>(`/reports/${report_id}`);
      } catch {
        return {
          content: [{
            type: "text" as const,
            text: JSON.stringify({
              error: `Report ID ${report_id} does not exist or is not accessible to the service account.`,
              suggestion: "Use insightvm_list_reports to get a list of valid report IDs.",
            }, null, 2),
          }],
        };
      }

      const response = await client.get<{
        resources: ReportHistory[];
      }>(`/reports/${report_id}/history`);

      const history = (response.resources ?? []).map((h) => ({
        id: h.id,
        instanceId: h.instanceId,
        status: h.status,
        generated: h.generated,
        uri: h.uri,
      }));

      return {
        content: [{
          type: "text" as const,
          text: JSON.stringify({ report_id, history }, null, 2),
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

Returns the report content as text. Large reports are truncated — download from the console for full output.`,
      inputSchema: z.object({
        report_id: z.number().int().positive(),
        instance_id: z.number().int().positive(),
      }).strict(),
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
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
