import { KeyRound, XCircle } from "lucide-react";
import type { ApiKeyRecord } from "../types";

export function Notices(props: {
  actionError: string | null;
  onDismissError: () => void;
  onboardingKey: ApiKeyRecord | null;
  onDismissOnboardingKey: () => void;
}) {
  return (
    <>
      {props.actionError && (
        <div className="action-error" role="alert">
          <XCircle size={16} />
          <span>{props.actionError}</span>
          <button className="dismiss-button" onClick={props.onDismissError} title="Dismiss">
            Dismiss
          </button>
        </div>
      )}

      {props.onboardingKey?.key && (
        <div className="action-success" role="status">
          <KeyRound size={16} />
          <span>
            Your first SDK key is ready. Copy it now; Heightproof will not show the secret again.
          </span>
          <code>{props.onboardingKey.key}</code>
          <button className="dismiss-button" onClick={props.onDismissOnboardingKey} title="Dismiss">
            Dismiss
          </button>
        </div>
      )}
    </>
  );
}
