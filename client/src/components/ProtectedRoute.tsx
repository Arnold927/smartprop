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

import React, { useEffect } from "react";
import { useLocation } from "wouter";
import { useAuth } from "@/hooks/useAuth";
import { isRouteAllowed, getHomeForRole } from "@/lib/roleNav";
import { useToast } from "@/hooks/use-toast";

interface ProtectedRouteProps {
  children: React.ReactNode;
}

export default function ProtectedRoute({ children }: ProtectedRouteProps) {
  const { user, isLoading } = useAuth();
  const [location, navigate] = useLocation();
  const { toast } = useToast();
  const allowed = isLoading || isRouteAllowed(user?.role, location);

  // Redirect to the role's home (in an effect, not during render) and say why,
  // instead of silently bouncing.
  useEffect(() => {
    if (!allowed) {
      toast({ title: "Not available for your account", description: "You were taken to your home page." });
      navigate(getHomeForRole(user?.role), { replace: true });
    }
  }, [allowed, location]); // eslint-disable-line react-hooks/exhaustive-deps

  if (isLoading) {
    return (
      <div className="min-h-[50vh] flex items-center justify-center">
        <div className="animate-spin rounded-full h-10 w-10 border-b-2 border-primary" />
      </div>
    );
  }

  if (!allowed) return null;

  return <>{children}</>;
}
