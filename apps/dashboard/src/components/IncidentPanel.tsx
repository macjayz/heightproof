import { CheckCircle2, ShieldCheck, XCircle } from "lucide-react";
import { Panel } from "./ui";
import { formatIps } from "../format";
import type { Incident, IncidentStatus } from "../types";

export function IncidentPanel(props: {
  incidents: Incident[];
  filters: { status: string; severity: string };
  onFilterChange: (filters: { status: string; severity: string }) => void;
  onStatusChange: (incidentId: string, status: IncidentStatus) => void;
}) {
  const incidents = props.incidents.filter((incident) => {
    if (props.filters.status && incident.status !== props.filters.status) return false;
    if (props.filters.severity && incident.severity !== props.filters.severity) return false;
    return true;
  });

  return (
    <Panel title="Incidents">
      <div className="incident-toolbar">
        <label>
          Status
          <select
            value={props.filters.status}
            onChange={(event) =>
              props.onFilterChange({ ...props.filters, status: event.target.value })
            }
          >
            <option value="">All statuses</option>
            <option value="open">Open</option>
            <option value="acknowledged">Acknowledged</option>
            <option value="resolved">Resolved</option>
            <option value="ignored">Ignored</option>
          </select>
        </label>
        <label>
          Severity
          <select
            value={props.filters.severity}
            onChange={(event) =>
              props.onFilterChange({ ...props.filters, severity: event.target.value })
            }
          >
            <option value="">All severities</option>
            <option value="critical">Critical</option>
            <option value="high">High</option>
            <option value="medium">Medium</option>
            <option value="low">Low</option>
          </select>
        </label>
      </div>
      <div className="incident-list">
        {incidents.map((incident) => (
          <article className="incident" key={incident.id}>
            <div className="incident-badges">
              <span className={`severity ${incident.severity}`}>{incident.severity}</span>
              <span className={`status-badge ${incident.status}`}>{incident.status}</span>
            </div>
            <div>
              <strong>{incident.title}</strong>
              <p>{incident.description}</p>
              <div className="incident-meta">
                <span>{incident.affected_endpoint ?? "Endpoint pending"}</span>
                <span>{incident.request_count ?? 1} requests</span>
                <span>{formatIps(incident.attacker_ips)}</span>
              </div>
              <div className="incident-actions">
                <button
                  className="secondary-action"
                  onClick={() => props.onStatusChange(incident.id, "acknowledged")}
                  disabled={incident.status === "acknowledged"}
                >
                  <CheckCircle2 size={15} />
                  Acknowledge
                </button>
                <button
                  className="secondary-action"
                  onClick={() => props.onStatusChange(incident.id, "resolved")}
                  disabled={incident.status === "resolved"}
                >
                  <ShieldCheck size={15} />
                  Resolve
                </button>
                <button
                  className="danger-button"
                  onClick={() => props.onStatusChange(incident.id, "ignored")}
                  disabled={incident.status === "ignored"}
                >
                  <XCircle size={15} />
                  Ignore
                </button>
                {incident.status !== "open" && (
                  <button
                    className="secondary-action"
                    onClick={() => props.onStatusChange(incident.id, "open")}
                  >
                    Reopen
                  </button>
                )}
              </div>
            </div>
            <time>{new Date(incident.last_seen_at ?? incident.created_at).toLocaleString()}</time>
          </article>
        ))}
        {incidents.length === 0 && (
          <p className="empty-state">No incidents match the current filters.</p>
        )}
      </div>
    </Panel>
  );
}
