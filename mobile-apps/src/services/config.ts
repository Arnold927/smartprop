/**
 * Mobile app configuration
 *
 * API_BASE_URL resolution order:
 *  1. REACT_NATIVE_API_URL env var (set in CI / EAS build profile)
 *  2. __DEV__ → LAN IP so a physical device can reach the dev server.
 *     Run `ipconfig` (Windows) or `ifconfig` (Mac/Linux), paste your
 *     machine's LAN IP into DEV_LAN_URL below.
 *  3. Production fallback.
 *
 * NEVER use 'localhost' on a real device — it resolves to the device itself.
 */

const ENV_URL = (globalThis as any).REACT_NATIVE_API_URL as string | undefined;

// ── Set this to your LAN IP when running the dev server locally ───────────────
const DEV_LAN_URL = 'http://192.168.1.100:5000';
// ─────────────────────────────────────────────────────────────────────────────

const PROD_URL = 'https://your-domain.com'; // ← update before production build

export const API_BASE_URL: string = ENV_URL ?? (__DEV__ ? DEV_LAN_URL : PROD_URL);
export const WS_BASE_URL: string  = API_BASE_URL.replace(/^http/, 'ws');

export const MOBILE_CONFIG = {
  AUTH_TOKEN_KEY:    '@smartprop:access_token',
  REFRESH_TOKEN_KEY: '@smartprop:refresh_token',
  USER_KEY:          '@smartprop:user',
  PUSH_TOKEN_KEY:    '@smartprop:push_token',

  SYNC_INTERVAL:   5 * 60 * 1000,
  OFFLINE_QUEUE_KEY: '@smartprop:offline_queue',

  MAX_PHOTO_SIZE: 5 * 1024 * 1024,
  PHOTO_QUALITY:  0.8,

  NOTIFICATION_CHANNEL_ID:   'smartprop_notifications',
  NOTIFICATION_CHANNEL_NAME: 'SmartProp Notifications',

  REQUEST_TIMEOUT: __DEV__ ? 10_000 : 15_000,
};

export const FEATURES = {
  OFFLINE_MODE:       true,
  PUSH_NOTIFICATIONS: true,
  BIOMETRIC_AUTH:     true,
  LOCATION_TRACKING:  true,
  CAMERA_INTEGRATION: true,
  QR_CODE_SCANNING:   true,
};

export default { API_BASE_URL, WS_BASE_URL, MOBILE_CONFIG, FEATURES };