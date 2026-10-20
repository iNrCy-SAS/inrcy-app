import { createBrowserClient } from "@supabase/ssr";
import type { SupabaseClient } from "@supabase/supabase-js";

type BrowserSupabaseClient = SupabaseClient;

let browserClient: BrowserSupabaseClient | null = null;
const AUTH_USER_PATH = "/auth/v1/user";
let authUserRequest: Promise<Response> | null = null;
let invalidSessionHandled = false;
let invalidSessionGeneration = 0;

function getRequestUrl(input: RequestInfo | URL) {
  if (typeof input === "string") return input;
  if (input instanceof URL) return input.toString();
  return input.url;
}

function isAuthUserRequest(input: RequestInfo | URL) {
  try {
    return new URL(getRequestUrl(input), "http://localhost").pathname === AUTH_USER_PATH;
  } catch {
    return false;
  }
}

function getRequestMethod(input: RequestInfo | URL, init?: RequestInit) {
  if (init?.method) return init.method.toUpperCase();
  if (typeof Request !== "undefined" && input instanceof Request) {
    return input.method.toUpperCase();
  }
  return "GET";
}

function handleInvalidBrowserSession() {
  if (invalidSessionHandled || typeof window === "undefined") return;
  invalidSessionHandled = true;
  const generation = ++invalidSessionGeneration;

  // getUser/updateUser hold the Auth lock until this fetch returns. Calling
  // signOut inside that response chain waits for the same lock and deadlocks.
  // A new task lets Auth finish first; a newer successful response cancels it.
  setTimeout(() => {
    if (generation !== invalidSessionGeneration) return;
    void (async () => {
      try {
        await browserClient?.auth.signOut({ scope: "local" });
      } catch {
        // The proxy also clears invalid cookies on the next navigation.
      }
      if (generation === invalidSessionGeneration) {
        window.dispatchEvent(new CustomEvent("inrcy:auth-session-invalid"));
      }
    })();
  }, 0);
}

export async function guardedFetch(input: RequestInfo | URL, init?: RequestInit) {
  if (!isAuthUserRequest(input)) return fetch(input, init);

  // A dashboard render may mount many hooks at once. Supabase getUser() calls are
  // identical, so coalesce them into one request instead of producing a 403 storm.
  const shouldCoalesce = getRequestMethod(input, init) === "GET";
  if (shouldCoalesce && authUserRequest) return (await authUserRequest).clone();

  const request = fetch(input, init)
    .then((response) => {
      if (response.ok) {
        invalidSessionHandled = false;
        invalidSessionGeneration += 1;
      }
      else if (response.status === 401 || response.status === 403) {
        handleInvalidBrowserSession();
      }
      return response;
    })
    .finally(() => {
      if (shouldCoalesce && authUserRequest === request) authUserRequest = null;
    });

  if (shouldCoalesce) {
    authUserRequest = request;
    return (await request).clone();
  }
  return request;
}

export function createClient() {
  if (browserClient) return browserClient;

  browserClient = createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      auth: {
        detectSessionInUrl: true,
        persistSession: true,
        autoRefreshToken: true,
      },
      global: { fetch: guardedFetch },
    },
  );

  return browserClient;
}
