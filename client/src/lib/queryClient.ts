import { QueryClient, QueryFunction } from "@tanstack/react-query";

export const API_BASE = "";

export function getAuthHeader(): Record<string, string> {
  const token = localStorage.getItem("access_token") || sessionStorage.getItem("access_token");
  if (token) return { Authorization: `Bearer ${token}` };
  return {};
}

async function throwIfResNotOk(res: Response) {
  if (!res.ok) {
    let message = res.statusText;
    try { const text = await res.text(); if (text) message = text; } catch {}
    throw new Error(message);
  }
}

let isRefreshing = false;
let refreshPromise: Promise<string | null> | null = null;

export async function refreshAccessToken(): Promise<string | null> {
  if (isRefreshing && refreshPromise) return refreshPromise;
  isRefreshing = true;
  refreshPromise = (async () => {
    // Determine which storage is active
    const store = localStorage.getItem("access_token") ? localStorage : sessionStorage;
    try {
      const res = await fetch(`/api/auth/refresh`, { method: "POST", credentials: "include", headers: { "Content-Type": "application/json" } });
      if (!res.ok) { store.removeItem("access_token"); store.removeItem("refresh_token"); window.location.href = "/auth"; return null; }
      const data = await res.json();
      if (data.success && (data.accessToken || data.access_token)) { const token = data.accessToken || data.access_token; store.setItem("access_token", token); return token; }
      return null;
    } catch {
      store.removeItem("access_token");
      const isOnAuthPage = window.location.pathname.startsWith("/auth") || window.location.pathname === "/";
      if (!isOnAuthPage) window.location.href = "/auth";
      return null;
    }
    finally { isRefreshing = false; refreshPromise = null; }
  })();
  return refreshPromise;
}

export async function apiRequest(url: string, options?: { method?: string; data?: unknown; headers?: Record<string, string> }): Promise<Response> {
  const method = options?.method || "GET";
  const data = options?.data;
  const headers: Record<string, string> = { ...getAuthHeader(), ...options?.headers, ...(data ? { "Content-Type": "application/json" } : {}) };
  let res = await fetch(`${API_BASE}${url}`, { method, headers, body: data ? JSON.stringify(data) : undefined, credentials: "include" });
  if (res.status === 401) {
    const newToken = await refreshAccessToken();
    if (newToken) { headers["Authorization"] = `Bearer ${newToken}`; res = await fetch(`${API_BASE}${url}`, { method, headers, body: data ? JSON.stringify(data) : undefined, credentials: "include" }); }
  }
  if (!res.ok) { let message = res.statusText; try { const text = await res.text(); if (text) message = text; } catch {} throw new Error(message); }
  return res;
}

export async function uploadWithAuth(url: string, formData: FormData): Promise<Response> {
  const token = localStorage.getItem("access_token");
  const headers: Record<string, string> = token ? { Authorization: `Bearer ${token}` } : {};
  let res = await fetch(`${API_BASE}${url}`, { method: "POST", body: formData, headers, credentials: "include" });
  if (res.status === 401) { const newToken = await refreshAccessToken(); if (newToken) { res = await fetch(`${API_BASE}${url}`, { method: "POST", body: formData, headers: { Authorization: `Bearer ${newToken}` }, credentials: "include" }); } }
  if (!res.ok) { const text = await res.text().catch(() => res.statusText); throw new Error(text); }
  return res;
}

type UnauthorizedBehavior = "returnNull" | "throw";

export const getQueryFn: <T>(options: { on401: UnauthorizedBehavior }) => QueryFunction<T> =
  ({ on401 }) => async ({ queryKey }) => {
    const headers: Record<string, string> = { ...getAuthHeader() };
    let res = await fetch(`${API_BASE}${queryKey[0]}`, { credentials: "include", headers });
    if (res.status === 401) {
      const newToken = await refreshAccessToken();
      if (newToken) { headers["Authorization"] = `Bearer ${newToken}`; res = await fetch(`${API_BASE}${queryKey[0]}`, { credentials: "include", headers }); }
      if (on401 === "returnNull" && res.status === 401) return null;
    }
    await throwIfResNotOk(res);
    const json = await res.json();
    if (json && typeof json === "object" && !Array.isArray(json)) {
      if (Array.isArray(json.results)) return json.results;
      if (Array.isArray(json.data))    return json.data;
      if (Array.isArray(json.items))   return json.items;
    }
    return json;
  };

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: { queryFn: getQueryFn({ on401: "throw" }), refetchInterval: false, refetchOnWindowFocus: false, staleTime: 5 * 60 * 1000, retry: false },
    mutations: { retry: false },
  },
});

export function ensureArray<T = any>(data: unknown): T[] {
  if (Array.isArray(data)) return data as T[];
  if (data && typeof data === "object") {
    const d = data as Record<string, unknown>;
    if (Array.isArray(d.results)) return d.results as T[];
    if (Array.isArray(d.data))    return d.data    as T[];
    if (Array.isArray(d.items))   return d.items   as T[];
  }
  return [];
}

export async function apiJson<T = any>(url: string, options?: Parameters<typeof apiRequest>[1]): Promise<T> {
  const res = await apiRequest(url, options);
  return res.json() as Promise<T>;
}