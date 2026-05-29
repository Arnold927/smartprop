import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";

interface ClockInData {
  staff_id: number;
  property_id?: number;
  location_lat?: number;
  location_lng?: number;
  clock_in_method?: string;
  notes?: string;
}

interface ClockOutData {
  time_tracking_id: number;
  location_lat?: number;
  location_lng?: number;
  clock_out_method?: string;
  notes?: string;
  break_time?: number;
}

export function useTimeTracking() {
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const useActiveSession = (staffId: number | undefined) => {
    return useQuery({
      queryKey: [`/api/time-tracking/active-session`, staffId],
      queryFn: async () => {
        if (!staffId) return null;
        try {
          const r = await apiRequest(`/api/time-tracking/active-session?staff_id=${staffId}`);
          const data = await r.json();
          return data.activeSession ?? null;
        } catch {
          return null;
        }
      },
      enabled: !!staffId,
      refetchInterval: 30000,
    });
  };

  const useStaffTimeRecords = (staffId: number | undefined) => {
    return useQuery({
      queryKey: [`/api/time-tracking/staff`, staffId],
      queryFn: async () => {
        if (!staffId) return [];
        try {
          const r = await apiRequest(`/api/time-tracking/staff/${staffId}`);
          const data = await r.json();
          return Array.isArray(data) ? data : [];
        } catch {
          return [];
        }
      },
      enabled: !!staffId,
    });
  };

  const clockInMutation = useMutation({
    mutationFn: async (data: ClockInData) => {
      const r = await apiRequest("/api/time-tracking/clock-in", { method: "POST", data });
      return r.json();
    },
    onSuccess: (data, variables) => {
      toast({
        title: "Clocked In",
        description: `Started at ${new Date(data.clock_in_time || Date.now()).toLocaleTimeString()}`,
      });
      queryClient.invalidateQueries({ queryKey: ["/api/time-tracking/active-session", variables.staff_id] });
      queryClient.invalidateQueries({ queryKey: ["/api/time-tracking/staff", variables.staff_id] });
      queryClient.invalidateQueries({ queryKey: ["/api/workforce/stats"] });
    },
    onError: (error: Error) => {
      toast({ title: "Clock In Failed", description: error.message, variant: "destructive" });
    },
  });

  const clockOutMutation = useMutation({
    mutationFn: async (data: ClockOutData) => {
      const r = await apiRequest("/api/time-tracking/clock-out", { method: "POST", data });
      return r.json();
    },
    onSuccess: (data, variables) => {
      const session = data.timeRecord || data;
      const hours = session.total_hours ? parseFloat(session.total_hours).toFixed(1) : "0";
      toast({
        title: "Clocked Out",
        description: `Worked ${hours} hours`,
      });
      queryClient.invalidateQueries({ queryKey: ["/api/time-tracking"] });
      queryClient.invalidateQueries({ queryKey: ["/api/workforce/stats"] });
    },
    onError: (error: Error) => {
      toast({ title: "Clock Out Failed", description: error.message, variant: "destructive" });
    },
  });

  return { useActiveSession, useStaffTimeRecords, clockInMutation, clockOutMutation };
}

// Re-export for direct use
export const useActiveSession = (staffId: number | undefined) => {
  return useQuery({
    queryKey: [`/api/time-tracking/active-session`, staffId],
    queryFn: async () => {
      if (!staffId) return null;
      try {
        const r = await apiRequest(`/api/time-tracking/active-session?staff_id=${staffId}`);
        const data = await r.json();
        return data.activeSession ?? null;
      } catch {
        return null;
      }
    },
    enabled: !!staffId,
    refetchInterval: 30000,
  });
};
