#!/usr/bin/env node

/**
 * Smart Prop Mobile App - Quick Pre-Deployment Test
 * 
 * This script validates that the mobile app configuration is correct
 * before proceeding with web app deployment.
 */

const fs = require('fs');
const path = require('path');

console.log('🚀 Smart Prop Mobile App - Pre-Deployment Validation\n');

// Test 1: Check if all required files exist
console.log('📁 Checking required files...');
const requiredFiles = [
  'package.json',
  'src/App.tsx',
  'src/services/config.ts',
  'src/services/whatsapp.ts',
  'src/components/WhatsAppButton.tsx',
  'android/app/build.gradle',
  'ios/SmartProp/Info.plist'
];

let filesValid = true;
requiredFiles.forEach(file => {
  if (fs.existsSync(file)) {
    console.log(`  ✅ ${file}`);
  } else {
    console.log(`  ❌ ${file} - MISSING`);
    filesValid = false;
  }
});

// Test 2: Validate package.json configuration
console.log('\n📦 Checking package.json...');
try {
  const packageJson = JSON.parse(fs.readFileSync('package.json', 'utf8'));
  
  if (packageJson.name === 'smart-prop-mobile') {
    console.log('  ✅ App name configured correctly');
  } else {
    console.log('  ❌ App name incorrect');
    filesValid = false;
  }
  
  if (packageJson.dependencies['react-native']) {
    console.log('  ✅ React Native dependency found');
  } else {
    console.log('  ❌ React Native dependency missing');
    filesValid = false;
  }
} catch (error) {
  console.log('  ❌ Error reading package.json');
  filesValid = false;
}

// Test 3: Validate API configuration
console.log('\n🔧 Checking API configuration...');
try {
  const configPath = path.join('src', 'services', 'config.ts');
  const configContent = fs.readFileSync(configPath, 'utf8');
  
  if (configContent.includes('localhost') || configContent.includes('your-domain.com')) {
    console.log('  ✅ API URL configured (update with your server URL)');
  } else {
    console.log('  ❌ API URL not configured');
    filesValid = false;
  }
  
  if (configContent.includes('+254724406054')) {
    console.log('  ✅ WhatsApp number configured');
  } else {
    console.log('  ❌ WhatsApp number not configured');
    filesValid = false;
  }
} catch (error) {
  console.log('  ❌ Error reading config file');
  filesValid = false;
}

// Test 4: Check WhatsApp integration
console.log('\n💬 Checking WhatsApp integration...');
try {
  const whatsappPath = path.join('src', 'services', 'whatsapp.ts');
  const whatsappContent = fs.readFileSync(whatsappPath, 'utf8');
  
  if (whatsappContent.includes('WhatsAppService')) {
    console.log('  ✅ WhatsApp service class found');
  } else {
    console.log('  ❌ WhatsApp service class missing');
    filesValid = false;
  }
  
  if (whatsappContent.includes('openWhatsAppChat')) {
    console.log('  ✅ WhatsApp chat function available');
  } else {
    console.log('  ❌ WhatsApp chat function missing');
    filesValid = false;
  }
} catch (error) {
  console.log('  ❌ Error reading WhatsApp service file');
  filesValid = false;
}

// Test 5: Network connectivity test (basic)
console.log('\n🌐 Testing network configuration...');
const https = require('https');

const testNetworkConnectivity = () => {
  return new Promise((resolve) => {
    const options = {
      hostname: 'localhost',
      port: 443,
      path: '/api/auth/user',
      method: 'GET',
      timeout: 5000
    };

    const req = https.request(options, (res) => {
      console.log(`  ✅ Backend API accessible (Status: ${res.statusCode})`);
      resolve(true);
    });

    req.on('error', (error) => {
      console.log(`  ❌ Backend API not accessible: ${error.message}`);
      resolve(false);
    });

    req.on('timeout', () => {
      console.log('  ❌ Backend API timeout');
      resolve(false);
    });

    req.end();
  });
};

// Run network test
testNetworkConnectivity().then((networkValid) => {
  
  // Final results
  console.log('\n📋 Pre-Deployment Test Results:');
  console.log('================================');
  
  if (filesValid && networkValid) {
    console.log('🎉 ALL TESTS PASSED');
    console.log('\n✅ Mobile app is ready for testing!');
    console.log('✅ Web app can be deployed to production!');
    
    console.log('\n🚀 Next Steps:');
    console.log('1. Test mobile app on device/simulator');
    console.log('2. Verify all features work correctly');
    console.log('3. Deploy web app to custom domain');
    
    console.log('\n📱 To test mobile app:');
    console.log('   npm install');
    console.log('   npm start');
    console.log('   npm run android  # or npm run ios');
    
  } else {
    console.log('❌ SOME TESTS FAILED');
    console.log('\n🔧 Issues to fix:');
    if (!filesValid) {
      console.log('- Fix missing or incorrect files');
    }
    if (!networkValid) {
      console.log('- Check backend API accessibility');
    }
    
    console.log('\n⚠️  Fix issues before deployment');
  }
  
  console.log('\n' + '='.repeat(50));
});