import React, { useState } from "react";
import { Filter, RefreshCcw, Search } from "lucide-react";
import { Panel } from "./ui";
import { shortTrace } from "../format";
import type { RequestRecord, RequestFilters } from "../types";

export function RequestExplorer(props: {
  filters: RequestFilters;
  requests: RequestRecord[];
  onChange: (filters: RequestFilters) => void;
  onRefresh: () => void;
}) {
  const [selectedRequestId, setSelectedRequestId] = useState<string | null>(null);
  const selectedRequest =
    props.requests.find((request) => request.id === selectedRequestId) ?? null;

  const setFilter = (key: keyof RequestFilters, value: string) => {
    props.onChange({ ...props.filters, [key]: value });
  };

  return (
    <Panel title="Request Explorer">
      <div className="filters">
        <label>
          <Search size={15} />
          <input
            value={props.filters.query}
            onChange={(event) => setFilter("query", event.target.value)}
            placeholder="Path or route"
          />
        </label>
        <label>
          <Filter size={15} />
          <select
            value={props.filters.method}
            onChange={(event) => setFilter("method", event.target.value)}
          >
            <option value="">All methods</option>
            <option value="GET">GET</option>
            <option value="POST">POST</option>
            <option value="PUT">PUT</option>
            <option value="PATCH">PATCH</option>
            <option value="DELETE">DELETE</option>
          </select>
        </label>
        <input
          value={props.filters.status}
          inputMode="numeric"
          onChange={(event) => setFilter("status", event.target.value)}
          placeholder="Status"
        />
        <input
          value={props.filters.ip}
          onChange={(event) => setFilter("ip", event.target.value)}
          placeholder="IP address"
        />
        <input
          value={props.filters.threatMin}
          inputMode="numeric"
          onChange={(event) => setFilter("threatMin", event.target.value)}
          placeholder="Min threat"
        />
        <button className="icon-button" onClick={props.onRefresh} title="Refresh request data">
          <RefreshCcw size={16} />
        </button>
      </div>

      <div className="request-table">
        <table>
          <thead>
            <tr>
              <th>Time</th>
              <th>Method</th>
              <th>Route</th>
              <th>Status</th>
              <th>Latency</th>
              <th>IP</th>
              <th>Kind</th>
              <th>Trace</th>
              <th>Threat</th>
            </tr>
          </thead>
          <tbody>
            {props.requests.map((request) => (
              <tr
                key={request.id}
                className="request-row"
                onClick={() => setSelectedRequestId(request.id)}
              >
                <td>{new Date(request.timestamp).toLocaleTimeString()}</td>
                <td>{request.method}</td>
                <td>
                  <strong>{request.route ?? request.path}</strong>
                  <span>
                    {request.evm_rpc_method ??
                      request.graphql_operation_name ??
                      request.service_name}
                  </span>
                </td>
                <td>
                  <span className={`status-code s${Math.floor(request.status_code / 100)}xx`}>
                    {request.status_code}
                  </span>
                </td>
                <td>{request.latency_ms}ms</td>
                <td>{request.ip ?? "N/A"}</td>
                <td>{request.kind}</td>
                <td>{shortTrace(request.trace_id)}</td>
                <td>
                  <meter min="0" max="100" value={request.threat_score} />
                  <span>{request.threat_score}</span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {selectedRequest && (
        <RequestDetail request={selectedRequest} onClose={() => setSelectedRequestId(null)} />
      )}
    </Panel>
  );
}

export function RequestDetail(props: { request: RequestRecord; onClose: () => void }) {
  const r = props.request;
  const fields: Array<[string, string | number | undefined | null]> = [
    ["Request ID", r.id],
    ["Trace ID", r.trace_id],
    ["Parent Span ID", r.parent_span_id],
    ["Timestamp", new Date(r.timestamp).toLocaleString()],
    ["Service", r.service_name],
    ["Environment", r.environment],
    ["Kind", r.kind],
    ["Method", r.method],
    ["Path", r.path],
    ["Route", r.route],
    ["IP", r.ip],
    ["User Agent", r.user_agent],
    ["Status Code", r.status_code],
    ["Latency", `${r.latency_ms}ms`],
    ["Body Bytes", r.body_bytes],
    ["Auth Present", r.auth_present ? "Yes" : "No"],
    ["Auth Failed", r.auth_failed ? "Yes" : "No"],
    ["GraphQL Operation", r.graphql_operation_name],
    ["GraphQL Operation Type", r.graphql_operation_type],
    ["EVM RPC Method", r.evm_rpc_method],
    ["EVM Chain ID", r.evm_chain_id],
    ["EVM Provider", r.evm_provider],
    ["Wallet Address", r.wallet_address],
    ["Contract Address", r.contract_address],
    ["Threat Score", r.threat_score],
    ["Threat Severity", r.threat_severity]
  ];

  return (
    <div className="detail-overlay" onClick={props.onClose}>
      <div className="detail-panel" onClick={(event) => event.stopPropagation()}>
        <header>
          <h3>
            {r.method} {r.route ?? r.path}
          </h3>
          <button className="dismiss-button" onClick={props.onClose}>
            Close
          </button>
        </header>
        <dl>
          {fields
            .filter(([, value]) => value !== undefined && value !== null && value !== "")
            .map(([label, value]) => (
              <React.Fragment key={label}>
                <dt>{label}</dt>
                <dd>{value}</dd>
              </React.Fragment>
            ))}
        </dl>
      </div>
    </div>
  );
}
