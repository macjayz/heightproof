import { Globe2 } from "lucide-react";
import type { Incident, IncidentStatus, Overview } from "../types";
import { IncidentPanel } from "./IncidentPanel";
import { Panel } from "./ui";

type IncidentFilters = { status: string; severity: string };

export function OverviewView(props: {
  overview: Overview | null;
  incidents: Incident[];
  incidentFilters: IncidentFilters;
  onIncidentFilterChange: (filters: IncidentFilters) => void;
  onIncidentStatusChange: (incidentId: string, status: IncidentStatus) => void;
}) {
  const { overview } = props;

  return (
    <>
      <section className="grid">
        <Panel title="Endpoint Discovery">
          <table>
            <thead>
              <tr>
                <th>Method</th>
                <th>Path</th>
                <th>Requests</th>
                <th>Latency</th>
                <th>Threat</th>
              </tr>
            </thead>
            <tbody>
              {(overview?.endpoints ?? []).map((endpoint) => (
                <tr key={`${endpoint.method}:${endpoint.path}`}>
                  <td>{endpoint.method}</td>
                  <td>{endpoint.path}</td>
                  <td>{endpoint.requests}</td>
                  <td>{Math.round(endpoint.latency ?? 0)}ms</td>
                  <td>{endpoint.max_threat_score}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Panel>

        <Panel title="IP Activity">
          <div className="ip-list">
            {(overview?.ips ?? []).map((entry) => (
              <div className="ip-row" key={entry.ip}>
                <Globe2 size={16} />
                <span>{entry.ip}</span>
                <strong>{entry.requests}</strong>
                <meter min="0" max="100" value={entry.max_threat_score} />
              </div>
            ))}
          </div>
        </Panel>
      </section>

      <IncidentPanel
        incidents={props.incidents}
        filters={props.incidentFilters}
        onFilterChange={props.onIncidentFilterChange}
        onStatusChange={props.onIncidentStatusChange}
      />
    </>
  );
}
