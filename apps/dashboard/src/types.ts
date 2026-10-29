export type Overview = {
  totals: {
    events: number;
    openIncidents: number;
    averageLatencyMs: number;
  };
  endpoints: Array<{
    path: string;
    method: string;
    requests: number;
    latency: number;
    max_threat_score: number;
  }>;
  ips: Array<{
    ip: string;
    requests: number;
    max_threat_score: number;
  }>;
};

export type Incident = {
  id: string;
  incident_key?: string;
  severity: string;
  title: string;
  description: string;
  status: string;
  affected_endpoint?: string;
  attacker_ips?: string[];
  request_count?: number;
  started_at?: string;
  last_seen_at?: string;
  acknowledged_at?: string | null;
  resolved_at?: string | null;
  ignored_at?: string | null;
  updated_at?: string;
  created_at: string;
};

export type IncidentStatus = "open" | "acknowledged" | "resolved" | "ignored";

export type Readiness = {
  status: "ready" | "degraded";
  checks: {
    database: { ok: boolean; latencyMs: number };
    queue: { ok: boolean; latencyMs: number; depth: number; oldestAgeMs?: number };
    worker?: { ok: boolean; consumer: string | null; lastSeenAt: string | null };
  };
};

export type SystemMetrics = {
  uptimeSeconds: number;
  totalRequests: number;
  ingestionRate: number;
  ingestionBatches: number;
  failedJobs: number;
  queueDepth: number;
  databaseLatencyMs: number;
  processingLatencyMs: number;
  websocketConnections: number;
};

export type RequestRecord = {
  id: string;
  trace_id?: string;
  parent_span_id?: string;
  timestamp: string;
  service_name: string;
  environment: string;
  kind: string;
  method: string;
  path: string;
  route?: string;
  ip?: string;
  user_agent?: string;
  status_code: number;
  latency_ms: number;
  body_bytes?: number;
  auth_present: boolean;
  auth_failed: boolean;
  graphql_operation_name?: string;
  graphql_operation_type?: string;
  evm_rpc_method?: string;
  evm_chain_id?: string;
  evm_provider?: string;
  wallet_address?: string;
  contract_address?: string;
  threat_score: number;
  threat_severity: string;
};

export type RequestFilters = {
  method: string;
  status: string;
  threatMin: string;
  ip: string;
  query: string;
};

export type ApiKeyRecord = {
  id: string;
  name: string;
  prefix: string;
  key?: string;
  last_used_at?: string | null;
  created_at: string;
  revoked_at?: string | null;
};

export type AlertDestination = {
  id: string;
  name: string;
  url: string;
  enabled: boolean;
  created_at: string;
  updated_at?: string;
};

export type AlertDelivery = {
  id: string;
  incident_id: string;
  destination_id: string;
  destination_name: string;
  status: string;
  attempts: number;
  last_error?: string | null;
  created_at: string;
  delivered_at?: string | null;
};

export type AlertRuleMetric =
  | "error_rate_percent"
  | "p95_latency_ms"
  | "max_threat_score"
  | "request_count"
  | "auth_failure_count";

export type AlertRule = {
  id: string;
  metric: AlertRuleMetric;
  threshold: number;
  window_minutes: number;
  enabled: boolean;
  created_at: string;
  updated_at?: string;
};

export type ErrorGroup = {
  id: string;
  error_type: string;
  message: string;
  affected_endpoint?: string;
  occurrences: number;
  affected_ips: string[];
  first_seen_at: string;
  last_seen_at: string;
};

export type DashboardView =
  "overview" | "requests" | "incidents" | "errors" | "api-keys" | "alerts" | "rpc";

export type ProjectOption = {
  id: string;
  name: string;
  role: "owner" | "admin" | "developer" | "viewer";
};

export type AuthSession = {
  user: {
    email: string;
  };
  organization: {
    id: string;
    name: string;
  };
  projects: ProjectOption[];
};
