# Smart Prop Mobile App Deployment Guide

## Overview
This guide covers deploying the Smart Prop mobile applications for Android and iOS, connecting them to your deployed web backend.

## Prerequisites
- React Native development environment set up
- Android Studio (for Android builds)
- Xcode (for iOS builds, macOS only)
- Node.js 16+ installed
- Smart Prop web backend deployed and accessible

## Current Configuration
The mobile apps are configured to connect to:
- **Production Backend**: `https://smart-prop-analytics-kapi2009.replit.app`
- **WhatsApp Support**: `+254724406054`
- **Business Name**: Smart Prop Support

## Quick Start

### 1. Install Dependencies
```bash
cd mobile-apps
npm install

# For iOS (macOS only)
cd ios && pod install && cd ..
```

### 2. Configure Environment
Update `src/services/config.ts` if needed:
```typescript
export const CONFIG = {
  production: {
    API_BASE_URL: 'https://smart-prop-analytics-kapi2009.replit.app',
    TIMEOUT: 15000,
  }
};
```

### 3. Build and Test

#### Android Development
```bash
# Start Metro bundler
npm start

# Run on Android device/emulator
npm run android
```

#### iOS Development (macOS only)
```bash
# Start Metro bundler
npm start

# Run on iOS simulator/device
npm run ios
```

## Production Builds

### Android APK/AAB Build
```bash
# Generate signed APK
npm run build:android

# The APK will be in: android/app/build/outputs/apk/release/
```

### iOS App Store Build
```bash
# Build for iOS App Store
npm run build:ios

# Use Xcode to archive and upload to App Store Connect
```

## App Store Deployment

### Android (Google Play Store)
1. **Prepare Release**:
   - Update version in `android/app/build.gradle`
   - Generate signed AAB: `./gradlew bundleRelease`
   - Test on multiple devices

2. **Play Console Upload**:
   - Upload AAB to Google Play Console
   - Configure store listing, screenshots, descriptions
   - Set up release tracks (internal → closed → open testing → production)

3. **App Details**:
   - **App Name**: Smart Prop - Property Management
   - **Package**: `com.smartprop.mobile`
   - **Description**: Comprehensive property management solution with real-time synchronization, maintenance tracking, and tenant management.

### iOS (Apple App Store)
1. **Prepare Release**:
   - Update version in `ios/SmartProp/Info.plist`
   - Configure code signing in Xcode
   - Archive build for distribution

2. **App Store Connect**:
   - Upload build via Xcode or Transporter
   - Configure app information and metadata
   - Submit for review

3. **App Details**:
   - **App Name**: Smart Prop - Property Management
   - **Bundle ID**: `com.smartprop.mobile`
   - **Description**: Professional property management app with offline support, real-time analytics, and comprehensive maintenance tracking.

## Features Included in Mobile App

### Core Functionality
✅ **Dashboard**: Real-time property analytics and metrics
✅ **Properties**: Property management and inspections
✅ **Tenants**: Tenant information and communication
✅ **Maintenance**: Work order management with photo capture
✅ **Inspections**: Property inspection with GPS tagging
✅ **Security**: QR code scanning and visitor management
✅ **Settings**: User preferences and sync controls

### Mobile-Specific Features
✅ **Offline Support**: Works without internet, syncs when online
✅ **Push Notifications**: Real-time alerts and updates
✅ **Camera Integration**: Photo capture for maintenance and inspections
✅ **GPS Location**: Location tagging for property visits
✅ **QR Code Scanner**: Quick access to properties and units
✅ **WhatsApp Integration**: Direct support contact
✅ **Biometric Auth**: Fingerprint/Face ID login (if supported)

## API Integration
The mobile apps connect to the same backend as your web application:
- **Authentication**: Uses same login system as web app
- **Data Sync**: Real-time synchronization with web dashboard
- **Offline Storage**: Local SQLite database for offline functionality
- **Push Notifications**: Firebase/APNs integration for real-time alerts

## Troubleshooting

### Common Issues
1. **API Connection Failed**:
   - Verify backend URL in config
   - Check network connectivity
   - Ensure CORS is configured for mobile domains

2. **Authentication Issues**:
   - Clear app data and re-login
   - Verify session management between web and mobile
   - Check token expiration handling

3. **Build Failures**:
   - Clean build: `npm run clean`
   - Reset Metro cache: `npx react-native start --reset-cache`
   - Rebuild node_modules: `rm -rf node_modules && npm install`

### Performance Optimization
- Enable Hermes JavaScript engine (Android)
- Use Flipper for debugging
- Implement image optimization for photo uploads
- Configure ProGuard for smaller APK size

## Monitoring and Analytics
- Integrate Crashlytics for crash reporting
- Set up Firebase Analytics for user behavior
- Monitor API performance and response times
- Track offline/online usage patterns

## Support and Maintenance
- Regular updates to match web platform features
- OS compatibility testing (iOS 12+, Android 7+)
- Security updates and dependency maintenance
- User feedback integration and feature requests

## Next Steps
1. Test on multiple device types and OS versions
2. Set up CI/CD pipeline for automated builds
3. Configure app store optimization (ASO)
4. Plan feature rollout and user onboarding
5. Set up user feedback and support channels

For technical support, contact: +254724406054 (WhatsApp)