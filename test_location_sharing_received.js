/**
 * Test script for location sharing "received" endpoint
 * Run with: node test_location_sharing_received.js
 */

const axios = require('axios');

const API_BASE_URL = 'http://localhost:5000/api';

// Replace with actual user token
const USER_TOKEN = 'YOUR_AUTH_TOKEN_HERE';

async function testReceivedShares() {
  console.log('🧪 Testing /api/location-sharing/received endpoint...\n');

  try {
    const response = await axios.get(`${API_BASE_URL}/location-sharing/received`, {
      headers: {
        'Authorization': `Bearer ${USER_TOKEN}`,
        'Content-Type': 'application/json'
      }
    });

    console.log('✅ SUCCESS - Endpoint is working!\n');
    console.log('📊 Response Data:');
    console.log('─'.repeat(50));
    console.log(`Status: ${response.status}`);
    console.log(`Success: ${response.data.success}`);
    console.log(`Count: ${response.data.count}`);
    console.log(`Shares: ${response.data.shares?.length || 0}\n`);

    if (response.data.shares && response.data.shares.length > 0) {
      console.log('📍 Active Location Shares:');
      console.log('─'.repeat(50));
      
      response.data.shares.forEach((share, index) => {
        console.log(`\n${index + 1}. ${share.senderName}`);
        console.log(`   Message ID: ${share.messageId}`);
        console.log(`   Sender ID: ${share.senderId}`);
        console.log(`   Location: ${share.locationData?.latitude}, ${share.locationData?.longitude}`);
        console.log(`   Expires: ${share.expiresAt}`);
        console.log(`   Message: ${share.message}`);
      });
    } else {
      console.log('ℹ️  No active location shares found');
    }

    console.log('\n' + '─'.repeat(50));
    console.log('✅ Test completed successfully!');
    
  } catch (error) {
    console.error('❌ ERROR - Test failed!\n');
    
    if (error.response) {
      console.error(`Status: ${error.response.status}`);
      console.error(`Message: ${error.response.data?.message || 'Unknown error'}`);
      console.error(`Data:`, error.response.data);
    } else if (error.request) {
      console.error('No response received from server');
      console.error('Is the backend running on port 5000?');
    } else {
      console.error('Error:', error.message);
    }
  }
}

// Run test
console.log('📍 Location Sharing - Received Endpoint Test');
console.log('='.repeat(50));
console.log(`API URL: ${API_BASE_URL}/location-sharing/received`);
console.log('='.repeat(50) + '\n');

if (USER_TOKEN === 'YOUR_AUTH_TOKEN_HERE') {
  console.log('⚠️  WARNING: Please set USER_TOKEN in the script first!');
  console.log('   Get your token by logging in and checking AsyncStorage\n');
} else {
  testReceivedShares();
}
