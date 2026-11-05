/**
 * Fix Moin-TesterOne Reciprocal Friendship
 * Restores the deleted reciprocal record
 */

const mongoose = require('mongoose');
require('dotenv').config();

const Friend = require('./models/Friend');
const User = require('./models/User');

const MOIN_USER_ID = '13a857b1-0f9c-45b4-aea1-1dc8835d3cd3';
const TESTERONE_USER_ID = '38283786-efcf-45bf-9f8b-42c3122857b5';

async function fixReciprocal() {
  try {
    console.log('🔧 [FIX] Connecting to database...');
    
    const mongoUri = process.env.MONGO_URI || process.env.MONGODB_URI;
    if (!mongoUri) {
      throw new Error('MongoDB URI not found in environment variables');
    }
    
    await mongoose.connect(mongoUri);
    console.log('✅ [FIX] Connected to database\n');

    // Find the deleted reciprocal record
    console.log('📊 [FIX] Finding Moin → TesterOne record...');
    const moinToTesterone = await Friend.findOne({
      userId: MOIN_USER_ID,
      friendUserId: TESTERONE_USER_ID
    });

    if (!moinToTesterone) {
      console.log('❌ [FIX] No record found! Creating new one...');
      
      // Get TesterOne's data
      const testeroneUser = await User.findOne({ userId: TESTERONE_USER_ID })
        .select('name profileImage username');
      
      if (!testeroneUser) {
        throw new Error('TesterOne user not found');
      }

      // Create new reciprocal
      const newReciprocal = new Friend({
        userId: MOIN_USER_ID,
        friendUserId: TESTERONE_USER_ID,
        source: 'app_search',
        status: 'accepted',
        acceptedAt: new Date(),
        isDeviceContact: false,
        isDeleted: false,
        cachedData: {
          name: testeroneUser.name,
          profileImage: testeroneUser.profileImage || '',
          username: testeroneUser.username || '',
          lastCacheUpdate: new Date()
        }
      });

      await newReciprocal.save();
      console.log('✅ [FIX] Created new reciprocal friendship');
      console.log('📊 [FIX] Details:', {
        _id: newReciprocal._id,
        status: newReciprocal.status,
        isDeleted: newReciprocal.isDeleted
      });
    } else {
      console.log('✅ [FIX] Found existing record');
      console.log('📊 [FIX] Current state:', {
        _id: moinToTesterone._id,
        status: moinToTesterone.status,
        isDeleted: moinToTesterone.isDeleted
      });

      if (moinToTesterone.isDeleted || moinToTesterone.status !== 'accepted') {
        console.log('🔧 [FIX] Restoring deleted/removed record...');
        
        // Get TesterOne's data
        const testeroneUser = await User.findOne({ userId: TESTERONE_USER_ID })
          .select('name profileImage username');

        // Restore the record
        moinToTesterone.status = 'accepted';
        moinToTesterone.acceptedAt = new Date();
        moinToTesterone.isDeleted = false;
        moinToTesterone.isDeviceContact = false;
        moinToTesterone.source = 'app_search';
        
        if (testeroneUser) {
          moinToTesterone.cachedData = {
            name: testeroneUser.name,
            profileImage: testeroneUser.profileImage || '',
            username: testeroneUser.username || '',
            lastCacheUpdate: new Date()
          };
        }

        await moinToTesterone.save();
        
        console.log('✅ [FIX] Record restored successfully!');
        console.log('📊 [FIX] New state:', {
          _id: moinToTesterone._id,
          status: moinToTesterone.status,
          isDeleted: moinToTesterone.isDeleted,
          isDeviceContact: moinToTesterone.isDeviceContact
        });
      } else {
        console.log('✅ [FIX] Record is already active, no changes needed');
      }
    }

    // Verify both directions
    console.log('\n' + '='.repeat(60));
    console.log('🔍 [VERIFICATION]');
    console.log('='.repeat(60));

    const testeroneToMoin = await Friend.findOne({
      userId: TESTERONE_USER_ID,
      friendUserId: MOIN_USER_ID,
      status: 'accepted',
      isDeleted: false
    });

    const moinToTesteroneVerify = await Friend.findOne({
      userId: MOIN_USER_ID,
      friendUserId: TESTERONE_USER_ID,
      status: 'accepted',
      isDeleted: false
    });

    console.log(`TesterOne → Moin: ${testeroneToMoin ? '✅ EXISTS' : '❌ MISSING'}`);
    console.log(`Moin → TesterOne: ${moinToTesteroneVerify ? '✅ EXISTS' : '❌ MISSING'}`);

    if (testeroneToMoin && moinToTesteroneVerify) {
      console.log('\n🎉 [SUCCESS] Both friendships are now active!');
      console.log('Both users should now see each other in their friend lists.');
    } else {
      console.log('\n⚠️ [WARNING] Friendship is still incomplete!');
    }

  } catch (error) {
    console.error('❌ [FIX] Error:', error);
  } finally {
    await mongoose.disconnect();
    console.log('\n👋 [FIX] Disconnected from database');
    process.exit(0);
  }
}

fixReciprocal();
