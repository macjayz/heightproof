import type { AlertRuleMetric } from "./types";

export function formatLatency(value: number) {
  return value < 0 ? "N/A" : `${value}ms`;
}

export function formatCount(value: number) {
  return value < 0 ? "N/A" : value;
}

export function alertRuleMetricLabel(metric: AlertRuleMetric): string {
  switch (metric) {
    case "error_rate_percent":
      return "Error rate";
    case "p95_latency_ms":
      return "p95 latency";
    case "max_threat_score":
      return "Threat score";
    case "request_count":
      return "Request volume";
    case "auth_failure_count":
      return "Authentication failures";
    default:
      return metric;
  }
}

export function formatAlertRuleThreshold(metric: AlertRuleMetric, threshold: number): string {
  switch (metric) {
    case "error_rate_percent":
      return `> ${threshold}%`;
    case "p95_latency_ms":
      return `> ${threshold}ms`;
    default:
      return `> ${threshold}`;
  }
}

export function formatIps(ips?: string[]) {
  if (!ips || ips.length === 0) return "No source IP";
  if (ips.length === 1) return ips[0];
  return `${ips.length} source IPs`;
}

export function shortTrace(traceId?: string) {
  return traceId ? traceId.slice(0, 8) : "N/A";
}

export function shortAddress(address?: string) {
  return address ? `${address.slice(0, 6)}...${address.slice(-4)}` : "N/A";
}
