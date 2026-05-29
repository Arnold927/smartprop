# SmartProp — Reliability Fixes Changelog

## Summary

Five reliability issues identified in the code review have been fixed.
This patch touches: 2 mobile screens, 5 analytics components, 1 new server
route file, the route registry, and documentation.

---

## Fix 1 — `MaintenanceScreen.tsx` (mobile) — TanStack Query v5 crash

**Root cause:** TanStack Query v5 removed the implicit `data` variable from
`onSuccess` callbacks. The resolved value must now be received explicitly as
the first parameter.

**Was:**
```ts
onSuccess: () => {
  const wasQueued = (data as any)?.queued; // ReferenceError — data not in scope
}
```

**Fixed:**
```ts
onSuccess: (data: any) => {
  Alert.alert('Success',
    data?.queued ? 'Request queued — will sync when online' : 'Request submitted');
}
```

**Also added:** Offline banner in header, `useSync` hook imported, `en-KE`
locale for date formatting, typed `const` array for field config.

---

## Fix 2 — `InspectionsScreen.tsx` (mobile) — crash + missing history list

**Root cause 1:** Same TanStack v5 `onSuccess` crash — `response` was
referenced but never declared in scope.

**Root cause 2:** The screen had only a create form. There was no `useQuery`
to load or display past inspection history, so the screen was empty after
every submission.

**Root cause 3:** Property was a raw text input for a numeric ID. Inspectors
cannot reasonably know internal IDs.

**Fixed:**
- `onSuccess: (data: any) =>` receives resolved value correctly.
- Added `useQuery(['inspections'])` to load and render inspection history.
- Added `useQuery(['properties'])` to drive a horizontal chip selector —
  inspectors pick from property names, not IDs.
- Added full loading / error / empty states with retry.
- Added offline banner.

---

## Fix 3 — `SecurityScreen.tsx` (mobile) — hardcoded stats *(already fixed in this zip)*

Verified: the current `SecurityScreen.tsx` already derives stats from real
API data via `useQuery(['visitors', 'today'])` with a 30-second polling
interval. The original hardcoded "23 Visitors, 8 QR Scans" values are gone.
No further change needed.

---

## Fix 4 — Analytics components — missing backend endpoints

**Root cause:** Five components (`FinancialAnalytics`, `TenantAnalytics`,
`MaintenanceAnalytics`, `MarketingAnalytics`, `PropertyAnalytics`) called
`/api/analytics/financial`, `/api/analytics/tenants`, etc. — but these
routes did not exist anywhere in the server. Every query silently returned a
404, the components received `undefined`, and any property access like
`data.totalRevenue.toLocaleString()` threw a runtime crash.

**Fixed:**
- Created `server/routes/analytics.ts` with five real SQL-backed endpoints:
  - `GET /api/analytics/financial` — revenue, expenses, net income, margin,
    collection rate, overdue count, 6-month monthly trend
  - `GET /api/analytics/tenants` — occupancy rate, total/new tenants,
    payment performance, active leases
  - `GET /api/analytics/maintenance` — request counts by status, avg
    resolution hours, by-priority breakdown
  - `GET /api/analytics/marketing` — vacancy rate, new/ended leases
  - `GET /api/analytics/property` — per-property occupancy + revenue (top 20)
- All queries are org-scoped via `req.user.organizationId`.
- `?timeframe=7d|30d|90d|1y` supported on all endpoints.
- Registered the router in `server/routes/index.ts` at `/api/analytics`.

**Frontend components also fixed:**
- Added missing `import { apiRequest } from "@/lib/queryClient"` (was calling
  `apiRequest` without importing it — TypeScript would have caught this).
- Removed `ensureArray()` wrapper — analytics endpoints return an object, not
  an array.
- All `data.field` accesses are now null-safe via `data: any = analytics ?? {}`.
- `.toLocaleString()` calls are wrapped with `Number(data.field ?? 0)`.
- `FinancialAnalytics`: replaced hardcoded `+8.7%` / `+12.3%` trend labels
  with dynamic values from `data.revenueTrend` and `data.profitMargin`.

---

## Fix 5 — Ardhisasa title verification — sandbox mode documentation

**Status:** The service itself is correctly implemented. `ardhisasaService.ts`
has a full live OAuth2 path **and** a realistic sandbox simulation. When
`ARDHISASA_CLIENT_ID` / `ARDHISASA_CLIENT_SECRET` (or `ARDHISASA_API_KEY`)
are not set, it falls back to sandbox mode — which the UI already labels
clearly with a `[SANDBOX]` badge.

**What was missing:** The env vars were not documented in `.env.example`, so
operators setting up production deployments had no guidance on what to set.

**Fixed:** Added `ARDHISASA_API_URL`, `ARDHISASA_CLIENT_ID`,
`ARDHISASA_CLIENT_SECRET`, and `ARDHISASA_API_KEY` to `.env.example` with
explanatory comments and a link to the eCitizen developer portal.

> **Note on live credentials:** Ardhisasa API access requires registration with
> Kenya's Ministry of Lands & Physical Planning via the eCitizen developer
> portal. Until credentials are obtained, sandbox mode provides safe,
> deterministic responses for all UI states (verified / encumbered / not_found).

---

## Files changed

| File | Change type |
|------|-------------|
| `mobile-apps/src/screens/MaintenanceScreen.tsx` | Bug fix (TanStack v5 crash) |
| `mobile-apps/src/screens/InspectionsScreen.tsx` | Bug fix (crash + missing features) |
| `server/routes/analytics.ts` | New file (5 analytics endpoints) |
| `server/routes/index.ts` | Import + mount analytics router |
| `client/src/components/analytics/FinancialAnalytics.tsx` | Bug fix (import, null-safety, dynamic trends) |
| `client/src/components/analytics/TenantAnalytics.tsx` | Bug fix (import, null-safety) |
| `client/src/components/analytics/MaintenanceAnalytics.tsx` | Bug fix (import, null-safety) |
| `client/src/components/analytics/MarketingAnalytics.tsx` | Bug fix (import, null-safety) |
| `client/src/components/analytics/PropertyAnalytics.tsx` | Bug fix (import, null-safety) |
| `.env.example` | Added Ardhisasa env var documentation |

