import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { InsightVMClient } from "../services/insightvm-client.js";
import {
  Scan,
  ScanStartResult,
  Site,
  SiteConfig,
  SiteUpdatePayload,
  ScanSchedule,
  ScanTemplate,
  ScanEngine,
} from "../types.js";

export function registerScanTools(server: McpServer, client: InsightVMClient): void {

  const ownedSiteId = client.config.ownedSiteId;

  // ── List sites ────────────────────────────────────────────────────────────

  server.registerTool(
    "insightvm_list_sites",
    {
      title: "List Sites",
      description: `Returns all sites the service account has access to, with asset count, risk score, last scan time, and scan template.

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
        resources: Site[];
        page: { totalResources: number };
      }>("/sites", { page, size });

      const output = {
        total: response.page?.totalResources ?? 0,
        sites: (response.resources ?? []).map((s) => ({
          id: s.id,
          name: s.name,
          description: s.description,
          assets: s.assets,
          riskScore: s.riskScore,
          lastScanTime: s.lastScanTime,
          scanTemplate: s.scanTemplate,
        })),
      };
      return { content: [{ type: "text" as const, text: JSON.stringify(output, null, 2) }] };
    }
  );

  // ── Get site config ───────────────────────────────────────────────────────

  server.registerTool(
    "insightvm_get_site_config",
    {
      title: "Get Site Config",
      description: `Returns full configuration for a site by ID, including default scan template, scan engine, and targets. Useful for diagnosing template drift between the site default and scheduled overrides.

Args:
  - site_id (number): The site ID`,
      inputSchema: z.object({
        site_id: z.number().int().positive().describe("Site ID"),
      }).strict(),
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    async ({ site_id }) => {
      const site = await client.get<SiteConfig>(`/sites/${site_id}`);

      let targets: unknown = undefined;
      try {
        targets = await client.get(`/sites/${site_id}/included_targets`);
      } catch {
        // Non-fatal
      }

      const output = {
        id: site.id,
        name: site.name,
        description: site.description,
        riskScore: site.riskScore,
        assets: site.assets,
        lastScanTime: site.lastScanTime,
        defaultScanTemplate: site.scanTemplate,
        scanTemplateId: site.scanTemplateId,
        engineId: site.engineId,
        engineName: site.engineName,
        targets: targets ?? site.targets,
      };
      return { content: [{ type: "text" as const, text: JSON.stringify(output, null, 2) }] };
    }
  );

  // ── List site schedules ───────────────────────────────────────────────────

  server.registerTool(
    "insightvm_list_site_schedules",
    {
      title: "List Site Schedules",
      description: `Returns all scan schedules configured for a site, including the scan template override per schedule. Essential for diagnosing template drift between the site default and scheduled overrides.

Args:
  - site_id (number): The site ID`,
      inputSchema: z.object({
        site_id: z.number().int().positive().describe("Site ID"),
      }).strict(),
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    async ({ site_id }) => {
      const response = await client.get<{ resources: ScanSchedule[] }>(`/sites/${site_id}/scan_schedules`);
      const output = {
        site_id,
        schedules: (response.resources ?? []).map((s) => ({
          id: s.id,
          enabled: s.enabled,
          scanName: s.scanName,
          scanTemplateId: s.scanTemplateId,
          frequency: s.frequency,
          nextRuntimeScheduled: s.nextRuntimeScheduled,
          start: s.start,
          scanEngineId: s.scanEngineId,
        })),
      };
      return { content: [{ type: "text" as const, text: JSON.stringify(output, null, 2) }] };
    }
  );

  // ── List scan templates ───────────────────────────────────────────────────

  server.registerTool(
    "insightvm_list_scan_templates",
    {
      title: "List Scan Templates",
      description: `Lists all scan templates available in the InsightVM instance, including built-in and custom templates.

Args:
  - page (number): Zero-based page number (default: 0)
  - size (number): Results per page, max 100 (default: 50)`,
      inputSchema: z.object({
        page: z.number().int().min(0).default(0),
        size: z.number().int().min(1).max(100).default(50),
      }).strict(),
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    async ({ page, size }) => {
      const response = await client.get<{
        resources: ScanTemplate[];
        page?: { totalResources: number };
      }>("/scan_templates", { page, size });

      const resources = response.resources ?? [];
      const output = {
        // BUG-009 fix: fall back to resources.length when page.totalResources is 0 or absent
        total: response.page?.totalResources || resources.length,
        templates: resources.map((t) => ({
          id: t.id,
          name: t.name,
          description: t.description,
          builtIn: t.builtIn,
        })),
      };
      return { content: [{ type: "text" as const, text: JSON.stringify(output, null, 2) }] };
    }
  );

  // ── Get scan engine status ────────────────────────────────────────────────

  server.registerTool(
    "insightvm_get_scan_engine_status",
    {
      title: "Get Scan Engine Status",
      description: `Returns the status, version, and connectivity of all registered scan engines. Use this to diagnose engines showing as N/A on scan results.`,
      inputSchema: z.object({}).strict(),
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    async () => {
      const response = await client.get<{
        resources: ScanEngine[];
        page: { totalResources: number };
      }>("/scan_engines");

      const output = {
        total: response.page?.totalResources ?? 0,
        engines: (response.resources ?? []).map((e) => ({
          id: e.id,
          name: e.name,
          address: e.address,
          port: e.port,
          status: e.status,
          version: e.version,
          lastRefreshedDate: e.lastRefreshedDate,
          siteCount: e.sites?.length ?? 0,
        })),
      };
      return { content: [{ type: "text" as const, text: JSON.stringify(output, null, 2) }] };
    }
  );

  // ── List scans ────────────────────────────────────────────────────────────

  server.registerTool(
    "insightvm_list_scans",
    {
      title: "List Scans",
      description: `Returns scans across all sites or scoped to a specific site. Defaults to newest-first. Supports filtering by status.

Args:
  - site_id (number, optional): Limit results to a specific site
  - status (string, optional): Filter by scan status — "finished", "running", "error", "paused", "stopped"
  - sort_order (string): "desc" for newest-first (default), "asc" for oldest-first
  - page (number): Zero-based page number (default: 0)
  - size (number): Results per page, max 100 (default: 25)`,
      inputSchema: z.object({
        site_id: z.number().int().positive().optional(),
        status: z.enum(["finished", "running", "error", "paused", "stopped"]).optional(),
        sort_order: z.enum(["asc", "desc"]).default("desc"),
        page: z.number().int().min(0).default(0),
        size: z.number().int().min(1).max(100).default(25),
      }).strict(),
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    async ({ site_id, status, sort_order, page, size }) => {
      const path = site_id ? `/sites/${site_id}/scans` : "/scans";

      // FEAT-005 fix: API supports sort via sort=startTime,ASC|DESC
      // Status filter: API only supports active (boolean), not specific statuses.
      // For specific statuses (error, finished, paused, stopped), fetch and filter client-side.
      const needsStatusFilter = status && status !== "running";
      const fetchSize = needsStatusFilter ? 500 : size; // Fetch more when filtering client-side

      const params: Record<string, unknown> = {
        page,
        size: fetchSize,
        sort: `startTime,${sort_order.toUpperCase()}`,
      };

      // API active param: true = only running scans, false = only completed scans
      if (status === "running") {
        params.active = true;
      } else if (status) {
        params.active = false; // Fetch completed, then filter by specific status below
      }

      const response = await client.get<{
        resources: Scan[];
        page: { totalResources: number };
      }>(path, params);

      let scans = response.resources ?? [];

      // Client-side status filter for specific statuses the API does not natively support
      if (needsStatusFilter && status) {
        scans = scans.filter((s) => s.status?.toLowerCase() === status.toLowerCase());
      }

      // Limit to requested page size after client-side filter
      const paginated = needsStatusFilter ? scans.slice(0, size) : scans;

      const output = {
        total: needsStatusFilter ? scans.length : (response.page?.totalResources ?? 0),
        clientSideFiltered: needsStatusFilter,
        scans: paginated.map(formatScan),
      };
      return { content: [{ type: "text" as const, text: JSON.stringify(output, null, 2) }] };
    }
  );

  // ── Get scan status ───────────────────────────────────────────────────────

  server.registerTool(
    "insightvm_get_scan_status",
    {
      title: "Get Scan Status",
      description: `Returns the status and progress of a specific scan. Note: the InsightVM API does not include scanTemplate in the scan response. To determine the template used, cross-reference insightvm_list_site_schedules for the site.

Args:
  - scan_id (number): The numeric scan ID`,
      inputSchema: z.object({
        scan_id: z.number().int().positive().describe("Numeric scan ID"),
      }).strict(),
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
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
      description: `Triggers a new scan on a site. Trigger-only on all sites other than the owned site.

Args:
  - site_id (number): The site ID to scan
  - scan_name (string, optional): Label for this scan run`,
      inputSchema: z.object({
        site_id: z.number().int().positive(),
        scan_name: z.string().optional(),
      }).strict(),
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
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
  - scan_id (number): The numeric scan ID to stop`,
      inputSchema: z.object({
        scan_id: z.number().int().positive(),
      }).strict(),
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
    },
    async ({ scan_id }) => {
      await client.post(`/scans/${scan_id}/stop`);
      return {
        content: [{
          type: "text" as const,
          text: JSON.stringify({ scan_id, message: "Stop request sent." }, null, 2),
        }],
      };
    }
  );

  // ── Get owned site ────────────────────────────────────────────────────────

  server.registerTool(
    "insightvm_get_owned_site",
    {
      title: "Get Owned Site",
      description: `Returns full details for the MCP-owned site (the site this MCP has full management rights over, set via INSIGHTVM_OWNED_SITE_ID).

Returns a clear configuration error if the env var is not set or the site ID is not accessible.`,
      inputSchema: z.object({}).strict(),
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    async () => {
      if (!ownedSiteId) {
        // Fetch available sites to help the user identify the correct ID
        let availableSites: unknown[] = [];
        try {
          const sitesResp = await client.get<{ resources: Site[] }>("/sites", { page: 0, size: 50 });
          availableSites = (sitesResp.resources ?? []).map((s) => ({ id: s.id, name: s.name }));
        } catch {
          // Non-fatal — best effort
        }
        return {
          content: [{
            type: "text" as const,
            text: JSON.stringify({
              error: "INSIGHTVM_OWNED_SITE_ID is not set in the MCP environment configuration.",
              instructions: "Add INSIGHTVM_OWNED_SITE_ID to the env section of your claude_desktop_config.json (or equivalent MCP client config) with the numeric ID of the site this MCP should own.",
              availableSites,
            }, null, 2),
          }],
        };
      }

      try {
        const site = await client.get<Site>(`/sites/${ownedSiteId}`);
        return { content: [{ type: "text" as const, text: JSON.stringify(site, null, 2) }] };
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        // Fetch available sites to help diagnose wrong ID
        let availableSites: unknown[] = [];
        try {
          const sitesResp = await client.get<{ resources: Site[] }>("/sites", { page: 0, size: 50 });
          availableSites = (sitesResp.resources ?? []).map((s) => ({ id: s.id, name: s.name }));
        } catch {
          // Non-fatal
        }
        return {
          content: [{
            type: "text" as const,
            text: JSON.stringify({
              error: `Site ID "${ownedSiteId}" (INSIGHTVM_OWNED_SITE_ID) could not be retrieved: ${message}`,
              instructions: "Verify the site ID matches one of the available sites listed below and update INSIGHTVM_OWNED_SITE_ID in your MCP client config.",
              availableSites,
            }, null, 2),
          }],
        };
      }
    }
  );

  // ── Update owned site ─────────────────────────────────────────────────────

  server.registerTool(
    "insightvm_update_owned_site",
    {
      title: "Update Owned Site",
      description: `Updates configuration of the MCP-owned site only. Refuses to modify any other site.

Args:
  - name (string, optional): New site name
  - description (string, optional): New site description
  - scan_template_id (string, optional): Scan template ID to apply
  - included_targets (array of strings, optional): IP addresses or CIDR ranges to scan
  - excluded_targets (array of strings, optional): IP addresses or CIDR ranges to exclude`,
      inputSchema: z.object({
        name: z.string().optional(),
        description: z.string().optional(),
        scan_template_id: z.string().optional(),
        included_targets: z.array(z.string()).optional(),
        excluded_targets: z.array(z.string()).optional(),
      }).strict(),
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    async ({ name, description, scan_template_id, included_targets, excluded_targets }) => {
      if (!ownedSiteId) {
        return {
          content: [{
            type: "text" as const,
            text: JSON.stringify({ error: "INSIGHTVM_OWNED_SITE_ID is not configured." }, null, 2),
          }],
        };
      }

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
    scanType: s.scanType,
    engineName: s.engineName,
    engineId: s.engineId,
    engineIds: s.engineIds,
    startedByUsername: s.startedByUsername,
    message: s.message,
    duration: s.duration,
    startTime: s.startTime,
    endTime: s.endTime,
    assets: s.assets,
    vulnerabilities: s.vulnerabilities,
  };
}
