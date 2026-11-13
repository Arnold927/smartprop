import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef } from "react";
import type { User } from "@shared/schema";
import { refreshAccessToken } from "@/lib/queryClient";

// Access token lifetime must match server expiresIn ("4h")
const ACCESS_TOKEN_LIFETIME_MS           = 4 * 60 * 60 * 1000;
// Proactively refresh 5 minutes before expiry so the user never gets kicked out
const PROACTIVE_REFRESH_BEFORE_EXPIRY_MS = 5 * 60 * 1000;

/** Errors that say "try again" rather than "you are not signed in". */
class AuthTransientError extends Error {
  transient = true;
}
function isTransient(err: unknown): boolean {
  return !!err && (err as any).transient === true;
}

export function useAuth() {
  const token = localStorage.getItem("access_token") || sessionStorage.getItem("access_token");
  const refreshTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Schedule a silent token refresh before the access token expires.
  // This keeps the session alive even when the tab is idle for hours.
  useEffect(() => {
    if (!token) return;

    const scheduleRefresh = () => {
      if (refreshTimerRef.current) clearTimeout(refreshTimerRef.current);
      const delay = ACCESS_TOKEN_LIFETIME_MS - PROACTIVE_REFRESH_BEFORE_EXPIRY_MS;
      refreshTimerRef.current = setTimeout(async () => {
        await refreshAccessToken();
        scheduleRefresh(); // reschedule so it keeps running
      }, delay);
    };

    scheduleRefresh();

    return () => {
      if (refreshTimerRef.current) clearTimeout(refreshTimerRef.current);
    };
  }, [token]);

  const {
    data: authResponse,
    isLoading: queryLoading,
    error,
    refetch,
  } = useQuery<{ success: boolean; user: User }>({
    queryKey: ["/api/auth/user"],
    queryFn: async () => {
      // Always read the latest token from storage (may have been refreshed)
      const currentToken = localStorage.getItem("access_token") || sessionStorage.getItem("access_token");
      if (!currentToken) throw new Error("No token found");

      let res: Response;
      try {
        res = await fetch("/api/auth/user", {
          headers: {
            Authorization: `Bearer ${currentToken}`,
            "Content-Type": "application/json",
          },
          credentials: "include",
        });
      } catch {
        // Offline / dropped connection: not a sign-out.
        throw new AuthTransientError("Network error");
      }

      if (res.status === 401) {
        const newToken = await refreshAccessToken();
        if (newToken) {
          res = await fetch("/api/auth/user", {
            headers: {
              Authorization: `Bearer ${newToken}`,
              "Content-Type": "application/json",
            },
            credentials: "include",
          });
        }
      }

      if (res.status === 429 || res.status >= 500) {
        throw new AuthTransientError(`HTTP ${res.status}`);
      }
      if (!res.ok) throw new Error(`HTTP ${res.status}`);

      const data = await res.json();
      if (!data.success || !data.user) throw new Error("Invalid authentication response");
      return data;
    },
    enabled: !!token,
    // Retry only "try again" failures (network, 429, 5xx) with backoff, so a
    // brief blip on mobile data does not look like being signed out.
    retry: (failureCount, err) => isTransient(err) && failureCount < 3,
    retryDelay: (attempt) => Math.min(1000 * 2 ** attempt, 6000),
    staleTime: ACCESS_TOKEN_LIFETIME_MS, // cache for full token lifetime — no unnecessary re-fetches
    refetchOnWindowFocus: false,         // switching tabs no longer triggers a re-auth check
    refetchOnMount: true,
  });

  const user = authResponse?.user;
  const isAuthenticated = !!user && !error;
  const isLoading = !!token && queryLoading;

  // Token present but the server could not be reached or is busy: show a
  // "reconnecting" state, never the public landing page.
  const isTransientError = !!token && !user && isTransient(error);

  return { user, isLoading, isAuthenticated, error, refetch, isTransientError };
}

export function useLogout() {
  const queryClient = useQueryClient();

  return async () => {
    try {
      await fetch("/api/auth/logout", { method: "POST", credentials: "include" });
    } catch {}
    localStorage.removeItem("access_token");
    localStorage.removeItem("refresh_token");
    sessionStorage.removeItem("access_token");
    sessionStorage.removeItem("refresh_token");
    queryClient.clear();
    // The service worker caches GET /api/* responses. Drop them so the next
    // person on a shared phone can never be served this user's data offline.
    try {
      if ("caches" in window) {
        const keys = await caches.keys();
        await Promise.all(keys.filter(k => k.startsWith("smartprop-api")).map(k => caches.delete(k)));
      }
    } catch {}
    window.location.href = "/auth";
  };
}