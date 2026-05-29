import { useQuery, useMutation, useQueryClient, keepPreviousData } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";

export interface RentPaymentsPage {
  count:    number;
  next:     string | null;
  previous: string | null;
  results:  any[];
}

export interface UseRentCollectionOptions {
  page?:     number;
  pageSize?: number;
  status?:   string;
  search?:   string;
}

export function useRentCollection(opts: UseRentCollectionOptions = {}) {
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const page     = opts.page     ?? 1;
  const pageSize = opts.pageSize ?? 20;
  const status   = opts.status   ?? "all";
  const search   = opts.search   ?? "";

  const params = new URLSearchParams();
  params.set("page",      String(page));
  params.set("page_size", String(pageSize));
  if (status && status !== "all") params.set("status", status);
  if (search) params.set("search", search);

  const queryKey = ["/api/rent-payments", page, pageSize, status, search];

  const { data: paymentsPage, isLoading } = useQuery<RentPaymentsPage>({
    queryKey,
    queryFn: async (): Promise<RentPaymentsPage> => {
      const res  = await apiRequest(`/api/rent-payments?${params.toString()}`);
      const json = await res.json();
      if (Array.isArray(json)) {
        return { count: json.length, next: null, previous: null, results: json };
      }
      return json as RentPaymentsPage;
    },
    placeholderData: keepPreviousData,
  });

  const payments: any[] = (paymentsPage as RentPaymentsPage | undefined)?.results ?? [];
  const totalCount       = (paymentsPage as RentPaymentsPage | undefined)?.count   ?? 0;
  const totalPages       = Math.ceil(totalCount / pageSize) || 1;

  const markPaidMutation = useMutation({
    mutationFn: async ({ id }: { id: number; onDone?: () => void }) => {
      const res = await apiRequest(`/api/rent-payments/${id}/mark-paid`, {
        method: "POST",
        data: {
          paidDate:      new Date().toISOString().split("T")[0],
          paymentMethod: "cash",
        },
      });
      return res.json();
    },
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({ queryKey: ["/api/rent-payments"] });
      queryClient.invalidateQueries({ queryKey: ["/api/rent-payments/stats"] });
      toast({ title: "Payment marked as paid ✓" });
      variables.onDone?.();
    },
    onError: (_err, variables) => {
      toast({ title: "Failed to mark payment as paid", variant: "destructive" });
      variables.onDone?.();
    },
  });

  const sendReminderMutation = useMutation({
    mutationFn: async ({ id }: { id: number; onDone?: () => void }) => {
      const res = await apiRequest(`/api/rent-payments/${id}/send-reminder`, { method: "POST" });
      return res.json();
    },
    onSuccess: (_data, variables) => {
      toast({ title: "Reminder sent successfully ✓" });
      variables.onDone?.();
    },
    onError: (_err, variables) => {
      toast({ title: "Failed to send reminder", variant: "destructive" });
      variables.onDone?.();
    },
  });

  const { data: stats } = useQuery({
    queryKey: ["/api/rent-payments/stats"],
    queryFn:  async () => {
      // Scope to current month by default so KPIs reflect this month's expected vs collected
      const now = new Date();
      const month = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
      const res = await apiRequest(`/api/rent-payments/stats?month=${month}`);
      return res.json();
    },
    staleTime: 30_000,
  });

  return {
    payments,
    totalCount,
    totalPages,
    isLoading,
    stats,
    markPaidMutation,
    sendReminderMutation,
  };
}