import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useNetworkStatus } from './useNetworkStatus';
import { useOfflineStorage } from './useOfflineStorage';
import { offlineQueue } from '@/utils/offlineQueue';
import { apiRequest } from '@/lib/queryClient';
import { useEffect } from 'react';

interface UseOfflineQueryOptions {
  cacheTime?: number;
  staleTime?: number;
  refetchOnReconnect?: boolean;
  offlineFirst?: boolean;
}

export function useOfflineQuery<T>(
  queryKey: string | string[],
  queryFn: () => Promise<T>,
  options: UseOfflineQueryOptions = {}
) {
  const {
    cacheTime = 24 * 60 * 60 * 1000, // 24 hours
    staleTime = 5 * 60 * 1000, // 5 minutes
    refetchOnReconnect = true,
    offlineFirst = false
  } = options;

  const { isOnline } = useNetworkStatus();
  const queryClient = useQueryClient();
  
  const cacheKey = Array.isArray(queryKey) ? queryKey.join('_') : queryKey;
  const { data: cachedData, setCachedData } = useOfflineStorage<T>(cacheKey, {
    expirationTime: cacheTime,
    version: '1.0'
  });

  // Enhanced query function that handles offline scenarios
  const enhancedQueryFn = async (): Promise<T> => {
    if (!isOnline) {
      if (cachedData) {
        return cachedData;
      }
      throw new Error('No internet connection and no cached data available');
    }

    try {
      const data = await queryFn();
      // Cache successful response
      setCachedData(data);
      return data;
    } catch (error) {
      // If online request fails and we have cached data, use it
      if (cachedData) {
        return cachedData;
      }
      throw error;
    }
  };

  const query = useQuery({
    queryKey: Array.isArray(queryKey) ? queryKey : [queryKey],
    queryFn: enhancedQueryFn,
    staleTime,
    gcTime: cacheTime,
    refetchOnWindowFocus: false,
    refetchOnReconnect: isOnline && refetchOnReconnect,
    retry: (failureCount, error) => {
      // Don't retry if offline
      if (!isOnline) return false;
      // Retry up to 2 times for network errors
      return failureCount < 2;
    },
    initialData: offlineFirst ? cachedData : undefined,
    enabled: isOnline || !!cachedData
  });

  // Process offline queue when coming back online
  useEffect(() => {
    if (isOnline) {
      offlineQueue.processQueue().catch(console.error);
    }
  }, [isOnline]);

  // Refresh data when coming back online
  useEffect(() => {
    if (isOnline && refetchOnReconnect) {
      const timer = setTimeout(() => {
        queryClient.invalidateQueries({
          queryKey: Array.isArray(queryKey) ? queryKey : [queryKey]
        });
      }, 1000); // Small delay to allow connection to stabilize

      return () => clearTimeout(timer);
    }
  }, [isOnline, refetchOnReconnect, queryClient, queryKey]);

  return {
    ...query,
    isOnline,
    hasCachedData: !!cachedData,
    isUsingCache: !isOnline && !!cachedData
  };
}