import { Activity, AlertTriangle, Clock, Database, Gauge, Radio, ShieldCheck } from "lucide-react";
import { formatCount, formatLatency } from "../format";
import type { Overview, Readiness, SystemMetrics } from "../types";
import { Metric, StatusItem } from "./ui";

export function SystemSummary(props: {
  overview: Overview | null;
  maxThreatScore: number;
  readiness: Readiness;
  systemMetrics: SystemMetrics;
}) {
  const { overview, maxThreatScore, readiness, systemMetrics } = props;

  return (
    <>
      <section className="metrics">
        <Metric label="Events" value={overview?.totals.events ?? 0} icon={<Activity size={18} />} />
        <Metric
          label="Open Incidents"
          value={overview?.totals.openIncidents ?? 0}
          icon={<AlertTriangle size={18} />}
        />
        <Metric
          label="Average Latency"
          value={`${overview?.totals.averageLatencyMs ?? 0}ms`}
          icon={<Clock size={18} />}
        />
        <Metric label="Max Threat Score" value={maxThreatScore} icon={<ShieldCheck size={18} />} />
      </section>

      <section className="system-strip">
        <StatusItem
          label="Readiness"
          value={readiness.status}
          active={readiness.status === "ready"}
          icon={<ShieldCheck size={16} />}
        />
        <StatusItem
          label="Database"
          value={formatLatency(readiness.checks.database.latencyMs)}
          active={readiness.checks.database.ok}
          icon={<Database size={16} />}
        />
        <StatusItem
          label="Queue Depth"
          value={formatCount(systemMetrics.queueDepth)}
          active={readiness.checks.queue.ok}
          icon={<Gauge size={16} />}
        />
        <StatusItem
          label="WebSockets"
          value={systemMetrics.websocketConnections}
          active={systemMetrics.websocketConnections >= 0}
          icon={<Radio size={16} />}
        />
        <StatusItem
          label="Failed Jobs"
          value={systemMetrics.failedJobs}
          active={systemMetrics.failedJobs === 0}
          icon={<AlertTriangle size={16} />}
        />
      </section>
    </>
  );
}
