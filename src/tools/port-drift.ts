import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { InsightVMClient } from "../services/insightvm-client.js";
import { Asset, AssetService, PortDriftResult, PortDriftSummary } from "../types.js";

export function registerPortDriftTools(server: McpServer, client: InsightVMClient): void {

  // ── Port drift check ──────────────────────────────────────────────────────

  server.registerTool(
    "insightvm_check_port_drift",
    {
      title: "Check Port Drift",
      description: `Queries all assets in a site (or a provided asset list) for currently open ports and returns any ports not present in the exclusion list. This is the primary tool for daily automated port exposure monitoring.

The exclusion list is loaded from the INSIGHTVM_PORT_EXCLUSIONS environment variable (comma-separated port numbers). Ports in this list are considered known-good and will not trigger alerts.

Args:
  - site_id (number, optional): Scope the check to a specific site. Defaults to the MCP-owned site.
  - asset_ids (array of numbers, optional): Check specific assets only instead of a full site scan
  - extra_exclusions (array of numbers, optional): Additional ports to exclude for this run only (does not modify the permanent exclusion list)

Returns JSON:
  {
    "totalAssetsChecked": number,
    "assetsWithNewPorts": number,
    "checkedAt": string (ISO timestamp),
    "results": [
      {
        "assetId": number,
        "hostname": string,
        "ip": string,
        "newPorts": number[],        // Ports NOT in the exclusion list
        "knownPorts": number[],      // Ports that ARE in the exclusion list
        "allOpenPorts": number[],    // Full list of open ports on this asset
        "checkedAt": string
      }
    ]
  }

Only assets with new ports are included in results. An empty results array means no drift was detected.`,
      inputSchema: z.object({
        site_id: z.number().int().positive().optional().describe(
          "Site ID to scope the check. Defaults to the MCP-owned site if not provided."
        ),
        asset_ids: z.array(z.number().int().positive()).optional().describe(
          "Check specific assets only. If provided, site_id is ignored."
        ),
        extra_exclusions: z.array(z.number().int().min(1).max(65535)).optional().describe(
          "Additional port numbers to exclude for this run only."
        ),
      }).strict(),
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: false,
      },
    },
    async ({ site_id, asset_ids, extra_exclusions }) => {
      const exclusions = new Set([
        ...client.config.portExclusions,
        ...(extra_exclusions ?? []),
      ]);

      const checkedAt = new Date().toISOString();

      // Resolve asset list
      let assets: Asset[];

      if (asset_ids && asset_ids.length > 0) {
        // Fetch specific assets
        assets = await Promise.all(
          asset_ids.map((id) => client.get<Asset>(`/assets/${id}`))
        );
      } else {
        // Fetch all assets in the target site
        const targetSiteId = site_id ?? client.config.ownedSiteId;
        const response = await client.get<{
          resources: Asset[];
          page: { totalPages: number; totalResources: number };
        }>(`/sites/${targetSiteId}/assets`, { size: 500 });

        assets = response.resources ?? [];

        // Walk additional pages if needed
        const totalPages = response.page?.totalPages ?? 1;
        for (let page = 1; page < Math.min(totalPages, 10); page++) {
          const nextPage = await client.get<{ resources: Asset[] }>(
            `/sites/${targetSiteId}/assets`,
            { page, size: 500 }
          );
          assets.push(...(nextPage.resources ?? []));
        }
      }

      // Check each asset's services concurrently (max 10 at a time)
      const results: PortDriftResult[] = [];
      const batchSize = 10;

      for (let i = 0; i < assets.length; i += batchSize) {
        const batch = assets.slice(i, i + batchSize);
        const batchResults = await Promise.all(
          batch.map(async (asset) => {
            const serviceResponse = await client.get<{ resources: AssetService[] }>(
              `/assets/${asset.id}/services`
            );

            const services = serviceResponse.resources ?? [];
            const allOpenPorts = services.map((s) => s.port);
            const newPorts = allOpenPorts.filter((p) => !exclusions.has(p));
            const knownPorts = allOpenPorts.filter((p) => exclusions.has(p));

            if (newPorts.length === 0) return null;

            return {
              assetId: asset.id,
              hostname: asset.hostName,
              ip: asset.ip,
              newPorts: newPorts.sort((a, b) => a - b),
              knownPorts: knownPorts.sort((a, b) => a - b),
              allOpenPorts: allOpenPorts.sort((a, b) => a - b),
              checkedAt,
            } satisfies PortDriftResult;
          })
        );

        results.push(...(batchResults.filter(Boolean) as PortDriftResult[]));
      }

      const summary: PortDriftSummary = {
        totalAssetsChecked: assets.length,
        assetsWithNewPorts: results.length,
        results,
        checkedAt,
      };

      return { content: [{ type: "text" as const, text: JSON.stringify(summary, null, 2) }] };
    }
  );
}
