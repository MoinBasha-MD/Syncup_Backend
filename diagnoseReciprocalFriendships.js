/**
 * Reciprocal Friendship Diagnostic Script
 * 
 * Purpose: Analyze all friendships in the database to find broken reciprocal relationships
 * 
 * This script will:
 * 1. Get all users with friendships
 * 2. For each friendship, check if reciprocal exists
 * 3. Identify patterns in broken reciprocals
 * 4. Generate detailed report with recommendations
 * 
 * Usage: node diagnoseReciprocalFriendships.js
 */

const mongoose = require('mongoose');
require('dotenv').config();

const Friend = require('./models/Friend');
const User = require('./models/User');

// Statistics tracking
const stats = {
  totalUsers: 0,
  totalFriendships: 0,
  acceptedFriendships: 0,
  pendingFriendships: 0,
  brokenReciprocals: [],
  oneWayFriendships: [],
  deviceContactIssues: [],
  appConnectionIssues: [],
  statusMismatches: [],
  deletedMismatches: []
};

/**
 * Check if reciprocal friendship exists
 */
async function checkReciprocal(friendship) {
  const reciprocal = await Friend.findOne({
    userId: friendship.friendUserId,
    friendUserId: friendship.userId,
    isDeleted: false
  }).lean();
  
  return reciprocal;
}

/**
 * Analyze a single friendship
 */
async function analyzeFriendship(friendship, user) {
  console.log(`\n🔍 Analyzing: ${user.name} (${friendship.userId}) → Friend (${friendship.friendUserId})`);
  console.log(`   Status: ${friendship.status}`);
  console.log(`   Source: ${friendship.source}`);
  console.log(`   isDeviceContact: ${friendship.isDeviceContact}`);
  console.log(`   isDeleted: ${friendship.isDeleted}`);
  
  // Check for reciprocal
  const reciprocal = await checkReciprocal(friendship);
  
  if (!reciprocal) {
    console.log(`   ❌ BROKEN: No reciprocal friendship found!`);
    
    stats.brokenReciprocals.push({
      user: {
        userId: friendship.userId,
        name: user.name
      },
      friend: {
        userId: friendship.friendUserId
      },
      friendship: {
        status: friendship.status,
        source: friendship.source,
        isDeviceContact: friendship.isDeviceContact,
        createdAt: friendship.createdAt,
        acceptedAt: friendship.acceptedAt
      },
      issue: 'MISSING_RECIPROCAL',
      severity: 'HIGH'
    });
    
    stats.oneWayFriendships.push({
      from: friendship.userId,
      to: friendship.friendUserId,
      status: friendship.status,
      source: friendship.source
    });
    
    return false;
  }
  
  console.log(`   ✅ Reciprocal exists`);
  console.log(`   Reciprocal Status: ${reciprocal.status}`);
  console.log(`   Reciprocal isDeviceContact: ${reciprocal.isDeviceContact}`);
  console.log(`   Reciprocal isDeleted: ${reciprocal.isDeleted}`);
  
  // Check for status mismatches
  if (friendship.status !== reciprocal.status) {
    console.log(`   ⚠️ STATUS MISMATCH: ${friendship.status} vs ${reciprocal.status}`);
    
    stats.statusMismatches.push({
      user1: {
        userId: friendship.userId,
        name: user.name,
        status: friendship.status
      },
      user2: {
        userId: reciprocal.userId,
        status: reciprocal.status
      },
      issue: 'STATUS_MISMATCH',
      severity: 'MEDIUM'
    });
  }
  
  // Check for isDeleted mismatches
  if (friendship.isDeleted !== reciprocal.isDeleted) {
    console.log(`   ⚠️ DELETED MISMATCH: ${friendship.isDeleted} vs ${reciprocal.isDeleted}`);
    
    stats.deletedMismatches.push({
      user1: {
        userId: friendship.userId,
        name: user.name,
        isDeleted: friendship.isDeleted
      },
      user2: {
        userId: reciprocal.userId,
        isDeleted: reciprocal.isDeleted
      },
      issue: 'DELETED_MISMATCH',
      severity: 'HIGH'
    });
  }
  
  // Check for device contact issues
  if (friendship.isDeviceContact !== reciprocal.isDeviceContact) {
    console.log(`   ⚠️ DEVICE CONTACT MISMATCH: ${friendship.isDeviceContact} vs ${reciprocal.isDeviceContact}`);
    
    stats.deviceContactIssues.push({
      user1: {
        userId: friendship.userId,
        name: user.name,
        isDeviceContact: friendship.isDeviceContact
      },
      user2: {
        userId: reciprocal.userId,
        isDeviceContact: reciprocal.isDeviceContact
      },
      issue: 'DEVICE_CONTACT_MISMATCH',
      severity: 'LOW'
    });
  }
  
  // Check for app connection issues (both should be false for app connections)
  if (!friendship.isDeviceContact && reciprocal.isDeviceContact) {
    console.log(`   ⚠️ APP CONNECTION ISSUE: One side is device contact, other is app connection`);
    
    stats.appConnectionIssues.push({
      user1: {
        userId: friendship.userId,
        name: user.name,
        isDeviceContact: friendship.isDeviceContact
      },
      user2: {
        userId: reciprocal.userId,
        isDeviceContact: reciprocal.isDeviceContact
      },
      issue: 'APP_CONNECTION_INCONSISTENCY',
      severity: 'MEDIUM'
    });
  }
  
  return true;
}

/**
 * Main diagnostic function
 */
async function diagnoseReciprocalFriendships() {
  try {
    console.log('🔧 [DIAGNOSTIC] Connecting to database...');
    await mongoose.connect(process.env.MONGODB_URI);
    console.log('✅ [DIAGNOSTIC] Connected to database\n');
    
    console.log('═══════════════════════════════════════════════════════════');
    console.log('  RECIPROCAL FRIENDSHIP DIAGNOSTIC TOOL');
    console.log('═══════════════════════════════════════════════════════════\n');
    
    // Get all users
    const users = await User.find({}).select('userId name username').lean();
    stats.totalUsers = users.length;
    
    console.log(`📊 Found ${users.length} users in database\n`);
    
    // Analyze each user's friendships
    for (const user of users) {
      console.log(`\n👤 Checking user: ${user.name} (${user.userId})`);
      
      // Get all friendships for this user
      const friendships = await Friend.find({
        userId: user.userId,
        isDeleted: false
      }).lean();
      
      if (friendships.length === 0) {
        console.log(`   No friendships found`);
        continue;
      }
      
      console.log(`   Found ${friendships.length} friendships`);
      stats.totalFriendships += friendships.length;
      
      // Count by status
      const accepted = friendships.filter(f => f.status === 'accepted').length;
      const pending = friendships.filter(f => f.status === 'pending').length;
      
      stats.acceptedFriendships += accepted;
      stats.pendingFriendships += pending;
      
      console.log(`   - Accepted: ${accepted}`);
      console.log(`   - Pending: ${pending}`);
      
      // Analyze each friendship
      for (const friendship of friendships) {
        await analyzeFriendship(friendship, user);
      }
    }
    
    // Generate report
    console.log('\n\n');
    console.log('═══════════════════════════════════════════════════════════');
    console.log('  DIAGNOSTIC REPORT');
    console.log('═══════════════════════════════════════════════════════════\n');
    
    console.log('📊 OVERALL STATISTICS:');
    console.log(`   Total Users: ${stats.totalUsers}`);
    console.log(`   Total Friendships: ${stats.totalFriendships}`);
    console.log(`   - Accepted: ${stats.acceptedFriendships}`);
    console.log(`   - Pending: ${stats.pendingFriendships}`);
    
    console.log('\n🔴 CRITICAL ISSUES:\n');
    
    // Broken reciprocals
    console.log(`❌ BROKEN RECIPROCALS: ${stats.brokenReciprocals.length}`);
    if (stats.brokenReciprocals.length > 0) {
      console.log('\nDetails:');
      stats.brokenReciprocals.forEach((issue, index) => {
        console.log(`\n${index + 1}. ${issue.user.name} (${issue.user.userId})`);
        console.log(`   → Friend: ${issue.friend.userId}`);
        console.log(`   Status: ${issue.friendship.status}`);
        console.log(`   Source: ${issue.friendship.source}`);
        console.log(`   isDeviceContact: ${issue.friendship.isDeviceContact}`);
        console.log(`   Created: ${issue.friendship.createdAt}`);
        console.log(`   Accepted: ${issue.friendship.acceptedAt || 'N/A'}`);
        console.log(`   ⚠️ Issue: Missing reciprocal friendship`);
      });
    }
    
    // Deleted mismatches
    console.log(`\n\n❌ DELETED MISMATCHES: ${stats.deletedMismatches.length}`);
    if (stats.deletedMismatches.length > 0) {
      console.log('\nDetails:');
      stats.deletedMismatches.forEach((issue, index) => {
        console.log(`\n${index + 1}. ${issue.user1.name} (${issue.user1.userId})`);
        console.log(`   isDeleted: ${issue.user1.isDeleted}`);
        console.log(`   ↔ Friend: ${issue.user2.userId}`);
        console.log(`   isDeleted: ${issue.user2.isDeleted}`);
        console.log(`   ⚠️ Issue: One side deleted, other not`);
      });
    }
    
    console.log('\n\n⚠️ MEDIUM ISSUES:\n');
    
    // Status mismatches
    console.log(`⚠️ STATUS MISMATCHES: ${stats.statusMismatches.length}`);
    if (stats.statusMismatches.length > 0) {
      console.log('\nDetails:');
      stats.statusMismatches.forEach((issue, index) => {
        console.log(`\n${index + 1}. ${issue.user1.name} (${issue.user1.userId})`);
        console.log(`   Status: ${issue.user1.status}`);
        console.log(`   ↔ Friend: ${issue.user2.userId}`);
        console.log(`   Status: ${issue.user2.status}`);
        console.log(`   ⚠️ Issue: Different statuses on each side`);
      });
    }
    
    // App connection issues
    console.log(`\n\n⚠️ APP CONNECTION ISSUES: ${stats.appConnectionIssues.length}`);
    if (stats.appConnectionIssues.length > 0) {
      console.log('\nDetails:');
      stats.appConnectionIssues.forEach((issue, index) => {
        console.log(`\n${index + 1}. ${issue.user1.name} (${issue.user1.userId})`);
        console.log(`   isDeviceContact: ${issue.user1.isDeviceContact}`);
        console.log(`   ↔ Friend: ${issue.user2.userId}`);
        console.log(`   isDeviceContact: ${issue.user2.isDeviceContact}`);
        console.log(`   ⚠️ Issue: Inconsistent device contact flags`);
      });
    }
    
    console.log('\n\nℹ️ LOW PRIORITY ISSUES:\n');
    
    // Device contact mismatches
    console.log(`ℹ️ DEVICE CONTACT MISMATCHES: ${stats.deviceContactIssues.length}`);
    if (stats.deviceContactIssues.length > 0 && stats.deviceContactIssues.length <= 10) {
      console.log('\nDetails:');
      stats.deviceContactIssues.forEach((issue, index) => {
        console.log(`\n${index + 1}. ${issue.user1.name} (${issue.user1.userId})`);
        console.log(`   isDeviceContact: ${issue.user1.isDeviceContact}`);
        console.log(`   ↔ Friend: ${issue.user2.userId}`);
        console.log(`   isDeviceContact: ${issue.user2.isDeviceContact}`);
      });
    } else if (stats.deviceContactIssues.length > 10) {
      console.log(`   (Too many to display - ${stats.deviceContactIssues.length} total)`);
    }
    
    // Recommendations
    console.log('\n\n');
    console.log('═══════════════════════════════════════════════════════════');
    console.log('  RECOMMENDATIONS');
    console.log('═══════════════════════════════════════════════════════════\n');
    
    if (stats.brokenReciprocals.length > 0) {
      console.log('🔧 CRITICAL: Fix broken reciprocals');
      console.log('   Action: Create missing reciprocal friendships');
      console.log('   Script: Run fixAllReciprocalFriendships.js (to be created)');
    }
    
    if (stats.deletedMismatches.length > 0) {
      console.log('\n🔧 CRITICAL: Fix deleted mismatches');
      console.log('   Action: Sync isDeleted flag on both sides');
      console.log('   Script: Run syncDeletedFlags.js (to be created)');
    }
    
    if (stats.statusMismatches.length > 0) {
      console.log('\n🔧 MEDIUM: Fix status mismatches');
      console.log('   Action: Sync status on both sides (use most recent)');
      console.log('   Script: Run syncFriendshipStatus.js (to be created)');
    }
    
    if (stats.appConnectionIssues.length > 0) {
      console.log('\n🔧 MEDIUM: Fix app connection inconsistencies');
      console.log('   Action: Set isDeviceContact=false for both sides of app connections');
      console.log('   Script: Run fixAppConnectionFlags.js (to be created)');
    }
    
    // Summary
    console.log('\n\n');
    console.log('═══════════════════════════════════════════════════════════');
    console.log('  SUMMARY');
    console.log('═══════════════════════════════════════════════════════════\n');
    
    const totalIssues = stats.brokenReciprocals.length + 
                       stats.deletedMismatches.length + 
                       stats.statusMismatches.length + 
                       stats.appConnectionIssues.length + 
                       stats.deviceContactIssues.length;
    
    if (totalIssues === 0) {
      console.log('✅ NO ISSUES FOUND! All friendships are properly reciprocal.');
    } else {
      console.log(`⚠️ FOUND ${totalIssues} TOTAL ISSUES:`);
      console.log(`   - ${stats.brokenReciprocals.length} broken reciprocals (CRITICAL)`);
      console.log(`   - ${stats.deletedMismatches.length} deleted mismatches (CRITICAL)`);
      console.log(`   - ${stats.statusMismatches.length} status mismatches (MEDIUM)`);
      console.log(`   - ${stats.appConnectionIssues.length} app connection issues (MEDIUM)`);
      console.log(`   - ${stats.deviceContactIssues.length} device contact mismatches (LOW)`);
      
      console.log('\n📝 Next Steps:');
      console.log('   1. Review the issues above');
      console.log('   2. Run the recommended fix scripts');
      console.log('   3. Re-run this diagnostic to verify fixes');
    }
    
    console.log('\n✅ [DIAGNOSTIC] Analysis complete!');
    
  } catch (error) {
    console.error('❌ [DIAGNOSTIC] Error:', error);
    console.error(error.stack);
  } finally {
    await mongoose.disconnect();
    console.log('\n👋 [DIAGNOSTIC] Disconnected from database');
    process.exit(0);
  }
}

// Run the diagnostic
console.log('Starting reciprocal friendship diagnostic...\n');
diagnoseReciprocalFriendships();
