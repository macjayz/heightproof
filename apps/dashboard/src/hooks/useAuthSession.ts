import { useEffect, useState } from "react";
import { apiBase, readErrorMessage, setApiSessionToken } from "../api";
import type { ApiKeyRecord, AuthSession } from "../types";

/**
 * Dashboard sign-in state: restores a stored session on load, and handles sign-in, sign-up and
 * sign-out. Project selection stays with the caller, which is told which project to show after
 * signing in.
 */
export function useAuthSession(options: {
  selectedProjectId: string;
  onProjectSelected: (projectId: string) => void;
  onSignupApiKey: (apiKey: ApiKeyRecord) => void;
}) {
  const [session, setSession] = useState<AuthSession | null>(null);
  const [sessionToken, setSessionToken] = useState<string | null>(() =>
    window.localStorage.getItem("heightproof.dashboard.token")
  );
  const [initializing, setInitializing] = useState(true);
  const [authMode, setAuthMode] = useState<"signin" | "signup">("signin");
  const [authForm, setAuthForm] = useState({ email: "owner@heightproof.local", password: "" });
  const [signupForm, setSignupForm] = useState({
    email: "",
    password: "",
    organizationName: "",
    projectName: ""
  });
  const [onboardingKey, setOnboardingKey] = useState<ApiKeyRecord | null>(null);
  const [authError, setAuthError] = useState<string | null>(null);
  const [authSubmitting, setAuthSubmitting] = useState(false);

  useEffect(() => {
    setApiSessionToken(sessionToken);
  }, [sessionToken]);

  useEffect(() => {
    if (!sessionToken) {
      setInitializing(false);
      return;
    }

    (async () => {
      try {
        const response = await fetch(new URL("/v1/auth/session", apiBase), {
          headers: { authorization: `Bearer ${sessionToken}` }
        });
        if (!response.ok) throw new Error("invalid_session");
        setSession((await response.json()) as AuthSession);
      } catch {
        window.localStorage.removeItem("heightproof.dashboard.token");
        setApiSessionToken(null);
        setSessionToken(null);
      } finally {
        setInitializing(false);
      }
    })();
  }, []);

  async function login() {
    setAuthError(null);
    setAuthSubmitting(true);
    try {
      const response = await fetch(new URL("/v1/auth/login", apiBase), {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(authForm)
      });

      if (!response.ok) {
        setAuthError(await readErrorMessage(response));
        return;
      }

      const data = (await response.json()) as AuthSession & { token: string };
      window.localStorage.setItem("heightproof.dashboard.token", data.token);
      setApiSessionToken(data.token);
      setSessionToken(data.token);
      setSession({ user: data.user, organization: data.organization, projects: data.projects });
      const projectId = data.projects.some((project) => project.id === options.selectedProjectId)
        ? options.selectedProjectId
        : (data.projects[0]?.id ?? "demo");
      window.localStorage.setItem("heightproof.dashboard.project", projectId);
      options.onProjectSelected(projectId);
    } catch {
      setAuthError(
        "Could not reach the Heightproof API. Confirm the API is running and reachable."
      );
    } finally {
      setAuthSubmitting(false);
    }
  }

  async function signup() {
    setAuthError(null);
    setAuthSubmitting(true);
    try {
      const response = await fetch(new URL("/v1/auth/signup", apiBase), {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(signupForm)
      });

      if (!response.ok) {
        setAuthError(await readErrorMessage(response));
        return;
      }

      const data = (await response.json()) as AuthSession & { token: string; apiKey: ApiKeyRecord };
      const projectId = data.projects[0]?.id ?? "demo";
      window.localStorage.setItem("heightproof.dashboard.token", data.token);
      window.localStorage.setItem("heightproof.dashboard.project", projectId);
      setApiSessionToken(data.token);
      setSessionToken(data.token);
      setSession({ user: data.user, organization: data.organization, projects: data.projects });
      options.onProjectSelected(projectId);
      setOnboardingKey(data.apiKey);
      options.onSignupApiKey(data.apiKey);
    } catch {
      setAuthError(
        "Could not reach the Heightproof API. Confirm the API is running and reachable."
      );
    } finally {
      setAuthSubmitting(false);
    }
  }

  async function logout() {
    const token = sessionToken;
    window.localStorage.removeItem("heightproof.dashboard.token");
    setApiSessionToken(null);
    setSessionToken(null);
    setSession(null);

    if (token) {
      try {
        await fetch(new URL("/v1/auth/logout", apiBase), {
          method: "POST",
          headers: { authorization: `Bearer ${token}` }
        });
      } catch {
        // Best-effort — the local session is already cleared either way.
      }
    }
  }

  return {
    session,
    sessionToken,
    initializing,
    authMode,
    setAuthMode,
    authForm,
    setAuthForm,
    signupForm,
    setSignupForm,
    authError,
    authSubmitting,
    onboardingKey,
    setOnboardingKey,
    login,
    signup,
    logout
  };
}
