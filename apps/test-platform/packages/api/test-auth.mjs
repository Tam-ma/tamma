/**
 * Test script for authentication and API key endpoints
 * Run with: node test-auth.mjs
 */

const BASE_URL = 'http://localhost:8787'

// Test user data
const testUser = {
  email: `test${Date.now()}@example.com`,
  password: 'TestPassword123!',
  fullName: 'Test User'
}

let accessToken = ''
let refreshToken = ''
let userId = ''

// Color codes for console output
const colors = {
  green: '\x1b[32m',
  red: '\x1b[31m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  reset: '\x1b[0m'
}

function log(message, color = colors.reset) {
  console.log(`${color}${message}${colors.reset}`)
}

async function makeRequest(endpoint, options = {}) {
  try {
    const url = `${BASE_URL}${endpoint}`
    const response = await fetch(url, {
      ...options,
      headers: {
        'Content-Type': 'application/json',
        ...options.headers
      }
    })

    const data = await response.json()

    if (!response.ok) {
      throw new Error(data.error || `HTTP ${response.status}`)
    }

    return { success: true, data, status: response.status }
  } catch (error) {
    return { success: false, error: error.message }
  }
}

async function testHealthCheck() {
  log('\n=== Testing Health Check ===', colors.blue)

  const result = await makeRequest('/')

  if (result.success) {
    log('✓ Health check passed', colors.green)
    log(`  Version: ${result.data.version}`)
    log(`  Environment: ${result.data.environment}`)
  } else {
    log(`✗ Health check failed: ${result.error}`, colors.red)
  }

  return result.success
}

async function testRegistration() {
  log('\n=== Testing User Registration ===', colors.blue)

  const result = await makeRequest('/auth/register', {
    method: 'POST',
    body: JSON.stringify(testUser)
  })

  if (result.success) {
    log('✓ Registration successful', colors.green)
    log(`  User ID: ${result.data.user.id}`)
    log(`  Email: ${result.data.user.email}`)
    userId = result.data.user.id

    // In development, we get the verification token
    if (result.data.verificationToken) {
      log(`  Verification token: ${result.data.verificationToken.substring(0, 8)}...[REDACTED]`, colors.yellow)

      // Test email verification
      const verifyResult = await makeRequest('/auth/verify-email', {
        method: 'POST',
        body: JSON.stringify({ token: result.data.verificationToken })
      })

      if (verifyResult.success) {
        log('✓ Email verification successful', colors.green)
      } else {
        log(`✗ Email verification failed: ${verifyResult.error}`, colors.red)
      }
    }
  } else {
    log(`✗ Registration failed: ${result.error}`, colors.red)
  }

  return result.success
}

async function testLogin() {
  log('\n=== Testing User Login ===', colors.blue)

  const result = await makeRequest('/auth/login', {
    method: 'POST',
    body: JSON.stringify({
      email: testUser.email,
      password: testUser.password
    })
  })

  if (result.success) {
    log('✓ Login successful', colors.green)
    log(`  User: ${result.data.user.email}`)
    accessToken = result.data.accessToken
    refreshToken = result.data.refreshToken
    log(`  Access token: [REDACTED]`, colors.yellow)
  } else {
    log(`✗ Login failed: ${result.error}`, colors.red)
  }

  return result.success
}

async function testGetProfile() {
  log('\n=== Testing Get Profile ===', colors.blue)

  const result = await makeRequest('/auth/me', {
    headers: {
      'Authorization': `Bearer ${accessToken}`
    }
  })

  if (result.success) {
    log('✓ Profile retrieved successfully', colors.green)
    log(`  User ID: ${result.data.user.id}`)
    log(`  Email: ${result.data.user.email}`)
  } else {
    log(`✗ Get profile failed: ${result.error}`, colors.red)
  }

  return result.success
}

async function testRefreshToken() {
  log('\n=== Testing Token Refresh ===', colors.blue)

  const result = await makeRequest('/auth/refresh', {
    method: 'POST',
    body: JSON.stringify({ refreshToken })
  })

  if (result.success) {
    log('✓ Token refreshed successfully', colors.green)
    accessToken = result.data.accessToken
    log(`  New access token: [REDACTED]`, colors.yellow)
  } else {
    log(`✗ Token refresh failed: ${result.error}`, colors.red)
  }

  return result.success
}

async function testCreateAPIKey() {
  log('\n=== Testing API Key Creation ===', colors.blue)

  const result = await makeRequest('/api-keys', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${accessToken}`
    },
    body: JSON.stringify({
      name: 'Test API Key',
      description: 'Key for testing',
      scopes: ['read:benchmarks', 'write:benchmarks'],
      rateLimit: 100
    })
  })

  if (result.success) {
    log('✓ API key created successfully', colors.green)
    log(`  Key ID: ${result.data.key.id}`)
    log('  Key: [REDACTED]', colors.yellow)
    log(`  Warning: ${result.data.warning}`, colors.yellow)

    // Test using the API key - access apiKey directly to avoid storing in variable
    const apiResult = await makeRequest('/api-keys', {
      headers: {
        'X-API-Key': result.data.apiKey
      }
    })

    if (apiResult.success) {
      log('✓ API key authentication successful', colors.green)
    } else {
      log(`✗ API key authentication failed: ${apiResult.error}`, colors.red)
    }

    return { success: true, keyId: result.data.key.id }
  } else {
    log(`✗ API key creation failed: ${result.error}`, colors.red)
    return { success: false }
  }
}

async function testListAPIKeys() {
  log('\n=== Testing List API Keys ===', colors.blue)

  const result = await makeRequest('/api-keys', {
    headers: {
      'Authorization': `Bearer ${accessToken}`
    }
  })

  if (result.success) {
    log('✓ API keys listed successfully', colors.green)
    log(`  Total keys: ${result.data.total}`)
    result.data.keys.forEach(key => {
      log(`  - ${key.name} (${key.status})`)
    })
  } else {
    log(`✗ List API keys failed: ${result.error}`, colors.red)
  }

  return result.success
}

async function testChangePassword() {
  log('\n=== Testing Password Change ===', colors.blue)

  const result = await makeRequest('/auth/change-password', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${accessToken}`
    },
    body: JSON.stringify({
      currentPassword: testUser.password,
      newPassword: 'NewTestPassword123!'
    })
  })

  if (result.success) {
    log('✓ Password changed successfully', colors.green)
  } else {
    log(`✗ Password change failed: ${result.error}`, colors.red)
  }

  return result.success
}

async function testLogout() {
  log('\n=== Testing Logout ===', colors.blue)

  const result = await makeRequest('/auth/logout', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${accessToken}`
    }
  })

  if (result.success) {
    log('✓ Logout successful', colors.green)
  } else {
    log(`✗ Logout failed: ${result.error}`, colors.red)
  }

  return result.success
}

async function runTests() {
  log('\n========================================', colors.blue)
  log('   AIBaaS API Authentication Tests', colors.blue)
  log('========================================', colors.blue)

  let passed = 0
  let failed = 0

  // Run tests
  const tests = [
    { name: 'Health Check', fn: testHealthCheck },
    { name: 'Registration', fn: testRegistration },
    { name: 'Login', fn: testLogin },
    { name: 'Get Profile', fn: testGetProfile },
    { name: 'Refresh Token', fn: testRefreshToken },
    { name: 'Create API Key', fn: testCreateAPIKey },
    { name: 'List API Keys', fn: testListAPIKeys },
    { name: 'Change Password', fn: testChangePassword },
    { name: 'Logout', fn: testLogout }
  ]

  for (const test of tests) {
    try {
      const result = await test.fn()
      if (result) {
        passed++
      } else {
        failed++
      }
    } catch (error) {
      log(`✗ ${test.name} error: ${error.message}`, colors.red)
      failed++
    }
  }

  // Summary
  log('\n========================================', colors.blue)
  log('            TEST SUMMARY', colors.blue)
  log('========================================', colors.blue)
  log(`Passed: ${passed}`, colors.green)
  log(`Failed: ${failed}`, failed > 0 ? colors.red : colors.green)
  log(`Total: ${passed + failed}`, colors.blue)

  if (failed === 0) {
    log('\nAll tests passed! ✓', colors.green)
  } else {
    log('\nSome tests failed. Please check the errors above.', colors.red)
  }
}

// Run the tests
runTests().catch(error => {
  log(`\nUnexpected error: ${error.message}`, colors.red)
  process.exit(1)
})