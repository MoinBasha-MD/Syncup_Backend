/**
 * Test getFriends() to see what's being filtered
 * 
 * This will show us exactly why User B can't see User A
 */

const mongoose = require('mongoose');
require('dotenv').config();
const connectDB = require('./config/db');

const Friend = require('./models/Friend');
const User = require('./models/userModel');

async function testGetFriends() {
  try {
    console.log('🔧 Connecting to database...');
    await connectDB();
    console.log('✅ Connected to database\n');
    
    // Test specific users from the diagnostic
    const testCases = [
      {
        userId: '45a22aca-fc31-42c9-88a3-fda3b63a8a0f', // Shivaji
        name: 'Shivaji'
      },
      {
        userId: '6b01e175-bdf1-4093-9504-e0da4a45be0e', // sai
        name: 'sai'
      },
      {
        userId: '13a857b1-0f9c-45b4-aea1-1dc8835d3cd3', // Moin
        name: 'Moin'
      }
    ];
    
    for (const testCase of testCases) {
      console.log('\n═══════════════════════════════════════════════════════════');
      console.log(`Testing getFriends() for: ${testCase.name} (${testCase.userId})`);
      console.log('═══════════════════════════════════════════════════════════\n');
      
      // Get raw friendships from database
      const rawFriendships = await Friend.find({
        userId: testCase.userId,
        isDeleted: false
      }).lean();
      
      console.log(`📊 RAW DATABASE QUERY: Found ${rawFriendships.length} friendships`);
      rawFriendships.forEach((f, i) => {
        console.log(`\n${i + 1}. ${testCase.name} → Friend (${f.friendUserId})`);
        console.log(`   Status: ${f.status}`);
        console.log(`   isDeviceContact: ${f.isDeviceContact}`);
        console.log(`   Source: ${f.source}`);
      });
      
      console.log('\n-----------------------------------------------------------');
      console.log('Now calling Friend.getFriends() with filtering logic...');
      console.log('-----------------------------------------------------------\n');
      
      // Call getFriends() which applies filtering
      const filteredFriends = await Friend.getFriends(testCase.userId, {
        status: 'accepted'
      });
      
      console.log(`\n📊 AFTER FILTERING: Returning ${filteredFriends.length} friends`);
      
      if (filteredFriends.length < rawFriendships.filter(f => f.status === 'accepted').length) {
        const acceptedCount = rawFriendships.filter(f => f.status === 'accepted').length;
        const filtered = acceptedCount - filteredFriends.length;
        console.log(`\n⚠️ WARNING: ${filtered} accepted friendships were FILTERED OUT!`);
        
        // Find which ones were filtered
        const filteredIds = new Set(filteredFriends.map(f => f.friendUserId));
        const removedFriends = rawFriendships.filter(f => 
          f.status === 'accepted' && !filteredIds.has(f.friendUserId)
        );
        
        console.log('\n❌ FILTERED OUT FRIENDSHIPS:');
        removedFriends.forEach((f, i) => {
          console.log(`\n${i + 1}. ${testCase.name} → Friend (${f.friendUserId})`);
          console.log(`   Status: ${f.status}`);
          console.log(`   isDeviceContact: ${f.isDeviceContact}`);
          console.log(`   Source: ${f.source}`);
          console.log(`   ⚠️ Reason: Likely failed mutual check or device contact logic`);
        });
      } else {
        console.log('\n✅ All accepted friendships are visible (none filtered)');
      }
      
      console.log('\n');
    }
    
    console.log('\n═══════════════════════════════════════════════════════════');
    console.log('Test Complete');
    console.log('═══════════════════════════════════════════════════════════\n');
    
  } catch (error) {
    console.error('❌ Error:', error);
    console.error(error.stack);
  } finally {
    await mongoose.disconnect();
    console.log('👋 Disconnected from database');
    process.exit(0);
  }
}

testGetFriends();
