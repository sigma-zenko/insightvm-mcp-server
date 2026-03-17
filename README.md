# insightvm-mcp-server

MCP server for Rapid7 InsightVM. Exposes asset triage, vulnerability lookup, scan management, reporting, remediation tracking, and port drift detection as MCP tools.

Compatible with any MCP-capable client: Claude, GitHub Copilot Enterprise, N8N, custom agents, or any LLM that supports the Model Context Protocol.

---

## Requirements

- Node.js v18+
- Rapid7 InsightVM console accessible over HTTPS
- Dedicated service account with the permissions listed below

---

## Permissions Required

| Scope | Permission |
|---|---|
| Global | View Asset Data |
| Global | View Group Asset Data |
| Global | View Vulnerability Data |
| Global | Manage Reports |
| MCP-owned site | Site Owner |
| All other sites | Start Scans only |

The owned site must be created manually by an InsightVM administrator before starting the server.

---

## Environment Variables

| Variable | Required | Description |
|---|---|---|
| `INSIGHTVM_HOST` | Yes | Console hostname or IP |
| `INSIGHTVM_PORT` | No | Console port (default: 3780) |
| `INSIGHTVM_USERNAME` | Yes | Service account username |
| `INSIGHTVM_PASSWORD` | Yes | Service account password |
| `INSIGHTVM_OWNED_SITE_ID` | Yes | Site ID this MCP has full ownership over |
| `INSIGHTVM_VERIFY_SSL` | No | Set to `false` to disable SSL verification (dev only) |
| `INSIGHTVM_PORT_EXCLUSIONS` | No | Comma-separated known-good port numbers for drift detection |
| `TRANSPORT` | No | `stdio` (default) or `http` |
| `PORT` | No | HTTP port when using HTTP transport (default: 3000) |

---

## Installation

```bash
npm install
npm run build
```

---

## Running

### stdio (default — for local MCP clients)

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

## MCP Client Configuration (Claude Desktop / Copilot)

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

---

## Available Tools

| Tool | Description | Write? |
|---|---|---|
| `insightvm_search_assets` | Search assets with optional filters | No |
| `insightvm_get_asset_detail` | Full detail for a single asset | No |
| `insightvm_get_asset_vulnerabilities` | Vulnerabilities on an asset | No |
| `insightvm_get_asset_services` | Open ports and service fingerprints | No |
| `insightvm_search_assets_by_criteria` | Advanced filtered asset search | No |
| `insightvm_get_vulnerability_detail` | CVE/CVSS detail for a vulnerability | No |
| `insightvm_get_remediation` | Remediation solutions for a vulnerability | No |
| `insightvm_list_scans` | List scans across all or a specific site | No |
| `insightvm_get_scan_status` | Status and progress of a specific scan | No |
| `insightvm_start_scan` | Trigger a scan on any site | Yes |
| `insightvm_stop_scan` | Stop a running scan | Yes |
| `insightvm_get_owned_site` | Details of the MCP-owned site | No |
| `insightvm_update_owned_site` | Update config of the MCP-owned site only | Yes |
| `insightvm_list_reports` | List report definitions | No |
| `insightvm_create_report` | Create a new report definition | Yes |
| `insightvm_generate_report` | Trigger report generation | Yes |
| `insightvm_get_report_history` | Report run history | No |
| `insightvm_get_report_output` | Pull output of a completed report | No |
| `insightvm_get_solution_detail` | Full detail for a remediation solution | No |
| `insightvm_list_tickets` | List remediation tickets | No |
| `insightvm_check_port_drift` | Check all assets for unexpected open ports | No |

---

## Guardrails

- `insightvm_update_owned_site` operates exclusively on the site specified by `INSIGHTVM_OWNED_SITE_ID`. Any other site ID is rejected at the tool layer.
- No tool exposes site creation (`POST /sites`) or site deletion (`DELETE /sites`).
- No tool exposes asset deletion.
- Credentials are injected via environment variables and never returned in tool output.
- Paginated responses are capped at 10 pages per request to prevent runaway API calls.
- Large responses are truncated at 50,000 characters with a clear message.
