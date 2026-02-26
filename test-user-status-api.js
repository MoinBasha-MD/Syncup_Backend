/**
 * Test script to verify User Status Management API
 * Run this to check if the backend routes are working
 */

const axios = require('axios');

const BASE_URL = 'http://45.129.86.96:5000';
const API_URL = `${BASE_URL}/api`;

// Test admin token - replace with actual token from admin panel
const ADMIN_TOKEN = 'YOUR_ADMIN_TOKEN_HERE';

async function testAPI() {
  console.log('🧪 Testing User Status Management API...\n');
  
  // Test 1: Health check
  console.log('1️⃣ Testing server health...');
  try {
    const health = await axios.get(`${BASE_URL}/health`);
    console.log('✅ Server is running:', health.data);
  } catch (error) {
    console.error('❌ Server health check failed:', error.message);
    console.log('⚠️  Make sure backend server is running on port 5000');
    return;
  }
  
  // Test 2: Admin auth verification
  console.log('\n2️⃣ Testing admin authentication...');
  if (ADMIN_TOKEN === 'YOUR_ADMIN_TOKEN_HERE') {
    console.log('⚠️  No admin token provided');
    console.log('📝 To get your token:');
    console.log('   1. Login to admin panel');
    console.log('   2. Open DevTools (F12) → Application → Local Storage');
    console.log('   3. Find "admin_token" and copy the value');
    console.log('   4. Replace ADMIN_TOKEN in this script\n');
  } else {
    try {
      const verify = await axios.get(`${API_URL}/admin/auth/verify`, {
        headers: { Authorization: `Bearer ${ADMIN_TOKEN}` }
      });
      console.log('✅ Admin token is valid:', verify.data.admin.username);
    } catch (error) {
      console.error('❌ Admin token verification failed:', error.response?.data || error.message);
      return;
    }
  }
  
  // Test 3: Check if route exists
  console.log('\n3️⃣ Testing user status route registration...');
  try {
    const response = await axios.get(`${API_URL}/admin/users/all-with-status`, {
      headers: { Authorization: `Bearer ${ADMIN_TOKEN}` },
      validateStatus: () => true // Accept any status code
    });
    
    if (response.status === 404) {
      console.error('❌ Route not found (404)');
      console.log('⚠️  Backend server needs to be restarted to load new routes');
      console.log('📝 Run: cd e:\\Backend && npm start');
      return;
    }
    
    if (response.status === 401) {
      console.error('❌ Unauthorized (401)');
      console.log('⚠️  Admin token is invalid or expired');
      return;
    }
    
    if (response.status === 200) {
      console.log('✅ Route is registered and accessible');
      console.log('📊 Response:', JSON.stringify(response.data, null, 2));
      
      if (response.data.users && response.data.users.length > 0) {
        console.log(`\n✅ Found ${response.data.users.length} users`);
        console.log('Sample user:', {
          userId: response.data.users[0].userId,
          name: response.data.users[0].name,
          status: response.data.users[0].status,
          isOnline: response.data.users[0].isOnline
        });
      } else {
        console.log('\n⚠️  No users in database');
        console.log('📝 Create some test users first');
      }
    } else {
      console.error(`❌ Unexpected status code: ${response.status}`);
      console.log('Response:', response.data);
    }
  } catch (error) {
    console.error('❌ API call failed:', error.message);
    if (error.code === 'ECONNREFUSED') {
      console.log('⚠️  Cannot connect to backend server');
      console.log('📝 Make sure server is running on http://45.129.86.96:5000');
    }
  }
  
  // Test 4: Check status statistics endpoint
  console.log('\n4️⃣ Testing status statistics endpoint...');
  try {
    const stats = await axios.get(`${API_URL}/admin/users/status-stats`, {
      headers: { Authorization: `Bearer ${ADMIN_TOKEN}` }
    });
    console.log('✅ Statistics endpoint working');
    console.log('📊 Stats:', stats.data.stats);
  } catch (error) {
    console.error('❌ Statistics endpoint failed:', error.response?.status, error.response?.data || error.message);
  }
  
  // Test 5: Check WebSocket connection
  console.log('\n5️⃣ Testing WebSocket availability...');
  try {
    const socketTest = await axios.get(`${BASE_URL}/socket.io/`, {
      validateStatus: () => true
    });
    if (socketTest.status === 200 || socketTest.status === 400) {
      console.log('✅ Socket.IO is available');
    } else {
      console.log('⚠️  Socket.IO might not be configured correctly');
    }
  } catch (error) {
    console.log('⚠️  Could not verify Socket.IO:', error.message);
  }
  
  console.log('\n' + '='.repeat(60));
  console.log('📋 SUMMARY');
  console.log('='.repeat(60));
  console.log('If you see ❌ errors above:');
  console.log('1. Make sure backend server is running: npm start');
  console.log('2. Verify server.js has adminUserStatusRoutes registered');
  console.log('3. Check backend logs for errors');
  console.log('4. Get valid admin token from browser localStorage');
  console.log('\nIf all ✅ green checks:');
  console.log('1. Admin panel should work');
  console.log('2. Refresh browser with Ctrl+F5');
  console.log('3. Check browser console for errors');
}

// Run the test
testAPI().catch(console.error);
