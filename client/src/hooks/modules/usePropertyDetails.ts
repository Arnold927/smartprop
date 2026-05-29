import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";

export function usePropertyDetails(id: string | undefined) {
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const { data: property, isLoading, error } = useQuery({
    queryKey: [`/api/properties/${id}/full`],
    queryFn: async () => {
      const res = await apiRequest(`/api/properties/${id}/full`);
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
