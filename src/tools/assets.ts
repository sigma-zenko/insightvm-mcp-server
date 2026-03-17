import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { InsightVMClient } from "../services/insightvm-client.js";
import {
  Asset,
  AssetVulnerability,
  AssetService,
  Vulnerability,
} from "../types.js";
import { CHARACTER_LIMIT, MAX_PAGES, DEFAULT_PAGE_SIZE } from "../constants.js";

export function registerAssetTools(server: McpServer, client: InsightVMClient): void {

  // ── Search assets ─────────────────────────────────────────────────────────

  server.registerTool(
    "insightvm_search_assets",
    {
      title: "Search Assets",
      description: `Returns a paginated list of assets. When site_id is provided, results are scoped to that site.

BUG-010 fix: When min_risk_score is combined with site_id, the site-scoped API endpoint does not support server-side risk filtering. The MCP automatically fetches all pages (up to ${MAX_PAGES} pages of ${DEFAULT_PAGE_SIZE}) and applies the filter client-side. The returned total reflects the filtered count.

Args:
  - query (string, optional): Filter by hostname or IP substring
  - min_risk_score (number, optional): Only return assets at or above this risk score. When combined with site_id, triggers full fetch + client-side filter.
  - site_id (number, optional): Scope results to a specific site
  - page (number): Zero-based page number — ignored when min_risk_score + site_id are both set (full fetch mode)
  - size (number): Results per page, max 500 (default: 100)`,
      inputSchema: z.object({
        query: z.string().optional(),
        min_risk_score: z.number().min(0).optional(),
        site_id: z.number().int().positive().optional(),
        page: z.number().int().min(0).default(0),
        size: z.number().int().min(1).max(500).default(100),
      }).strict(),
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    async ({ query, min_risk_score, site_id, page, size }) => {
      const path = site_id ? `/sites/${site_id}/assets` : "/assets";

      // BUG-010 fix: when min_risk_score + site_id are both set, the site-scoped
      // endpoint does not support server-side risk filtering. Fetch all pages and filter.
      const needsFullFetch = min_risk_score !== undefined && site_id !== undefined;

      let assets: Asset[] = [];
      let total: number;

      if (needsFullFetch) {
        assets = await client.getAllPages<Asset>(path, {}, MAX_PAGES);
        total = assets.length; // Pre-filter total
        if (min_risk_score !== undefined) {
          assets = assets.filter((a) => (a.riskScore ?? 0) >= min_risk_score!);
        }
        if (query) {
          const q = query.toLowerCase();
          assets = assets.filter((a) =>
            a.hostName?.toLowerCase().includes(q) || a.ip?.toLowerCase().includes(q)
          );
        }
        total = assets.length; // Post-filter total
      } else {
        const response = await client.get<{
          resources: Asset[];
          page: { totalResources: number; number: number; size: number };
        }>(path, { page, size });

        assets = response.resources ?? [];

        if (query) {
          const q = query.toLowerCase();
          assets = assets.filter((a) =>
            a.hostName?.toLowerCase().includes(q) || a.ip?.toLowerCase().includes(q)
          );
        }
        if (min_risk_score !== undefined) {
          assets = assets.filter((a) => (a.riskScore ?? 0) >= min_risk_score!);
        }

        total = response.page?.totalResources ?? assets.length;
      }

      const output = {
        total,
        fullFetchMode: needsFullFetch,
        assets: assets.map(formatAssetSummary),
      };
      return { content: [{ type: "text" as const, text: truncate(JSON.stringify(output, null, 2)) }] };
    }
  );

  // ── Get asset detail ──────────────────────────────────────────────────────

  server.registerTool(
    "insightvm_get_asset_detail",
    {
      title: "Get Asset Detail",
      description: `Returns full detail for a single asset including hostname, OS fingerprint, MAC address, last scan time, scan history, site memberships, risk scores, and assessment status.

Note: hostName, os, osFingerprint, and service fingerprint fields are only populated when the asset has been scanned by a credentialed internal scanner. Assets scanned exclusively by an external unauthenticated scanner (e.g. AWS External Scanner) will have these fields absent — this is expected behaviour, not an MCP bug.

Args:
  - asset_id (number): The numeric asset ID`,
      inputSchema: z.object({
        asset_id: z.number().int().positive().describe("Numeric asset ID"),
      }).strict(),
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    async ({ asset_id }) => {
      const raw = await client.get<Record<string, unknown>>(`/assets/${asset_id}`);
      const asset = raw as unknown as Asset;

      // Resolve field name variants across InsightVM versions
      const hostName =
        asset.hostName ??
        (raw["hostname"] as string | undefined) ??
        (raw["host_name"] as string | undefined) ??
        (asset.hostNames?.[0]?.name);

      const osDescription =
        asset.os ??
        (raw["operatingSystem"] as string | undefined) ??
        (raw["operating_system"] as string | undefined) ??
        ((raw["os"] as Record<string, unknown> | undefined)?.["description"] as string | undefined);

      const mac =
        asset.mac ??
        (raw["macAddress"] as string | undefined) ??
        (asset.addresses?.[0]?.mac);

      const assetType =
        asset.type ??
        (raw["assetType"] as string | undefined);

      const osFingerprint =
        asset.osFingerprint ??
        (raw["operatingSystemFingerprint"] as Record<string, unknown> | undefined) ??
        (raw["os_fingerprint"] as Record<string, unknown> | undefined);

      const output = {
        id: asset.id,
        hostName,
        ip: asset.ip,
        mac,
        os: osDescription,
        osFingerprint,
        osCertainty: asset.osCertainty,
        type: assetType,
        addresses: asset.addresses,
        hostNames: asset.hostNames,
        ids: asset.ids,
        riskScore: asset.riskScore,
        rawRiskScore: asset.rawRiskScore,
        vulnerabilities: asset.vulnerabilities,
        lastScanTime: asset.history?.[0]?.date ?? asset.lastScanTime,
        scanHistory: asset.history?.slice(0, 5),
        assessedForVulnerabilities: asset.assessedForVulnerabilities,
        assessedForPolicies: asset.assessedForPolicies,
        sites: asset.sites?.map((s) => ({ id: s.id, name: s.name })),
      };
      return { content: [{ type: "text" as const, text: truncate(JSON.stringify(output, null, 2)) }] };
    }
  );

  // ── Get asset vulnerabilities ─────────────────────────────────────────────

  server.registerTool(
    "insightvm_get_asset_vulnerabilities",
    {
      title: "Get Asset Vulnerabilities",
      description: `Lists vulnerabilities found on a specific asset. When enrich is true (default), performs a batch join to /vulnerabilities/{id} to add title, severity, CVSS scores, CVEs, and exploit count.

Args:
  - asset_id (number): The numeric asset ID
  - enrich (boolean): Join each vuln ID for full detail (default: true). Set false for large assets to get raw ids only.
  - page (number): Zero-based page number (default: 0)
  - size (number): Results per page, max 100 (default: 25 — keep low when enrich is true)`,
      inputSchema: z.object({
        asset_id: z.number().int().positive(),
        enrich: z.boolean().default(true),
        page: z.number().int().min(0).default(0),
        size: z.number().int().min(1).max(100).default(25),
      }).strict(),
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    async ({ asset_id, enrich, page, size }) => {
      const response = await client.get<{
        resources: AssetVulnerability[];
        page: { totalResources: number };
      }>(`/assets/${asset_id}/vulnerabilities`, { page, size });

      const refs = response.resources ?? [];

      if (!enrich) {
        return {
          content: [{
            type: "text" as const,
            text: JSON.stringify({
              asset_id,
              total: response.page?.totalResources ?? 0,
              enriched: false,
              vulnerabilities: refs.map((v) => ({ id: v.id, since: v.since, status: v.status })),
            }, null, 2),
          }],
        };
      }

      const enriched: unknown[] = [];
      const batchSize = 10;

      for (let i = 0; i < refs.length; i += batchSize) {
        const batch = refs.slice(i, i + batchSize);
        const details = await Promise.all(
          batch.map(async (ref) => {
            try {
              const detail = await client.get<Vulnerability>(`/vulnerabilities/${ref.id}`);
              return {
                id: ref.id,
                since: ref.since,
                status: ref.status,
                title: detail.title,
                severity: detail.severity,
                severityScore: detail.severityScore,
                riskScore: detail.riskScore,
                cvssV3Score: detail.cvss?.v3?.score,
                cvssV2Score: detail.cvss?.v2?.score,
                cvssV3Vector: detail.cvss?.v3?.vector,
                cves: detail.cves,
                exploits: detail.exploits,
                malwareKits: detail.malwareKits,
                published: detail.published,
              };
            } catch {
              return { id: ref.id, since: ref.since, status: ref.status, enrichmentError: true };
            }
          })
        );
        enriched.push(...details);
      }

      return {
        content: [{
          type: "text" as const,
          text: truncate(JSON.stringify({
            asset_id,
            total: response.page?.totalResources ?? 0,
            enriched: true,
            vulnerabilities: enriched,
          }, null, 2)),
        }],
      };
    }
  );

  // ── Get asset services ────────────────────────────────────────────────────

  server.registerTool(
    "insightvm_get_asset_services",
    {
      title: "Get Asset Services",
      description: `Returns all open ports and service fingerprints detected on an asset.

Note: Fingerprint fields (name, product, vendor, version, family) are only populated when the asset has been scanned by a credentialed internal scanner with a template that includes service identification. Assets scanned exclusively by an external unauthenticated scanner will return port and protocol only.

Args:
  - asset_id (number): The numeric asset ID`,
      inputSchema: z.object({
        asset_id: z.number().int().positive(),
      }).strict(),
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    async ({ asset_id }) => {
      const response = await client.get<{ resources: AssetService[] }>(`/assets/${asset_id}/services`);

      const output = {
        asset_id,
        services: (response.resources ?? []).map((s) => ({
          port: s.port,
          protocol: s.protocol,
          name: s.name,
          product: s.product,
          vendor: s.vendor,
          version: s.version,
          family: s.family,
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
      description: `Advanced asset search using InsightVM filter criteria.

Operator notes per field:
  - "site-id": operator must be "in", value is comma-separated e.g. "72" or "72,92"
  - "operating-system": use "contains"
  - "vulnerability-title": use "contains"
  - "risk-score": use "is-greater-than" with a numeric string
  - "ip-address-is": use "in" with comma-separated IP values

KNOWN API LIMITATION (BUG-011): The "last-scan-date" filter field is silently ignored by InsightVM when combined with other criteria such as "site-id". This is a server-side limitation of the InsightVM asset search API, not an MCP bug. To filter by last scan date, use last_scanned_before_days on this tool for client-side filtering instead.

Args:
  - filters (array): List of {field, operator, value} objects
  - match (string): "all" (AND) or "any" (OR) — default: "all"
  - last_scanned_before_days (number, optional): Client-side filter — only return assets whose lastScanTime is older than this many days. Use this instead of the broken last-scan-date API filter.
  - page (number): Zero-based page number (default: 0)
  - size (number): Results per page, max 500 (default: 100)`,
      inputSchema: z.object({
        filters: z.array(z.object({
          field: z.string(),
          operator: z.string(),
          value: z.string(),
        })).min(1),
        match: z.enum(["all", "any"]).default("all"),
        last_scanned_before_days: z.number().int().positive().optional().describe(
          "Client-side filter: only return assets last scanned more than this many days ago"
        ),
        page: z.number().int().min(0).default(0),
        size: z.number().int().min(1).max(500).default(100),
      }).strict(),
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: false, openWorldHint: false },
    },
    async ({ filters, match, last_scanned_before_days, page, size }) => {
      const normalizedFilters = filters.map((f) => {
        if (f.operator === "in" || f.operator === "not-in") {
          return { field: f.field, operator: f.operator, values: f.value.split(",").map((v) => v.trim()) };
        }
        return f;
      });

      const body = { filters: normalizedFilters, match };

      // When last_scanned_before_days is set we need to fetch all pages to filter client-side
      const needsFullFetch = last_scanned_before_days !== undefined;

      if (needsFullFetch) {
        const allAssets = await client.getAllPagesPOST<Asset>(
          `/assets/search`,
          body,
          MAX_PAGES
        );

        const cutoff = new Date();
        cutoff.setDate(cutoff.getDate() - last_scanned_before_days!);

        const filtered = allAssets.filter((a) => {
          const lastScan = a.history?.[0]?.date ?? a.lastScanTime;
          if (!lastScan) return true; // Include never-scanned assets
          return new Date(lastScan) < cutoff;
        });

        const output = {
          total: filtered.length,
          fullFetchMode: true,
          last_scanned_before_days,
          assets: filtered.map(formatAssetSummary),
        };
        return { content: [{ type: "text" as const, text: truncate(JSON.stringify(output, null, 2)) }] };
      }

      const response = await client.post<{
        resources: Asset[];
        page: { totalResources: number; number: number; size: number };
      }>(`/assets/search?page=${page}&size=${size}`, body);

      const output = {
        total: response.page?.totalResources ?? 0,
        page: response.page?.number ?? page,
        size: response.page?.size ?? size,
        assets: (response.resources ?? []).map(formatAssetSummary),
      };
      return { content: [{ type: "text" as const, text: truncate(JSON.stringify(output, null, 2)) }] };
    }
  );

  // ── Get vulnerability detail ──────────────────────────────────────────────

  server.registerTool(
    "insightvm_get_vulnerability_detail",
    {
      title: "Get Vulnerability Detail",
      description: `Returns full detail for a specific vulnerability including description, CVSS scores, CVEs, exploit count, and publish date.

Args:
  - vuln_id (string): The vulnerability ID (e.g. "apache-httpd-cve-2021-41773")`,
      inputSchema: z.object({
        vuln_id: z.string().min(1),
      }).strict(),
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    async ({ vuln_id }) => {
      const vuln = await client.get<Vulnerability>(`/vulnerabilities/${vuln_id}`);
      return { content: [{ type: "text" as const, text: JSON.stringify(vuln, null, 2) }] };
    }
  );

}

// ── Helpers ───────────────────────────────────────────────────────────────────

function formatAssetSummary(a: Asset) {
  return {
    id: a.id,
    hostName: a.hostName,
    ip: a.ip,
    os: a.os,
    riskScore: a.riskScore,
    vulnerabilities: a.vulnerabilities,
    lastScanTime: a.history?.[0]?.date ?? a.lastScanTime,
  };
}

function truncate(text: string): string {
  if (text.length <= CHARACTER_LIMIT) return text;
  return text.slice(0, CHARACTER_LIMIT) + `\n\n[Response truncated at ${CHARACTER_LIMIT} characters. Use pagination to retrieve remaining results.]`;
}
