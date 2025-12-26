/**
 * Fix Missing Reciprocal Friendship
 * Creates the missing reciprocal friendship record for TesterOne → Moin
 */

const mongoose = require('mongoose');
require('dotenv').config();

// Import Friend model
const Friend = require('./models/Friend');
const User = require('./models/User');

const MOIN_USER_ID = '13a857b1-0f9c-45b4-aea1-1dc8835d3cd3';
const TESTERONE_USER_ID = '38283786-efcf-45bf-9f8b-42c3122857b5';

async function fixMissingReciprocal() {
  try {
    console.log('🔧 [FIX] Connecting to database...');
    await mongoose.connect(process.env.MONGODB_URI);
    console.log('✅ [FIX] Connected to database');

    // Check if Moin → TesterOne exists
    console.log('\n📊 [FIX] Checking existing friendships...');
    const moinToTesterone = await Friend.findOne({
      userId: MOIN_USER_ID,
      friendUserId: TESTERONE_USER_ID,
      isDeleted: false
    });

    console.log('Moin → TesterOne:', moinToTesterone ? {
      _id: moinToTesterone._id,
      status: moinToTesterone.status,
      source: moinToTesterone.source,
      isDeviceContact: moinToTesterone.isDeviceContact
    } : '❌ NOT FOUND');

    // Check if TesterOne → Moin exists
    const testeroneToMoin = await Friend.findOne({
      userId: TESTERONE_USER_ID,
      friendUserId: MOIN_USER_ID,
      isDeleted: false
    });

    console.log('TesterOne → Moin:', testeroneToMoin ? {
      _id: testeroneToMoin._id,
      status: testeroneToMoin.status,
      source: testeroneToMoin.source,
      isDeviceContact: testeroneToMoin.isDeviceContact
    } : '❌ NOT FOUND');

    // If reciprocal is missing, create it
    if (!testeroneToMoin && moinToTesterone) {
      console.log('\n🔧 [FIX] Reciprocal friendship missing! Creating...');

      // Get Moin's user data for cache
      const moinUser = await User.findOne({ userId: MOIN_USER_ID })
        .select('name profileImage username');

      if (!moinUser) {
        console.error('❌ [FIX] Moin user not found in database!');
        process.exit(1);
      }

      // Create reciprocal friendship
      const newReciprocal = new Friend({
        userId: TESTERONE_USER_ID,
        friendUserId: MOIN_USER_ID,
        source: moinToTesterone.source || 'app_search',
        status: 'accepted',
        acceptedAt: moinToTesterone.acceptedAt || new Date(),
        isDeviceContact: false, // CRITICAL: Must be false for app connections
        cachedData: {
          name: moinUser.name,
          profileImage: moinUser.profileImage || '',
          username: moinUser.username || '',
          lastCacheUpdate: new Date()
        }
      });

      await newReciprocal.save();

      console.log('✅ [FIX] Reciprocal friendship created!');
      console.log('📊 [FIX] Details:', {
        _id: newReciprocal._id,
        userId: newReciprocal.userId,
        friendUserId: newReciprocal.friendUserId,
        status: newReciprocal.status,
        source: newReciprocal.source,
        isDeviceContact: newReciprocal.isDeviceContact
      });

      // Verify it was created
      const verify = await Friend.findById(newReciprocal._id);
      console.log('🔍 [FIX] Verification:', verify ? '✅ Record exists in database' : '❌ Failed to create');

    } else if (testeroneToMoin) {
      console.log('\n✅ [FIX] Reciprocal friendship already exists!');
      console.log('📊 [FIX] Checking if it needs update...');

      let needsUpdate = false;
      const updates = {};

      // Check if isDeviceContact is wrong
      if (testeroneToMoin.isDeviceContact !== false) {
        console.log('⚠️ [FIX] isDeviceContact is wrong:', testeroneToMoin.isDeviceContact, '→ should be false');
        updates.isDeviceContact = false;
        needsUpdate = true;
      }

      // Check if status is wrong
      if (testeroneToMoin.status !== 'accepted') {
        console.log('⚠️ [FIX] status is wrong:', testeroneToMoin.status, '→ should be accepted');
        updates.status = 'accepted';
        updates.acceptedAt = new Date();
        needsUpdate = true;
      }

      // Check if isDeleted is true
      if (testeroneToMoin.isDeleted) {
        console.log('⚠️ [FIX] isDeleted is true → should be false');
        updates.isDeleted = false;
        needsUpdate = true;
      }

      if (needsUpdate) {
        console.log('🔧 [FIX] Updating reciprocal friendship...');
        await Friend.findByIdAndUpdate(testeroneToMoin._id, updates);
        console.log('✅ [FIX] Reciprocal friendship updated!');
        console.log('📊 [FIX] Updates applied:', updates);
      } else {
        console.log('✅ [FIX] Reciprocal friendship is correct, no updates needed');
      }
    } else {
      console.log('\n⚠️ [FIX] Neither friendship exists! This is unexpected.');
      console.log('Please check if the friend request was actually accepted.');
    }

    console.log('\n✅ [FIX] Fix completed!');
    console.log('🔄 [FIX] Please refresh the app on TesterOne\'s device to see Moin');

  } catch (error) {
    console.error('❌ [FIX] Error:', error);
  } finally {
    await mongoose.disconnect();
    console.log('👋 [FIX] Disconnected from database');
    process.exit(0);
  }
}

// Run the fix
fixMissingReciprocal();
