/**
 * Check Moin-TesterOne Friendship Status
 * Diagnose why reciprocal friendship is missing
 */

const mongoose = require('mongoose');
require('dotenv').config();

const Friend = require('./models/Friend');

const MOIN_USER_ID = '13a857b1-0f9c-45b4-aea1-1dc8835d3cd3';
const TESTERONE_USER_ID = '38283786-efcf-45bf-9f8b-42c3122857b5';

async function checkFriendship() {
  try {
    console.log('🔍 [CHECK] Connecting to database...');
    await mongoose.connect(process.env.MONGODB_URI);
    console.log('✅ [CHECK] Connected to database\n');

    // Check TesterOne → Moin
    console.log('📊 [CHECK] Checking TesterOne → Moin friendship...');
    const testeroneToMoin = await Friend.find({
      userId: TESTERONE_USER_ID,
      friendUserId: MOIN_USER_ID
    }).sort({ createdAt: -1 });

    console.log(`Found ${testeroneToMoin.length} record(s):`);
    testeroneToMoin.forEach((record, index) => {
      console.log(`\nRecord ${index + 1}:`, {
        _id: record._id,
        status: record.status,
        source: record.source,
        isDeviceContact: record.isDeviceContact,
        isDeleted: record.isDeleted,
        createdAt: record.createdAt,
        acceptedAt: record.acceptedAt
      });
    });

    // Check Moin → TesterOne
    console.log('\n📊 [CHECK] Checking Moin → TesterOne friendship...');
    const moinToTesterone = await Friend.find({
      userId: MOIN_USER_ID,
      friendUserId: TESTERONE_USER_ID
    }).sort({ createdAt: -1 });

    console.log(`Found ${moinToTesterone.length} record(s):`);
    moinToTesterone.forEach((record, index) => {
      console.log(`\nRecord ${index + 1}:`, {
        _id: record._id,
        status: record.status,
        source: record.source,
        isDeviceContact: record.isDeviceContact,
        isDeleted: record.isDeleted,
        createdAt: record.createdAt,
        acceptedAt: record.acceptedAt
      });
    });

    // Summary
    console.log('\n' + '='.repeat(60));
    console.log('📋 [SUMMARY]');
    console.log('='.repeat(60));
    
    const activeTesteroneToMoin = testeroneToMoin.find(r => r.status === 'accepted' && !r.isDeleted);
    const activeMoinToTesterone = moinToTesterone.find(r => r.status === 'accepted' && !r.isDeleted);
    
    console.log(`TesterOne → Moin (active): ${activeTesteroneToMoin ? '✅ EXISTS' : '❌ MISSING'}`);
    console.log(`Moin → TesterOne (active): ${activeMoinToTesterone ? '✅ EXISTS' : '❌ MISSING'}`);
    
    if (activeTesteroneToMoin && !activeMoinToTesterone) {
      console.log('\n⚠️ [ISSUE] ONE-WAY FRIENDSHIP DETECTED!');
      console.log('TesterOne can see Moin, but Moin cannot see TesterOne');
      console.log('\nThis confirms the reciprocal friendship creation failed.');
    } else if (!activeTesteroneToMoin && activeMoinToTesterone) {
      console.log('\n⚠️ [ISSUE] REVERSE ONE-WAY FRIENDSHIP DETECTED!');
      console.log('Moin can see TesterOne, but TesterOne cannot see Moin');
    } else if (activeTesteroneToMoin && activeMoinToTesterone) {
      console.log('\n✅ [SUCCESS] Both friendships exist!');
    } else {
      console.log('\n❌ [ERROR] No active friendships found!');
    }

  } catch (error) {
    console.error('❌ [CHECK] Error:', error);
  } finally {
    await mongoose.disconnect();
    console.log('\n👋 [CHECK] Disconnected from database');
    process.exit(0);
  }
}

checkFriendship();
