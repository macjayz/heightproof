import { Activity, Bell, Gauge, Plus } from "lucide-react";
import { Panel, StatusItem } from "./ui";
import { alertRuleMetricLabel, formatAlertRuleThreshold } from "../format";
import type { AlertDestination, AlertDelivery, AlertRuleMetric, AlertRule } from "../types";

export function AlertsPanel(props: {
  destinations: AlertDestination[];
  deliveries: AlertDelivery[];
  form: { name: string; url: string };
  onFormChange: (form: { name: string; url: string }) => void;
  onCreate: () => void;
  onDestinationStatusChange: (destinationId: string, enabled: boolean) => void;
  rules: AlertRule[];
  ruleForm: { metric: AlertRuleMetric; threshold: string; windowMinutes: string };
  onRuleFormChange: (form: {
    metric: AlertRuleMetric;
    threshold: string;
    windowMinutes: string;
  }) => void;
  onRuleCreate: () => void;
  onRuleStatusChange: (ruleId: string, enabled: boolean) => void;
}) {
  const canCreate = props.form.name.trim().length > 1 && props.form.url.trim().length > 10;
  const canCreateRule =
    Number(props.ruleForm.threshold) > 0 && Number(props.ruleForm.windowMinutes) >= 1;

  return (
    <>
      <Panel title="Alert Destinations">
        <div className="alerts-layout">
          <section className="alert-create">
            <div>
              <h3>Webhook destination</h3>
              <p>Queue high and critical incident notifications for security response tooling.</p>
            </div>
            <label>
              Name
              <input
                value={props.form.name}
                onChange={(event) =>
                  props.onFormChange({ ...props.form, name: event.target.value })
                }
              />
            </label>
            <label>
              Webhook URL
              <input
                value={props.form.url}
                onChange={(event) => props.onFormChange({ ...props.form, url: event.target.value })}
              />
            </label>
            <button className="primary-action" onClick={props.onCreate} disabled={!canCreate}>
              <Plus size={16} />
              Add destination
            </button>
          </section>

          <section className="delivery-summary">
            <StatusItem
              label="Destinations"
              value={props.destinations.length}
              active={props.destinations.some((destination) => destination.enabled)}
              icon={<Bell size={16} />}
            />
            <StatusItem
              label="Queued Deliveries"
              value={props.deliveries.filter((delivery) => delivery.status === "queued").length}
              active
              icon={<Activity size={16} />}
            />
          </section>
        </div>

        <div className="destination-list">
          {props.destinations.map((destination) => (
            <article className="destination-row" key={destination.id}>
              <span
                className={
                  destination.enabled ? "destination-icon enabled" : "destination-icon disabled"
                }
              >
                <Bell size={16} />
              </span>
              <div>
                <strong>{destination.name}</strong>
                <p>{destination.url}</p>
              </div>
              <span className={`status-badge ${destination.enabled ? "open" : "ignored"}`}>
                {destination.enabled ? "enabled" : "disabled"}
              </span>
              <button
                className="secondary-action"
                onClick={() =>
                  props.onDestinationStatusChange(destination.id, !destination.enabled)
                }
              >
                {destination.enabled ? "Disable" : "Enable"}
              </button>
            </article>
          ))}
        </div>

        <div className="delivery-table">
          <h3>Recent deliveries</h3>
          <table>
            <thead>
              <tr>
                <th>Destination</th>
                <th>Status</th>
                <th>Attempts</th>
                <th>Created</th>
              </tr>
            </thead>
            <tbody>
              {props.deliveries.map((delivery) => (
                <tr key={delivery.id}>
                  <td>{delivery.destination_name}</td>
                  <td>{delivery.status}</td>
                  <td>{delivery.attempts}</td>
                  <td>{new Date(delivery.created_at).toLocaleString()}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {props.deliveries.length === 0 && (
            <p className="empty-state">No alert deliveries have been queued yet.</p>
          )}
        </div>
      </Panel>

      <Panel title="Alert Rules">
        <div className="alerts-layout">
          <section className="alert-create">
            <div>
              <h3>Threshold rule</h3>
              <p>Automatically raise an incident when a project-wide metric crosses a threshold.</p>
            </div>
            <label>
              Metric
              <select
                value={props.ruleForm.metric}
                onChange={(event) =>
                  props.onRuleFormChange({
                    ...props.ruleForm,
                    metric: event.target.value as AlertRuleMetric
                  })
                }
              >
                <option value="error_rate_percent">Error rate (%)</option>
                <option value="p95_latency_ms">p95 latency (ms)</option>
                <option value="max_threat_score">Threat score</option>
                <option value="request_count">Request volume</option>
                <option value="auth_failure_count">Authentication failures</option>
              </select>
            </label>
            <label>
              Threshold
              <input
                inputMode="decimal"
                value={props.ruleForm.threshold}
                onChange={(event) =>
                  props.onRuleFormChange({ ...props.ruleForm, threshold: event.target.value })
                }
              />
            </label>
            <label>
              Window (minutes)
              <input
                inputMode="numeric"
                value={props.ruleForm.windowMinutes}
                onChange={(event) =>
                  props.onRuleFormChange({ ...props.ruleForm, windowMinutes: event.target.value })
                }
              />
            </label>
            <button
              className="primary-action"
              onClick={props.onRuleCreate}
              disabled={!canCreateRule}
            >
              <Plus size={16} />
              Add rule
            </button>
          </section>

          <section className="delivery-summary">
            <StatusItem
              label="Rules"
              value={props.rules.length}
              active={props.rules.some((rule) => rule.enabled)}
              icon={<Gauge size={16} />}
            />
            <StatusItem
              label="Active Rules"
              value={props.rules.filter((rule) => rule.enabled).length}
              active
              icon={<Activity size={16} />}
            />
          </section>
        </div>

        <div className="destination-list">
          {props.rules.map((rule) => (
            <article className="destination-row" key={rule.id}>
              <span
                className={rule.enabled ? "destination-icon enabled" : "destination-icon disabled"}
              >
                <Gauge size={16} />
              </span>
              <div>
                <strong>{alertRuleMetricLabel(rule.metric)}</strong>
                <p>
                  Alerts when {formatAlertRuleThreshold(rule.metric, rule.threshold)} over{" "}
                  {rule.window_minutes} minute
                  {rule.window_minutes === 1 ? "" : "s"}
                </p>
              </div>
              <span className={`status-badge ${rule.enabled ? "open" : "ignored"}`}>
                {rule.enabled ? "enabled" : "disabled"}
              </span>
              <button
                className="secondary-action"
                onClick={() => props.onRuleStatusChange(rule.id, !rule.enabled)}
              >
                {rule.enabled ? "Disable" : "Enable"}
              </button>
            </article>
          ))}
        </div>
        {props.rules.length === 0 && <p className="empty-state">No alert rules configured yet.</p>}
      </Panel>
    </>
  );
}
