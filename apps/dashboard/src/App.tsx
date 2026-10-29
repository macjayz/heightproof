import { useEffect, useMemo, useState } from "react";
import { apiBase, demoMode, apiFetch, submitToApi } from "./api";
import { AlertsPanel } from "./components/AlertsPanel";
import { ApiKeyPanel } from "./components/ApiKeyPanel";
import { AuthScreen } from "./components/AuthScreen";
import { ErrorsPanel } from "./components/ErrorsPanel";
import { IncidentPanel } from "./components/IncidentPanel";
import { RequestExplorer } from "./components/RequestExplorer";
import { RpcPanel } from "./components/RpcPanel";
import {
  getDemoProjectData,
  createDemoApiKey,
  createDemoAlertDestination,
  demoReadiness,
  demoSystemMetrics,
  demoRequests,
  demoApiKeys,
  demoAlertDestinations,
  demoAlertDeliveries,
  demoAlertRules,
  demoErrorGroups,
  filterDemoRequests
} from "./demoData";
import { getInitialView, getHeader } from "./navigation";
import type {
  Overview,
  Incident,
  IncidentStatus,
  Readiness,
  SystemMetrics,
  RequestRecord,
  RequestFilters,
  ApiKeyRecord,
  AlertDestination,
  AlertDelivery,
  AlertRuleMetric,
  AlertRule,
  ErrorGroup,
  DashboardView
} from "./types";
import { Notices } from "./components/Notices";
import { OverviewView } from "./components/OverviewView";
import { Sidebar } from "./components/Sidebar";
import { SystemSummary } from "./components/SystemSummary";
import { Topbar } from "./components/Topbar";
import { useAuthSession } from "./hooks/useAuthSession";

export function App() {
  const [activeView, setActiveView] = useState<DashboardView>(getInitialView());
  const [selectedProjectId, setSelectedProjectId] = useState(
    () => window.localStorage.getItem("heightproof.dashboard.project") ?? "demo"
  );
  const auth = useAuthSession({
    selectedProjectId,
    onProjectSelected: setSelectedProjectId,
    onSignupApiKey: (apiKey) => setNewKeySecret(apiKey.key ?? "")
  });
  const { session, sessionToken, initializing, onboardingKey, setOnboardingKey } = auth;
  const [overview, setOverview] = useState<Overview | null>(null);
  const [incidents, setIncidents] = useState<Incident[]>([]);
  const [requests, setRequests] = useState<RequestRecord[]>(demoRequests);
  const [apiKeys, setApiKeys] = useState<ApiKeyRecord[]>(demoApiKeys);
  const [alertDestinations, setAlertDestinations] =
    useState<AlertDestination[]>(demoAlertDestinations);
  const [alertDeliveries, setAlertDeliveries] = useState<AlertDelivery[]>(demoAlertDeliveries);
  const [alertRules, setAlertRules] = useState<AlertRule[]>(demoAlertRules);
  const [errorGroups, setErrorGroups] = useState<ErrorGroup[]>(demoErrorGroups);
  const [newDestination, setNewDestination] = useState({
    name: "Security Operations",
    url: "https://alerts.example.com/heightproof"
  });
  const [newRule, setNewRule] = useState<{
    metric: AlertRuleMetric;
    threshold: string;
    windowMinutes: string;
  }>({
    metric: "error_rate_percent",
    threshold: "5",
    windowMinutes: "5"
  });
  const [incidentFilters, setIncidentFilters] = useState({ status: "open", severity: "" });
  const [newKeyName, setNewKeyName] = useState("Production SDK");
  const [newKeySecret, setNewKeySecret] = useState("");
  const [requestFilters, setRequestFilters] = useState<RequestFilters>({
    method: "",
    status: "",
    threatMin: "",
    ip: "",
    query: ""
  });
  const [readiness, setReadiness] = useState<Readiness>(demoReadiness);
  const [systemMetrics, setSystemMetrics] = useState<SystemMetrics>(demoSystemMetrics);
  const [liveStatus, setLiveStatus] = useState("Connecting");
  const [actionError, setActionError] = useState<string | null>(null);

  useEffect(() => {
    if (!session) return;

    async function load() {
      try {
        const [
          overviewResponse,
          incidentResponse,
          readinessResponse,
          systemResponse,
          apiKeysResponse,
          alertDestinationsResponse,
          alertDeliveriesResponse,
          alertRulesResponse,
          errorGroupsResponse
        ] = await Promise.all([
          apiFetch("/v1/analytics/overview", selectedProjectId),
          apiFetch("/v1/analytics/incidents", selectedProjectId),
          fetch(`${apiBase}/ready`),
          apiFetch("/v1/analytics/system", selectedProjectId),
          apiFetch("/v1/api-keys", selectedProjectId),
          apiFetch("/v1/alert-destinations", selectedProjectId),
          apiFetch("/v1/alert-deliveries", selectedProjectId),
          apiFetch("/v1/alert-rules", selectedProjectId),
          apiFetch("/v1/errors", selectedProjectId)
        ]);

        if (
          !overviewResponse.ok ||
          !incidentResponse.ok ||
          // /ready answers 503 with a full body when degraded; that is data to show, not an outage.
          (!readinessResponse.ok && readinessResponse.status !== 503) ||
          !systemResponse.ok ||
          !apiKeysResponse.ok ||
          !alertDestinationsResponse.ok ||
          !alertDeliveriesResponse.ok ||
          !alertRulesResponse.ok ||
          !errorGroupsResponse.ok
        ) {
          throw new Error("analytics_unavailable");
        }

        setOverview(await overviewResponse.json());
        setIncidents(await incidentResponse.json());
        setReadiness(await readinessResponse.json());
        setSystemMetrics(await systemResponse.json());
        setApiKeys(await apiKeysResponse.json());
        setAlertDestinations(await alertDestinationsResponse.json());
        setAlertDeliveries(await alertDeliveriesResponse.json());
        setAlertRules(await alertRulesResponse.json());
        setErrorGroups(await errorGroupsResponse.json());
        await loadRequests();
      } catch {
        if (!demoMode) {
          setActionError("Could not load project telemetry from the Heightproof API.");
          return;
        }

        const demoData = getDemoProjectData(selectedProjectId);
        setOverview(demoData.overview);
        setIncidents(demoData.incidents);
        setReadiness(demoReadiness);
        setSystemMetrics(demoSystemMetrics);
        setRequests(filterDemoRequests(demoData.requests, requestFilters));
        setApiKeys(demoData.apiKeys);
        setAlertDestinations(demoData.alertDestinations);
        setAlertDeliveries(demoData.alertDeliveries);
        setAlertRules(demoData.alertRules);
        setErrorGroups(demoData.errorGroups);
      }
    }

    void load();
    const interval = window.setInterval(() => void load(), 15000);
    return () => window.clearInterval(interval);
  }, [activeView, session, requestFilters, selectedProjectId]);

  async function createDashboardApiKey() {
    setActionError(null);
    const outcome = await submitToApi(() =>
      apiFetch("/v1/api-keys", selectedProjectId, {
        method: "POST",
        body: JSON.stringify({ name: newKeyName })
      })
    );

    if (outcome.kind === "unreachable" && demoMode) {
      const key = createDemoApiKey(newKeyName);
      setApiKeys((current) => [key, ...current]);
      setNewKeySecret(key.key ?? "");
      return;
    }
    if (outcome.kind === "unreachable") {
      setActionError("Could not reach the Heightproof API.");
      return;
    }
    if (outcome.kind === "rejected") {
      setActionError(outcome.message);
      return;
    }

    const key = (await outcome.response.json()) as ApiKeyRecord;
    setApiKeys((current) => [key, ...current]);
    setNewKeySecret(key.key ?? "");
  }

  async function revokeDashboardApiKey(keyId: string) {
    setActionError(null);
    const outcome = await submitToApi(() =>
      apiFetch(`/v1/api-keys/${keyId}`, selectedProjectId, { method: "DELETE" })
    );

    if (outcome.kind === "rejected") {
      setActionError(outcome.message);
      return;
    }

    if (outcome.kind === "unreachable" && !demoMode) {
      setActionError("Could not reach the Heightproof API.");
      return;
    }

    // Demo mode applies the change locally so offline demos stay usable.
    setApiKeys((current) =>
      current.map((key) =>
        key.id === keyId ? { ...key, revoked_at: new Date().toISOString() } : key
      )
    );
  }

  async function updateDashboardIncidentStatus(incidentId: string, status: IncidentStatus) {
    setActionError(null);
    const outcome = await submitToApi(() =>
      apiFetch(`/v1/incidents/${incidentId}/status`, selectedProjectId, {
        method: "PATCH",
        body: JSON.stringify({ status })
      })
    );

    if (outcome.kind === "rejected") {
      setActionError(outcome.message);
      return;
    }
    if (outcome.kind === "unreachable" && demoMode) {
      setIncidents((current) =>
        current.map((entry) =>
          entry.id === incidentId
            ? { ...entry, status, updated_at: new Date().toISOString() }
            : entry
        )
      );
      return;
    }
    if (outcome.kind === "unreachable") {
      setActionError("Could not reach the Heightproof API.");
      return;
    }

    const incident = (await outcome.response.json()) as Incident;
    setIncidents((current) => current.map((entry) => (entry.id === incidentId ? incident : entry)));
  }

  async function createDashboardAlertDestination() {
    setActionError(null);
    const outcome = await submitToApi(() =>
      apiFetch("/v1/alert-destinations", selectedProjectId, {
        method: "POST",
        body: JSON.stringify(newDestination)
      })
    );

    if (outcome.kind === "unreachable" && demoMode) {
      setAlertDestinations((current) => [createDemoAlertDestination(newDestination), ...current]);
      return;
    }
    if (outcome.kind === "unreachable") {
      setActionError("Could not reach the Heightproof API.");
      return;
    }
    if (outcome.kind === "rejected") {
      setActionError(outcome.message);
      return;
    }

    const destination = (await outcome.response.json()) as AlertDestination;
    setAlertDestinations((current) => [destination, ...current]);
  }

  async function setDashboardAlertDestinationStatus(destinationId: string, enabled: boolean) {
    setActionError(null);
    const outcome = await submitToApi(() =>
      apiFetch(`/v1/alert-destinations/${destinationId}`, selectedProjectId, {
        method: "PATCH",
        body: JSON.stringify({ enabled })
      })
    );

    if (outcome.kind === "rejected") {
      setActionError(outcome.message);
      return;
    }
    if (outcome.kind === "unreachable" && demoMode) {
      setAlertDestinations((current) =>
        current.map((entry) =>
          entry.id === destinationId
            ? { ...entry, enabled, updated_at: new Date().toISOString() }
            : entry
        )
      );
      return;
    }
    if (outcome.kind === "unreachable") {
      setActionError("Could not reach the Heightproof API.");
      return;
    }

    const destination = (await outcome.response.json()) as AlertDestination;
    setAlertDestinations((current) =>
      current.map((entry) => (entry.id === destinationId ? destination : entry))
    );
  }

  async function createDashboardAlertRule() {
    setActionError(null);
    const threshold = Number(newRule.threshold);
    const windowMinutes = Number(newRule.windowMinutes);
    const outcome = await submitToApi(() =>
      apiFetch("/v1/alert-rules", selectedProjectId, {
        method: "POST",
        body: JSON.stringify({ metric: newRule.metric, threshold, windowMinutes })
      })
    );

    if (outcome.kind === "unreachable" && demoMode) {
      setAlertRules((current) => [
        {
          id: `demo-rule-${Date.now()}`,
          metric: newRule.metric,
          threshold,
          window_minutes: windowMinutes,
          enabled: true,
          created_at: new Date().toISOString()
        },
        ...current
      ]);
      return;
    }
    if (outcome.kind === "unreachable") {
      setActionError("Could not reach the Heightproof API.");
      return;
    }
    if (outcome.kind === "rejected") {
      setActionError(outcome.message);
      return;
    }

    const rule = (await outcome.response.json()) as AlertRule;
    setAlertRules((current) => [rule, ...current]);
  }

  async function setDashboardAlertRuleStatus(ruleId: string, enabled: boolean) {
    setActionError(null);
    const outcome = await submitToApi(() =>
      apiFetch(`/v1/alert-rules/${ruleId}`, selectedProjectId, {
        method: "PATCH",
        body: JSON.stringify({ enabled })
      })
    );

    if (outcome.kind === "rejected") {
      setActionError(outcome.message);
      return;
    }
    if (outcome.kind === "unreachable" && demoMode) {
      setAlertRules((current) =>
        current.map((entry) =>
          entry.id === ruleId ? { ...entry, enabled, updated_at: new Date().toISOString() } : entry
        )
      );
      return;
    }
    if (outcome.kind === "unreachable") {
      setActionError("Could not reach the Heightproof API.");
      return;
    }

    const rule = (await outcome.response.json()) as AlertRule;
    setAlertRules((current) => current.map((entry) => (entry.id === ruleId ? rule : entry)));
  }

  async function loadRequests() {
    const params = new URLSearchParams();
    if (requestFilters.method) params.set("method", requestFilters.method);
    if (requestFilters.status) params.set("status", requestFilters.status);
    if (requestFilters.threatMin) params.set("threatMin", requestFilters.threatMin);
    if (requestFilters.ip) params.set("ip", requestFilters.ip);
    if (requestFilters.query) params.set("q", requestFilters.query);
    if (activeView === "rpc") params.set("kind", "evm_rpc");
    params.set("limit", "50");

    const response = await apiFetch(
      `/v1/analytics/requests?${params.toString()}`,
      selectedProjectId
    );
    if (!response.ok) throw new Error("requests_unavailable");
    setRequests(await response.json());
  }

  useEffect(() => {
    if (!session) return;

    const liveUrl = new URL("/live", apiBase.replace(/^http/, "ws"));
    liveUrl.searchParams.set("projectId", selectedProjectId);
    if (sessionToken) liveUrl.searchParams.set("token", sessionToken);
    const socket = new WebSocket(liveUrl);

    socket.addEventListener("open", () => setLiveStatus("Live"));
    socket.addEventListener("close", () => setLiveStatus("Offline"));
    socket.addEventListener("message", () => setLiveStatus("Event received"));

    return () => socket.close();
  }, [selectedProjectId, session, sessionToken]);

  const maxThreatScore = useMemo(() => {
    const endpointScores = overview?.endpoints.map((endpoint) => endpoint.max_threat_score) ?? [];
    const ipScores = overview?.ips.map((ip) => ip.max_threat_score) ?? [];
    return Math.max(0, ...endpointScores, ...ipScores);
  }, [overview]);
  const header = getHeader(activeView);

  if (initializing) {
    return (
      <main className="auth-shell">
        <p>Loading...</p>
      </main>
    );
  }

  if (!session) {
    return (
      <AuthScreen
        mode={auth.authMode}
        form={auth.authForm}
        signupForm={auth.signupForm}
        onModeChange={auth.setAuthMode}
        onChange={auth.setAuthForm}
        onSignupChange={auth.setSignupForm}
        onSubmit={() => void auth.login()}
        onSignup={() => void auth.signup()}
        error={auth.authError}
        submitting={auth.authSubmitting}
      />
    );
  }

  const selectedProject =
    session.projects.find((project) => project.id === selectedProjectId) ?? session.projects[0];

  return (
    <main className="shell">
      <Sidebar
        activeView={activeView}
        onNavigate={changeView}
        email={session.user.email}
        role={selectedProject?.role ?? "viewer"}
      />

      <section className="workspace">
        <Topbar
          title={header.title}
          subtitle={header.subtitle}
          projects={session.projects}
          selectedProjectId={selectedProjectId}
          onProjectChange={(projectId) => {
            window.localStorage.setItem("heightproof.dashboard.project", projectId);
            setSelectedProjectId(projectId);
          }}
          liveStatus={liveStatus}
          onLogout={() => void auth.logout()}
        />

        <Notices
          actionError={actionError}
          onDismissError={() => setActionError(null)}
          onboardingKey={onboardingKey}
          onDismissOnboardingKey={() => setOnboardingKey(null)}
        />

        <SystemSummary
          overview={overview}
          maxThreatScore={maxThreatScore}
          readiness={readiness}
          systemMetrics={systemMetrics}
        />

        {activeView === "overview" && (
          <OverviewView
            overview={overview}
            incidents={incidents}
            incidentFilters={incidentFilters}
            onIncidentFilterChange={setIncidentFilters}
            onIncidentStatusChange={(id, status) => void updateDashboardIncidentStatus(id, status)}
          />
        )}

        {activeView === "requests" && (
          <RequestExplorer
            filters={requestFilters}
            requests={requests}
            onChange={setRequestFilters}
            onRefresh={() =>
              void loadRequests().catch(() => {
                if (demoMode) {
                  setRequests(
                    filterDemoRequests(
                      getDemoProjectData(selectedProjectId).requests,
                      requestFilters
                    )
                  );
                  return;
                }
                setActionError("Could not refresh requests from the Heightproof API.");
              })
            }
          />
        )}

        {activeView === "incidents" && (
          <IncidentPanel
            incidents={incidents}
            filters={incidentFilters}
            onFilterChange={setIncidentFilters}
            onStatusChange={(id, status) => void updateDashboardIncidentStatus(id, status)}
          />
        )}

        {activeView === "errors" && <ErrorsPanel errorGroups={errorGroups} />}

        {activeView === "api-keys" && (
          <ApiKeyPanel
            apiKeys={apiKeys}
            keyName={newKeyName}
            keySecret={newKeySecret}
            selectedProject={selectedProject}
            onKeyNameChange={setNewKeyName}
            onCreate={() => void createDashboardApiKey()}
            onRevoke={(keyId) => void revokeDashboardApiKey(keyId)}
          />
        )}

        {activeView === "alerts" && (
          <AlertsPanel
            destinations={alertDestinations}
            deliveries={alertDeliveries}
            form={newDestination}
            onFormChange={setNewDestination}
            onCreate={() => void createDashboardAlertDestination()}
            onDestinationStatusChange={(id, enabled) =>
              void setDashboardAlertDestinationStatus(id, enabled)
            }
            rules={alertRules}
            ruleForm={newRule}
            onRuleFormChange={setNewRule}
            onRuleCreate={() => void createDashboardAlertRule()}
            onRuleStatusChange={(id, enabled) => void setDashboardAlertRuleStatus(id, enabled)}
          />
        )}

        {activeView === "rpc" && <RpcPanel requests={requests} />}
      </section>
    </main>
  );

  function changeView(view: DashboardView) {
    setActiveView(view);
    const url = new URL(window.location.href);
    url.searchParams.set("view", view);
    window.history.replaceState(null, "", url);
  }
}
