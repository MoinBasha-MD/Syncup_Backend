/**
 * Auto-Fix Broken Reciprocal Friendships
 * 
 * Purpose: Automatically repair all broken reciprocal relationships found in the database
 * 
 * This script will:
 * 1. Find all friendships missing reciprocals
 * 2. Create missing reciprocal friendships
 * 3. Sync status and flags between reciprocals
 * 4. Generate detailed report of fixes applied
 * 
 * Usage: node fixAllReciprocalFriendships.js
 */

const mongoose = require('mongoose');
require('dotenv').config();
const connectDB = require('./config/db');

const Friend = require('./models/Friend');
const User = require('./models/userModel');

// Statistics tracking
const stats = {
  totalChecked: 0,
  reciprocalsCreated: 0,
  reciprocalsRestored: 0,
  statusSynced: 0,
  deletedSynced: 0,
  deviceContactSynced: 0,
  errors: []
};

/**
 * Create missing reciprocal friendship
 */
async function createReciprocal(friendship, userName) {
  try {
    console.log(`\n🔧 Creating reciprocal: ${friendship.friendUserId} → ${friendship.userId}`);
    
    // Get friend's user data for cache
    const friendUser = await User.findOne({ userId: friendship.userId })
      .select('name profileImage username');
    
    if (!friendUser) {
      console.error(`❌ User not found: ${friendship.userId}`);
      stats.errors.push({
        type: 'USER_NOT_FOUND',
        userId: friendship.userId,
        friendUserId: friendship.friendUserId
      });
      return false;
    }
    
    // Create new reciprocal friendship
    const newReciprocal = new Friend({
      userId: friendship.friendUserId,
      friendUserId: friendship.userId,
      source: friendship.source || 'app_search',
      status: friendship.status,
      acceptedAt: friendship.acceptedAt || (friendship.status === 'accepted' ? new Date() : null),
      isDeviceContact: friendship.isDeviceContact,
      cachedData: {
        name: friendUser.name,
        profileImage: friendUser.profileImage || '',
        username: friendUser.username || '',
        lastCacheUpdate: new Date()
      }
    });
    
    await newReciprocal.save();
    
    console.log(`✅ Created reciprocal friendship`);
    console.log(`   From: ${friendship.friendUserId}`);
    console.log(`   To: ${friendship.userId}`);
    console.log(`   Status: ${newReciprocal.status}`);
    console.log(`   Source: ${newReciprocal.source}`);
    console.log(`   isDeviceContact: ${newReciprocal.isDeviceContact}`);
    
    stats.reciprocalsCreated++;
    return true;
    
  } catch (error) {
    console.error(`❌ Failed to create reciprocal:`, error.message);
    stats.errors.push({
      type: 'CREATE_FAILED',
      userId: friendship.userId,
      friendUserId: friendship.friendUserId,
      error: error.message
    });
    return false;
  }
}

/**
 * Sync reciprocal friendship properties
 */
async function syncReciprocal(friendship, reciprocal, userName) {
  try {
    console.log(`\n🔄 Syncing reciprocal properties`);
    
    let updated = false;
    const updates = {};
    
    // Sync status (use accepted if either is accepted)
    if (friendship.status !== reciprocal.status) {
      console.log(`   Status mismatch: ${friendship.status} vs ${reciprocal.status}`);
      
      // If one is accepted, both should be accepted
      if (friendship.status === 'accepted' || reciprocal.status === 'accepted') {
        updates.status = 'accepted';
        if (!reciprocal.acceptedAt) {
          updates.acceptedAt = new Date();
        }
        console.log(`   → Setting both to: accepted`);
        updated = true;
        stats.statusSynced++;
      }
    }
    
    // Sync isDeleted (if one is deleted, both should be deleted)
    if (friendship.isDeleted !== reciprocal.isDeleted) {
      console.log(`   isDeleted mismatch: ${friendship.isDeleted} vs ${reciprocal.isDeleted}`);
      
      // If either is deleted, mark both as deleted
      if (friendship.isDeleted || reciprocal.isDeleted) {
        updates.isDeleted = true;
        console.log(`   → Setting both to: deleted`);
      } else {
        updates.isDeleted = false;
        console.log(`   → Setting both to: not deleted`);
      }
      updated = true;
      stats.deletedSynced++;
    }
    
    // Sync isDeviceContact (should match for consistency)
    if (friendship.isDeviceContact !== reciprocal.isDeviceContact) {
      console.log(`   isDeviceContact mismatch: ${friendship.isDeviceContact} vs ${reciprocal.isDeviceContact}`);
      
      // For app connections (friend requests), both should be false
      if (!friendship.isDeviceContact || !reciprocal.isDeviceContact) {
        updates.isDeviceContact = false;
        console.log(`   → Setting both to: false (app connection)`);
      } else {
        updates.isDeviceContact = true;
        console.log(`   → Setting both to: true (device contact)`);
      }
      updated = true;
      stats.deviceContactSynced++;
    }
    
    // Restore if deleted
    if (reciprocal.isDeleted && !friendship.isDeleted) {
      console.log(`   Restoring deleted reciprocal`);
      updates.isDeleted = false;
      updates.status = friendship.status;
      if (friendship.status === 'accepted' && !reciprocal.acceptedAt) {
        updates.acceptedAt = new Date();
      }
      updated = true;
      stats.reciprocalsRestored++;
    }
    
    if (updated) {
      await Friend.findByIdAndUpdate(reciprocal._id, updates);
      console.log(`✅ Reciprocal synced successfully`);
      return true;
    } else {
      console.log(`✅ Reciprocal already in sync`);
      return false;
    }
    
  } catch (error) {
    console.error(`❌ Failed to sync reciprocal:`, error.message);
    stats.errors.push({
      type: 'SYNC_FAILED',
      userId: friendship.userId,
      friendUserId: friendship.friendUserId,
      error: error.message
    });
    return false;
  }
}

/**
 * Main fix function
 */
async function fixAllReciprocalFriendships() {
  try {
    console.log('🔧 [FIX] Connecting to database...');
    await connectDB();
    console.log('✅ [FIX] Connected to database\n');
    
    console.log('═══════════════════════════════════════════════════════════');
    console.log('  AUTO-FIX RECIPROCAL FRIENDSHIPS');
    console.log('═══════════════════════════════════════════════════════════\n');
    
    // Get all users
    const users = await User.find({}).select('userId name username').lean();
    console.log(`📊 Found ${users.length} users in database\n`);
    
    // Process each user's friendships
    for (const user of users) {
      console.log(`\n👤 Processing: ${user.name} (${user.userId})`);
      
      // Get all friendships for this user (including deleted)
      const friendships = await Friend.find({
        userId: user.userId
      }).lean();
      
      if (friendships.length === 0) {
        console.log(`   No friendships found`);
        continue;
      }
      
      console.log(`   Found ${friendships.length} friendships`);
      
      // Check each friendship for reciprocal
      for (const friendship of friendships) {
        stats.totalChecked++;
        
        console.log(`\n   🔍 Checking: ${user.name} → Friend (${friendship.friendUserId})`);
        console.log(`      Status: ${friendship.status}, isDeleted: ${friendship.isDeleted}`);
        
        // Find reciprocal (including deleted)
        const reciprocal = await Friend.findOne({
          userId: friendship.friendUserId,
          friendUserId: friendship.userId
        }).lean();
        
        if (!reciprocal) {
          console.log(`      ❌ Missing reciprocal - creating...`);
          await createReciprocal(friendship, user.name);
        } else {
          console.log(`      ✅ Reciprocal exists - checking sync...`);
          await syncReciprocal(friendship, reciprocal, user.name);
        }
      }
    }
    
    // Generate report
    console.log('\n\n');
    console.log('═══════════════════════════════════════════════════════════');
    console.log('  FIX REPORT');
    console.log('═══════════════════════════════════════════════════════════\n');
    
    console.log('📊 STATISTICS:');
    console.log(`   Total Friendships Checked: ${stats.totalChecked}`);
    console.log(`   Reciprocals Created: ${stats.reciprocalsCreated}`);
    console.log(`   Reciprocals Restored: ${stats.reciprocalsRestored}`);
    console.log(`   Status Synced: ${stats.statusSynced}`);
    console.log(`   Deleted Flags Synced: ${stats.deletedSynced}`);
    console.log(`   Device Contact Flags Synced: ${stats.deviceContactSynced}`);
    console.log(`   Errors: ${stats.errors.length}`);
    
    if (stats.errors.length > 0) {
      console.log('\n❌ ERRORS:');
      stats.errors.forEach((error, index) => {
        console.log(`\n${index + 1}. ${error.type}`);
        console.log(`   User: ${error.userId}`);
        console.log(`   Friend: ${error.friendUserId}`);
        if (error.error) {
          console.log(`   Error: ${error.error}`);
        }
      });
    }
    
    const totalFixes = stats.reciprocalsCreated + stats.reciprocalsRestored + 
                      stats.statusSynced + stats.deletedSynced + stats.deviceContactSynced;
    
    console.log('\n\n');
    console.log('═══════════════════════════════════════════════════════════');
    console.log('  SUMMARY');
    console.log('═══════════════════════════════════════════════════════════\n');
    
    if (totalFixes === 0 && stats.errors.length === 0) {
      console.log('✅ NO ISSUES FOUND! All friendships are properly reciprocal.');
    } else {
      console.log(`✅ APPLIED ${totalFixes} FIXES`);
      
      if (stats.reciprocalsCreated > 0) {
        console.log(`   ✓ Created ${stats.reciprocalsCreated} missing reciprocals`);
      }
      if (stats.reciprocalsRestored > 0) {
        console.log(`   ✓ Restored ${stats.reciprocalsRestored} deleted reciprocals`);
      }
      if (stats.statusSynced > 0) {
        console.log(`   ✓ Synced ${stats.statusSynced} status mismatches`);
      }
      if (stats.deletedSynced > 0) {
        console.log(`   ✓ Synced ${stats.deletedSynced} deleted flags`);
      }
      if (stats.deviceContactSynced > 0) {
        console.log(`   ✓ Synced ${stats.deviceContactSynced} device contact flags`);
      }
      
      if (stats.errors.length > 0) {
        console.log(`\n   ⚠️ ${stats.errors.length} errors encountered (see above)`);
      }
      
      console.log('\n📝 Next Steps:');
      console.log('   1. Run diagnoseReciprocalFriendships.js to verify fixes');
      console.log('   2. Ask users to refresh their apps');
      console.log('   3. Monitor for any new reciprocal issues');
    }
    
    console.log('\n✅ [FIX] Auto-fix complete!');
    
  } catch (error) {
    console.error('❌ [FIX] Error:', error);
    console.error(error.stack);
  } finally {
    await mongoose.disconnect();
    console.log('\n👋 [FIX] Disconnected from database');
    process.exit(0);
  }
}

// Run the fix
console.log('Starting auto-fix for reciprocal friendships...\n');
fixAllReciprocalFriendships();
