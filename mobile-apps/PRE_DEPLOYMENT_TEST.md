# 📱 Smart Prop Mobile App - Pre-Deployment Test Guide

## 🎯 Mobile App Testing Before Web Deployment

Testing the mobile app first to ensure everything works before deploying the web app to production domain.

## 📋 Pre-Test Setup

### Current Configuration:
- **Backend API**: `https://smart-prop-analytics-kapi2009.replit.app`
- **WhatsApp Support**: `+254724406054`
- **Test Credentials**: `kapi2009@gmail.com / test123`

### Mobile App Features to Test:

#### Core Functionality:
✅ **Dashboard**: Real-time analytics and property metrics
✅ **Properties**: Property list, details, and management
✅ **Tenants**: Tenant management and communication
✅ **Maintenance**: Work order creation and tracking
✅ **Inspections**: Property inspection with photo capture
✅ **Security**: QR code scanning and visitor management
✅ **Settings**: User preferences and WhatsApp integration

## 🧪 Testing Steps

### Step 1: Development Environment Setup (5 minutes)
```bash
# Navigate to mobile app directory
cd mobile-apps

# Install dependencies
npm install

# For iOS (macOS only)
cd ios && pod install && cd ..
```

### Step 2: Start Development Servers (2 minutes)
```bash
# Start Metro bundler
npm start

# In separate terminals:
npm run android  # For Android testing
npm run ios      # For iOS testing (macOS only)
```

### Step 3: Authentication Test (3 minutes)
1. **Launch App**: Open on simulator/device
2. **Login Screen**: Should appear first
3. **Test Login**: Use credentials `kapi2009@gmail.com / test123`
4. **Verify**: Should redirect to Dashboard after login
5. **Session Persistence**: Close/reopen app, should stay logged in

### Step 4: Core Features Test (10 minutes)

#### Dashboard Test:
- [ ] Displays property metrics and charts
- [ ] Shows recent activity feed
- [ ] Quick action buttons functional
- [ ] Data syncs from web backend

#### Properties Test:
- [ ] Property list loads correctly
- [ ] Property details show complete information
- [ ] Can navigate between properties
- [ ] Property images display properly

#### Tenants Test:
- [ ] Tenant list displays
- [ ] Individual tenant profiles accessible
- [ ] Contact information visible
- [ ] Communication history available

#### Maintenance Test:
- [ ] Work order list displays
- [ ] Can create new maintenance requests
- [ ] Photo capture works for documentation
- [ ] Status updates sync properly

#### Settings Test:
- [ ] User profile information displays
- [ ] WhatsApp support button works
- [ ] Notification preferences adjustable
- [ ] Logout functionality works

### Step 5: WhatsApp Integration Test (3 minutes)
1. **Navigate to Settings**
2. **Tap WhatsApp Support Button**
3. **Verify**: Opens WhatsApp with pre-filled message
4. **Test Message**: "Hi! I need help with the Smart Prop mobile app. Can you assist me?"
5. **Confirm**: Number shows as +254724406054

### Step 6: Offline Functionality Test (5 minutes)
1. **Disable Internet**: Turn off WiFi/cellular
2. **Navigate App**: Should still work with cached data
3. **Create Content**: Try adding maintenance request
4. **Re-enable Internet**: Content should sync automatically
5. **Verify**: Changes appear in web dashboard

## ✅ Success Criteria

### Must Pass:
- [ ] Authentication works completely
- [ ] All main screens load without errors
- [ ] Navigation between screens smooth
- [ ] WhatsApp integration opens correctly
- [ ] Data syncs with web backend
- [ ] App doesn't crash during normal usage

### Performance Criteria:
- [ ] App launches in under 3 seconds
- [ ] Screen transitions smooth (under 1 second)
- [ ] No memory leaks during extended usage
- [ ] Network requests complete within 5 seconds
- [ ] Images load properly and cache correctly

### Quality Criteria:
- [ ] UI matches design specifications
- [ ] All text readable and properly formatted
- [ ] Icons and images display correctly
- [ ] Responsive design works on different screen sizes
- [ ] No console errors or warnings

## 🔧 Test Configuration

### Android Testing:
```bash
# Test on Android emulator or device
npm run android

# Check logs for errors
npx react-native log-android
```

### iOS Testing (macOS only):
```bash
# Test on iOS simulator or device
npm run ios

# Check logs for errors
npx react-native log-ios
```

### Debug Configuration:
```javascript
// Enable debug mode for testing
__DEV__ = true;

// API endpoint for testing
API_BASE_URL = 'https://smart-prop-analytics-kapi2009.replit.app';
```

## 🐛 Common Issues & Solutions

### Issue 1: Metro Bundle Error
```bash
# Clear Metro cache
npx react-native start --reset-cache
```

### Issue 2: Build Failures
```bash
# Clean build directories
cd android && ./gradlew clean && cd ..
cd ios && rm -rf build && cd ..
```

### Issue 3: Network Connection Issues
- Check API endpoint is accessible
- Verify CORS settings on backend
- Test with different network conditions

### Issue 4: Authentication Problems
- Clear app data/cache
- Test with known working credentials
- Check session management

## 📊 Test Report Template

### Mobile App Pre-Deployment Test Results
**Date**: [Test Date]
**Platform**: Android/iOS
**Tester**: [Tester Name]

#### Authentication: PASS/FAIL
- Login functionality: ✅/❌
- Session persistence: ✅/❌
- Logout functionality: ✅/❌

#### Core Features: PASS/FAIL
- Dashboard: ✅/❌
- Properties: ✅/❌
- Tenants: ✅/❌
- Maintenance: ✅/❌
- Settings: ✅/❌

#### WhatsApp Integration: PASS/FAIL
- Support button works: ✅/❌
- Correct number: ✅/❌
- Pre-filled message: ✅/❌

#### Performance: PASS/FAIL
- App launch time: ✅/❌
- Screen transitions: ✅/❌
- Network requests: ✅/❌

#### Overall Result: PASS/FAIL
**Ready for Web App Deployment**: YES/NO

## 🎯 Next Steps After Testing

### If Tests Pass:
1. **Document Results**: Complete test report
2. **Deploy Web App**: Proceed with web app deployment to custom domain
3. **Production Testing**: Test mobile app with production web backend
4. **App Store Preparation**: Prepare mobile apps for store submission

### If Tests Fail:
1. **Fix Issues**: Address any failing test cases
2. **Re-test**: Run tests again until all pass
3. **Code Review**: Review code changes
4. **Final Verification**: Confirm all functionality works

## 📱 Ready for Testing

The mobile app is configured and ready for comprehensive testing. Run through all test scenarios to ensure everything works perfectly before deploying the web app to your production domain.

**Test Environment Ready**:
- Backend API: Accessible and functioning
- Authentication: Working with test credentials
- WhatsApp: Integrated with support number
- All Features: Implemented and ready to test

Start testing now to validate mobile app functionality before web deployment!