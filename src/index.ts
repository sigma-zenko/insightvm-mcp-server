import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import express, { Request, Response } from "express";

import { SERVER_NAME, SERVER_VERSION } from "./constants.js";
import { loadConfig } from "./services/config.js";
import { InsightVMClient } from "./services/insightvm-client.js";
import { registerAssetTools } from "./tools/assets.js";
import { registerScanTools } from "./tools/scans.js";
import { registerReportTools } from "./tools/reports.js";
import { registerRemediationTools } from "./tools/remediation.js";
import { registerPortDriftTools } from "./tools/port-drift.js";

// ── Bootstrap ─────────────────────────────────────────────────────────────────

function buildServer(): McpServer {
  const config = loadConfig();
  const client = new InsightVMClient(config);

  const server = new McpServer({
    name: SERVER_NAME,
    version: SERVER_VERSION,
  });

  registerAssetTools(server, client);
  registerScanTools(server, client);
  registerReportTools(server, client);
  registerRemediationTools(server, client);
  registerPortDriftTools(server, client);

  return server;
}

// ── Transport: stdio (default) ────────────────────────────────────────────────

async function runStdio(): Promise<void> {
  const server = buildServer();
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error(`${SERVER_NAME} v${SERVER_VERSION} running on stdio`);
}

// ── Transport: HTTP ───────────────────────────────────────────────────────────

async function runHTTP(): Promise<void> {
  const app = express();
  app.use(express.json());

  app.post("/mcp", async (req: Request, res: Response) => {
    const server = buildServer();
    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: undefined,
      enableJsonResponse: true,
    });
    res.on("close", () => transport.close());
    await server.connect(transport);
    await transport.handleRequest(req, res, req.body);
  });

  app.get("/health", (_req: Request, res: Response) => {
    res.json({ status: "ok", server: SERVER_NAME, version: SERVER_VERSION });
  });

  const port = parseInt(process.env.PORT ?? "3000", 10);
  app.listen(port, () => {
    console.error(`${SERVER_NAME} v${SERVER_VERSION} running on http://localhost:${port}/mcp`);
  });
}

// ── Entry point ───────────────────────────────────────────────────────────────

const transport = process.env.TRANSPORT ?? "stdio";

if (transport === "http") {
  runHTTP().catch((err: unknown) => {
    console.error("Fatal error:", err);
    process.exit(1);
  });
} else {
  runStdio().catch((err: unknown) => {
    console.error("Fatal error:", err);
    process.exit(1);
  });
}
