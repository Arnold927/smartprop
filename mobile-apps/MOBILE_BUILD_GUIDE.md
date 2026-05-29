# Smart Prop - Mobile App Build Guide

## 📱 Overview

Smart Prop has **BOTH** web and mobile applications:

### Web Application (Primary)
- **Location**: `client/`, `server/`, `shared/`
- **Tech**: React + Express + PostgreSQL
- **Access**: http://localhost:5000
- **Status**: ✅ Fully operational

### Mobile Applications (Connected)
- **Location**: `mobile-apps/`
- **Tech**: React Native for Android & iOS
- **Backend**: Uses the **same API** from web app
- **Status**: ✅ Native build files now complete

---

## 🏗️ Architecture

```
┌─────────────────────────────────────────┐
│         Web Application (Port 5000)      │
│  ┌─────────────┐      ┌──────────────┐  │
│  │   React     │      │   Express    │  │
│  │   Frontend  │◄────►│   Backend    │  │
│  └─────────────┘      └──────────────┘  │
│                              ▲           │
└──────────────────────────────┼───────────┘
                               │ API
                ┌──────────────┴──────────────┐
                │                             │
         ┌──────▼──────┐             ┌───────▼──────┐
         │   Android   │             │     iOS      │
         │     App     │             │     App      │
         │ (React RN)  │             │ (React RN)   │
         └─────────────┘             └──────────────┘
```

---

## 📋 Prerequisites

### For Android Development:
- ✅ **Java Development Kit (JDK)** 11 or higher
- ✅ **Android Studio** (includes Android SDK)
- ✅ **Android SDK** (API Level 33+)
- ✅ **Node.js** 16+ (same as web app)

### For iOS Development (Mac only):
- ✅ **Xcode** 14+ (from App Store)
- ✅ **CocoaPods** (`gem install cocoapods`)
- ✅ **Node.js** 16+

---

## 🚀 Quick Start

### Step 1: Install Mobile Dependencies

```bash
cd mobile-apps
npm install
```

### Step 2: Start the Web Backend

The mobile apps need the backend API running:

```bash
# In the root directory (not mobile-apps)
cd ..
npm run dev
```

This starts the backend on port 5000.

### Step 3A: Run Android App

```bash
cd mobile-apps

# Start Metro bundler
npm start

# In another terminal, run Android
npm run android
```

### Step 3B: Run iOS App (Mac only)

```bash
cd mobile-apps

# Install iOS dependencies
cd ios
pod install
cd ..

# Start Metro bundler
npm start

# In another terminal, run iOS
npm run ios
```

---

## 🔨 Building for Production

### Android APK/AAB

```bash
cd mobile-apps

# Build debug APK (for testing)
npm run build:android

# Output: android/app/build/outputs/apk/release/app-release.apk
```

For **signed release builds**:

```bash
cd android

# Generate keystore (first time only)
keytool -genkeypair -v -storetype PKCS12 -keystore smartprop-release.keystore -alias smartprop-key -keyalg RSA -keysize 2048 -validity 10000

# Edit android/gradle.properties and add:
# MYAPP_UPLOAD_STORE_FILE=smartprop-release.keystore
# MYAPP_UPLOAD_KEY_ALIAS=smartprop-key
# MYAPP_UPLOAD_STORE_PASSWORD=your_password
# MYAPP_UPLOAD_KEY_PASSWORD=your_password

# Build signed release
./gradlew bundleRelease

# Output: android/app/build/outputs/bundle/release/app-release.aab
```

### iOS IPA

```bash
cd mobile-apps/ios

# Open in Xcode
open SmartProp.xcworkspace

# Then in Xcode:
# 1. Select Product > Archive
# 2. Distribute App > Ad Hoc/App Store
# 3. Follow the signing wizard
```

---

## 📱 Connecting to Backend

### Local Development

Edit `mobile-apps/src/services/config.ts`:

```typescript
export const API_BASE_URL = __DEV__ 
  ? 'http://localhost:5000/api'  // Local web backend
  : 'https://your-domain.com/api';  // Production
```

### Testing on Physical Device

If testing on a physical device, use your computer's IP:

```typescript
export const API_BASE_URL = __DEV__
  ? 'http://192.168.1.100:5000/api'  // Replace with your IP
  : 'https://your-domain.com/api';
```

Find your IP:
- **Mac/Linux**: `ifconfig | grep inet`
- **Windows**: `ipconfig`

---

## 🧪 Testing Mobile Apps

### Run on Emulator/Simulator

**Android Emulator:**
```bash
# List available devices
emulator -list-avds

# Start emulator
emulator -avd Pixel_5_API_33

# Run app
npm run android
```

**iOS Simulator:**
```bash
# List available simulators
xcrun simctl list devices

# Run on specific device
npm run ios -- --simulator="iPhone 14 Pro"
```

### Run on Physical Device

**Android:**
1. Enable Developer Options on phone
2. Enable USB Debugging
3. Connect via USB
4. Run: `adb devices` to verify
5. Run: `npm run android`

**iOS:**
1. Connect iPhone via USB
2. Trust computer on device
3. Open Xcode
4. Select your device
5. Click Run

---

## 📂 Project Structure

```
mobile-apps/
├── android/              ✅ Complete Android project
│   ├── gradlew          ✅ Gradle wrapper (now added)
│   ├── gradlew.bat      ✅ Windows Gradle wrapper
│   ├── build.gradle     ✅ Project-level build config
│   ├── settings.gradle  ✅ Project settings
│   └── app/
│       ├── build.gradle ✅ App-level build config
│       └── src/main/    ✅ Android source code
├── ios/                  ✅ Complete iOS project
│   ├── Podfile          ✅ CocoaPods dependencies
│   ├── SmartProp.xcodeproj ✅ Xcode project
│   └── SmartProp/       ✅ iOS source code
├── src/                  ✅ React Native source
│   ├── screens/         ✅ App screens
│   ├── components/      ✅ Reusable components
│   └── services/        ✅ API & utilities
├── index.js             ✅ App entry point
├── package.json         ✅ Dependencies
└── metro.config.js      ✅ Metro bundler config
```

---

## 🔄 How Web & Mobile Work Together

### 1. Shared Backend API
Both web and mobile use the **same Express backend**:
- Properties, tenants, maintenance requests
- Authentication, payments, documents
- All business logic is centralized

### 2. Different Frontend
- **Web**: React with Tailwind CSS (desktop/browser)
- **Mobile**: React Native (native iOS/Android)

### 3. Data Sync
Mobile apps automatically sync with backend:
- Real-time updates via API polling
- Offline support with local SQLite cache
- Auto-sync when connection restored

---

## 🛠️ Common Issues & Solutions

### Android Build Issues

**Issue**: "SDK location not found"
```bash
# Create local.properties in android/
echo "sdk.dir=/Users/YOUR_USERNAME/Library/Android/sdk" > android/local.properties
# (Replace path with your Android SDK location)
```

**Issue**: "Gradle build failed"
```bash
cd android
./gradlew clean
./gradlew assembleDebug
```

### iOS Build Issues

**Issue**: "Pod install failed"
```bash
cd ios
rm -rf Pods Podfile.lock
pod install --repo-update
```

**Issue**: "Code signing error"
```
1. Open Xcode
2. Select project
3. Signing & Capabilities
4. Select your Team
```

### Metro Bundler Issues

**Issue**: "Metro bundler stuck"
```bash
# Clear Metro cache
npm start -- --reset-cache

# Or clear all caches
watchman watch-del-all
rm -rf $TMPDIR/metro-* $TMPDIR/haste-*
```

---

## 📲 Deployment Checklist

### Before Building Production Apps

- [ ] Update API_BASE_URL to production URL
- [ ] Test all features on physical devices
- [ ] Generate signed Android keystore
- [ ] Configure iOS signing certificates
- [ ] Test payment integrations
- [ ] Test WhatsApp integration
- [ ] Verify push notifications
- [ ] Test offline mode
- [ ] Update app version in package.json
- [ ] Update versionCode/versionName (Android)
- [ ] Update CFBundleVersion (iOS)

### Android Play Store

1. **Generate signed AAB**:
   ```bash
   cd android
   ./gradlew bundleRelease
   ```

2. **Upload to Play Console**:
   - Go to [Google Play Console](https://play.google.com/console)
   - Create app listing
   - Upload AAB file
   - Fill in store listing details
   - Submit for review

### iOS App Store

1. **Archive in Xcode**:
   - Product > Archive
   - Distribute App > App Store Connect

2. **Upload to App Store**:
   - Go to [App Store Connect](https://appstoreconnect.apple.com)
   - Create app listing
   - Upload build
   - Fill in app information
   - Submit for review

---

## 🔐 Environment Variables

Mobile apps use the same backend, so environment variables are managed in the main `.env` file:

```env
# Backend API (web app .env)
DATABASE_URL=your_database_url
SESSION_SECRET=your_secret
WHATSAPP_API_KEY=your_key
MPESA_CONSUMER_KEY=your_key
# etc.
```

Mobile apps connect to the backend API and inherit all configurations.

---

## 📝 Development Commands

```bash
# Start Metro bundler
npm start

# Run Android
npm run android

# Run iOS
npm run ios

# Build Android APK
npm run build:android

# Run tests
npm test

# Lint code
npm run lint

# Clear cache and restart
npm start -- --reset-cache
```

---

## 🎯 Key Features in Mobile Apps

- ✅ Property & unit management
- ✅ Tenant portal
- ✅ Maintenance requests with photo upload
- ✅ QR code scanning for visitor access
- ✅ Real-time notifications
- ✅ Offline mode with local storage
- ✅ WhatsApp integration
- ✅ M-PESA payments
- ✅ Document management
- ✅ GPS-based check-in for staff
- ✅ Camera integration for inspections

---

## 📚 Additional Resources

- [React Native Docs](https://reactnative.dev/)
- [Android Developer Guide](https://developer.android.com/)
- [iOS Developer Guide](https://developer.apple.com/)
- [Metro Bundler](https://facebook.github.io/metro/)

---

## 🆘 Need Help?

1. **Web app not working?** 
   - Check `LOCAL_SETUP_GUIDE.md`
   - Ensure backend is running on port 5000

2. **Mobile build failing?**
   - Check this guide's troubleshooting section
   - Verify all prerequisites are installed

3. **API connection issues?**
   - Verify backend is accessible
   - Check firewall settings
   - Use correct IP address for physical devices

---

**Remember**: The mobile apps are an **addition** to your web app, not a replacement. Both work together using the same backend! 🚀
