import { Building2, KeyRound, Plus, ShieldCheck } from "lucide-react";

export function AuthScreen(props: {
  mode: "signin" | "signup";
  form: { email: string; password: string };
  signupForm: { email: string; password: string; organizationName: string; projectName: string };
  onModeChange: (mode: "signin" | "signup") => void;
  onChange: (form: { email: string; password: string }) => void;
  onSignupChange: (form: {
    email: string;
    password: string;
    organizationName: string;
    projectName: string;
  }) => void;
  onSubmit: () => void;
  onSignup: () => void;
  error: string | null;
  submitting: boolean;
}) {
  const isSignup = props.mode === "signup";
  const activeForm = isSignup ? props.signupForm : props.form;
  const canSubmit =
    activeForm.email.length > 0 &&
    activeForm.password.length > 0 &&
    (!isSignup ||
      (props.signupForm.organizationName.length > 0 && props.signupForm.projectName.length > 0)) &&
    !props.submitting;
  const title = isSignup ? "Create your Heightproof account" : "Sign in to Heightproof";
  const submitLabel = isSignup ? "Create account" : "Sign in";

  return (
    <main className="auth-shell">
      <section className="auth-panel">
        <div className="brand auth-brand">
          <ShieldCheck size={30} />
          <div>
            <strong>Heightproof</strong>
            <span>API Security</span>
          </div>
        </div>
        <div>
          <h1>{title}</h1>
          <p>Access project-scoped API telemetry, incidents, keys, and alerts.</p>
        </div>
        <div className="auth-tabs" role="tablist" aria-label="Authentication mode">
          <button
            className={props.mode === "signin" ? "active" : ""}
            type="button"
            onClick={() => props.onModeChange("signin")}
          >
            Sign in
          </button>
          <button
            className={props.mode === "signup" ? "active" : ""}
            type="button"
            onClick={() => props.onModeChange("signup")}
          >
            Create account
          </button>
        </div>
        <form
          className="auth-form"
          onSubmit={(event) => {
            event.preventDefault();
            if (canSubmit) {
              if (isSignup) props.onSignup();
              else props.onSubmit();
            }
          }}
        >
          {props.error && (
            <p className="auth-error" role="alert">
              {props.error}
            </p>
          )}
          <label>
            Email
            <input
              type="email"
              value={activeForm.email}
              onChange={(event) => {
                if (isSignup)
                  props.onSignupChange({ ...props.signupForm, email: event.target.value });
                else props.onChange({ ...props.form, email: event.target.value });
              }}
              placeholder="owner@heightproof.local"
            />
          </label>
          <label>
            Password
            <input
              type="password"
              value={activeForm.password}
              onChange={(event) => {
                if (isSignup)
                  props.onSignupChange({ ...props.signupForm, password: event.target.value });
                else props.onChange({ ...props.form, password: event.target.value });
              }}
              placeholder="Enter your password"
            />
          </label>
          {isSignup && (
            <>
              <label>
                Organization
                <input
                  type="text"
                  value={props.signupForm.organizationName}
                  onChange={(event) =>
                    props.onSignupChange({
                      ...props.signupForm,
                      organizationName: event.target.value
                    })
                  }
                  placeholder="Acme Security"
                />
              </label>
              <label>
                Project
                <input
                  type="text"
                  value={props.signupForm.projectName}
                  onChange={(event) =>
                    props.onSignupChange({ ...props.signupForm, projectName: event.target.value })
                  }
                  placeholder="Production API"
                />
              </label>
            </>
          )}
          <button disabled={!canSubmit}>
            {isSignup ? <Plus size={16} /> : <KeyRound size={16} />}
            {props.submitting ? "Working..." : submitLabel}
          </button>
        </form>
      </section>

      <aside className="auth-context">
        <span>
          <Building2 size={18} />
        </span>
        <div>
          <strong>{isSignup ? "Isolated workspace" : "Project isolation"}</strong>
          <p>
            {isSignup
              ? "A new organization, project, owner role, and first SDK key are created for your account."
              : "Users only see projects where they have an explicit membership and role."}
          </p>
        </div>
      </aside>
    </main>
  );
}
