// ── Config ────────────────────────────────────────────────────────────────────

export interface InsightVMConfig {
  host: string;           // Console hostname or IP
  port: number;           // Default: 3780
  username: string;
  password: string;
  ownedSiteId: string;    // The single site this MCP has full ownership over
  verifySsl: boolean;     // Set false for self-signed certs in dev environments
  portExclusions: number[]; // Ports considered known-good for drift detection
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
  ip?: string;
  os?: OsInfo;
  riskScore?: number;
  vulnerabilities?: VulnerabilitySummary;
  lastScanTime?: string;
}

export interface OsInfo {
  name?: string;
  family?: string;
  version?: string;
}

export interface VulnerabilitySummary {
  critical: number;
  severe: number;
  moderate: number;
  total: number;
}

export interface AssetVulnerability {
  id: string;
  title: string;
  severity: string;
  cvssV3Score?: number;
  cvssV2Score?: number;
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

export interface AssetService {
  port: number;
  protocol: string;
  name?: string;
  product?: string;
  version?: string;
}

// ── Vulnerabilities ───────────────────────────────────────────────────────────

export interface Vulnerability {
  id: string;
  title: string;
  description?: string;
  severity: string;
  riskScore?: number;
  cvss?: CvssInfo;
  published?: string;
  modified?: string;
  categories?: string[];
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
  assets?: ScanAssetCount;
  vulnerabilities?: ScanVulnCount;
  engineName?: string;
  scanName?: string;
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
  assets?: number;
  lastScanTime?: string;
  links?: Array<{ rel: string; href: string }>;
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
