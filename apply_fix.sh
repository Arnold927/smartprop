#!/bin/bash
# Run from: ~/Downloads/smartprop_v11_fixed (3)/smartprop_fixed

echo "=== Current directory ==="
pwd

echo ""
echo "=== Writing queryClient.ts directly ==="
cat > "client/src/lib/queryClient.ts" << 'TSEOF'
import { QueryClient, QueryFunction } from "@tanstack/react-query";

export const API_BASE = "";

export function getAuthHeader(): Record<string, string> {
  const token = localStorage.getItem("access_token");
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
    try {
      const res = await fetch(`/api/auth/refresh`, { method: "POST", credentials: "include", headers: { "Content-Type": "application/json" } });
      if (!res.ok) { localStorage.removeItem("access_token"); localStorage.removeItem("refresh_token"); window.location.href = "/auth"; return null; }
      const data = await res.json();
      if (data.success && (data.accessToken || data.access_token)) { const token = data.accessToken || data.access_token; localStorage.setItem("access_token", token); return token; }
      return null;
    } catch { localStorage.removeItem("access_token"); window.location.href = "/auth"; return null; }
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
TSEOF
echo "  queryClient.ts written ($(wc -l < client/src/lib/queryClient.ts) lines)"

echo ""
echo "=== Rewriting comprehensive-tenant-modal.tsx ==="
# Use Python to surgically replace just the useQuery block
python3 << 'PYEOF'
import re, sys

path = "client/src/components/modals/comprehensive-tenant-modal.tsx"
with open(path, encoding="utf-8") as f:
    src = f.read()

# Print line count and line 284 so we can see what's actually there
lines = src.split("\n")
print(f"  File has {len(lines)} lines")
if len(lines) >= 284:
    print(f"  Line 284: {lines[283]}")

# The fix: replace the useQuery+properties derivation with a version
# that uses `select` to ALWAYS return an array no matter what hits the cache.
# We match from `const { data:` through the closing `});` of the useQuery.
pattern = re.compile(
    r'const \{ data: (?:propertiesRaw|\w+), isLoading: propertiesLoading \}[^\n]*\n'
    r'.*?enabled: isOpen,.*?\}\);'
    r'(?:\s*\n\s*// toArray handles.*?\n\s*const properties[^\n]+\n)?',
    re.DOTALL
)

replacement = '''const { data: properties = [], isLoading: propertiesLoading } = useQuery({
    queryKey: ["/api/properties"],
    enabled: isOpen,
    queryFn: async () => {
      const r = await apiRequest("/api/properties");
      const j = await r.json();
      if (Array.isArray(j)) return j;
      if (j && Array.isArray(j.results)) return j.results;
      return [];
    },
    select: (d: any): any[] => {
      if (Array.isArray(d)) return d.filter((p: any) => p?.id != null);
      if (d && Array.isArray(d.results)) return d.results.filter((p: any) => p?.id != null);
      return [];
    },
  });'''

new_src, count = pattern.subn(replacement, src)
if count == 0:
    print("  WARNING: pattern not matched — applying line-based fallback")
    # Fallback: find the line with `const { data: propertiesRaw` and replace block manually
    start = None
    end = None
    for i, line in enumerate(lines):
        if "isLoading: propertiesLoading" in line and "useQuery" not in line:
            # Find the useQuery( opening above this line
            for j in range(i, max(0, i-3), -1):
                if "useQuery(" in lines[j] or ("data:" in lines[j] and "propert" in lines[j]):
                    start = j
                    break
        if start is not None and end is None:
            if i > start and lines[i].strip() == "});":
                end = i
                break
    
    if start is not None and end is not None:
        # Also remove the `const properties = toArray(...)` line after
        after_end = end + 1
        while after_end < len(lines) and lines[after_end].strip() == "":
            after_end += 1
        if after_end < len(lines) and "const properties" in lines[after_end] and "toArray" in lines[after_end]:
            end = after_end
        
        indent = "  "
        new_block = replacement.split("\n")
        lines[start:end+1] = [indent + l if l else l for l in new_block]
        new_src = "\n".join(lines)
        print(f"  Fallback applied: replaced lines {start+1}-{end+1}")
    else:
        print(f"  ERROR: could not find block. start={start} end={end}")
        sys.exit(1)
else:
    print(f"  Pattern matched and replaced ({count} occurrence(s))")

# Verify the result
if "properties.map is not a function" in new_src:
    print("  ERROR: still broken after replacement")
elif 'select: (d: any)' in new_src:
    print("  Verified: select transform present in output")

with open(path, "w", encoding="utf-8") as f:
    f.write(new_src)
print(f"  Written ({len(new_src.split(chr(10)))} lines)")
PYEOF

echo ""
echo "=== Verifying the fix ==="
echo "--- queryClient.ts line with json.results ---"
grep -n "json.results" "client/src/lib/queryClient.ts"
echo "--- modal select line ---"
grep -n "select:" "client/src/components/modals/comprehensive-tenant-modal.tsx"

echo ""
echo "=== Clearing ALL caches ==="
rm -rf client/node_modules/.vite
rm -rf node_modules/.cache

echo ""
echo "=== Done! Run: npm run dev ==="