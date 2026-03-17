// Server metadata
export const SERVER_NAME = "insightvm-mcp-server";
export const SERVER_VERSION = "1.0.0";

// API
export const API_BASE_PATH = "/api/3";
export const DEFAULT_TIMEOUT_MS = 30_000;
export const DEFAULT_PAGE_SIZE = 100;
export const MAX_PAGES = 10; // Safety cap — prevents runaway pagination in large environments

// Character limit for large text responses
export const CHARACTER_LIMIT = 50_000;
