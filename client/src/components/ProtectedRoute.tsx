/**
 * ProtectedRoute.tsx
 *
 * Wraps a page component and redirects the user if their role doesn't
 * allow access to the current path.
 *
 * Usage in App.tsx:
 *   <Route path="/admin-only-page" component={() => (
 *     <ProtectedRoute allowedRoles={["admin", "manager"]}>
 *       <AdminPage />
 *     </ProtectedRoute>
 *   )} />
 */

import React from "react";
import { useLocation } from "wouter";
import { useAuth } from "@/hooks/useAuth";
import { isRouteAllowed, getHomeForRole } from "@/lib/roleNav";

interface ProtectedRouteProps {
  children: React.ReactNode;
}

export default function ProtectedRoute({ children }: ProtectedRouteProps) {
  const { user, isLoading } = useAuth();
  const [location, navigate] = useLocation();

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="animate-spin rounded-full h-10 w-10 border-b-2 border-primary" />
      </div>
    );
  }

  if (!isRouteAllowed(user?.role, location)) {
    // Redirect them to their appropriate home instead of a blank 403
    const home = getHomeForRole(user?.role);
    navigate(home);
    return null;
  }

  return <>{children}</>;
}
