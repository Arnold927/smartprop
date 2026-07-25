import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { withOrgParam } from "@/lib/platformOrgContext";

export function usePropertyDetails(id: string | undefined, orgIdParam?: string | null) {
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const { data: property, isLoading, error } = useQuery({
    queryKey: [`/api/properties/${id}/full`, orgIdParam],
    queryFn: async () => {
      const res = await apiRequest(withOrgParam(`/api/properties/${id}/full`, orgIdParam));
      return res.json();
    },
    enabled: !!id,
  });

  const updateUnitStatusMutation = useMutation({
    mutationFn: async ({ unitId, isOccupied }: { unitId: number; isOccupied: boolean }) => {
      const res = await apiRequest(`/api/units/${unitId}`, {
        method: "PATCH",
        data: { isOccupied },
      });
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [`/api/properties/${id}/full`] });
      toast({ title: "Unit status updated" });
    },
    onError: (err: any) => {
      toast({
        title: "Failed to update unit",
        description: err.message,
        variant: "destructive",
      });
    },
  });

  return {
    property,
    isLoading,
    error,
    updateUnitStatusMutation,
  };
}