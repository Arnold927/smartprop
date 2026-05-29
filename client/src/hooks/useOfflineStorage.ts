import { useState, useEffect } from 'react';

interface CacheData {
  data: any;
  timestamp: number;
  version: string;
}

interface OfflineStorageOptions {
  expirationTime?: number; // in milliseconds
  version?: string;
}

export function useOfflineStorage<T>(
  key: string, 
  options: OfflineStorageOptions = {}
) {
  const { expirationTime = 24 * 60 * 60 * 1000, version = '1.0' } = options; // 24 hours default
  const [data, setData] = useState<T | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Get data from localStorage
  const getCachedData = (): T | null => {
    try {
      const cached = localStorage.getItem(`offline_${key}`);
      if (!cached) return null;

      const parsed: CacheData = JSON.parse(cached);
      
      // Check if data is expired
      const now = Date.now();
      if (now - parsed.timestamp > expirationTime) {
        localStorage.removeItem(`offline_${key}`);
        return null;
      }

      // Check version compatibility
      if (parsed.version !== version) {
        localStorage.removeItem(`offline_${key}`);
        return null;
      }

      return parsed.data;
    } catch (err) {
      console.error('Error reading cached data:', err);
      setError('Failed to read cached data');
      return null;
    }
  };

  // Store data in localStorage
  const setCachedData = (newData: T): void => {
    try {
      const cacheEntry: CacheData = {
        data: newData,
        timestamp: Date.now(),
        version
      };
      
      localStorage.setItem(`offline_${key}`, JSON.stringify(cacheEntry));
      setData(newData);
      setError(null);
    } catch (err) {
      console.error('Error storing cached data:', err);
      setError('Failed to store data offline');
    }
  };

  // Clear cached data
  const clearCache = (): void => {
    try {
      localStorage.removeItem(`offline_${key}`);
      setData(null);
      setError(null);
    } catch (err) {
      console.error('Error clearing cache:', err);
      setError('Failed to clear cache');
    }
  };

  // Initialize data on mount
  useEffect(() => {
    const cachedData = getCachedData();
    setData(cachedData);
    setIsLoading(false);
  }, [key]);

  return {
    data,
    isLoading,
    error,
    setCachedData,
    clearCache,
    getCachedData
  };
}