import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { InsightVMClient } from "../services/insightvm-client.js";
import {
  Asset,
  AssetVulnerability,
  AssetService,
  Vulnerability,
  Solution,
} from "../types.js";
import { CHARACTER_LIMIT } from "../constants.js";

export function registerAssetTools(server: McpServer, client: InsightVMClient): void {

  // ── Search assets ─────────────────────────────────────────────────────────

  server.registerTool(
    "insightvm_search_assets",
    {
      title: "Search Assets",
      description: `Returns a paginated list of assets from InsightVM, with optional filtering by hostname, IP, or risk score threshold.

Args:
  - query (string, optional): Filter by hostname or IP substring
  - min_risk_score (number, optional): Only return assets at or above this risk score
  - site_id (number, optional): Limit results to a specific site
  - page (number): Page number, zero-based (default: 0)
  - size (number): Results per page, max 500 (default: 100)

Returns JSON:
  {
    "total": number,
    "page": number,
    "size": number,
    "assets": [
      {
        "id": number,
        "hostName": string,
        "ip": string,
        "os": { "name": string, "family": string },
        "riskScore": number,
        "vulnerabilities": { "critical": number, "severe": number, "moderate": number, "total": number },
        "lastScanTime": string
      }
    ]
  }`,
      inputSchema: z.object({
        query: z.string().optional().describe("Filter by hostname or IP substring"),
        min_risk_score: z.number().min(0).optional().describe("Minimum risk score threshold"),
        site_id: z.number().int().positive().optional().describe("Limit results to a specific site ID"),
        page: z.number().int().min(0).default(0).describe("Zero-based page number"),
        size: z.number().int().min(1).max(500).default(100).describe("Results per page"),
      }).strict(),
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    async ({ query, min_risk_score, site_id, page, size }) => {
      const params: Record<string, unknown> = { page, size };
      if (site_id) params.siteId = site_id;

      const response = await client.get<{
        resources: Asset[];
        page: { totalResources: number; number: number; size: number };
      }>("/assets", params);

      let assets = response.resources ?? [];

      if (query) {
        const q = query.toLowerCase();
        assets = assets.filter(
          (a) =>
            a.hostName?.toLowerCase().includes(q) ||
            a.ip?.toLowerCase().includes(q)
        );
      }

      if (min_risk_score !== undefined) {
        assets = assets.filter((a) => (a.riskScore ?? 0) >= min_risk_score!);
      }

      const output = {
        total: response.page?.totalResources ?? assets.length,
        page: response.page?.number ?? page,
        size: response.page?.size ?? size,
        assets: assets.map(formatAsset),
      };

      return { content: [{ type: "text" as const, text: truncate(JSON.stringify(output, null, 2)) }] };
    }
  );

  // ── Get asset detail ──────────────────────────────────────────────────────

  server.registerTool(
    "insightvm_get_asset_detail",
    {
      title: "Get Asset Detail",
      description: `Returns full detail for a single asset including OS, risk score, and vulnerability counts.

Args:
  - asset_id (number): The numeric asset ID

Returns JSON with full asset properties including risk score, OS, and vulnerability summary.`,
      inputSchema: z.object({
        asset_id: z.number().int().positive().describe("Numeric asset ID"),
      }).strict(),
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    async ({ asset_id }) => {
      const asset = await client.get<Asset>(`/assets/${asset_id}`);
      return { content: [{ type: "text" as const, text: JSON.stringify(formatAsset(asset), null, 2) }] };
    }
  );

  // ── Get asset vulnerabilities ─────────────────────────────────────────────

  server.registerTool(
    "insightvm_get_asset_vulnerabilities",
    {
      title: "Get Asset Vulnerabilities",
      description: `Lists all vulnerabilities found on a specific asset, including CVSS scores, severity, and detection status.

Args:
  - asset_id (number): The numeric asset ID
  - page (number): Zero-based page number (default: 0)
  - size (number): Results per page, max 500 (default: 100)

Returns JSON:
  {
    "asset_id": number,
    "total": number,
    "vulnerabilities": [
      {
        "id": string,
        "title": string,
        "severity": string,
        "cvssV3Score": number,
        "cvssV2Score": number,
        "since": string,
        "status": string
      }
    ]
  }`,
      inputSchema: z.object({
        asset_id: z.number().int().positive().describe("Numeric asset ID"),
        page: z.number().int().min(0).default(0).describe("Zero-based page number"),
        size: z.number().int().min(1).max(500).default(100).describe("Results per page"),
      }).strict(),
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    async ({ asset_id, page, size }) => {
      const response = await client.get<{
        resources: AssetVulnerability[];
        page: { totalResources: number };
      }>(`/assets/${asset_id}/vulnerabilities`, { page, size });

      const output = {
        asset_id,
        total: response.page?.totalResources ?? 0,
        vulnerabilities: (response.resources ?? []).map((v) => ({
          id: v.id,
          title: v.title,
          severity: v.severity,
          cvssV3Score: v.cvssV3Score,
          cvssV2Score: v.cvssV2Score,
          since: v.since,
          status: v.status,
        })),
      };

      return { content: [{ type: "text" as const, text: truncate(JSON.stringify(output, null, 2)) }] };
    }
  );

  // ── Get asset services (open ports) ──────────────────────────────────────

  server.registerTool(
    "insightvm_get_asset_services",
    {
      title: "Get Asset Services",
      description: `Returns all open ports and service fingerprints detected on an asset. Used for port drift detection and network exposure analysis.

Args:
  - asset_id (number): The numeric asset ID

Returns JSON:
  {
    "asset_id": number,
    "services": [
      {
        "port": number,
        "protocol": string,
        "name": string,
        "product": string,
        "version": string
      }
    ]
  }`,
      inputSchema: z.object({
        asset_id: z.number().int().positive().describe("Numeric asset ID"),
      }).strict(),
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    async ({ asset_id }) => {
      const response = await client.get<{
        resources: AssetService[];
      }>(`/assets/${asset_id}/services`);

      const output = {
        asset_id,
        services: (response.resources ?? []).map((s) => ({
          port: s.port,
          protocol: s.protocol,
          name: s.name,
          product: s.product,
          version: s.version,
        })),
      };

      return { content: [{ type: "text" as const, text: JSON.stringify(output, null, 2) }] };
    }
  );

  // ── Search assets by criteria ─────────────────────────────────────────────

  server.registerTool(
    "insightvm_search_assets_by_criteria",
    {
      title: "Search Assets by Criteria",
      description: `Advanced asset search using InsightVM's filter criteria. Supports filtering by OS, vulnerability severity, site, tag, and more. Used for targeted queries such as port drift detection scoped to a specific site.

Args:
  - filters (array): List of filter objects, each with:
      - field (string): e.g. "site-id", "operating-system", "vulnerability-title"
      - operator (string): e.g. "is", "contains", "is-greater-than"
      - value (string): The value to match against
  - match (string): "all" (AND) or "any" (OR) — default: "all"
  - page (number): Zero-based page number (default: 0)
  - size (number): Results per page, max 500 (default: 100)

Returns same structure as insightvm_search_assets.`,
      inputSchema: z.object({
        filters: z.array(
          z.object({
            field: z.string().describe("Filter field name"),
            operator: z.string().describe("Filter operator"),
            value: z.string().describe("Filter value"),
          })
        ).min(1).describe("At least one filter is required"),
        match: z.enum(["all", "any"]).default("all").describe("Match all filters (AND) or any filter (OR)"),
        page: z.number().int().min(0).default(0),
        size: z.number().int().min(1).max(500).default(100),
      }).strict(),
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: false,
      },
    },
    async ({ filters, match, page, size }) => {
      const body = { filters, match };
      const response = await client.post<{
        resources: Asset[];
        page: { totalResources: number; number: number; size: number };
      }>(`/assets/search?page=${page}&size=${size}`, body);

      const output = {
        total: response.page?.totalResources ?? 0,
        page: response.page?.number ?? page,
        size: response.page?.size ?? size,
        assets: (response.resources ?? []).map(formatAsset),
      };

      return { content: [{ type: "text" as const, text: truncate(JSON.stringify(output, null, 2)) }] };
    }
  );

  // ── Get vulnerability detail ──────────────────────────────────────────────

  server.registerTool(
    "insightvm_get_vulnerability_detail",
    {
      title: "Get Vulnerability Detail",
      description: `Returns full detail for a specific vulnerability including description, CVSS scores, affected categories, and publish dates.

Args:
  - vuln_id (string): The vulnerability ID (e.g. "apache-httpd-cve-2021-41773")

Returns JSON with full vulnerability properties.`,
      inputSchema: z.object({
        vuln_id: z.string().min(1).describe("Vulnerability ID string"),
      }).strict(),
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    async ({ vuln_id }) => {
      const vuln = await client.get<Vulnerability>(`/vulnerabilities/${vuln_id}`);
      return { content: [{ type: "text" as const, text: JSON.stringify(vuln, null, 2) }] };
    }
  );

  // ── Get remediation solutions ─────────────────────────────────────────────

  server.registerTool(
    "insightvm_get_remediation",
    {
      title: "Get Remediation Solutions",
      description: `Returns available remediation options for a specific vulnerability, including solution type, summary, affected platforms, and step-by-step instructions.

Args:
  - vuln_id (string): The vulnerability ID
  - include_steps (boolean): Include detailed remediation steps (default: false)

Returns JSON:
  {
    "vuln_id": string,
    "solutions": [
      {
        "id": string,
        "summary": string,
        "type": string,
        "appliesTo": string,
        "estimate": string,
        "steps": string  (only if include_steps is true)
      }
    ]
  }`,
      inputSchema: z.object({
        vuln_id: z.string().min(1).describe("Vulnerability ID string"),
        include_steps: z.boolean().default(false).describe("Include detailed remediation step text"),
      }).strict(),
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    async ({ vuln_id, include_steps }) => {
      const response = await client.get<{ resources: Solution[] }>(
        `/vulnerabilities/${vuln_id}/solutions`
      );

      const solutions = (response.resources ?? []).map((s) => ({
        id: s.id,
        summary: s.summary,
        type: s.type,
        appliesTo: s.appliesTo,
        estimate: s.estimate,
        ...(include_steps && s.steps?.text ? { steps: s.steps.text } : {}),
      }));

      const output = { vuln_id, solutions };
      return { content: [{ type: "text" as const, text: JSON.stringify(output, null, 2) }] };
    }
  );
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function formatAsset(a: Asset) {
  return {
    id: a.id,
    hostName: a.hostName,
    ip: a.ip,
    os: a.os ? { name: a.os.name, family: a.os.family } : undefined,
    riskScore: a.riskScore,
    vulnerabilities: a.vulnerabilities,
    lastScanTime: a.lastScanTime,
  };
}

function truncate(text: string): string {
  if (text.length <= CHARACTER_LIMIT) return text;
  return text.slice(0, CHARACTER_LIMIT) + `\n\n[Response truncated at ${CHARACTER_LIMIT} characters. Use pagination to retrieve remaining results.]`;
}
