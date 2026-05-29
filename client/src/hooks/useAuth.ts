import { useQuery, useQueryClient } from "@tanstack/react-query";
import type { User } from "@shared/schema";
import { refreshAccessToken } from "@/lib/queryClient";

export function useAuth() {
  const token = localStorage.getItem("access_token") || sessionStorage.getItem("access_token");

  const {
    data: authResponse,
    isLoading: queryLoading,
    error,
    refetch,
  } = useQuery<{ success: boolean; user: User }>({
    queryKey: ["/api/auth/user"],
    queryFn: async () => {
      if (!token) throw new Error("No token found");

      let res = await fetch("/api/auth/user", {
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        credentials: "include",
      });

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

      if (!res.ok) throw new Error(`HTTP ${res.status}`);

      const data = await res.json();
      if (!data.success || !data.user) throw new Error("Invalid authentication response");
      return data;
    },
    enabled: !!token,
    retry: false,
    staleTime: 5 * 60 * 1000,
    refetchOnWindowFocus: true,
    refetchOnMount: true,
  });

  const user = authResponse?.user;
  const isAuthenticated = !!user && !error;
  const isLoading = !!token && queryLoading;

  return { user, isLoading, isAuthenticated, error, refetch };
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
    window.location.href = "/auth";
  };
}