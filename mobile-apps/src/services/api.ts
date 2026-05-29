/**
 * api.ts  (upgraded error handling)
 *
 * Changes vs original:
 *  - `request()` now returns a richer `ApiResponse` with `errorCode` and
 *    `userMessage` (human-readable, context-free) alongside the raw `error`
 *  - HTTP status codes mapped to specific user messages instead of raw strings
 *  - Upload errors distinguish quota vs network vs server
 *  - Login errors mapped to specific messages (wrong password vs locked account
 *    vs server down)
 *  - All error paths always include a `userMessage` the UI can display directly
 *  - New `getInspections` / `createInspection` endpoints added
 */

import AsyncStorage from '@react-native-async-storage/async-storage';
import { API_BASE_URL, MOBILE_CONFIG } from './config';
import { classifyError, AppError } from './errors';

// ── Types ─────────────────────────────────────────────────────────────────────

export interface ApiResponse<T = any> {
  success:     boolean;
  data?:       T;
  error?:      string;       // raw technical error (for logging)
  userMessage?: string;      // human-friendly message (for UI display)
  errorCode?:  string;       // classifyError code
  status?:     number;
}

export interface DashboardMetrics {
  totalProperties:   number;
  activeInspections: number;
  pendingMaintenance:number;
  todayVisitors:     number;
  trends?: {
    revenueLabels: string[];
    revenue:       number[];
  };
}

export interface RecentActivity {
  id:      string;
  type:    'inspection' | 'maintenance' | 'visitor';
  message: string;
  time:    string;
}

export interface MessagesResponse {
  activities: RecentActivity[];
}

interface LoginResponse {
  success:              boolean;
  accessToken:          string;
  access_token:         string;
  mobileRefreshToken?:  string;
  user: {
    id:             string;
    email:          string;
    firstName:      string;
    lastName:       string;
    role:           string;
    organizationId: number;
  };
}

// ── Helpers ───────────────────────────────────────────────────────────────────

/**
 * Map a login-specific HTTP error to a user-facing message.
 * This is more specific than the generic classifyError.
 */
function loginErrorMessage(status: number, body: any): string {
  if (status === 401) return 'Incorrect email or password. Please try again.';
  if (status === 403) return 'Your account has been suspended. Contact your administrator.';
  if (status === 429) return 'Too many login attempts. Please wait a moment and try again.';
  if (status >= 500)  return 'SmartProp's servers are temporarily unavailable. Please try again in a few minutes.';
  return body?.message ?? 'Sign-in failed. Please check your details and try again.';
}

// ── Client ────────────────────────────────────────────────────────────────────

class ApiService {
  private baseUrl       = API_BASE_URL;
  private accessToken:  string | null = null;
  private refreshToken: string | null = null;
  private isRefreshing  = false;
  private refreshQueue: Array<(token: string | null) => void> = [];

  // ── Token management ──────────────────────────────────────────────────────

  async loadStoredTokens() {
    const [at, rt] = await Promise.all([
      AsyncStorage.getItem(MOBILE_CONFIG.AUTH_TOKEN_KEY),
      AsyncStorage.getItem(MOBILE_CONFIG.REFRESH_TOKEN_KEY),
    ]);
    this.accessToken  = at;
    this.refreshToken = rt;
  }

  async setTokens(accessToken: string, refreshToken?: string) {
    this.accessToken = accessToken;
    await AsyncStorage.setItem(MOBILE_CONFIG.AUTH_TOKEN_KEY, accessToken);
    if (refreshToken) {
      this.refreshToken = refreshToken;
      await AsyncStorage.setItem(MOBILE_CONFIG.REFRESH_TOKEN_KEY, refreshToken);
    }
  }

  async clearTokens() {
    this.accessToken  = null;
    this.refreshToken = null;
    await AsyncStorage.multiRemove([
      MOBILE_CONFIG.AUTH_TOKEN_KEY,
      MOBILE_CONFIG.REFRESH_TOKEN_KEY,
      MOBILE_CONFIG.USER_KEY,
    ]);
  }

  // ── Core request ─────────────────────────────────────────────────────────

  private async request<T>(
    endpoint: string,
    options: RequestInit = {},
    retry = true,
    context?: string,   // human label for error messages e.g. 'maintenance request'
  ): Promise<ApiResponse<T>> {
    const controller = new AbortController();
    const timeoutId  = setTimeout(() => controller.abort(), MOBILE_CONFIG.REQUEST_TIMEOUT);

    try {
      const headers: Record<string, string> = {
        'Content-Type': 'application/json',
        ...(options.headers as Record<string, string>),
      };
      if (this.accessToken) headers['Authorization'] = `Bearer ${this.accessToken}`;

      const response = await fetch(`${this.baseUrl}${endpoint}`, {
        ...options,
        headers,
        signal: controller.signal,
      });
      clearTimeout(timeoutId);

      // Token expired → refresh once
      if (response.status === 401 && retry && this.refreshToken) {
        const newToken = await this.attemptTokenRefresh();
        if (newToken) return this.request<T>(endpoint, options, false, context);
        return {
          success:     false,
          error:       'Session expired',
          userMessage: 'Your session has ended. Please sign in again.',
          errorCode:   'SESSION_EXPIRED',
          status:      401,
        };
      }

      const body = await response.json().catch(() => ({}));

      if (!response.ok) {
        const appErr: AppError = classifyError(
          body?.message ?? `HTTP ${response.status}`,
          response.status,
          context,
        );
        return {
          success:     false,
          error:       body?.message ?? `HTTP ${response.status}`,
          userMessage: appErr.message,
          errorCode:   appErr.code,
          status:      response.status,
        };
      }

      return { success: true, data: body, status: response.status };

    } catch (err: any) {
      clearTimeout(timeoutId);

      const isTimeout = err?.name === 'AbortError';
      const rawMsg    = isTimeout ? 'Request timed out' : (err?.message ?? 'Network error');
      const appErr    = classifyError(rawMsg, undefined, context);

      return {
        success:     false,
        error:       rawMsg,
        userMessage: appErr.message,
        errorCode:   appErr.code,
      };
    }
  }

  private async attemptTokenRefresh(): Promise<string | null> {
    if (this.isRefreshing) {
      return new Promise(resolve => { this.refreshQueue.push(resolve); });
    }
    this.isRefreshing = true;
    try {
      const response = await fetch(`${this.baseUrl}/api/auth/mobile-refresh`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ refreshToken: this.refreshToken }),
      });
      if (!response.ok) {
        await this.clearTokens();
        this.refreshQueue.forEach(cb => cb(null));
        this.refreshQueue = [];
        return null;
      }
      const { accessToken } = await response.json();
      await this.setTokens(accessToken);
      this.refreshQueue.forEach(cb => cb(accessToken));
      this.refreshQueue = [];
      return accessToken;
    } catch {
      await this.clearTokens();
      this.refreshQueue.forEach(cb => cb(null));
      this.refreshQueue = [];
      return null;
    } finally {
      this.isRefreshing = false;
    }
  }

  // ── Auth ─────────────────────────────────────────────────────────────────

  async login(email: string, password: string): Promise<ApiResponse<LoginResponse>> {
    const controller = new AbortController();
    const timeoutId  = setTimeout(() => controller.abort(), MOBILE_CONFIG.REQUEST_TIMEOUT);

    try {
      const response = await fetch(`${this.baseUrl}/api/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password }),
        signal: controller.signal,
      });
      clearTimeout(timeoutId);

      const body = await response.json().catch(() => ({}));

      if (!response.ok) {
        return {
          success:     false,
          error:       body?.message ?? `HTTP ${response.status}`,
          userMessage: loginErrorMessage(response.status, body),
          status:      response.status,
        };
      }

      const at = body.accessToken ?? body.access_token;
      const rt = body.mobileRefreshToken;
      await this.setTokens(at, rt);
      return { success: true, data: body };

    } catch (err: any) {
      clearTimeout(timeoutId);
      const isTimeout = err?.name === 'AbortError';
      return {
        success:     false,
        error:       err?.message ?? 'Network error',
        userMessage: isTimeout
          ? 'Sign-in timed out. Check your connection and try again.'
          : 'Could not connect to SmartProp. Make sure you have internet access.',
      };
    }
  }

  async logout() {
    await this.request('/api/auth/logout', { method: 'POST' }, false);
    await this.clearTokens();
  }

  async getProfile() {
    return this.request('/api/auth/user', {}, true, 'loading your profile');
  }

  async registerPushToken(token: string, platform: 'android' | 'ios') {
    return this.request('/api/auth/push-token', {
      method: 'POST',
      body: JSON.stringify({ pushToken: token, platform }),
    }, true, 'registering push notifications');
  }

  // ── Dashboard ─────────────────────────────────────────────────────────────

  async getDashboardMetrics(): Promise<ApiResponse<DashboardMetrics>> {
    return this.request<DashboardMetrics>('/api/dashboard/metrics', {}, true, 'loading dashboard');
  }

  // ── Properties ────────────────────────────────────────────────────────────

  async getProperties() {
    return this.request('/api/properties', {}, true, 'loading properties');
  }

  async getProperty(id: string | number) {
    return this.request(`/api/properties/${id}`, {}, true, 'loading property details');
  }

  async getPropertyFull(id: string | number) {
    return this.request(`/api/properties/${id}/full`, {}, true, 'loading property');
  }

  async getPropertyUnits(propertyId: string | number) {
    return this.request(`/api/properties/${propertyId}/units`, {}, true, 'loading units');
  }

  // ── Tenants ───────────────────────────────────────────────────────────────

  async getTenants() {
    return this.request('/api/tenants', {}, true, 'loading tenants');
  }

  async getTenant(id: string | number) {
    return this.request(`/api/tenants/${id}`, {}, true, 'loading tenant details');
  }

  // ── Rent payments ─────────────────────────────────────────────────────────

  async getRentPayments() {
    return this.request('/api/rent-payments', {}, true, 'loading rent payments');
  }

  async getRentPaymentStats() {
    return this.request('/api/rent-payments/stats', {}, true, 'loading payment stats');
  }

  async markPaymentPaid(id: string | number, data: {
    paidDate: string; paymentMethod: string; transactionId?: string; notes?: string;
  }) {
    return this.request(`/api/rent-payments/${id}/mark-paid`, {
      method: 'POST', body: JSON.stringify(data),
    }, true, 'marking payment as paid');
  }

  async sendPaymentReminder(id: string | number) {
    return this.request(`/api/rent-payments/${id}/send-reminder`, { method: 'POST' }, true, 'sending reminder');
  }

  // ── Maintenance ───────────────────────────────────────────────────────────

  async getMaintenanceRequests(params?: { status?: string }) {
    const qs = params?.status ? `?status=${params.status}` : '';
    return this.request(`/api/maintenance-requests${qs}`, {}, true, 'loading maintenance requests');
  }

  async createMaintenanceRequest(data: Record<string, unknown>) {
    return this.request('/api/maintenance-requests', {
      method: 'POST', body: JSON.stringify(data),
    }, true, 'submitting maintenance request');
  }

  async assignTechnician(requestId: string | number, technicianId: number) {
    return this.request(`/api/maintenance-requests/${requestId}/assign-technician`, {
      method: 'PATCH', body: JSON.stringify({ technicianId }),
    }, true, 'assigning technician');
  }

  async completeMaintenanceRequest(requestId: string | number, data: Record<string, unknown>) {
    return this.request(`/api/maintenance-requests/${requestId}/complete`, {
      method: 'PATCH', body: JSON.stringify(data),
    }, true, 'completing request');
  }

  // ── Inspections ───────────────────────────────────────────────────────────

  async getInspections(params?: { propertyId?: string | number; status?: string }) {
    const qs = params
      ? '?' + Object.entries(params).filter(([, v]) => v != null).map(([k, v]) => `${k}=${v}`).join('&')
      : '';
    return this.request(`/api/inspections${qs}`, {}, true, 'loading inspections');
  }

  async createInspection(data: Record<string, unknown>) {
    return this.request('/api/inspections', {
      method: 'POST', body: JSON.stringify(data),
    }, true, 'saving inspection');
  }

  // ── Work orders ───────────────────────────────────────────────────────────

  async getWorkOrders(params?: { page?: number; limit?: number }) {
    const qs = params ? `?page=${params.page ?? 1}&limit=${params.limit ?? 20}` : '';
    return this.request(`/api/work-orders${qs}`, {}, true, 'loading work orders');
  }

  async createWorkOrder(data: Record<string, unknown>) {
    return this.request('/api/work-orders', { method: 'POST', body: JSON.stringify(data) }, true, 'creating work order');
  }

  // ── Documents ─────────────────────────────────────────────────────────────

  async getDocuments(params?: { tenantId?: number; propertyId?: number }) {
    const qs = params
      ? '?' + Object.entries(params).filter(([, v]) => v != null).map(([k, v]) => `${k}=${v}`).join('&')
      : '';
    return this.request(`/api/documents${qs}`, {}, true, 'loading documents');
  }

  async uploadDocument(
    file: { uri: string; type: string; name: string },
    meta: { name?: string; type?: string; tenantId?: number; propertyId?: number },
  ): Promise<ApiResponse> {
    const formData = new FormData();
    formData.append('file', file as any);
    Object.entries(meta).forEach(([k, v]) => { if (v != null) formData.append(k, String(v)); });

    try {
      const response = await fetch(`${this.baseUrl}/api/documents`, {
        method: 'POST',
        headers: { Authorization: this.accessToken ? `Bearer ${this.accessToken}` : '' },
        body: formData,
      });
      if (!response.ok) {
        const appErr = classifyError(`HTTP ${response.status}`, response.status, 'uploading document');
        return { success: false, error: `HTTP ${response.status}`, userMessage: appErr.message, errorCode: appErr.code };
      }
      return { success: true, data: await response.json() };
    } catch (err: any) {
      const appErr = classifyError(err?.message ?? 'upload failed', undefined, 'uploading document');
      return { success: false, error: err?.message, userMessage: appErr.message, errorCode: 'UPLOAD_FAILED' };
    }
  }

  // ── Messages ──────────────────────────────────────────────────────────────

  async getMessages(): Promise<ApiResponse<MessagesResponse>> {
    return this.request<MessagesResponse>('/api/messages', {}, true, 'loading messages');
  }

  async sendMessage(data: { toUserId: string; subject?: string; body: string }) {
    return this.request('/api/messages', { method: 'POST', body: JSON.stringify(data) }, true, 'sending message');
  }

  async markMessageRead(id: string | number) {
    return this.request(`/api/messages/${id}/read`, { method: 'PATCH' });
  }

  // ── Arrears ───────────────────────────────────────────────────────────────

  async getArrears(status?: string) {
    return this.request(`/api/arrears${status ? `?status=${status}` : ''}`, {}, true, 'loading arrears');
  }

  // ── Time tracking ─────────────────────────────────────────────────────────

  async clockIn(data: { staff_id: number; property_id?: number; notes?: string }) {
    return this.request('/api/time-tracking/clock-in', { method: 'POST', body: JSON.stringify(data) }, true, 'clocking in');
  }

  async clockOut(data: { time_tracking_id: number; break_time?: number; notes?: string }) {
    return this.request('/api/time-tracking/clock-out', { method: 'POST', body: JSON.stringify(data) }, true, 'clocking out');
  }

  // ── Visitors ─────────────────────────────────────────────────────────────

  async getVisitors() {
    return this.request('/api/visitors', {}, true, 'loading visitors');
  }

  async createVisitor(data: Record<string, unknown>) {
    return this.request('/api/visitors', { method: 'POST', body: JSON.stringify(data) }, true, 'checking in visitor');
  }

  // ── Security — Patrols ────────────────────────────────────────────────────

  async getPatrols() {
    return this.request('/api/security/patrols', {}, true, 'loading patrol logs');
  }

  async createPatrolLog(data: Record<string, unknown>) {
    return this.request('/api/security/patrols', { method: 'POST', body: JSON.stringify(data) }, true, 'submitting patrol log');
  }

  // ── Security — Incidents ──────────────────────────────────────────────────

  async getSecurityIncidents() {
    return this.request('/api/security/incidents', {}, true, 'loading incidents');
  }

  async createSecurityIncident(data: Record<string, unknown>) {
    return this.request('/api/security/incidents', { method: 'POST', body: JSON.stringify(data) }, true, 'submitting incident report');
  }

  async controlGate(data: { action: 'open' | 'close'; timestamp: string }) {
    return this.request('/api/security/gate-control', { method: 'POST', body: JSON.stringify(data) }, true, 'gate control');
  }

  // ── Reports ───────────────────────────────────────────────────────────────

  async getReports() {
    return this.request('/api/reports', {}, true, 'loading reports');
  }
}

export const apiService = new ApiService();
export default apiService;
