/**
 * notifications.ts — Expo push notification service
 *
 * Migration from react-native-push-notification → expo-notifications:
 *  - expo-notifications works in both Expo Go and bare workflow (EAS Build)
 *  - Generates an Expo Push Token (for Expo's push service) or a native
 *    FCM/APNs token via getDevicePushTokenAsync() for direct server-side push
 *  - Channels created on Android so each alert type has correct priority/sound
 *  - handleNotificationTap wired to navigationRef so tapping a push navigates
 *  - Token registered with backend via apiService.registerPushToken()
 *
 * Required packages (add to package.json / run expo install):
 *   expo-notifications
 *   expo-device
 */

import * as Notifications from 'expo-notifications';
import * as Device from 'expo-device';
import { Platform } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { MOBILE_CONFIG } from './config';
import { apiService } from './api';

// ── Global handler: show banner even when app is foregrounded ─────────────────
Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowAlert: true,
    shouldPlaySound: true,
    shouldSetBadge:  true,
  }),
});

// Navigation ref — set this from NavigationContainer's ref so tap → navigate
let navigationRef: any = null;
export const setNotificationNavigationRef = (ref: any) => {
  navigationRef = ref;
};

// ── Android notification channels ─────────────────────────────────────────────

async function createAndroidChannels() {
  if (Platform.OS !== 'android') return;

  const channels: Notifications.NotificationChannelInput[] = [
    {
      name:       'Maintenance Alerts',
      importance: Notifications.AndroidImportance.HIGH,
      vibrationPattern: [0, 250, 250, 250],
      sound: 'default',
    },
    {
      name:       'Payment Notifications',
      importance: Notifications.AndroidImportance.DEFAULT,
      sound: 'default',
    },
    {
      name:       'Visitor Management',
      importance: Notifications.AndroidImportance.HIGH,
      vibrationPattern: [0, 250, 250, 250],
      sound: 'default',
    },
    {
      name:       'Property Inspections',
      importance: Notifications.AndroidImportance.DEFAULT,
      sound: 'default',
    },
    {
      name:       'General Updates',
      importance: Notifications.AndroidImportance.LOW,
    },
  ];

  // Channel IDs match the string keys used in show()
  const ids = ['maintenance', 'payment', 'visitor', 'inspection', 'general'];

  await Promise.all(
    channels.map((ch, i) =>
      Notifications.setNotificationChannelAsync(ids[i], ch),
    ),
  );
}

// ── Service class ─────────────────────────────────────────────────────────────

class NotificationService {
  private tapSubscription:      Notifications.Subscription | null = null;
  private receiveSubscription:  Notifications.Subscription | null = null;

  async initialize() {
    await createAndroidChannels();

    // Listen for taps (user interaction with a notification)
    this.tapSubscription = Notifications.addNotificationResponseReceivedListener(
      (response) => {
        const data = response.notification.request.content.data as Record<string, any>;
        this.handleNotificationTap(data);
      },
    );

    // Listen for foreground notifications
    this.receiveSubscription = Notifications.addNotificationReceivedListener(
      (notification) => {
        console.log('[Push] Foreground notification:', notification.request.content.title);
      },
    );

    // Register for push token if on a physical device
    await this.registerForPushNotifications();
  }

  /** Request permission and obtain the Expo push token */
  async registerForPushNotifications(): Promise<string | null> {
    if (!Device.isDevice) {
      console.warn('[Push] Must be on a physical device to receive push notifications');
      return null;
    }

    const { status: existingStatus } = await Notifications.getPermissionsAsync();
    let finalStatus = existingStatus;

    if (existingStatus !== 'granted') {
      const { status } = await Notifications.requestPermissionsAsync();
      finalStatus = status;
    }

    if (finalStatus !== 'granted') {
      console.warn('[Push] Permission not granted');
      return null;
    }

    try {
      // projectId is required for Expo push tokens in SDK 49+
      // Set EXPO_PROJECT_ID in your app.json or pass it here
      const tokenData = await Notifications.getExpoPushTokenAsync();
      const token = tokenData.data;

      await AsyncStorage.setItem(MOBILE_CONFIG.PUSH_TOKEN_KEY, token);
      await this.registerTokenWithServer(token);
      return token;
    } catch (err) {
      console.error('[Push] Token fetch failed:', err);
      return null;
    }
  }

  /** Re-register stored token after login (avoids re-prompting) */
  async registerTokenWithServer(token?: string) {
    const t = token ?? await AsyncStorage.getItem(MOBILE_CONFIG.PUSH_TOKEN_KEY);
    if (!t) return;

    const platform = Platform.OS as 'android' | 'ios';
    const res = await apiService.registerPushToken(t, platform);

    if (res.success) {
      console.log('[Push] Token registered with server');
    } else {
      console.warn('[Push] Server registration failed:', res.error);
    }
  }

  // ── Local notification helpers ──────────────────────────────────────────────

  async show(opts: {
    title:     string;
    body:      string;
    channelId?: string;
    data?:     Record<string, any>;
    badge?:    number;
  }) {
    await Notifications.scheduleNotificationAsync({
      content: {
        title:    opts.title,
        body:     opts.body,
        data:     opts.data ?? {},
        badge:    opts.badge,
        sound:    'default',
        ...(Platform.OS === 'android'
          ? { categoryIdentifier: opts.channelId ?? 'general' }
          : {}),
      },
      trigger: null, // deliver immediately
    });
  }

  async schedule(opts: {
    title:     string;
    body:      string;
    date:      Date;
    channelId?: string;
    data?:     Record<string, any>;
  }) {
    await Notifications.scheduleNotificationAsync({
      content: {
        title: opts.title,
        body:  opts.body,
        data:  opts.data ?? {},
        sound: 'default',
      },
      trigger: { date: opts.date },
    });
  }

  // ── Domain-specific helpers ─────────────────────────────────────────────────

  async notifyMaintenanceUpdate(requestId: string | number, status: string, message: string) {
    await this.show({
      title:     'Maintenance Update',
      body:      `Request #${requestId}: ${message}`,
      channelId: 'maintenance',
      data:      { type: 'maintenance', requestId: String(requestId), status },
    });
  }

  async notifyVisitorArrival(visitorName: string, propertyName: string) {
    await this.show({
      title:     'Visitor Arrival',
      body:      `${visitorName} has arrived at ${propertyName}`,
      channelId: 'visitor',
      data:      { type: 'visitor', visitorName, propertyName },
    });
  }

  async notifyPaymentReceived(amount: string, tenantName: string) {
    await this.show({
      title:     'Payment Received',
      body:      `KES ${amount} received from ${tenantName}`,
      channelId: 'payment',
      data:      { type: 'payment', amount, tenantName },
    });
  }

  async notifyInspectionDue(propertyName: string, dueDate: string) {
    await this.show({
      title:     'Inspection Due',
      body:      `Inspection due for ${propertyName} on ${dueDate}`,
      channelId: 'inspection',
      data:      { type: 'inspection', propertyName, dueDate },
    });
  }

  // ── Navigation on tap ───────────────────────────────────────────────────────

  handleNotificationTap(data: Record<string, any>) {
    if (!navigationRef?.current) {
      console.warn('[Push] Navigation ref not set — cannot navigate from tap');
      return;
    }
    const nav = navigationRef.current;
    switch (data?.type) {
      case 'maintenance': nav.navigate('Maintenance', { requestId: data.requestId }); break;
      case 'visitor':     nav.navigate('Security');                                   break;
      case 'payment':     nav.navigate('Tenants');                                    break;
      case 'inspection':  nav.navigate('Inspections');                                break;
      default:            nav.navigate('Dashboard');
    }
  }

  /** Clean up listeners (call in App.tsx cleanup if needed) */
  destroy() {
    this.tapSubscription?.remove();
    this.receiveSubscription?.remove();
  }

  async clearAll() {
    await Notifications.dismissAllNotificationsAsync();
    await Notifications.cancelAllScheduledNotificationsAsync();
  }
}

export const notificationService = new NotificationService();
export default notificationService;
