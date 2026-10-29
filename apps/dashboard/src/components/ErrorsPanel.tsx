import { Panel } from "./ui";
import type { ErrorGroup } from "../types";

export function ErrorsPanel(props: { errorGroups: ErrorGroup[] }) {
  return (
    <Panel title="Errors">
      <div className="request-table">
        <table>
          <thead>
            <tr>
              <th>Type</th>
              <th>Message</th>
              <th>Endpoint</th>
              <th>Occurrences</th>
              <th>Affected IPs</th>
              <th>First seen</th>
              <th>Last seen</th>
            </tr>
          </thead>
          <tbody>
            {props.errorGroups.map((group) => (
              <tr key={group.id}>
                <td>
                  <span className="status-badge open">{group.error_type}</span>
                </td>
                <td>{group.message}</td>
                <td>{group.affected_endpoint ?? "N/A"}</td>
                <td>{group.occurrences.toLocaleString()}</td>
                <td>{group.affected_ips.length}</td>
                <td>{new Date(group.first_seen_at).toLocaleDateString()}</td>
                <td>{new Date(group.last_seen_at).toLocaleString()}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {props.errorGroups.length === 0 && <p className="empty-state">No errors captured yet.</p>}
    </Panel>
  );
}
