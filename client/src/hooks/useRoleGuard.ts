/**
 * useRoleGuard — client-side role + auth guard for page components.
 *
 * Usage:
 *   const guard = useRoleGuard(["admin", "manager"]);
 *   if (guard.gate) return guard.gate;   // renders a lock screen or spinner
 *
 * The server enforces the real security via roleGuard middleware.
 * This hook exists solely to give a clean UX and prevent
 * unnecessary API calls from roles that can't use the page.
 */
import { useAuth } from "@/hooks/useAuth";
import React from "react";

export type AppRole =
  | "admin"
  | "manager"
  | "landlord"
  | "staff"
  | "caretaker"
  | "tenant"
  | "guard"
  | "contractor";

// Convenience role groups matching the server's ROUTE_POLICY
export const ROLES = {
  ADMIN_ONLY:              ["admin"] as AppRole[],
  ADMIN_MANAGER:           ["admin", "manager"] as AppRole[],
  ADMIN_MANAGER_STAFF:     ["admin", "manager", "staff"] as AppRole[],
  ADMIN_MANAGER_LANDLORD:  ["admin", "manager", "landlord"] as AppRole[],
  STAFF_AND_ABOVE:         ["admin", "manager", "landlord", "staff"] as AppRole[],
  CARETAKER_ALLOWED:       ["admin", "manager", "landlord", "staff", "caretaker"] as AppRole[],
  ALL_AUTHENTICATED:       ["admin", "manager", "landlord", "staff", "caretaker", "tenant", "guard", "contractor"] as AppRole[],
};

interface GuardResult {
  /** If non-null, render this element instead of the page content */
  gate: React.ReactElement | null;
  user: ReturnType<typeof useAuth>["user"];
  role: AppRole | "";
  isAdmin:    boolean;
  isManager:  boolean;
  isLandlord: boolean;
  isStaff:    boolean;
  isCaretaker:boolean;
  isTenant:   boolean;
  /** true if role is admin or manager */
  canManage:  boolean;
  /** true if role is admin, manager, or staff */
  canOperate: boolean;
}

export function useRoleGuard(allowedRoles: AppRole[]): GuardResult {
  const { user, isLoading } = useAuth();
  const role = (user?.role ?? "") as AppRole | "";

  const isAdmin     = role === "admin";
  const isManager   = role === "manager";
  const isLandlord  = role === "landlord";
  const isStaff     = role === "staff";
  const isCaretaker = role === "caretaker";
  const isTenant    = role === "tenant";
  const canManage   = isAdmin || isManager;
  const canOperate  = isAdmin || isManager || isStaff;

  let gate: React.ReactElement | null = null;

  if (isLoading) {
    gate = React.createElement(
      "div",
      { className: "flex items-center justify-center min-h-[60vh]" },
      React.createElement("div", { className: "animate-spin rounded-full h-10 w-10 border-b-2 border-primary" })
    );
  } else if (!user) {
    gate = React.createElement(
      "div",
      { className: "flex flex-col items-center justify-center min-h-[60vh] gap-3 text-center p-8" },
      React.createElement("p", { className: "text-lg font-semibold" }, "Please sign in to continue.")
    );
  } else if (role && !allowedRoles.includes(role as AppRole)) {
    gate = React.createElement(
      "div",
      { className: "flex flex-col items-center justify-center min-h-[60vh] gap-4 text-center p-8" },
      React.createElement(
        "div",
        { className: "w-14 h-14 rounded-full bg-muted flex items-center justify-center" },
        React.createElement(
          "svg",
          { className: "w-7 h-7 text-muted-foreground", fill: "none", viewBox: "0 0 24 24", stroke: "currentColor" },
          React.createElement("path", { strokeLinecap: "round", strokeLinejoin: "round", strokeWidth: 2, d: "M12 15v2m0 0v2m0-2h2m-2 0H10m2-6V7a4 4 0 00-8 0v4h8z" })
        )
      ),
      React.createElement("h2", { className: "text-xl font-semibold" }, "Access Restricted"),
      React.createElement(
        "p",
        { className: "text-muted-foreground max-w-sm text-sm" },
        `This page is not available for your role (${role}). Contact your administrator if you believe this is an error.`
      )
    );
  }

  return { gate, user, role, isAdmin, isManager, isLandlord, isStaff, isCaretaker, isTenant, canManage, canOperate };
}