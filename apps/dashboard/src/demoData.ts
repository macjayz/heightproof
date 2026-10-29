import type {
  Overview,
  Incident,
  Readiness,
  SystemMetrics,
  RequestRecord,
  RequestFilters,
  ApiKeyRecord,
  AlertDestination,
  AlertDelivery,
  AlertRule,
  ErrorGroup
} from "./types";

export const demoOverview: Overview = {
  totals: {
    events: 12842,
    openIncidents: 4,
    averageLatencyMs: 92
  },
  endpoints: [
    {
      method: "POST",
      path: "/api/login",
      requests: 2384,
      latency: 86,
      max_threat_score: 92
    },
    {
      method: "POST",
      path: "/graphql",
      requests: 1840,
      latency: 132,
      max_threat_score: 61
    },
    {
      method: "POST",
      path: "/rpc",
      requests: 956,
      latency: 74,
      max_threat_score: 76
    },
    {
      method: "GET",
      path: "/api/users/:id",
      requests: 4412,
      latency: 44,
      max_threat_score: 28
    }
  ],
  ips: [
    { ip: "203.0.113.14", requests: 942, max_threat_score: 92 },
    { ip: "198.51.100.22", requests: 518, max_threat_score: 76 },
    { ip: "192.0.2.41", requests: 304, max_threat_score: 54 },
    { ip: "198.51.100.80", requests: 88, max_threat_score: 18 }
  ]
};

export const demoIncidents: Incident[] = [
  {
    id: "SC-1932",
    severity: "critical",
    title: "Potential credential stuffing on POST /api/login",
    description:
      "Authentication failures and single-IP request volume exceeded heuristic thresholds.",
    affected_endpoint: "POST /api/login",
    attacker_ips: ["203.0.113.14", "203.0.113.15", "203.0.113.16"],
    request_count: 35,
    status: "open",
    started_at: new Date(Date.now() - 1000 * 60 * 8).toISOString(),
    last_seen_at: new Date().toISOString(),
    created_at: new Date().toISOString()
  },
  {
    id: "SC-1933",
    severity: "high",
    title: "Sensitive EVM RPC activity on POST /rpc",
    description: "Repeated eth_sendRawTransaction requests returned authorization failures.",
    affected_endpoint: "POST /rpc",
    attacker_ips: ["198.51.100.22"],
    request_count: 9,
    status: "open",
    started_at: new Date(Date.now() - 1000 * 60 * 12).toISOString(),
    last_seen_at: new Date(Date.now() - 1000 * 60 * 7).toISOString(),
    created_at: new Date(Date.now() - 1000 * 60 * 7).toISOString()
  }
];

export const demoReadiness: Readiness = {
  status: "degraded",
  checks: {
    database: { ok: false, latencyMs: -1 },
    queue: { ok: false, latencyMs: -1, depth: -1 }
  }
};

export const demoSystemMetrics: SystemMetrics = {
  uptimeSeconds: 0,
  totalRequests: 0,
  ingestionRate: 138,
  ingestionBatches: 4,
  failedJobs: 0,
  queueDepth: 0,
  databaseLatencyMs: -1,
  processingLatencyMs: 0,
  websocketConnections: 0
};

export const demoRequests: RequestRecord[] = [
  {
    id: "req-1",
    trace_id: "0123456789abcdef0123456789abcdef",
    timestamp: new Date().toISOString(),
    service_name: "demo-api",
    environment: "demo",
    kind: "rest",
    method: "POST",
    path: "/api/login",
    route: "/api/login",
    ip: "203.0.113.14",
    user_agent: "curl/8.0",
    status_code: 401,
    latency_ms: 82,
    auth_present: true,
    auth_failed: true,
    threat_score: 92,
    threat_severity: "critical"
  },
  {
    id: "req-2",
    trace_id: "1123456789abcdef0123456789abcdef",
    timestamp: new Date(Date.now() - 1000 * 45).toISOString(),
    service_name: "demo-api",
    environment: "demo",
    kind: "evm_rpc",
    method: "POST",
    path: "/rpc",
    route: "/rpc",
    ip: "198.51.100.22",
    status_code: 401,
    latency_ms: 76,
    auth_present: true,
    auth_failed: true,
    evm_rpc_method: "eth_sendRawTransaction",
    evm_chain_id: "1",
    evm_provider: "alchemy",
    wallet_address: "0x742d35Cc6634C0532925a3b844Bc454e4438f44e",
    threat_score: 76,
    threat_severity: "high"
  },
  {
    id: "req-3",
    trace_id: "2123456789abcdef0123456789abcdef",
    timestamp: new Date(Date.now() - 1000 * 90).toISOString(),
    service_name: "demo-api",
    environment: "demo",
    kind: "graphql",
    method: "POST",
    path: "/graphql",
    route: "/graphql",
    ip: "192.0.2.41",
    status_code: 500,
    latency_ms: 184,
    auth_present: true,
    auth_failed: false,
    graphql_operation_name: "UpdateProfile",
    graphql_operation_type: "mutation",
    threat_score: 61,
    threat_severity: "high"
  },
  {
    id: "req-4",
    trace_id: "3123456789abcdef0123456789abcdef",
    timestamp: new Date(Date.now() - 1000 * 120).toISOString(),
    service_name: "demo-api",
    environment: "demo",
    kind: "rest",
    method: "GET",
    path: "/api/users/283",
    route: "/api/users/:id",
    ip: "198.51.100.80",
    status_code: 200,
    latency_ms: 44,
    auth_present: true,
    auth_failed: false,
    threat_score: 18,
    threat_severity: "low"
  }
];

export const demoApiKeys: ApiKeyRecord[] = [
  {
    id: "demo-key-primary",
    name: "Production SDK",
    prefix: "heightproof_prod",
    created_at: new Date(Date.now() - 1000 * 60 * 60 * 24 * 4).toISOString(),
    last_used_at: new Date(Date.now() - 1000 * 60 * 11).toISOString(),
    revoked_at: null
  },
  {
    id: "demo-key-ci",
    name: "CI Smoke Tests",
    prefix: "heightproof_ci",
    created_at: new Date(Date.now() - 1000 * 60 * 60 * 24 * 18).toISOString(),
    last_used_at: null,
    revoked_at: null
  }
];

export const demoAlertDestinations: AlertDestination[] = [
  {
    id: "demo-alert-soc",
    name: "Security Operations",
    url: "https://alerts.example.com/heightproof",
    enabled: true,
    created_at: new Date(Date.now() - 1000 * 60 * 60 * 24 * 5).toISOString(),
    updated_at: new Date(Date.now() - 1000 * 60 * 60 * 24 * 5).toISOString()
  },
  {
    id: "demo-alert-pager",
    name: "PagerDuty Intake",
    url: "https://events.example.com/v2/enqueue",
    enabled: false,
    created_at: new Date(Date.now() - 1000 * 60 * 60 * 24 * 12).toISOString(),
    updated_at: new Date(Date.now() - 1000 * 60 * 60 * 12).toISOString()
  }
];

export const demoAlertDeliveries: AlertDelivery[] = [
  {
    id: "delivery-1",
    incident_id: "SC-1932",
    destination_id: "demo-alert-soc",
    destination_name: "Security Operations",
    status: "queued",
    attempts: 0,
    created_at: new Date(Date.now() - 1000 * 60 * 6).toISOString(),
    delivered_at: null
  }
];

export const demoAlertRules: AlertRule[] = [
  {
    id: "demo-rule-error-rate",
    metric: "error_rate_percent",
    threshold: 5,
    window_minutes: 5,
    enabled: true,
    created_at: new Date(Date.now() - 1000 * 60 * 60 * 24).toISOString()
  },
  {
    id: "demo-rule-p95-latency",
    metric: "p95_latency_ms",
    threshold: 1000,
    window_minutes: 5,
    enabled: true,
    created_at: new Date(Date.now() - 1000 * 60 * 60 * 24).toISOString()
  }
];

export const demoErrorGroups: ErrorGroup[] = [
  {
    id: "demo-error-1",
    error_type: "TypeError",
    message: "Cannot read property 'email' of undefined",
    affected_endpoint: "POST /api/users/:id",
    occurrences: 8923,
    affected_ips: ["203.0.113.14", "203.0.113.22", "198.51.100.9"],
    first_seen_at: new Date(Date.now() - 1000 * 60 * 60 * 24 * 15).toISOString(),
    last_seen_at: new Date(Date.now() - 1000 * 60 * 4).toISOString()
  }
];

export const checkoutOverview: Overview = {
  totals: {
    events: 6421,
    openIncidents: 2,
    averageLatencyMs: 118
  },
  endpoints: [
    {
      method: "POST",
      path: "/api/checkout",
      requests: 1704,
      latency: 124,
      max_threat_score: 68
    },
    {
      method: "POST",
      path: "/api/payment-intents",
      requests: 1388,
      latency: 142,
      max_threat_score: 73
    },
    {
      method: "GET",
      path: "/api/orders/:id",
      requests: 2384,
      latency: 52,
      max_threat_score: 34
    }
  ],
  ips: [
    { ip: "203.0.113.88", requests: 402, max_threat_score: 73 },
    { ip: "198.51.100.44", requests: 318, max_threat_score: 68 },
    { ip: "192.0.2.18", requests: 121, max_threat_score: 24 }
  ]
};

export const checkoutIncidents: Incident[] = [
  {
    id: "SC-2210",
    severity: "high",
    title: "Payment authorization failures on POST /api/payment-intents",
    description: "A concentrated source triggered repeated payment failures within a short window.",
    affected_endpoint: "POST /api/payment-intents",
    attacker_ips: ["203.0.113.88"],
    request_count: 18,
    status: "open",
    started_at: new Date(Date.now() - 1000 * 60 * 16).toISOString(),
    last_seen_at: new Date(Date.now() - 1000 * 60 * 3).toISOString(),
    created_at: new Date(Date.now() - 1000 * 60 * 12).toISOString()
  }
];

export const checkoutRequests: RequestRecord[] = [
  {
    id: "checkout-1",
    trace_id: "4123456789abcdef0123456789abcdef",
    timestamp: new Date().toISOString(),
    service_name: "checkout-api",
    environment: "demo",
    kind: "rest",
    method: "POST",
    path: "/api/payment-intents",
    route: "/api/payment-intents",
    ip: "203.0.113.88",
    status_code: 402,
    latency_ms: 142,
    auth_present: true,
    auth_failed: false,
    threat_score: 73,
    threat_severity: "high"
  },
  {
    id: "checkout-2",
    trace_id: "5123456789abcdef0123456789abcdef",
    timestamp: new Date(Date.now() - 1000 * 36).toISOString(),
    service_name: "checkout-api",
    environment: "demo",
    kind: "rest",
    method: "POST",
    path: "/api/checkout",
    route: "/api/checkout",
    ip: "198.51.100.44",
    status_code: 429,
    latency_ms: 118,
    auth_present: true,
    auth_failed: false,
    threat_score: 68,
    threat_severity: "high"
  },
  {
    id: "checkout-3",
    trace_id: "6123456789abcdef0123456789abcdef",
    timestamp: new Date(Date.now() - 1000 * 78).toISOString(),
    service_name: "checkout-rpc",
    environment: "demo",
    kind: "evm_rpc",
    method: "POST",
    path: "/rpc",
    route: "/rpc",
    ip: "198.51.100.91",
    status_code: 200,
    latency_ms: 64,
    auth_present: true,
    auth_failed: false,
    evm_rpc_method: "eth_estimateGas",
    evm_chain_id: "1",
    evm_provider: "infura",
    contract_address: "0x0000000000000000000000000000000000000002",
    threat_score: 32,
    threat_severity: "medium"
  }
];

export const checkoutApiKeys: ApiKeyRecord[] = [
  {
    id: "checkout-key-web",
    name: "Checkout API SDK",
    prefix: "heightproof_pay",
    created_at: new Date(Date.now() - 1000 * 60 * 60 * 24 * 6).toISOString(),
    last_used_at: new Date(Date.now() - 1000 * 60 * 27).toISOString(),
    revoked_at: null
  }
];

export const checkoutAlertDestinations: AlertDestination[] = [
  {
    id: "checkout-alert-soc",
    name: "Checkout Security",
    url: "https://checkout.example.com/security-alerts",
    enabled: true,
    created_at: new Date(Date.now() - 1000 * 60 * 60 * 24 * 3).toISOString(),
    updated_at: new Date(Date.now() - 1000 * 60 * 60 * 24 * 3).toISOString()
  }
];

export const checkoutAlertDeliveries: AlertDelivery[] = [
  {
    id: "checkout-delivery-1",
    incident_id: "SC-2210",
    destination_id: "checkout-alert-soc",
    destination_name: "Checkout Security",
    status: "queued",
    attempts: 0,
    created_at: new Date(Date.now() - 1000 * 60 * 2).toISOString(),
    delivered_at: null
  }
];

export function getDemoProjectData(projectId: string) {
  if (projectId === "checkout") {
    return {
      overview: checkoutOverview,
      incidents: checkoutIncidents,
      requests: checkoutRequests,
      apiKeys: checkoutApiKeys,
      alertDestinations: checkoutAlertDestinations,
      alertDeliveries: checkoutAlertDeliveries,
      alertRules: demoAlertRules,
      errorGroups: demoErrorGroups
    };
  }

  return {
    overview: demoOverview,
    incidents: demoIncidents,
    requests: demoRequests,
    apiKeys: demoApiKeys,
    alertDestinations: demoAlertDestinations,
    alertDeliveries: demoAlertDeliveries,
    alertRules: demoAlertRules,
    errorGroups: demoErrorGroups
  };
}

export function createDemoApiKey(name: string): ApiKeyRecord {
  const suffix = Array.from(crypto.getRandomValues(new Uint8Array(6)))
    .map((value) => value.toString(16).padStart(2, "0"))
    .join("");

  return {
    id: `demo-key-${suffix}`,
    name,
    prefix: `heightproof_${suffix.slice(0, 8)}`,
    key: `heightproof_demo_${suffix}`,
    created_at: new Date().toISOString(),
    last_used_at: null,
    revoked_at: null
  };
}

export function createDemoAlertDestination(form: { name: string; url: string }): AlertDestination {
  const suffix = Array.from(crypto.getRandomValues(new Uint8Array(4)))
    .map((value) => value.toString(16).padStart(2, "0"))
    .join("");

  return {
    id: `demo-alert-${suffix}`,
    name: form.name,
    url: form.url,
    enabled: true,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString()
  };
}

export function filterDemoRequests(requests: RequestRecord[], filters: RequestFilters) {
  return requests.filter((request) => {
    if (filters.method && request.method !== filters.method) return false;
    if (filters.status && request.status_code !== Number(filters.status)) return false;
    if (filters.ip && request.ip !== filters.ip) return false;
    if (filters.threatMin && request.threat_score < Number(filters.threatMin)) return false;
    if (filters.query) {
      const haystack = `${request.path} ${request.route ?? ""}`.toLowerCase();
      return haystack.includes(filters.query.toLowerCase());
    }
    return true;
  });
}
