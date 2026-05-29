import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useNetworkStatus } from './useNetworkStatus';
import { offlineQueue } from '@/utils/offlineQueue';
import { useToast } from '@/hooks/use-toast';

interface UseOfflineMutationOptions<T, V> {
  onSuccess?: (data: T) => void;
  onError?: (error: Error) => void;
  invalidateQueries?: string[];
  optimisticUpdate?: (variables: V) => any;
  rollbackUpdate?: (variables: V) => any;
}

export function useOfflineMutation<T, V>(
  mutationFn: (variables: V) => Promise<T>,
  url: string,
  method: string = 'POST',
  options: UseOfflineMutationOptions<T, V> = {}
) {
  const { isOnline } = useNetworkStatus();
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const {
    onSuccess,
    onError,
    invalidateQueries = [],
    optimisticUpdate,
    rollbackUpdate
  } = options;

  const mutation = useMutation({
    mutationFn: async (variables: V) => {
      if (!isOnline) {
        // Queue the request for later
        const requestId = offlineQueue.addRequest(url, method, variables);
        
        // Show offline notification
        toast({
          title: "Offline Mode",
          description: "Your action will be synced when connection is restored",
          variant: "default"
        });

        // Apply optimistic update if provided
        if (optimisticUpdate && invalidateQueries.length > 0) {
          invalidateQueries.forEach(queryKey => {
            queryClient.setQueryData([queryKey], optimisticUpdate(variables));
          });
        }

        // Return a placeholder response for offline operations
        return { success: true, offline: true, requestId } as T;
      }

      // Online - execute the mutation normally
      return mutationFn(variables);
    },
    onSuccess: (data, variables, context) => {
      // Invalidate specified queries
      invalidateQueries.forEach(queryKey => {
        queryClient.invalidateQueries({ queryKey: [queryKey] });
      });

      // Call custom success handler
      if (onSuccess) {
        onSuccess(data);
      }

      // Show success message for online operations
      if (isOnline) {
        toast({
          title: "Success",
          description: "Operation completed successfully",
          variant: "default"
        });
      }
    },
    onError: (error, variables, context) => {
      // Rollback optimistic update if provided
      if (rollbackUpdate && invalidateQueries.length > 0) {
        invalidateQueries.forEach(queryKey => {
          queryClient.setQueryData([queryKey], rollbackUpdate(variables));
        });
      }

      // Call custom error handler
      if (onError) {
        onError(error as Error);
      }

      // Show error message
      toast({
        title: "Error",
        description: error.message || "Operation failed",
        variant: "destructive"
      });
    },
    retry: (failureCount, error) => {
      // Don't retry if offline
      if (!isOnline) return false;
      // Retry up to 2 times for network errors
      return failureCount < 2;
    }
  });

  return {
    ...mutation,
    isOnline,
    queueInfo: offlineQueue.getQueueInfo()
  };
}