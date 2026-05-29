import React, { useEffect, useCallback } from 'react';
import { apiRequest } from '@/lib/queryClient';
import { useAuth } from '@/hooks/useAuth';

interface ActivityData {
 [key: string]: any;
}

interface ActivityTrackerProps {
 children: React.ReactNode;
}

// Activity tracking hook
export function useActivityTracker() {
 const { user } = useAuth();

 const trackActivity = useCallback(async (
 activityType: 'login' | 'logout' | 'property_view' | 'tenant_action' | 'payment_made' | 'maintenance_request' | 'document_upload' | 'search' | 'report_generated',
 activityData?: ActivityData,
 success: boolean = true,
 errorMessage?: string
 ) => {
 if (!user) return;

 try {
 // Collect detailed browser and device information
 const userAgent = navigator.userAgent;
 const deviceInfo = {
 userAgent,
 language: navigator.language,
 platform: navigator.platform,
 cookieEnabled: navigator.cookieEnabled,
 onLine: navigator.onLine,
 screenWidth: window.screen.width,
 screenHeight: window.screen.height,
 viewportWidth: window.innerWidth,
 viewportHeight: window.innerHeight,
 devicePixelRatio: window.devicePixelRatio,
 timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
 };

 // Detect device type
 const deviceType = /Mobi|Android/i.test(userAgent) ? 'mobile' : 
 /Tablet|iPad/i.test(userAgent) ? 'tablet' : 'desktop';

 // Extract browser information
 const getBrowserInfo = () => {
 const browsers = [
 { name: 'Chrome', regex: /Chrome\/([0-9.]+)/ },
 { name: 'Firefox', regex: /Firefox\/([0-9.]+)/ },
 { name: 'Safari', regex: /Safari\/([0-9.]+)/ },
 { name: 'Edge', regex: /Edge\/([0-9.]+)/ },
 { name: 'Opera', regex: /Opera\/([0-9.]+)/ },
 ];

 for (const browser of browsers) {
 const match = userAgent.match(browser.regex);
 if (match) {
 return { name: browser.name, version: match[1] };
 }
 }
 return { name: 'Unknown', version: 'Unknown' };
 };

 const browserInfo = getBrowserInfo();

 // Get OS information
 const getOSInfo = () => {
 const os = [
 { name: 'Windows', regex: /Windows NT ([0-9.]+)/ },
 { name: 'macOS', regex: /Mac OS X ([0-9_.]+)/ },
 { name: 'Linux', regex: /Linux/ },
 { name: 'Android', regex: /Android ([0-9.]+)/ },
 { name: 'iOS', regex: /OS ([0-9_]+)/ },
 ];

 for (const system of os) {
 const match = userAgent.match(system.regex);
 if (match) {
 return { name: system.name, version: match[1]?.replace(/_/g, '.') || 'Unknown' };
 }
 }
 return { name: 'Unknown', version: 'Unknown' };
 };

 const osInfo = getOSInfo();

 const payload = {
 activityType,
 activityData: activityData || {},
 pageUrl: window.location.href,
 pagePath: window.location.pathname,
 referrerUrl: document.referrer,
 userAgent,
 ipAddress: null, // Will be filled by server
 deviceType,
 browserName: browserInfo.name,
 browserVersion: browserInfo.version,
 osName: osInfo.name,
 osVersion: osInfo.version,
 screenResolution: `${window.screen.width}x${window.screen.height}`,
 success,
 errorMessage,
 metadata: {
 timestamp: Date.now(),
 sessionId: sessionStorage.getItem('sessionId') || 'anonymous',
 ...deviceInfo,
 },
 };

 // Fire and forget - don't wait for response
 apiRequest('/api/user-activity', {
 method: 'POST',
 data: payload,
 }).catch(() => {
 // Silently fail - activity tracking shouldn't break the app
 });
 } catch (error) {
 // Silently fail - activity tracking shouldn't break the app
 console.debug('Activity tracking failed:', error);
 }
 }, [user]);

 return { trackActivity };
}

// Page view tracker component
export function PageViewTracker({ page, data }: { page: string; data?: ActivityData }) {
 const { trackActivity } = useActivityTracker();

 useEffect(() => {
 const startTime = Date.now();

 // Track page view
 trackActivity('property_view', {
 page,
 viewType: 'page_view',
 ...data,
 });

 // Track time spent on page when leaving
 const handleBeforeUnload = () => {
 const duration = Date.now() - startTime;
 trackActivity('property_view', {
 page,
 viewType: 'page_leave',
 duration,
 ...data,
 });
 };

 window.addEventListener('beforeunload', handleBeforeUnload);

 return () => {
 window.removeEventListener('beforeunload', handleBeforeUnload);
 // Also track on component unmount
 const duration = Date.now() - startTime;
 trackActivity('property_view', {
 page,
 viewType: 'page_leave',
 duration,
 ...data,
 });
 };
 }, [page, trackActivity, data]);

 return null;
}

// Click tracker for important actions
export function ClickTracker({ 
 action, 
 data, 
 children, 
 className = '',
 ...props 
}: { 
 action: string; 
 data?: ActivityData; 
 children: React.ReactNode; 
 className?: string;
 [key: string]: any;
}) {
 const { trackActivity } = useActivityTracker();

 const handleClick = useCallback((event: React.MouseEvent) => {
 trackActivity('tenant_action', {
 action,
 elementType: 'click',
 clickTarget: event.currentTarget.tagName,
 clickText: event.currentTarget.textContent?.slice(0, 100),
 ...data,
 });

 // Call original onClick if provided
 if (props.onClick) {
 props.onClick(event);
 }
 }, [action, data, trackActivity, props.onClick]);

 return (
 <div 
 {...props} 
 onClick={handleClick}
 className={className}
 data-activity-action={action}
 >
 {children}
 </div>
 );
}

// Search tracker
export function SearchTracker() {
 const { trackActivity } = useActivityTracker();

 const trackSearch = useCallback((query: string, results: number, filters?: any) => {
 trackActivity('search', {
 query: query.slice(0, 100), // Limit query length for privacy
 resultsCount: results,
 filters,
 searchType: 'internal',
 });
 }, [trackActivity]);

 return { trackSearch };
}

// Error tracker
export function ErrorTracker() {
 const { trackActivity } = useActivityTracker();

 useEffect(() => {
 const handleError = (event: ErrorEvent) => {
 trackActivity('property_view', {
 errorType: 'javascript',
 errorMessage: event.message,
 errorFile: event.filename,
 errorLine: event.lineno,
 errorColumn: event.colno,
 stack: event.error?.stack,
 }, false, event.message);
 };

 const handleUnhandledRejection = (event: PromiseRejectionEvent) => {
 trackActivity('property_view', {
 errorType: 'promise_rejection',
 errorReason: event.reason?.toString(),
 }, false, 'Unhandled promise rejection');
 };

 window.addEventListener('error', handleError);
 window.addEventListener('unhandledrejection', handleUnhandledRejection);

 return () => {
 window.removeEventListener('error', handleError);
 window.removeEventListener('unhandledrejection', handleUnhandledRejection);
 };
 }, [trackActivity]);

 return null;
}

// Performance tracker
export function PerformanceTracker() {
 const { trackActivity } = useActivityTracker();

 useEffect(() => {
 // Track page load performance
 const trackPerformance = () => {
 if ('performance' in window && 'getEntriesByType' in window.performance) {
 setTimeout(() => {
 const navigation = performance.getEntriesByType('navigation')[0] as PerformanceNavigationTiming;
 if (navigation) {
 trackActivity('property_view', {
 performanceType: 'page_load',
 loadTime: navigation.loadEventEnd - navigation.loadEventStart,
 domContentLoaded: navigation.domContentLoadedEventEnd - navigation.domContentLoadedEventStart,
 firstPaint: performance.getEntriesByName('first-paint')[0]?.startTime || 0,
 firstContentfulPaint: performance.getEntriesByName('first-contentful-paint')[0]?.startTime || 0,
 networkTime: navigation.responseEnd - navigation.requestStart,
 renderTime: navigation.loadEventEnd - navigation.responseEnd,
 });
 }
 }, 1000); // Wait for page to fully load
 }
 };

 if (document.readyState === 'complete') {
 trackPerformance();
 } else {
 window.addEventListener('load', trackPerformance);
 }

 return () => {
 window.removeEventListener('load', trackPerformance);
 };
 }, [trackActivity]);

 return null;
}

// Main activity tracker component that wraps the app
export function ActivityTracker({ children }: ActivityTrackerProps) {
 const { user } = useAuth();
 const { trackActivity } = useActivityTracker();

 // Track login/logout
 useEffect(() => {
 if (user) {
 trackActivity('login', {
 loginMethod: 'jwt_auth',
 userRole: user.role,
 });
 }

 // Track logout on beforeunload
 const handleBeforeUnload = () => {
 if (user) {
 trackActivity('logout', {
 logoutType: 'session_end',
 });
 }
 };

 window.addEventListener('beforeunload', handleBeforeUnload);

 return () => {
 window.removeEventListener('beforeunload', handleBeforeUnload);
 };
 }, [user, trackActivity]);

 // Generate or retrieve session ID
 useEffect(() => {
 if (!sessionStorage.getItem('sessionId')) {
 sessionStorage.setItem('sessionId', `session_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`);
 }
 }, []);

 return (
 <>
 {children}
 <ErrorTracker />
 <PerformanceTracker />
 </>
 );
}

// Export utility function for manual tracking
export function trackManualActivity(
 activityType: string,
 data?: ActivityData,
 success: boolean = true,
 errorMessage?: string
) {
 // This is a fallback for cases where the hook can't be used
 try {
 apiRequest('/api/user-activity', {
 method: 'POST',
 data: {
 activityType,
 activityData: data || {},
 pageUrl: window.location.href,
 pagePath: window.location.pathname,
 success,
 errorMessage,
 metadata: {
 timestamp: Date.now(),
 sessionId: sessionStorage.getItem('sessionId') || 'anonymous',
 },
 },
 }).catch(() => {
 // Silently fail
 });
 } catch (error) {
 // Silently fail
 }
}