# Smart Prop Mobile App Deployment Guide

## Overview
This guide covers the deployment process for Smart Prop mobile applications on Android and iOS platforms.

## Prerequisites
- React Native development environment set up
- Android Studio (for Android builds)
- Xcode (for iOS builds)
- Google Play Console account (for Android deployment)
- Apple Developer Account (for iOS deployment)

## Android Deployment

### 1. Build Configuration
```bash
cd mobile-apps/android
./gradlew assembleRelease
```

### 2. Signing Configuration
Create `android/app/my-upload-key.keystore`:
```bash
keytool -genkeypair -v -storetype PKCS12 -keystore my-upload-key.keystore -alias my-key-alias -keyalg RSA -keysize 2048 -validity 10000
```

Add to `android/gradle.properties`:
```
MYAPP_UPLOAD_STORE_FILE=my-upload-key.keystore
MYAPP_UPLOAD_KEY_ALIAS=my-key-alias
MYAPP_UPLOAD_STORE_PASSWORD=***
MYAPP_UPLOAD_KEY_PASSWORD=***
```

### 3. Google Play Store Upload
1. Generate signed APK/AAB
2. Upload to Google Play Console
3. Configure app listing and metadata
4. Submit for review

## iOS Deployment

### 1. Xcode Configuration
```bash
cd mobile-apps/ios
xcodebuild -workspace SmartProp.xcworkspace -scheme SmartProp -configuration Release
```

### 2. App Store Connect
1. Archive build in Xcode
2. Upload to App Store Connect
3. Configure app information
4. Submit for App Store review

## Environment Configuration

### Production API Endpoints
Update API base URLs for production:
- Android: Update `BuildConfig.API_BASE_URL` in build.gradle
- iOS: Update API endpoints in Info.plist

### Firebase Setup
1. Create Firebase project
2. Add Android and iOS apps
3. Download configuration files:
   - `google-services.json` for Android
   - `GoogleService-Info.plist` for iOS

### Push Notifications
Configure FCM for cross-platform push notifications:
```javascript
// In NotificationService.ts
const fcmToken = await messaging().getToken();
// Send token to server for targeted notifications
```

## Feature-Specific Configurations

### Camera and Photo Permissions
Ensure proper permissions in:
- Android: `android/app/src/main/AndroidManifest.xml`
- iOS: `ios/SmartProp/Info.plist`

### Location Services
Configure location permissions for property inspections:
```xml
<!-- Android -->
<uses-permission android:name="android.permission.ACCESS_FINE_LOCATION" />

<!-- iOS -->
<key>NSLocationWhenInUseUsageDescription</key>
<string>Smart Prop needs location for property inspections</string>
```

### QR Code Scanning
Include camera permissions and ZXing library configuration.

## Performance Optimization

### Bundle Size Optimization
```bash
# Analyze bundle size
npx react-native bundle --platform android --dev false --entry-file index.js --bundle-output android-bundle.js --analyze

# Enable Hermes for faster startup
android {
  project.ext.react = [
    enableHermes: true
  ]
}
```

### ProGuard Configuration
Enable code shrinking in `android/app/build.gradle`:
```gradle
buildTypes {
    release {
        minifyEnabled true
        proguardFiles getDefaultProguardFile("proguard-android.txt"), "proguard-rules.pro"
    }
}
```

## Testing Strategy

### Device Testing
Test on various devices:
- Android: Various screen sizes, API levels
- iOS: Different iPhone/iPad models

### Integration Testing
Verify API integration with web platform:
- Authentication flow
- Data synchronization
- Real-time updates

### Performance Testing
Monitor app performance:
- Launch time
- Memory usage
- Battery consumption
- Network efficiency

## Monitoring and Analytics

### Crash Reporting
Implement crash reporting:
```javascript
import crashlytics from '@react-native-firebase/crashlytics';

crashlytics().recordError(error);
```

### Analytics
Track user engagement:
```javascript
import analytics from '@react-native-firebase/analytics';

analytics().logEvent('property_inspection_completed', {
  property_id: propertyId,
  duration: inspectionDuration
});
```

## Maintenance and Updates

### Over-the-Air Updates
Consider CodePush for JavaScript updates:
```bash
npm install -g code-push-cli
code-push release-react SmartProp-Android android
```

### Version Management
Maintain consistent versioning:
- Semantic versioning (1.0.0, 1.0.1, etc.)
- Build numbers for each release
- Changelog documentation

## Security Considerations

### API Security
- Use HTTPS for all API communications
- Implement certificate pinning
- Secure token storage

### Data Protection
- Encrypt sensitive data
- Implement biometric authentication
- Secure offline data storage

## Deployment Checklist

### Pre-Deployment
- [ ] Test on physical devices
- [ ] Verify API integration
- [ ] Check permissions and configurations
- [ ] Performance testing completed
- [ ] Security audit passed

### Deployment
- [ ] Build signed releases
- [ ] Upload to app stores
- [ ] Configure store listings
- [ ] Submit for review
- [ ] Monitor review process

### Post-Deployment
- [ ] Monitor crash reports
- [ ] Track user analytics
- [ ] Gather user feedback
- [ ] Plan next iteration

## Support and Documentation

### User Documentation
- In-app help and tutorials
- Feature explanation screens
- Contact support information

### Developer Documentation
- API integration guide
- Feature implementation details
- Troubleshooting guide

This deployment guide ensures successful release of Smart Prop mobile applications with proper configuration, testing, and monitoring in place.