/**
 * Type declaration shim for react-native-geolocation-service.
 *
 * The package is listed in package.json (v5.3.1) and is installed during
 * the native build (npm install / pod install). This shim satisfies
 * TypeScript in environments where node_modules is not fully present
 * (e.g. CI type-checks, VS Code without a full install).
 *
 * The real types ship with the package itself — this shim mirrors the
 * public API surface used in this project.
 */

declare module 'react-native-geolocation-service' {
  export interface GeoCoordinates {
    latitude: number;
    longitude: number;
    altitude: number | null;
    accuracy: number;
    altitudeAccuracy: number | null;
    heading: number | null;
    speed: number | null;
  }

  export interface GeoPosition {
    coords: GeoCoordinates;
    timestamp: number;
  }

  export interface GeoError {
    code: number;
    message: string;
    PERMISSION_DENIED: number;
    POSITION_UNAVAILABLE: number;
    TIMEOUT: number;
  }

  export interface GeoOptions {
    timeout?: number;
    maximumAge?: number;
    enableHighAccuracy?: boolean;
    distanceFilter?: number;
    showLocationDialog?: boolean;
    forceRequestLocation?: boolean;
    forceLocationManager?: boolean;
    showsBackgroundLocationIndicator?: boolean;
  }

  type SuccessCallback = (position: GeoPosition) => void;
  type ErrorCallback = (error: GeoError) => void;

  const Geolocation: {
    getCurrentPosition(
      successCallback: SuccessCallback,
      errorCallback?: ErrorCallback,
      options?: GeoOptions,
    ): void;

    watchPosition(
      successCallback: SuccessCallback,
      errorCallback?: ErrorCallback,
      options?: GeoOptions,
    ): number;

    clearWatch(watchId: number): void;

    stopObserving(): void;

    requestAuthorization(
      authorizationLevel: 'always' | 'whenInUse',
    ): Promise<'disabled' | 'granted' | 'denied' | 'restricted'>;
  };

  export default Geolocation;
}