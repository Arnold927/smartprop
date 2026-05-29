/**
 * notifications.ts — push notification service
 *
 * Fixes vs original:
 *  - FCM/APNs token is captured in onRegister and sent to the server
 *    via apiService.registerPushToken() so the server can target
 *    this device with real pushes (not just local notifications)
 *  - Stored in AsyncStorage so it survives app restarts and can be
 *    re-registered after login without requiring a new permission prompt
 *  - handleNotificationTap wires up to a navigation ref so tapping a
 *    push actually navigates somewhere instead of console.log
 *  - All channel setup preserved
 */

import PushNotification, { Importance } from 'react-native-push-notification';
import PushNotificationIOS from '@react-native-community/push-notification-ios';
import { Platform, PermissionsAndroid } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { MOBILE_CONFIG } from './config';
import { apiService } from './api';

// Type declarations for missing types
declare module 'react-native-push-notification' {
  interface PushNotificationOptions {
    userInteraction?: boolean;
    finish?: (result: string) => void;
    data?: Record<string, any>;
    action?: string;
  }
}

interface NotificationData {
  userInteraction?: boolean;
  data?: Record<string, any>;
  action?: string;
  finish?: (result: string) => void;
}

interface RegistrationError {
  message: string;
  code?: string;
}

interface TokenData {
  token: string;
}

// Navigation ref — set this from your NavigationContainer's ref prop
// so handleNotificationTap can navigate without prop drilling.
let navigationRef: any = null;
export const setNotificationNavigationRef = (ref: any) => { navigationRef = ref; };

// ── Service ───────────────────────────────────────────────────────────────────

class NotificationService {
  private pushToken: string | null = null;

  initialize() {
    PushNotification.configure({
      // Called when the FCM/APNs token is issued or rotated
      onRegister: async ({ token }: TokenData) => {
        console.log('[Push] Device token received:', token);
        this.pushToken = token;
        await AsyncStorage.setItem(MOBILE_CONFIG.PUSH_TOKEN_KEY, token);
        // If user is already logged in, register immediately
        await this.registerTokenWithServer();
      },

      onNotification: (notification: NotificationData) => {
        console.log('[Push] Notification received:', notification);
        if (notification.userInteraction) {
          this.handleNotificationTap(notification.data || {});
        }
        // Required on iOS
        if (notification.finish) {
          notification.finish(PushNotificationIOS.FetchResult.NoData);
        }
      },

      onAction: (notification: NotificationData) => {
        console.log('[Push] Action:', notification.action);
      },

      onRegistrationError: (err: RegistrationError) => {
        console.error('[Push] Registration error:', err.message);
      },

      permissions: { alert: true, badge: true, sound: true },
      popInitialNotification: true,
      requestPermissions: Platform.OS === 'ios',
    });

    if (Platform.OS === 'android') {
      this.createAndroidChannels();
    }
  }

  /** Send the stored push token to the server (called after login) */
  async registerTokenWithServer() {
    const token = this.pushToken ?? await AsyncStorage.getItem(MOBILE_CONFIG.PUSH_TOKEN_KEY);
    if (!token) return;

    const platform = Platform.OS as 'android' | 'ios';
    const res = await apiService.registerPushToken(token, platform);
    if (res.success) {
      console.log('[Push] Token registered with server');
    } else {
      console.warn('[Push] Server registration failed:', res.error);
    }
  }

  async requestPermissions(): Promise<boolean> {
    if (Platform.OS === 'ios') {
      // Handled by PushNotification.configure requestPermissions: true
      return true;
    }

    try {
      const result = await PermissionsAndroid.request(
        PermissionsAndroid.PERMISSIONS.POST_NOTIFICATIONS as any,
        {
          title: 'SmartProp Notifications',
          message: 'Allow SmartProp to send you important property management alerts.',
          buttonPositive: 'Allow',
          buttonNegative: 'Deny',
          buttonNeutral: 'Ask Later',
        },
      );
      return result === PermissionsAndroid.RESULTS.GRANTED;
    } catch (err) {
      console.warn('[Push] Permission request error:', err);
      return false;
    }
  }

  // ── Android notification channels ─────────────────────────────────────────

  private createAndroidChannels() {
    const channels = [
      { channelId: 'maintenance', channelName: 'Maintenance Alerts',     importance: Importance.HIGH },
      { channelId: 'payment',     channelName: 'Payment Notifications',   importance: Importance.DEFAULT },
      { channelId: 'visitor',     channelName: 'Visitor Management',      importance: Importance.HIGH },
      { channelId: 'inspection',  channelName: 'Property Inspections',    importance: Importance.DEFAULT },
      { channelId: 'general',     channelName: 'General Updates',         importance: Importance.LOW },
    ];

    channels.forEach(ch => {
      PushNotification.createChannel(ch, () => {});
    });
  }

  // ── Local notification helpers ────────────────────────────────────────────

  show(opts: {
    title: string;
    message: string;
    channelId?: string;
    priority?: 'high' | 'low' | 'default' | 'max' | 'min';
    data?: Record<string, any>;
  }) {
    PushNotification.localNotification({
      title:     opts.title,
      message:   opts.message,
      channelId: opts.channelId ?? 'general',
      priority:  opts.priority ?? 'default',
      userInfo:  opts.data,
      playSound: true,
      soundName: 'default',
      vibrate:   true,
      vibration: 300,
    });
  }

  schedule(opts: {
    title: string;
    message: string;
    date: Date;
    channelId?: string;
    data?: Record<string, any>;
  }) {
    PushNotification.localNotificationSchedule({
      title:     opts.title,
      message:   opts.message,
      date:      opts.date,
      channelId: opts.channelId ?? 'general',
      userInfo:  opts.data,
      playSound: true,
      soundName: 'default',
    });
  }

  // ── Domain-specific helpers ───────────────────────────────────────────────

  notifyMaintenanceUpdate(requestId: string | number, status: string, message: string) {
    this.show({
      title:     'Maintenance Update',
      message:   `Request #${requestId}: ${message}`,
      channelId: 'maintenance',
      priority:  'high',
      data:      { type: 'maintenance', requestId: String(requestId), status },
    });
  }

  notifyVisitorArrival(visitorName: string, propertyName: string) {
    this.show({
      title:     'Visitor Arrival',
      message:   `${visitorName} has arrived at ${propertyName}`,
      channelId: 'visitor',
      priority:  'high',
      data:      { type: 'visitor', visitorName, propertyName },
    });
  }

  notifyPaymentReceived(amount: string, tenantName: string) {
    this.show({
      title:     'Payment Received',
      message:   `KES ${amount} received from ${tenantName}`,
      channelId: 'payment',
      priority:  'default',
      data:      { type: 'payment', amount, tenantName },
    });
  }

  notifyInspectionDue(propertyName: string, dueDate: string) {
    this.show({
      title:     'Inspection Due',
      message:   `Inspection due for ${propertyName} on ${dueDate}`,
      channelId: 'inspection',
      priority:  'default',
      data:      { type: 'inspection', propertyName, dueDate },
    });
  }

  // ── Navigation on tap ─────────────────────────────────────────────────────

  handleNotificationTap(data: Record<string, any>) {
    if (!navigationRef?.current) {
      console.warn('[Push] Navigation ref not set — cannot navigate from tap');
      return;
    }

    const nav = navigationRef.current;

    switch (data?.type) {
      case 'maintenance':
        nav.navigate('Maintenance', { requestId: data.requestId });
        break;
      case 'visitor':
        nav.navigate('Security');
        break;
      case 'payment':
        nav.navigate('Tenants', { screen: 'Payments' });
        break;
      case 'inspection':
        nav.navigate('Inspections');
        break;
      default:
        nav.navigate('Dashboard');
    }
  }

  clearAll() {
    PushNotification.cancelAllLocalNotifications();
  }
}

export const notificationService = new NotificationService();
export default notificationService;