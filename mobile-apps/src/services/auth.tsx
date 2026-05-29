/**
 * auth.tsx — authentication context
 *
 * Fixes vs original:
 *  - Calls apiService.login(email, password) with correct signature
 *  - Reads accessToken from response (was .token — field never existed)
 *  - Loads stored tokens into apiService on boot so all subsequent
 *    requests are authenticated without requiring a fresh login
 *  - Registers push token with server immediately after login
 */

import React, { createContext, useContext, useState, useEffect } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { apiService } from './api';
import { notificationService } from './notifications';
import { MOBILE_CONFIG } from './config';

interface User {
  id: string;
  email: string;
  firstName: string;
  lastName: string;
  role: string;
  organizationId: number;
}

interface AuthContextType {
  user: User | null;
  isAuthenticated: boolean;
  isLoading: boolean;
  login: (email: string, password: string) => Promise<{ success: boolean; error?: string }>;
  logout: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [user, setUser]       = useState<User | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => { restoreSession(); }, []);

  /** On app start: load stored tokens and verify the session is still valid */
  const restoreSession = async () => {
    try {
      await apiService.loadStoredTokens();

      const userData = await AsyncStorage.getItem(MOBILE_CONFIG.USER_KEY);
      if (!userData) return;

      // Verify the token is still accepted by the server
      const profileRes = await apiService.getProfile();
      if (profileRes.success && profileRes.data) {
        const freshUser = profileRes.data as User;
        setUser(freshUser);
        await AsyncStorage.setItem(MOBILE_CONFIG.USER_KEY, JSON.stringify(freshUser));
      } else {
        // Token is dead — clear everything
        await apiService.clearTokens();
      }
    } catch (err) {
      console.error('[Auth] Session restore error:', err);
    } finally {
      setIsLoading(false);
    }
  };

  const login = async (email: string, password: string) => {
    try {
      const res = await apiService.login(email, password);

      if (!res.success || !res.data) {
        return { success: false, error: res.error ?? 'Login failed' };
      }

      const loggedInUser = res.data.user as User;
      setUser(loggedInUser);
      await AsyncStorage.setItem(MOBILE_CONFIG.USER_KEY, JSON.stringify(loggedInUser));

      // Register push token with the server (non-fatal)
      notificationService.registerTokenWithServer().catch(err =>
        console.warn('[Auth] Push token registration failed (non-fatal):', err),
      );

      return { success: true };
    } catch (err: any) {
      console.error('[Auth] Login error:', err);
      return { success: false, error: err?.message ?? 'An error occurred' };
    }
  };

  const logout = async () => {
    try {
      await apiService.logout();
    } catch (err) {
      console.warn('[Auth] Logout request failed (clearing local state anyway):', err);
    } finally {
      setUser(null);
    }
  };

  return (
    <AuthContext.Provider value={{ user, isAuthenticated: !!user, isLoading, login, logout }}>
      {children}
    </AuthContext.Provider>
  );
};

export const useAuth = () => {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within an AuthProvider');
  return ctx;
};