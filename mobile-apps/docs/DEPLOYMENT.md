# Smart Prop Mobile App Deployment Guide

## Overview
This guide covers the deployment process for Smart Prop's Android and iOS mobile applications that integrate with the centralized web dashboard.

## Architecture
The mobile applications are built with React Native and connect to the main web application's backend API. All mobile data feeds into the centralized web dashboard for unified property management.

## Prerequisites

### Development Environment
- Node.js 18+ 
- React Native CLI
- Android Studio (for Android builds)
- Xcode (for iOS builds, macOS only)
- Java Development Kit (JDK) 11

### Android Requirements
- Android SDK 30+
- Android NDK
- Gradle 7.0+
- Minimum Android version: 7.0 (API level 24)

### iOS Requirements  
- iOS 12.0+
- Xcode 13+
- CocoaPods
- Valid Apple Developer Account

## Installation

1. **Clone and Install Dependencies**
```bash
cd mobile-apps
npm install
```

2. **Install iOS Dependencies** (iOS only)
```bash
cd ios && pod install && cd ..
```

3. **Configure Environment**
```bash
# Copy environment template
cp .env.example .env

# Update API endpoints to match your web application
API_BASE_URL=https://your-smartprop-domain.com
```

## Building for Development

### Android Development
```bash
# Start Metro bundler
npm start

# Run on Android emulator/device
npm run android
```

### iOS Development
```bash
# Run on iOS simulator/device
npm run ios
```

## Production Builds

### Android Production Build
```bash
# Generate signed APK
cd android
./gradlew assembleRelease

# Generate Android App Bundle (recommended for Play Store)
./gradlew bundleRelease
```

The built files will be in:
- APK: `android/app/build/outputs/apk/release/app-release.apk`
- AAB: `android/app/build/outputs/bundle/release/app-release.aab`

### iOS Production Build
```bash
# Open in Xcode for archive and distribution
open ios/SmartPropMobile.xcworkspace

# Or build from command line
xcodebuild -workspace ios/SmartPropMobile.xcworkspace \
  -scheme SmartPropMobile \
  -configuration Release \
  -archivePath build/SmartPropMobile.xcarchive \
  archive
```

## Store Deployment

### Google Play Store
1. **Prepare Store Listing**
   - App name: "Smart Prop Mobile"
   - Package name: `com.smartprop.mobile`
   - Description: Property management on-the-go
   - Screenshots from mobile-apps/screenshots/

2. **Upload Build**
   - Use Android App Bundle (.aab file)
   - Set up internal testing first
   - Configure release management

3. **Required Permissions**
   ```xml
   <uses-permission android:name="android.permission.CAMERA" />
   <uses-permission android:name="android.permission.ACCESS_FINE_LOCATION" />
   <uses-permission android:name="android.permission.INTERNET" />
   <uses-permission android:name="android.permission.VIBRATE" />
   ```

### Apple App Store
1. **Prepare Store Listing**
   - App name: "Smart Prop Mobile"
   - Bundle ID: `com.smartprop.mobile`
   - Category: Business
   - Screenshots from mobile-apps/screenshots/

2. **Upload Build**
   - Use Xcode or Application Loader
   - Submit for TestFlight beta testing
   - Submit for App Store review

3. **Required Info.plist Entries**
   ```xml
   <key>NSCameraUsageDescription</key>
   <string>Take photos for property inspections and maintenance reports</string>
   <key>NSLocationWhenInUseUsageDescription</key>
   <string>Location needed for property inspections and service tracking</string>
   ```

## App Configuration

### Backend Integration
The mobile apps connect to your main Smart Prop web application:

```typescript
// Update src/services/config.ts
export const API_BASE_URL = 'https://your-domain.replit.app';
```

### Feature Configuration
Enable/disable mobile features in `src/services/config.ts`:

```typescript
export const FEATURES = {
  OFFLINE_MODE: true,        // Cache data for offline use
  PUSH_NOTIFICATIONS: true,  // Property alerts and updates  
  BIOMETRIC_AUTH: true,      // Fingerprint/Face ID login
  LOCATION_TRACKING: true,   // GPS for property visits
  CAMERA_INTEGRATION: true,  // Photo capture for inspections
  QR_CODE_SCANNING: true,    // Visitor access management
};
```

## Centralized Dashboard Integration

### Data Synchronization
Mobile apps automatically sync data to the web dashboard:

- **Property Inspections**: Real-time inspection reports with photos
- **Maintenance Requests**: Field-submitted work orders  
- **Visitor Management**: QR code scans and check-ins
- **Security Operations**: Gate pass creation and vehicle registration
- **Analytics**: Mobile usage tracking and platform distribution

### Dashboard Features
The web application's Mobile Dashboard displays:

- Live mobile user activity (45 users: 28 Android, 17 iOS)
- Real-time action feed from mobile apps
- Platform-specific analytics and charts
- Mobile feature usage statistics

### API Endpoints
Mobile apps use these backend endpoints:

- `GET /api/mobile/analytics` - Mobile usage analytics
- `POST /api/properties/:id/inspections` - Property inspection submission
- `POST /api/mobile/maintenance` - Maintenance request creation  
- `POST /api/mobile/qr-scan` - QR code processing
- `POST /api/mobile/visitors/checkin` - Visitor check-in

## Testing

### Pre-deployment Testing
1. **Functional Testing**
   - Login/authentication flow
   - Property inspection workflow
   - Maintenance request submission
   - QR code scanning
   - Visitor check-in process

2. **Integration Testing**  
   - API connectivity to web backend
   - Data synchronization accuracy
   - Real-time dashboard updates
   - Offline mode functionality

3. **Performance Testing**
   - App startup time < 3 seconds
   - Photo upload performance
   - Battery usage optimization
   - Memory usage monitoring

### Device Testing Matrix
- **Android**: Samsung Galaxy S20+, Google Pixel 6, OnePlus 9
- **iOS**: iPhone 12, iPhone 13 Pro, iPad Air 4
- **OS Versions**: Android 10-14, iOS 14-17

## Monitoring and Analytics

### Performance Monitoring
- Crash reporting via React Native's built-in tools
- API response time monitoring
- User session tracking
- Feature usage analytics

### Dashboard Metrics
Monitor mobile app performance through the web dashboard:
- Active mobile sessions
- Daily mobile actions
- Platform distribution trends
- Feature adoption rates

## Troubleshooting

### Common Issues

1. **API Connection Failures**
   ```bash
   # Check API endpoint configuration
   cat src/services/config.ts
   
   # Verify network connectivity
   npm run test:api
   ```

2. **Build Failures**
   ```bash
   # Clean builds
   npm run clean
   
   # Reset Metro cache
   npm run reset-cache
   ```

3. **Performance Issues**
   ```bash
   # Enable performance monitoring
   npm run debug:performance
   
   # Analyze bundle size
   npm run analyze
   ```

## Security Considerations

### Data Protection
- All API communications use HTTPS
- User authentication tokens stored securely
- Local data encrypted on device
- Photos compressed before upload

### Permissions
- Camera: Property inspection photos
- Location: Property visit tracking
- Notifications: Maintenance alerts
- Storage: Offline data caching

## Support and Maintenance

### Version Management
- Semantic versioning (1.0.0)
- Regular security updates
- Feature updates coordinated with web app
- Backward compatibility maintenance

### User Support
- In-app help documentation
- Contact support integration
- Feedback collection system
- Error reporting mechanism

## Deployment Checklist

- [ ] Backend API endpoints configured
- [ ] Mobile app builds tested on devices
- [ ] Store listings prepared with screenshots
- [ ] App permissions configured correctly
- [ ] Push notifications set up
- [ ] Analytics tracking implemented
- [ ] Security review completed
- [ ] Performance benchmarks met
- [ ] Beta testing completed
- [ ] Store submission ready

This deployment guide ensures successful launch of Smart Prop's mobile applications with full integration to the centralized web dashboard system.