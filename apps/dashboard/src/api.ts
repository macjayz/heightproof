// An empty VITE_HEIGHTPROOF_API_URL means the API is proxied on the dashboard's own origin
// (infra/dashboard.prod.Dockerfile); unset keeps the local-dev default.
const configuredApiUrl = import.meta.env.VITE_HEIGHTPROOF_API_URL;
export const apiBase = configuredApiUrl === "" ? window.location.origin : (configuredApiUrl ?? "http://localhost:8080");

export const demoMode = import.meta.env.VITE_HEIGHTPROOF_DEMO_MODE === "true";

// Kept in sync with App's `sessionToken` state through setApiSessionToken. apiFetch is a
// standalone function (not a hook), so it reads the current token from here rather than from props.
let currentSessionToken: string | null = null;

export function setApiSessionToken(token: string | null) {
  currentSessionToken = token;
}

export async function apiFetch(path: string, projectId: string, init: RequestInit = {}) {
  const url = new URL(path, apiBase);
  if (!url.searchParams.has("projectId")) url.searchParams.set("projectId", projectId);

  return fetch(url, {
    ...init,
    headers: {
      ...(init.body ? { "content-type": "application/json" } : {}),
      ...(currentSessionToken ? { authorization: `Bearer ${currentSessionToken}` } : {}),
      ...init.headers
    }
  });
}

export type ApiOutcome =
  | { kind: "ok"; response: Response }
  | { kind: "rejected"; response: Response; message: string }
  | { kind: "unreachable" };

// Distinguishes a genuinely unreachable API (network error, Docker down — safe to fall back to
// offline demo mode) from a reachable API that rejected the request (must surface the real error
// rather than silently pretending the action succeeded).
export async function submitToApi(request: () => Promise<Response>): Promise<ApiOutcome> {
  let response: Response;
  try {
    response = await request();
  } catch {
    return { kind: "unreachable" };
  }

  if (!response.ok) {
    return { kind: "rejected", response, message: await readErrorMessage(response) };
  }

  return { kind: "ok", response };
}

export async function readErrorMessage(response: Response): Promise<string> {
  try {
    const body = (await response.json()) as {
      error?: string;
      details?: { fieldErrors?: Record<string, string[]> };
    };
    const fieldMessage = Object.values(body.details?.fieldErrors ?? {})
      .flat()
      .find(Boolean);
    if (fieldMessage) return fieldMessage;
    if (body.error) return body.error.replace(/_/g, " ");
  } catch {
    // Response body wasn't JSON — fall through to the generic message below.
  }
  return `Request failed (${response.status}).`;
}
