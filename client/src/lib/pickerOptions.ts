import type { SearchableOption } from "@/components/ui/searchable-select";

/**
 * Option builders for <SearchableSelect>. They add the context people need to tell
 * look-alike rows apart (unit number, property) and make email / phone searchable.
 * All accept the loose shapes the API returns (camelCase or snake_case).
 */

const nm = (a?: any, b?: any) => `${a ?? ""} ${b ?? ""}`.trim();

export function tenantOptions(tenants: any[] | undefined, opts?: { unitsById?: Map<any, any>; propsById?: Map<any, any> }): SearchableOption[] {
  return (tenants ?? []).map((t: any) => {
    const unit = t.unit ?? opts?.unitsById?.get(t.unitId);
    const unitNumber = unit?.unitNumber ?? t.unitNumber;
    const prop = t.property ?? opts?.propsById?.get(unit?.propertyId ?? t.propertyId);
    const label = t.name || nm(t.firstName ?? t.first_name, t.lastName ?? t.last_name) || t.email || `Tenant #${t.id}`;
    return {
      value: String(t.id),
      label,
      description: [unitNumber ? `Unit ${unitNumber}` : null, prop?.name ?? t.propertyName].filter(Boolean).join(" · ") || undefined,
      keywords: [t.email, t.phone, t.idNumber].filter(Boolean).join(" "),
    };
  });
}

export function unitOptions(units: any[] | undefined, propsById?: Map<any, any>, opts?: { showOccupancy?: boolean }): SearchableOption[] {
  return (units ?? []).map((u: any) => {
    const prop = propsById?.get(u.propertyId) ?? u.property;
    const occ = opts?.showOccupancy === false ? null
      : u.isOccupied === true ? "occupied" : u.isOccupied === false ? "vacant" : null;
    return {
      value: String(u.id),
      label: `Unit ${u.unitNumber}`,
      description: [prop?.name ?? u.propertyName, u.unitType && u.unitType !== "apartment" ? String(u.unitType).replace(/_/g, " ") : null, u.bedrooms ? `${u.bedrooms} bed` : null, occ]
        .filter(Boolean).join(" · ") || undefined,
      keywords: String(u.unitType ?? ""),
    };
  });
}

export function propertyOptions(properties: any[] | undefined): SearchableOption[] {
  return (properties ?? []).map((p: any) => ({
    value: String(p.id),
    label: p.name,
    description: p.address || undefined,
    keywords: String(p.propertyType ?? ""),
  }));
}

export function userOptions(users: any[] | undefined, valueKey: "id" = "id"): SearchableOption[] {
  return (users ?? []).map((u: any) => ({
    value: String(u[valueKey]),
    label: nm(u.firstName ?? u.first_name, u.lastName ?? u.last_name) || u.email,
    description: [u.email, u.role ? String(u.role) : null].filter(Boolean).join(" · ") || undefined,
    keywords: u.phone ?? "",
  }));
}

export const byId = <T extends { id: any }>(rows: T[] | undefined) => new Map((rows ?? []).map(r => [r.id, r] as const));
