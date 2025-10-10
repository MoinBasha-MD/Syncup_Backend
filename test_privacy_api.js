const axios = require('axios');

// Test script to verify privacy API endpoints are working
async function testPrivacyAPI() {
  try {
    console.log('🧪 [API Test] Starting privacy API test...');
    
    const BASE_URL = 'http://localhost:5000/api'; // Adjust as needed
    
    // You'll need to get actual auth tokens for your test users
    const user1Token = 'YOUR_USER1_TOKEN_HERE'; // Replace with actual token
    const user2Token = 'YOUR_USER2_TOKEN_HERE'; // Replace with actual token
    const user2Phone = 'USER2_PHONE_NUMBER'; // Replace with actual phone
    
    if (user1Token === 'YOUR_USER1_TOKEN_HERE') {
      console.log('❌ [API Test] Please update the tokens and phone numbers in this script');
      return;
    }
    
    // Test 1: Get current privacy settings
    console.log('\n--- Test 1: Get Privacy Settings ---');
    try {
      const response = await axios.get(`${BASE_URL}/status-privacy`, {
        headers: { Authorization: `Bearer ${user1Token}` }
      });
      console.log('✅ Current privacy settings:', response.data.data);
    } catch (error) {
      console.log('❌ Error getting privacy settings:', error.response?.data || error.message);
    }
    
    // Test 2: Update privacy settings to app_connections_only
    console.log('\n--- Test 2: Update Privacy to App Connections Only ---');
    try {
      const response = await axios.put(`${BASE_URL}/status-privacy`, {
        visibility: 'app_connections_only',
        allowedGroups: [],
        allowedContacts: [],
        blockedContacts: [],
        locationSharing: true
      }, {
        headers: { Authorization: `Bearer ${user1Token}` }
      });
      console.log('✅ Updated privacy settings:', response.data.data);
    } catch (error) {
      console.log('❌ Error updating privacy settings:', error.response?.data || error.message);
    }
    
    // Test 3: Try to get status by phone (should be filtered)
    console.log('\n--- Test 3: Get Status by Phone (should be filtered) ---');
    try {
      const response = await axios.get(`${BASE_URL}/contacts/phone/${user2Phone}/status`, {
        headers: { Authorization: `Bearer ${user2Token}` }
      });
      console.log('✅ Status by phone (filtered):', response.data.data);
    } catch (error) {
      console.log('❌ Error getting status by phone:', error.response?.data || error.message);
    }
    
    // Test 4: Update privacy settings to public
    console.log('\n--- Test 4: Update Privacy to Public ---');
    try {
      const response = await axios.put(`${BASE_URL}/status-privacy`, {
        visibility: 'public',
        allowedGroups: [],
        allowedContacts: [],
        blockedContacts: [],
        locationSharing: true
      }, {
        headers: { Authorization: `Bearer ${user1Token}` }
      });
      console.log('✅ Updated privacy settings to public:', response.data.data);
    } catch (error) {
      console.log('❌ Error updating privacy settings:', error.response?.data || error.message);
    }
    
    // Test 5: Try to get status by phone again (should show actual status)
    console.log('\n--- Test 5: Get Status by Phone (should show actual status) ---');
    try {
      const response = await axios.get(`${BASE_URL}/contacts/phone/${user2Phone}/status`, {
        headers: { Authorization: `Bearer ${user2Token}` }
      });
      console.log('✅ Status by phone (public):', response.data.data);
    } catch (error) {
      console.log('❌ Error getting status by phone:', error.response?.data || error.message);
    }
    
    console.log('✅ [API Test] Privacy API test completed!');
    
  } catch (error) {
    console.error('❌ [API Test] Error during API test:', error);
  }
}

// Instructions for running the test
console.log(`
📋 [Instructions] To run this test:
1. Start your backend server
2. Get auth tokens for two test users (login via your app/API)
3. Update the tokens and phone number in this script
4. Run: node test_privacy_api.js
`);

// Run the test if this file is executed directly
if (require.main === module) {
  testPrivacyAPI();
}

module.exports = { testPrivacyAPI };
