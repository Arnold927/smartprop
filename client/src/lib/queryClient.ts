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
      if (!res.ok) {
        store.removeItem("access_token"); store.removeItem("refresh_token");
        // Previously redirected unconditionally, even when already on the
        // login or landing page — forcing a full reload there too, which
        // could repeat if the stale-token condition wasn't actually cleared
        // by the reload. Now matches the catch branch below.
        const isOnAuthPage = window.location.pathname.startsWith("/auth") || window.location.pathname === "/";
        if (!isOnAuthPage) window.location.href = "/auth";
        return null;
      }
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

// /api/tenants and /api/units are paginated (20 per page by default). Most pages
// read them as "the list of all tenants / units" (dropdowns, KPIs, arrears,
// leases, unit labels…), so a plain GET would silently stop at the first 20.
// For those exact URLs (optionally with ?organizationId= / ?propertyId=) we walk
// every page and hand back one merged response. Requests that pass their own
// page/limit/search params (e.g. the Property Manager dashboard) are untouched.
const ALL_PAGES_URL = /^\/api\/(tenants|units)(\?(organizationId|propertyId)=\d+)?$/;

// Very large organisations can have more rows than the hard stop above. Rather than
// silently showing a partial list, say so once per session and point at global
// search, which queries the whole organisation on the server.
const truncationWarned = new Set<string>();
function warnListTruncated(kind: string, shown: number) {
  if (truncationWarned.has(kind)) return;
  truncationWarned.add(kind);
  import("@/hooks/use-toast").then(({ toast }) => toast({
    title: `Showing the first ${shown.toLocaleString("en-KE")} ${kind}`,
    description: `This organisation has more ${kind} than lists and pickers can load at once. Use the search bar (Ctrl/Cmd + K) to find any ${kind === "tenants" ? "tenant" : "unit"}.`,
  })).catch(() => {});
}

async function apiRequestAllPages(url: string): Promise<Response> {
  const sep = url.includes("?") ? "&" : "?";
  // tenants take `limit` (max 100); units use the generic `page_size`
  const size = url.startsWith("/api/units") ? "page_size=500" : "limit=100";
  const json = (body: unknown) => new Response(JSON.stringify(body), { status: 200, headers: { "Content-Type": "application/json" } });
  const body = await (await apiRequest(`${url}${sep}${size}&page=1`)).json();
  if (!body || !Array.isArray(body.results) || !body.next) return json(body);
  const results: unknown[] = [...body.results];
  let more = true;
  for (let page = 2; page <= 50; page++) {   // hard stop at 50 pages (5,000 tenants / 25,000 units)
    const b = await (await apiRequest(`${url}${sep}${size}&page=${page}`)).json();
    if (!Array.isArray(b?.results) || b.results.length === 0) { more = false; break; }
    results.push(...b.results);
    if (!b.next) { more = false; break; }
  }
  if (more) warnListTruncated(url.startsWith("/api/units") ? "units" : "tenants", results.length);
  return json({ ...body, results, next: null, previous: null });
}

export async function apiRequest(url: string, options?: { method?: string; data?: unknown; headers?: Record<string, string> }): Promise<Response> {
  const method = options?.method || "GET";
  if (method === "GET" && ALL_PAGES_URL.test(url)) return apiRequestAllPages(url);
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
  // Use getAuthHeader() (checks both localStorage and sessionStorage) rather than
  // reading localStorage directly — the token lives in sessionStorage whenever the
  // user didn't check "Remember me" at login, which is the default, unchecked state.
  const headers: Record<string, string> = getAuthHeader();
  let res = await fetch(`${API_BASE}${url}`, { method: "POST", body: formData, headers, credentials: "include" });
  if (res.status === 401) { const newToken = await refreshAccessToken(); if (newToken) { res = await fetch(`${API_BASE}${url}`, { method: "POST", body: formData, headers: { Authorization: `Bearer ${newToken}` }, credentials: "include" }); } }
  if (!res.ok) { const text = await res.text().catch(() => res.statusText); throw new Error(text); }
  return res;
}

type UnauthorizedBehavior = "returnNull" | "throw";

export const getQueryFn: <T>(options: { on401: UnauthorizedBehavior }) => QueryFunction<T> =
  ({ on401 }) => async ({ queryKey }) => {
    if (typeof queryKey[0] === "string" && ALL_PAGES_URL.test(queryKey[0])) {
      const merged = await (await apiRequestAllPages(queryKey[0])).json();
      return Array.isArray(merged?.results) ? merged.results : merged;
    }
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