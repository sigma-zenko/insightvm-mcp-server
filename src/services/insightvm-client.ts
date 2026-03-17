import axios, { AxiosInstance, AxiosError } from "axios";
import https from "https";
import { InsightVMConfig, PagedResponse } from "../types.js";
import { API_BASE_PATH, DEFAULT_TIMEOUT_MS, DEFAULT_PAGE_SIZE, MAX_PAGES } from "../constants.js";

export class InsightVMClient {
  private readonly http: AxiosInstance;
  readonly config: InsightVMConfig;

  constructor(config: InsightVMConfig) {
    this.config = config;

    const baseURL = `https://${config.host}:${config.port}${API_BASE_PATH}`;
    const auth = Buffer.from(`${config.username}:${config.password}`).toString("base64");

    this.http = axios.create({
      baseURL,
      timeout: DEFAULT_TIMEOUT_MS,
      headers: {
        Authorization: `Basic ${auth}`,
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      httpsAgent: new https.Agent({ rejectUnauthorized: config.verifySsl }),
    });
  }

  // ── Generic request helpers ───────────────────────────────────────────────

  async get<T>(path: string, params?: Record<string, unknown>): Promise<T> {
    try {
      const res = await this.http.get<T>(path, { params });
      return res.data;
    } catch (err) {
      throw formatError(err);
    }
  }

  async post<T>(path: string, body?: unknown): Promise<T> {
    try {
      const res = await this.http.post<T>(path, body);
      return res.data;
    } catch (err) {
      throw formatError(err);
    }
  }

  async put<T>(path: string, body?: unknown): Promise<T> {
    try {
      const res = await this.http.put<T>(path, body);
      return res.data;
    } catch (err) {
      throw formatError(err);
    }
  }

  // ── Paginated collection helper ───────────────────────────────────────────
  // Automatically walks pages up to MAX_PAGES and collects all resources.

  async getAllPages<T>(
    path: string,
    params?: Record<string, unknown>,
    maxPages: number = MAX_PAGES
  ): Promise<T[]> {
    const results: T[] = [];
    let page = 0;

    while (page < maxPages) {
      const response = await this.get<PagedResponse<T>>(path, {
        ...params,
        page,
        size: DEFAULT_PAGE_SIZE,
      });

      const resources = response.resources ?? [];
      results.push(...resources);

      const totalPages = response.page?.totalPages ?? 1;
      if (page + 1 >= totalPages) break;
      page++;
    }

    return results;
  }

  // POST-based pagination for search endpoints
  async getAllPagesPOST<T>(
    path: string,
    body: unknown,
    maxPages: number = MAX_PAGES
  ): Promise<T[]> {
    const results: T[] = [];
    let page = 0;

    while (page < maxPages) {
      const response = await this.post<PagedResponse<T>>(
        `${path}?page=${page}&size=${DEFAULT_PAGE_SIZE}`,
        body
      );

      const resources = response.resources ?? [];
      results.push(...resources);

      const totalPages = response.page?.totalPages ?? 1;
      if (page + 1 >= totalPages) break;
      page++;
    }

    return results;
  }
}

// ── Error formatting ──────────────────────────────────────────────────────────

function formatError(err: unknown): Error {
  if (axios.isAxiosError(err)) {
    const axErr = err as AxiosError<{ message?: string }>;
    const status = axErr.response?.status;
    const message = axErr.response?.data?.message ?? axErr.message;

    if (status === 401) return new Error("Authentication failed. Check INSIGHTVM_USERNAME and INSIGHTVM_PASSWORD.");
    if (status === 403) return new Error(`Forbidden. The service account lacks permission for this operation. API message: ${message}`);
    if (status === 404) return new Error(`Resource not found. API message: ${message}`);
    if (status === 429) return new Error("Rate limit exceeded. Reduce request frequency.");
    if (status && status >= 500) return new Error(`InsightVM server error (${status}). API message: ${message}`);

    return new Error(`API request failed (${status ?? "no response"}): ${message}`);
  }

  if (err instanceof Error) return err;
  return new Error(String(err));
}
