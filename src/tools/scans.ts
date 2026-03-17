import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { InsightVMClient } from "../services/insightvm-client.js";
import { Scan, ScanStartResult, Site, SiteUpdatePayload } from "../types.js";

export function registerScanTools(server: McpServer, client: InsightVMClient): void {

  const ownedSiteId = client.config.ownedSiteId;

  // ── List scans ────────────────────────────────────────────────────────────

  server.registerTool(
    "insightvm_list_scans",
    {
      title: "List Scans",
      description: `Returns recent scans across all sites, or scoped to a specific site. Includes status, start/end times, and asset and vulnerability counts.

Args:
  - site_id (number, optional): Limit results to a specific site
  - active (boolean, optional): If true, return only currently running scans
  - page (number): Zero-based page number (default: 0)
  - size (number): Results per page, max 100 (default: 25)

Returns JSON list of scan objects with id, siteId, status, timing, and counts.`,
      inputSchema: z.object({
        site_id: z.number().int().positive().optional().describe("Filter scans to a specific site ID"),
        active: z.boolean().optional().describe("Return only active (running) scans"),
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
    async ({ site_id, active, page, size }) => {
      const path = site_id ? `/sites/${site_id}/scans` : "/scans";
      const params: Record<string, unknown> = { page, size };
      if (active !== undefined) params.active = active;

      const response = await client.get<{
        resources: Scan[];
        page: { totalResources: number };
      }>(path, params);

      const output = {
        total: response.page?.totalResources ?? 0,
        scans: (response.resources ?? []).map(formatScan),
      };

      return { content: [{ type: "text" as const, text: JSON.stringify(output, null, 2) }] };
    }
  );

  // ── Get scan status ───────────────────────────────────────────────────────

  server.registerTool(
    "insightvm_get_scan_status",
    {
      title: "Get Scan Status",
      description: `Returns the current status and progress of a specific scan by ID.

Args:
  - scan_id (number): The numeric scan ID

Returns JSON with scan status, timing, asset count, and vulnerability counts.`,
      inputSchema: z.object({
        scan_id: z.number().int().positive().describe("Numeric scan ID"),
      }).strict(),
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    async ({ scan_id }) => {
      const scan = await client.get<Scan>(`/scans/${scan_id}`);
      return { content: [{ type: "text" as const, text: JSON.stringify(formatScan(scan), null, 2) }] };
    }
  );

  // ── Start scan ────────────────────────────────────────────────────────────

  server.registerTool(
    "insightvm_start_scan",
    {
      title: "Start Scan",
      description: `Triggers a new scan on a site. This is a trigger-only operation — it does not modify site configuration, targets, or scan templates on any site other than the owned site.

Args:
  - site_id (number): The site ID to scan
  - scan_name (string, optional): Label for this scan run

Returns JSON with the new scan ID and a link to monitor its status.`,
      inputSchema: z.object({
        site_id: z.number().int().positive().describe("Site ID to scan"),
        scan_name: z.string().optional().describe("Optional label for this scan run"),
      }).strict(),
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: false,
      },
    },
    async ({ site_id, scan_name }) => {
      const body = scan_name ? { name: scan_name } : undefined;
      const result = await client.post<ScanStartResult>(`/sites/${site_id}/scans`, body);

      const output = {
        scan_id: result.id,
        site_id,
        message: `Scan started. Use insightvm_get_scan_status with scan_id ${result.id} to monitor progress.`,
      };

      return { content: [{ type: "text" as const, text: JSON.stringify(output, null, 2) }] };
    }
  );

  // ── Stop scan ─────────────────────────────────────────────────────────────

  server.registerTool(
    "insightvm_stop_scan",
    {
      title: "Stop Scan",
      description: `Stops a currently running scan. Partial results are retained.

Args:
  - scan_id (number): The numeric scan ID to stop

Returns confirmation message.`,
      inputSchema: z.object({
        scan_id: z.number().int().positive().describe("Numeric scan ID to stop"),
      }).strict(),
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: false,
      },
    },
    async ({ scan_id }) => {
      await client.post(`/scans/${scan_id}/stop`);
      return {
        content: [{
          type: "text" as const,
          text: JSON.stringify({ scan_id, message: "Stop request sent. Scan will halt after completing current work." }, null, 2),
        }],
      };
    }
  );

  // ── Get owned site ────────────────────────────────────────────────────────

  server.registerTool(
    "insightvm_get_owned_site",
    {
      title: "Get Owned Site",
      description: `Returns full details for the MCP-owned site. This is the only site the MCP has full management rights over.

Returns JSON with site name, description, risk score, scan template, asset count, and last scan time.`,
      inputSchema: z.object({}).strict(),
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    async () => {
      const site = await client.get<Site>(`/sites/${ownedSiteId}`);
      return { content: [{ type: "text" as const, text: JSON.stringify(site, null, 2) }] };
    }
  );

  // ── Update owned site ─────────────────────────────────────────────────────

  server.registerTool(
    "insightvm_update_owned_site",
    {
      title: "Update Owned Site",
      description: `Updates configuration of the MCP-owned site. This operation is restricted to the owned site only and will refuse any attempt to modify a different site.

Args:
  - name (string, optional): New site name
  - description (string, optional): New site description
  - scan_template_id (string, optional): Scan template ID to apply
  - included_targets (array of strings, optional): IP addresses or ranges to scan
  - excluded_targets (array of strings, optional): IP addresses or ranges to exclude

Returns updated site object.`,
      inputSchema: z.object({
        name: z.string().optional().describe("New site name"),
        description: z.string().optional().describe("New site description"),
        scan_template_id: z.string().optional().describe("Scan template ID"),
        included_targets: z.array(z.string()).optional().describe("IP addresses or CIDR ranges to include"),
        excluded_targets: z.array(z.string()).optional().describe("IP addresses or CIDR ranges to exclude"),
      }).strict(),
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    async ({ name, description, scan_template_id, included_targets, excluded_targets }) => {
      const payload: SiteUpdatePayload = {};
      if (name) payload.name = name;
      if (description) payload.description = description;
      if (scan_template_id) payload.scanTemplateId = scan_template_id;
      if (included_targets || excluded_targets) {
        payload.targets = {};
        if (included_targets) payload.targets.includedTargets = { addresses: included_targets };
        if (excluded_targets) payload.targets.excludedTargets = { addresses: excluded_targets };
      }

      const updated = await client.put<Site>(`/sites/${ownedSiteId}`, payload);
      return { content: [{ type: "text" as const, text: JSON.stringify(updated, null, 2) }] };
    }
  );
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function formatScan(s: Scan) {
  return {
    id: s.id,
    siteId: s.siteId,
    siteName: s.siteName,
    status: s.status,
    scanName: s.scanName,
    startTime: s.startTime,
    endTime: s.endTime,
    assets: s.assets,
    vulnerabilities: s.vulnerabilities,
    engineName: s.engineName,
  };
}
