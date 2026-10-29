import { ShieldCheck, User } from "lucide-react";
import type { DashboardView } from "../types";

const NAV_ITEMS: Array<{ view: DashboardView; label: string }> = [
  { view: "overview", label: "Overview" },
  { view: "requests", label: "Requests" },
  { view: "incidents", label: "Incidents" },
  { view: "errors", label: "Errors" },
  { view: "api-keys", label: "API Keys" },
  { view: "alerts", label: "Alerts" },
  { view: "rpc", label: "RPC" }
];

export function Sidebar(props: {
  activeView: DashboardView;
  onNavigate: (view: DashboardView) => void;
  email: string;
  role: string;
}) {
  return (
    <aside className="sidebar">
      <div className="brand">
        <ShieldCheck size={28} />
        <div>
          <strong>Heightproof</strong>
          <span>API Security</span>
        </div>
      </div>
      <nav>
        {NAV_ITEMS.map((item) => (
          <button
            key={item.view}
            className={props.activeView === item.view ? "active" : ""}
            onClick={() => props.onNavigate(item.view)}
          >
            {item.label}
          </button>
        ))}
      </nav>

      <div className="operator-card">
        <span>
          <User size={16} />
        </span>
        <div>
          <strong>{props.email}</strong>
          <p>{props.role}</p>
        </div>
      </div>
    </aside>
  );
}
