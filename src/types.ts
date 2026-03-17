// ── Config ────────────────────────────────────────────────────────────────────

export interface InsightVMConfig {
  host: string;
  port: number;
  username: string;
  password: string;
  ownedSiteId: string;
  verifySsl: boolean;
  portExclusions: number[];
}

// ── Pagination ────────────────────────────────────────────────────────────────

export interface PagedResponse<T> {
  resources: T[];
  page: {
    number: number;
    size: number;
    totalPages: number;
    totalResources: number;
  };
}

// ── Assets ────────────────────────────────────────────────────────────────────

export interface Asset {
  id: number;
  hostName?: string;
  hostNames?: Array<{ name: string; source?: string }>;
  ip?: string;
  mac?: string;
  addresses?: Array<{ ip: string; mac?: string }>;
  ids?: Array<{ id: string; source?: string }>;
  // `os` is a plain string description in the API response
  os?: string;
  osCertainty?: string;
  osFingerprint?: OsFingerprint;
  riskScore?: number;
  rawRiskScore?: number;
  vulnerabilities?: VulnerabilitySummary;
  // lastScanTime is derived from history[0].date
  lastScanTime?: string;
  history?: Array<{ date?: string; scanId?: number; type?: string; user?: string }>;
  type?: string;
  assessedForVulnerabilities?: boolean;
  assessedForPolicies?: boolean;
  sites?: Array<{ id: number; name?: string }>;
}

export interface OsFingerprint {
  architecture?: string;
  family?: string;
  vendor?: string;
  product?: string;
  version?: string;
  cpe?: string;
}

export interface VulnerabilitySummary {
  critical: number;
  severe: number;
  moderate: number;
  total: number;
}

// Asset-scoped vuln — lightweight, enrichment requires join to /vulnerabilities/{id}
export interface AssetVulnerability {
  id: string;
  since?: string;
  status?: string;
  results?: VulnResult[];
}

export interface VulnResult {
  port?: number;
  protocol?: string;
  status?: string;
  proof?: string;
}

// Service fields are directly on the object — no nesting
export interface AssetService {
  port: number;
  protocol: string;
  name?: string;
  product?: string;
  vendor?: string;
  version?: string;
  family?: string;
  configurations?: Array<{ name: string; value?: string }>;
  webApplications?: Array<{ name?: string; webApp?: string }>;
}

// ── Vulnerabilities ───────────────────────────────────────────────────────────

export interface Vulnerability {
  id: string;
  title: string;
  description?: { text?: string; html?: string };
  severity: string;
  severityScore?: number;
  riskScore?: number;
  cvss?: CvssInfo;
  published?: string;
  added?: string;
  modified?: string;
  categories?: string[];
  cves?: string[];
  exploits?: number;
  malwareKits?: number;
}

export interface CvssInfo {
  v3?: CvssScore;
  v2?: CvssScore;
}

export interface CvssScore {
  score?: number;
  vector?: string;
}

export interface Solution {
  id: string;
  summary: string;
  type: string;
  appliesTo?: string;
  estimate?: string;
  steps?: SolutionSteps;
  additionalInformation?: string;
}

export interface SolutionSteps {
  html?: string;
  text?: string;
}

// ── Scans ─────────────────────────────────────────────────────────────────────

export interface Scan {
  id: number;
  siteId: number;
  siteName?: string;
  status: string;
  startTime?: string;
  endTime?: string;
  duration?: string;
  assets?: ScanAssetCount;
  vulnerabilities?: ScanVulnCount;
  engineName?: string;
  engineId?: number;
  engineIds?: Array<{ id: number; newScanEngine?: boolean; scope?: string }>;
  scanName?: string;
  scanType?: string;
  startedBy?: string;
  startedByUsername?: string;
  message?: string;
}

export interface ScanAssetCount {
  discovered?: number;
  total?: number;
}

export interface ScanVulnCount {
  critical?: number;
  moderate?: number;
  severe?: number;
  total?: number;
}

export interface ScanStartResult {
  id: number;
  links?: Array<{ rel: string; href: string }>;
}

// ── Sites ─────────────────────────────────────────────────────────────────────

export interface Site {
  id: number;
  name: string;
  description?: string;
  riskScore?: number;
  scanTemplate?: string;
  scanTemplateId?: string;
  assets?: number;
  lastScanTime?: string;
  links?: Array<{ rel: string; href: string }>;
}

export interface SiteConfig extends Site {
  engineId?: number;
  engineName?: string;
  targets?: {
    includedTargets?: { addresses: string[] };
    excludedTargets?: { addresses: string[] };
  };
  credentials?: Array<{ name: string; service?: string }>;
}

export interface SiteUpdatePayload {
  name?: string;
  description?: string;
  scanTemplateId?: string;
  targets?: SiteTargets;
}

export interface SiteTargets {
  includedTargets?: { addresses: string[] };
  excludedTargets?: { addresses: string[] };
}

// ── Scan Schedules ────────────────────────────────────────────────────────────

export interface ScanSchedule {
  id: number;
  enabled: boolean;
  scanName?: string;
  scanTemplateId?: string;
  duration?: string;
  nextRuntimeScheduled?: string;
  start?: string;
  frequency?: {
    interval?: number;
    type?: string;
    dayOfWeek?: string;
  };
  scanEngineId?: number;
}

// ── Scan Templates ────────────────────────────────────────────────────────────

export interface ScanTemplate {
  id: string;
  name: string;
  description?: string;
  builtIn?: boolean;
}

// ── Scan Engines ──────────────────────────────────────────────────────────────

export interface ScanEngine {
  id: number;
  name: string;
  address?: string;
  port?: number;
  status?: string;
  version?: string;
  lastRefreshedDate?: string;
  sites?: number[];
}

// ── Reports ───────────────────────────────────────────────────────────────────

export interface Report {
  id: number;
  name: string;
  format?: string;
  template?: { id: string; name?: string };
  status?: string;
  lastUpdated?: string;
}

export interface ReportCreatePayload {
  name: string;
  format: string;
  template: { id: string };
  scope?: ReportScope;
}

export interface ReportScope {
  sites?: number[];
  assetGroups?: number[];
  assets?: number[];
  vulnerabilities?: string[];
}

export interface ReportHistory {
  id: number;
  instanceId?: number;
  status: string;
  generated?: string;
  uri?: string;
}

// ── Tickets ───────────────────────────────────────────────────────────────────

export interface Ticket {
  id: number;
  name: string;
  state?: string;
  priority?: string;
  assetCount?: number;
  openedBy?: string;
  openedTime?: string;
}

// ── Port Drift ────────────────────────────────────────────────────────────────

export interface PortDriftResult {
  assetId: number;
  hostname?: string;
  ip?: string;
  newPorts: number[];
  knownPorts: number[];
  allOpenPorts: number[];
  checkedAt: string;
}

export interface PortDriftSummary {
  totalAssetsChecked: number;
  assetsWithNewPorts: number;
  results: PortDriftResult[];
  checkedAt: string;
}
