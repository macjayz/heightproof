import { Copy, Plus, Trash2 } from "lucide-react";
import { Panel } from "./ui";
import type { ApiKeyRecord, ProjectOption } from "../types";

export function ApiKeyPanel(props: {
  apiKeys: ApiKeyRecord[];
  keyName: string;
  keySecret: string;
  selectedProject: ProjectOption;
  onKeyNameChange: (name: string) => void;
  onCreate: () => void;
  onRevoke: (keyId: string) => void;
}) {
  return (
    <Panel title="API Key Management">
      <div className="key-layout">
        <section className="key-create">
          <div>
            <h3>Create project key</h3>
            <p>Generate a scoped SDK key for {props.selectedProject.name}.</p>
          </div>
          <label>
            Key name
            <input
              value={props.keyName}
              onChange={(event) => props.onKeyNameChange(event.target.value)}
            />
          </label>
          <button
            className="primary-action"
            onClick={props.onCreate}
            disabled={props.keyName.trim().length < 2}
          >
            <Plus size={16} />
            Create key
          </button>
          {props.keySecret && (
            <div className="key-secret">
              <span>New key</span>
              <code>{props.keySecret}</code>
              <button
                className="icon-button"
                onClick={() => void navigator.clipboard?.writeText(props.keySecret)}
                title="Copy new key"
              >
                <Copy size={16} />
              </button>
            </div>
          )}
        </section>

        <section className="sdk-snippet">
          <h3>SDK setup</h3>
          <pre>{`heightproofExpress({
  projectId: "${props.selectedProject.id}",
  apiKey: process.env.HEIGHTPROOF_API_KEY,
  endpoint: "http://localhost:8080"
});`}</pre>
        </section>
      </div>

      <div className="key-table">
        <table>
          <thead>
            <tr>
              <th>Name</th>
              <th>Prefix</th>
              <th>Status</th>
              <th>Last Used</th>
              <th>Created</th>
              <th>Action</th>
            </tr>
          </thead>
          <tbody>
            {props.apiKeys.map((key) => (
              <tr key={key.id}>
                <td>{key.name}</td>
                <td>
                  <code>{key.prefix}</code>
                </td>
                <td>{key.revoked_at ? "Revoked" : "Active"}</td>
                <td>{key.last_used_at ? new Date(key.last_used_at).toLocaleString() : "Never"}</td>
                <td>{new Date(key.created_at).toLocaleDateString()}</td>
                <td>
                  <button
                    className="danger-button"
                    onClick={() => props.onRevoke(key.id)}
                    disabled={Boolean(key.revoked_at)}
                    title="Revoke API key"
                  >
                    <Trash2 size={15} />
                    Revoke
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Panel>
  );
}
