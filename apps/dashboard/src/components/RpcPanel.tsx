import { Activity, AlertTriangle, Clock } from "lucide-react";
import { Panel, StatusItem } from "./ui";
import { shortAddress } from "../format";
import type { RequestRecord } from "../types";

export function RpcPanel(props: { requests: RequestRecord[] }) {
  const rpcRequests = props.requests.filter((request) => request.kind === "evm_rpc");
  const slowest = Math.max(0, ...rpcRequests.map((request) => request.latency_ms));
  const failures = rpcRequests.filter((request) => request.status_code >= 400).length;

  return (
    <Panel title="EVM RPC Activity">
      <section className="rpc-summary">
        <StatusItem
          label="RPC Calls"
          value={rpcRequests.length}
          active
          icon={<Activity size={16} />}
        />
        <StatusItem
          label="Failures"
          value={failures}
          active={failures === 0}
          icon={<AlertTriangle size={16} />}
        />
        <StatusItem
          label="Slowest Call"
          value={`${slowest}ms`}
          active={slowest < 500}
          icon={<Clock size={16} />}
        />
      </section>
      <div className="request-table rpc-table">
        <table>
          <thead>
            <tr>
              <th>Time</th>
              <th>Method</th>
              <th>Chain</th>
              <th>Provider</th>
              <th>Status</th>
              <th>Latency</th>
              <th>Address</th>
              <th>Threat</th>
            </tr>
          </thead>
          <tbody>
            {rpcRequests.map((request) => (
              <tr key={request.id}>
                <td data-label="Time">{new Date(request.timestamp).toLocaleTimeString()}</td>
                <td data-label="Method">{request.evm_rpc_method ?? "unknown"}</td>
                <td data-label="Chain">{request.evm_chain_id ?? "N/A"}</td>
                <td data-label="Provider">{request.evm_provider ?? "N/A"}</td>
                <td data-label="Status">
                  <span className={`status-code s${Math.floor(request.status_code / 100)}xx`}>
                    {request.status_code}
                  </span>
                </td>
                <td data-label="Latency">{request.latency_ms}ms</td>
                <td data-label="Address">
                  {shortAddress(request.wallet_address ?? request.contract_address)}
                </td>
                <td data-label="Threat">{request.threat_score}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Panel>
  );
}
