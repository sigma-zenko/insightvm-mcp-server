# insightvm-mcp-server

MCP server for Rapid7 InsightVM. Exposes asset triage, vulnerability lookup, scan management, site and schedule inspection, reporting, remediation tracking, and port drift detection as MCP tools.

Compatible with any MCP-capable client: Claude Desktop, GitHub Copilot Enterprise, N8N, custom agents, or any LLM that supports the Model Context Protocol.

---

## Requirements

- Node.js v18+
- Rapid7 InsightVM console accessible over HTTPS (v3 API)
- Dedicated service account with the permissions listed below

---

## Authentication

This server uses **HTTP Basic Authentication** against the InsightVM v3 REST API (`/api/3/`). There is no API key — credentials are a username and password for a dedicated service account. Credentials are injected at startup via environment variables and are never returned in tool output or logs.

---

## Permissions Required

| Scope | Permission |
|---|---|
| Global | View Asset Data |
| Global | View Group Asset Data |
| Global | View Vulnerability Data |
| Global | Manage Reports |
| MCP-owned site | Site Owner (full edit rights) |
| All other sites | Start Scans only |

The owned site must be created manually by an InsightVM administrator before starting the server. If `INSIGHTVM_OWNED_SITE_ID` is not set or points to a non-existent site, `insightvm_get_owned_site` will return a clear error and list all available sites to help identify the correct ID.

---

## Environment Variables

| Variable | Required | Description |
|---|---|---|
| `INSIGHTVM_HOST` | Yes | Console hostname or IP |
| `INSIGHTVM_PORT` | No | Console port (default: 3780) |
| `INSIGHTVM_USERNAME` | Yes | Service account username |
| `INSIGHTVM_PASSWORD` | Yes | Service account password |
| `INSIGHTVM_OWNED_SITE_ID` | Yes | Numeric site ID this MCP has full ownership over |
| `INSIGHTVM_VERIFY_SSL` | No | Set to `false` to skip SSL verification (dev/self-signed cert environments only) |
| `INSIGHTVM_PORT_EXCLUSIONS` | No | Comma-separated known-good port numbers for port drift detection (e.g. `22,443,8443`) |
| `TRANSPORT` | No | `stdio` (default) or `http` |
| `PORT` | No | HTTP listen port when using HTTP transport (default: 3000) |

---

## Installation

```bash
npm install
npm run build
```

---

## Running

### stdio (default — for local MCP clients such as Claude Desktop)

```bash
INSIGHTVM_HOST=your-console.example.com \
INSIGHTVM_USERNAME=insightvm-mcp-svc \
INSIGHTVM_PASSWORD=your-password \
INSIGHTVM_OWNED_SITE_ID=42 \
INSIGHTVM_PORT_EXCLUSIONS=22,443,8443 \
node dist/index.js
```

### HTTP (for remote or multi-client deployments)

```bash
TRANSPORT=http \
PORT=3000 \
INSIGHTVM_HOST=your-console.example.com \
INSIGHTVM_USERNAME=insightvm-mcp-svc \
INSIGHTVM_PASSWORD=your-password \
INSIGHTVM_OWNED_SITE_ID=42 \
node dist/index.js
```

---

## MCP Client Configuration

### Claude Desktop

Add the following to `~/Library/Application Support/Claude/claude_desktop_config.json` (macOS) or `%APPDATA%\Claude\claude_desktop_config.json` (Windows):

```json
{
  "mcpServers": {
    "insightvm": {
      "command": "node",
      "args": ["/path/to/insightvm-mcp-server/dist/index.js"],
      "env": {
        "INSIGHTVM_HOST": "your-console.example.com",
        "INSIGHTVM_USERNAME": "insightvm-mcp-svc",
        "INSIGHTVM_PASSWORD": "your-password",
        "INSIGHTVM_OWNED_SITE_ID": "42",
        "INSIGHTVM_PORT_EXCLUSIONS": "22,443,8443"
      }
    }
  }
}
```

Fully quit and reopen Claude Desktop after saving. The hammer icon in the chat input confirms the server loaded successfully.

### GitHub Copilot Enterprise

Add to your MCP registry configuration following your organisation's registry deployment pattern.

---

## Available Tools

### Asset & Vulnerability Triage

| Tool | Description |
|---|---|
| `insightvm_search_assets` | Search assets with optional hostname/IP query, minimum risk score, and site scope. Automatically switches to full-fetch mode when `min_risk_score` and `site_id` are combined (API limitation). |
| `insightvm_get_asset_detail` | Full detail for a single asset: hostname, OS fingerprint, MAC, addresses, risk scores, scan history, and site memberships. |
| `insightvm_get_asset_vulnerabilities` | Vulnerabilities on an asset. Enriches each finding with title, severity, CVSS scores, CVEs, and exploit count via a batch join to `/vulnerabilities/{id}`. |
| `insightvm_get_asset_services` | Open ports and service fingerprints per asset. Fingerprint fields populate only when a credentialed internal scanner has run — absent for assets scanned by external unauthenticated scanners. |
| `insightvm_search_assets_by_criteria` | Advanced asset search using InsightVM filter criteria. Includes `last_scanned_before_days` for client-side date filtering (the `last-scan-date` API filter is silently ignored by InsightVM). |
| `insightvm_get_vulnerability_detail` | Full CVE/CVSS detail for a vulnerability including description, categories, PCI status, exploit count, and fix availability. |
| `insightvm_get_remediation` | Remediation solutions for a vulnerability. Fetches full solution detail for each reference returned by the API (the solutions endpoint returns hypermedia references only, not full objects). |
| `insightvm_get_solution_detail` | Full detail for a specific remediation solution by ID, including type, affected platforms, time estimate, and step-by-step instructions. |

### Scan Management

| Tool | Description | Write? |
|---|---|---|
| `insightvm_list_sites` | All sites the service account can access, with asset count, risk score, last scan time, and default scan template. | No |
| `insightvm_get_site_config` | Full configuration for a site: default scan template, scan engine, and target ranges. | No |
| `insightvm_list_site_schedules` | All scan schedules for a site, including the scan template override per schedule. Essential for diagnosing template drift. | No |
| `insightvm_list_scan_templates` | All scan templates available in the InsightVM instance. | No |
| `insightvm_list_scans` | Scans across all sites or scoped to a specific site. Supports `sort_order` (newest-first by default via server-side sort) and `status` filter (`running` uses the API `active` param; other statuses are filtered client-side). | No |
| `insightvm_get_scan_status` | Status and detail for a specific scan including engine info, scan type, duration, and who started it. Note: `scanTemplate` is not returned by the InsightVM scan API — use `insightvm_list_site_schedules` to identify the template. | No |
| `insightvm_start_scan` | Trigger a scan on any site. Trigger-only — does not modify site configuration. | Yes |
| `insightvm_stop_scan` | Stop a running scan. Partial results are retained. | Yes |
| `insightvm_get_owned_site` | Details for the MCP-owned site. Returns a clear error with a list of available sites if `INSIGHTVM_OWNED_SITE_ID` is not set or points to an inaccessible site. | No |
| `insightvm_update_owned_site` | Update configuration of the MCP-owned site only (name, description, scan template, targets). Enforced at the tool layer — cannot modify any other site. | Yes |
| `insightvm_get_scan_engine_status` | Status, version, and connectivity of all registered scan engines. Requires elevated permissions (Platform Administrator or Security Manager) on the service account. Returns 404 if the account lacks these permissions. | No |

### Reporting

| Tool | Description | Write? |
|---|---|---|
| `insightvm_list_reports` | All report definitions available to the service account. Always call this first — InsightVM returns 401 (not 404) when requesting history for a non-existent report ID. | No |
| `insightvm_create_report` | Create a new report definition scoped to sites, asset groups, or specific assets. Does not generate immediately. | Yes |
| `insightvm_generate_report` | Trigger generation of an existing report definition. Runs asynchronously. | Yes |
| `insightvm_get_report_history` | Generation history for a report including status, timestamp, and file size. Pre-validates the report exists before fetching. | No |
| `insightvm_get_report_output` | Pull the output of a completed report run. Large reports are truncated at 50,000 characters. | No |

### Remediation Tracking

| Tool | Description |
|---|---|
| `insightvm_list_tickets` | Remediation tickets from InsightVM's built-in ticketing system. Returns empty list if native ticketing is not in use. |

### Port Drift Detection

| Tool | Description |
|---|---|
| `insightvm_check_port_drift` | Queries all assets in a site for currently open ports and returns any not present in the exclusion list (`INSIGHTVM_PORT_EXCLUSIONS`). Designed for scheduled daily automation. Returns a structured payload with per-asset new ports, known ports, and a full open port list. |

---

## Known API Limitations

These are InsightVM API behaviours, not MCP bugs:

- **`scanTemplate` not in scan results**: The `GET /api/3/scans/{id}` endpoint does not return the scan template used. Cross-reference `insightvm_list_site_schedules` to identify the template per schedule.
- **`last-scan-date` filter ignored**: The InsightVM asset search API silently ignores `last-scan-date` when combined with other criteria. Use the `last_scanned_before_days` parameter on `insightvm_search_assets_by_criteria` for client-side date filtering instead.
- **`min_risk_score` + `site_id`**: The site-scoped asset endpoint does not support server-side risk filtering. The MCP automatically fetches all pages and filters client-side when both parameters are set (`fullFetchMode: true` in the response).
- **Report history returns 401 for missing reports**: InsightVM returns 401 instead of 404 when requesting history for a non-existent report ID. Always confirm the report exists via `insightvm_list_reports` first.
- **Service fingerprint fields**: `name`, `product`, `vendor`, `version` on services are only populated when a credentialed internal scanner has run. External unauthenticated scanners return port and protocol only.
- **Asset OS and hostname fields**: `hostName`, `os`, and `osFingerprint` require a credentialed scan. Assets scanned exclusively by an external scanner will not have these fields.

---

## Guardrails

- `insightvm_update_owned_site` is enforced at the tool layer to only operate on the site ID in `INSIGHTVM_OWNED_SITE_ID` — regardless of what the API would permit.
- No tool exposes site creation or deletion.
- No tool exposes asset deletion.
- Credentials are injected via environment variables and never returned in any tool response or log output.
- Paginated responses are capped at 10 pages per request to prevent runaway API calls in large environments.
- Large text responses are truncated at 50,000 characters with an explicit message.

---

## License

Apache 2.0 — see [LICENSE](LICENSE).
