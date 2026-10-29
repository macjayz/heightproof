import type { DashboardView } from "./types";

export function getInitialView(): DashboardView {
  const view = new URLSearchParams(window.location.search).get("view");
  return view === "requests" ||
    view === "incidents" ||
    view === "errors" ||
    view === "api-keys" ||
    view === "alerts" ||
    view === "rpc"
    ? view
    : "overview";
}

export function getHeader(view: DashboardView) {
  if (view === "requests") {
    return {
      title: "Request Explorer",
      subtitle: "Filter recent REST, GraphQL, and EVM JSON-RPC events by risk and behavior."
    };
  }

  if (view === "incidents") {
    return {
      title: "Incidents",
      subtitle: "Review grouped security events and their current severity."
    };
  }

  if (view === "errors") {
    return {
      title: "Errors",
      subtitle: "Application errors grouped by type, message, and endpoint."
    };
  }

  if (view === "api-keys") {
    return {
      title: "API Keys",
      subtitle: "Create and revoke project-scoped SDK credentials."
    };
  }

  if (view === "alerts") {
    return {
      title: "Alerts",
      subtitle: "Manage webhook destinations and delivery records for high-severity incidents."
    };
  }

  if (view === "rpc") {
    return {
      title: "EVM RPC",
      subtitle: "Inspect wallet, provider, chain, latency, and error patterns from JSON-RPC calls."
    };
  }

  return {
    title: "Security Overview",
    subtitle: "REST, GraphQL, and EVM JSON-RPC telemetry from monitored services."
  };
}
