/**
 * client/src/lib/platformOrgContext.ts
 *
 * platform_admin is the one role not scoped to a single organisation (see
 * server/middleware/requireOrg.ts). When a platform admin is viewing a
 * specific organisation's data, that org's id is carried in the URL as
 * ?organizationId=X — this keeps it bookmarkable/shareable and means every
 * page reads from one source of truth instead of separate component state.
 *
 * withOrgParam() appends it to an API URL when present; every other role
 * gets back the exact same URL unchanged (their own organizationId already
 * comes from their JWT, same as before this feature existed).
 */

export function getOrgIdFromSearch(search: string): string | null {
  const params = new URLSearchParams(search);
  return params.get("organizationId");
}

export function withOrgParam(url: string, orgId: string | null | undefined): string {
  if (!orgId) return url;
  const separator = url.includes("?") ? "&" : "?";
  return `${url}${separator}organizationId=${encodeURIComponent(orgId)}`;
}