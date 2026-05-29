const { execSync } = require('child_process');
const fs = require('fs');

/**
 * Automated Action Validation Script for Smart Prop
 * Tests all CRUD operations across modules
 */

class ActionValidator {
  constructor(baseUrl = 'http://localhost:5000', sessionCookie = '') {
    this.baseUrl = baseUrl;
    this.sessionCookie = sessionCookie;
    this.results = {
      passed: 0,
      failed: 0,
      errors: []
    };
  }

  // Execute curl command and return parsed response
  async execCurl(method, endpoint, data = null, headers = {}) {
    try {
      let curlCommand = `curl -s -w "HTTPSTATUS:%{http_code}" -X ${method} "${this.baseUrl}${endpoint}"`;
      
      // Add session cookie if available
      if (this.sessionCookie) {
        curlCommand += ` -H "Cookie: ${this.sessionCookie}"`;
      }
      
      // Add content type for POST/PUT requests
      if (data) {
        curlCommand += ` -H "Content-Type: application/json"`;
        curlCommand += ` -d '${JSON.stringify(data)}'`;
      }
      
      // Add custom headers
      Object.entries(headers).forEach(([key, value]) => {
        curlCommand += ` -H "${key}: ${value}"`;
      });

      console.log(`Executing: ${method} ${endpoint}`);
      const result = execSync(curlCommand, { encoding: 'utf8' });
      
      const httpStatus = result.match(/HTTPSTATUS:(\d+)$/)?.[1];
      const responseBody = result.replace(/HTTPSTATUS:\d+$/, '');
      
      return {
        status: parseInt(httpStatus),
        body: responseBody ? JSON.parse(responseBody) : null
      };
    } catch (error) {
      console.error(`Error executing ${method} ${endpoint}:`, error.message);
      return { status: 500, body: null, error: error.message };
    }
  }

  // Test VIEW action for a module
  async testViewAction(moduleName, endpoint) {
    console.log(`\n🔍 Testing VIEW action for ${moduleName}`);
    
    const response = await this.execCurl('GET', endpoint);
    
    if (response.status === 200 && Array.isArray(response.body)) {
      console.log(`✅ ${moduleName} VIEW: PASSED (${response.body.length} records)`);
      this.results.passed++;
      return true;
    } else {
      console.log(`❌ ${moduleName} VIEW: FAILED (Status: ${response.status})`);
      this.results.failed++;
      this.results.errors.push(`${moduleName} VIEW failed with status ${response.status}`);
      return false;
    }
  }

  // Test EDIT action for a module
  async testEditAction(moduleName, endpoint, itemId, updateData) {
    console.log(`\n✏️ Testing EDIT action for ${moduleName}`);
    
    const response = await this.execCurl('PUT', `${endpoint}/${itemId}`, updateData);
    
    if (response.status >= 200 && response.status < 300) {
      console.log(`✅ ${moduleName} EDIT: PASSED`);
      this.results.passed++;
      return true;
    } else {
      console.log(`❌ ${moduleName} EDIT: FAILED (Status: ${response.status})`);
      this.results.failed++;
      this.results.errors.push(`${moduleName} EDIT failed with status ${response.status}`);
      return false;
    }
  }

  // Test DELETE action for a module
  async testDeleteAction(moduleName, endpoint, itemId) {
    console.log(`\n🗑️ Testing DELETE action for ${moduleName}`);
    
    const response = await this.execCurl('DELETE', `${endpoint}/${itemId}`);
    
    if (response.status >= 200 && response.status < 300) {
      console.log(`✅ ${moduleName} DELETE: PASSED`);
      this.results.passed++;
      return true;
    } else {
      console.log(`❌ ${moduleName} DELETE: FAILED (Status: ${response.status})`);
      this.results.failed++;
      this.results.errors.push(`${moduleName} DELETE failed with status ${response.status}`);
      return false;
    }
  }

  // Test CREATE action for a module
  async testCreateAction(moduleName, endpoint, createData) {
    console.log(`\n➕ Testing CREATE action for ${moduleName}`);
    
    const response = await this.execCurl('POST', endpoint, createData);
    
    if (response.status >= 200 && response.status < 300) {
      console.log(`✅ ${moduleName} CREATE: PASSED`);
      this.results.passed++;
      return response.body?.id || true;
    } else {
      console.log(`❌ ${moduleName} CREATE: FAILED (Status: ${response.status})`);
      this.results.failed++;
      this.results.errors.push(`${moduleName} CREATE failed with status ${response.status}`);
      return false;
    }
  }

  // Test DOWNLOAD action for a module
  async testDownloadAction(moduleName, endpoint) {
    console.log(`\n📥 Testing DOWNLOAD action for ${moduleName}`);
    
    try {
      const curlCommand = `curl -s -I "${this.baseUrl}${endpoint}"`;
      const headers = execSync(curlCommand, { encoding: 'utf8' });
      
      const statusMatch = headers.match(/HTTP\/\d\.\d\s+(\d+)/);
      const status = statusMatch ? parseInt(statusMatch[1]) : 500;
      
      const contentType = headers.match(/content-type:\s*([^\r\n]+)/i)?.[1];
      
      if (status === 200 && (contentType?.includes('pdf') || contentType?.includes('csv') || contentType?.includes('excel'))) {
        console.log(`✅ ${moduleName} DOWNLOAD: PASSED (${contentType})`);
        this.results.passed++;
        return true;
      } else {
        console.log(`❌ ${moduleName} DOWNLOAD: FAILED (Status: ${status}, Type: ${contentType})`);
        this.results.failed++;
        this.results.errors.push(`${moduleName} DOWNLOAD failed - Status: ${status}, Content-Type: ${contentType}`);
        return false;
      }
    } catch (error) {
      console.log(`❌ ${moduleName} DOWNLOAD: ERROR - ${error.message}`);
      this.results.failed++;
      this.results.errors.push(`${moduleName} DOWNLOAD error: ${error.message}`);
      return false;
    }
  }

  // Test all actions for a complete module
  async testCompleteModule(moduleConfig) {
    console.log(`\n🏢 Testing Complete Module: ${moduleConfig.name}`);
    console.log('=' * 50);

    const results = {};

    // Test VIEW
    results.view = await this.testViewAction(moduleConfig.name, moduleConfig.endpoints.list);

    // Test CREATE (if configured)
    if (moduleConfig.testData?.create) {
      results.create = await this.testCreateAction(
        moduleConfig.name, 
        moduleConfig.endpoints.create || moduleConfig.endpoints.list, 
        moduleConfig.testData.create
      );
    }

    // Test EDIT (if we have test data and an ID)
    if (moduleConfig.testData?.edit && moduleConfig.testData?.testId) {
      results.edit = await this.testEditAction(
        moduleConfig.name,
        moduleConfig.endpoints.edit || moduleConfig.endpoints.list,
        moduleConfig.testData.testId,
        moduleConfig.testData.edit
      );
    }

    // Test DOWNLOAD (if configured)
    if (moduleConfig.endpoints.download) {
      results.download = await this.testDownloadAction(moduleConfig.name, moduleConfig.endpoints.download);
    }

    // Test DELETE (if configured and we have test ID)
    if (moduleConfig.testData?.testId && moduleConfig.allowDelete) {
      results.delete = await this.testDeleteAction(
        moduleConfig.name,
        moduleConfig.endpoints.delete || moduleConfig.endpoints.list,
        moduleConfig.testData.testId
      );
    }

    return results;
  }

  // Generate final report
  generateReport() {
    console.log('\n📊 VALIDATION REPORT');
    console.log('=' * 40);
    console.log(`✅ Tests Passed: ${this.results.passed}`);
    console.log(`❌ Tests Failed: ${this.results.failed}`);
    console.log(`📈 Success Rate: ${(this.results.passed / (this.results.passed + this.results.failed) * 100).toFixed(1)}%`);
    
    if (this.results.errors.length > 0) {
      console.log('\n🚨 Errors Found:');
      this.results.errors.forEach((error, index) => {
        console.log(`${index + 1}. ${error}`);
      });
    }
    
    // Save report to file
    const reportData = {
      timestamp: new Date().toISOString(),
      passed: this.results.passed,
      failed: this.results.failed,
      successRate: (this.results.passed / (this.results.passed + this.results.failed) * 100).toFixed(1),
      errors: this.results.errors
    };
    
    fs.writeFileSync('validation-report.json', JSON.stringify(reportData, null, 2));
    console.log('\n📄 Report saved to validation-report.json');
  }
}

// Module configurations for testing
const moduleConfigs = [
  {
    name: 'Properties',
    endpoints: {
      list: '/api/properties',
      create: '/api/properties',
      edit: '/api/properties',
      delete: '/api/properties',
      download: '/api/properties/export/csv'
    },
    testData: {
      create: {
        name: 'Test Property',
        address: '123 Test Street',
        type: 'apartment',
        units: 10
      },
      edit: {
        name: 'Updated Test Property',
        address: '456 Updated Street'
      },
      testId: 1
    },
    allowDelete: false // Don't delete in production
  },
  {
    name: 'Tenants',
    endpoints: {
      list: '/api/tenants',
      create: '/api/tenants',
      edit: '/api/tenants',
      delete: '/api/tenants',
      download: '/api/tenants/export/csv'
    },
    testData: {
      create: {
        firstName: 'Test',
        lastName: 'Tenant',
        email: 'test@example.com',
        phone: '+254724406054'
      },
      edit: {
        firstName: 'Updated',
        lastName: 'Tenant'
      },
      testId: 1
    },
    allowDelete: false
  },
  {
    name: 'Maintenance Requests',
    endpoints: {
      list: '/api/maintenance-requests',
      create: '/api/maintenance-requests',
      edit: '/api/maintenance-requests',
      delete: '/api/maintenance-requests'
    },
    testData: {
      create: {
        title: 'Test Maintenance Request',
        description: 'Testing the system',
        priority: 'medium',
        status: 'open'
      },
      edit: {
        status: 'in_progress',
        priority: 'high'
      },
      testId: 1
    },
    allowDelete: false
  },
  {
    name: 'Security Operations',
    endpoints: {
      list: '/api/security/visitors',
      create: '/api/security/visitors',
      edit: '/api/security/visitors'
    },
    testData: {
      create: {
        visitorName: 'Test Visitor',
        purpose: 'Testing',
        hostName: 'Test Host'
      },
      edit: {
        status: 'checked_out'
      },
      testId: 1
    },
    allowDelete: false
  }
];

// Main execution function
async function runValidation() {
  console.log('🚀 Starting Smart Prop Action Validation');
  console.log('Time:', new Date().toISOString());
  
  const validator = new ActionValidator();
  
  // Test authentication first
  console.log('\n🔐 Testing Authentication...');
  const authResponse = await validator.execCurl('GET', '/api/auth/user');
  
  if (authResponse.status !== 200) {
    console.log('❌ Authentication failed. Please ensure you are logged in.');
    console.log('Run this script with a valid session cookie:');
    console.log('node tests/automated-action-validation.js --cookie "connect.sid=your-session-id"');
    return;
  }
  
  console.log('✅ Authentication successful');
  
  // Test each module
  for (const moduleConfig of moduleConfigs) {
    await validator.testCompleteModule(moduleConfig);
    
    // Small delay between modules
    await new Promise(resolve => setTimeout(resolve, 1000));
  }
  
  // Generate final report
  validator.generateReport();
}

// Run if called directly
if (require.main === module) {
  // Check for session cookie in command line args
  const args = process.argv.slice(2);
  const cookieIndex = args.indexOf('--cookie');
  
  if (cookieIndex !== -1 && args[cookieIndex + 1]) {
    const validator = new ActionValidator('http://localhost:5000', args[cookieIndex + 1]);
    runValidation.call(validator);
  } else {
    runValidation();
  }
}

module.exports = { ActionValidator, moduleConfigs };