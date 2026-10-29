import { Building2, LogOut, Radio } from "lucide-react";
import type { ProjectOption } from "../types";

export function Topbar(props: {
  title: string;
  subtitle: string;
  projects: ProjectOption[];
  selectedProjectId: string;
  onProjectChange: (projectId: string) => void;
  liveStatus: string;
  onLogout: () => void;
}) {
  return (
    <header className="topbar">
      <div>
        <h1>{props.title}</h1>
        <p>{props.subtitle}</p>
      </div>
      <div className="topbar-actions">
        <label className="project-switcher">
          <Building2 size={16} />
          <select
            value={props.selectedProjectId}
            onChange={(event) => props.onProjectChange(event.target.value)}
          >
            {props.projects.map((project) => (
              <option key={project.id} value={project.id}>
                {project.name}
              </option>
            ))}
          </select>
        </label>
        <div className={`live-pill ${props.liveStatus.toLowerCase().replace(/\s+/g, "-")}`}>
          <Radio size={16} />
          {props.liveStatus}
        </div>
        <button className="icon-button" onClick={props.onLogout} title="Sign out">
          <LogOut size={16} />
        </button>
      </div>
    </header>
  );
}
