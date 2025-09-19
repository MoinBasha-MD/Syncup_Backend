const mongoose = require('mongoose');
require('dotenv').config();

// Import models
const User = require('../models/userModel');
const ConnectionRequest = require('../models/connectionRequestModel');

/**
 * Script to diagnose potential connection sharing issues
 * This will analyze:
 * 1. Check for duplicate connections across users
 * 2. Verify bidirectional consistency
 * 3. Look for anomalous connection patterns
 * 4. Check for shared object references
 */

const diagnoseConnectionSharing = async () => {
  try {
    console.log('🔍 Starting connection sharing diagnosis...');
    
    // Connect to MongoDB
    await mongoose.connect(process.env.MONGO_URI);
    console.log('✅ Connected to MongoDB');
    
    // Get all users with connections
    const usersWithConnections = await User.find({
      'appConnections.0': { $exists: true }
    }, 'userId name appConnections').lean();
    
    console.log(`📊 Found ${usersWithConnections.length} users with connections`);
    
    // Analyze connection patterns
    const connectionMap = new Map(); // userId -> Set of connected userIds
    const allConnections = [];
    let totalConnections = 0;
    
    // Build connection map
    usersWithConnections.forEach(user => {
      const userConnections = new Set();
      user.appConnections.forEach(conn => {
        userConnections.add(conn.userId);
        allConnections.push({
          fromUser: user.userId,
          fromUserName: user.name,
          toUser: conn.userId,
          toUserName: conn.name,
          connectionDate: conn.connectionDate,
          status: conn.status
        });
        totalConnections++;
      });
      connectionMap.set(user.userId, userConnections);
    });
    
    console.log(`📊 Total connection records: ${totalConnections}`);
    console.log('');
    
    // Check for bidirectional consistency issues
    console.log('🔍 Checking bidirectional consistency...');
    const inconsistencies = [];
    
    connectionMap.forEach((connections, userId) => {
      connections.forEach(connectedUserId => {
        const reverseConnections = connectionMap.get(connectedUserId);
        if (!reverseConnections || !reverseConnections.has(userId)) {
          inconsistencies.push({
            user1: userId,
            user2: connectedUserId,
            issue: 'One-way connection (missing reverse connection)'
          });
        }
      });
    });
    
    if (inconsistencies.length > 0) {
      console.log(`❌ Found ${inconsistencies.length} bidirectional inconsistencies:`);
      inconsistencies.forEach((issue, index) => {
        console.log(`   ${index + 1}. ${issue.user1} -> ${issue.user2}: ${issue.issue}`);
      });
    } else {
      console.log('✅ All connections are bidirectionally consistent');
    }
    console.log('');
    
    // Check for suspicious connection patterns
    console.log('🔍 Checking for suspicious connection patterns...');
    const userConnectionCounts = new Map();
    const suspiciousPatterns = [];
    
    connectionMap.forEach((connections, userId) => {
      const count = connections.size;
      userConnectionCounts.set(userId, count);
      
      // Flag users with unusually high connection counts
      if (count > 100) {
        suspiciousPatterns.push({
          userId,
          issue: `Unusually high connection count: ${count}`,
          severity: 'high'
        });
      }
    });
    
    // Check for identical connection lists (potential sharing bug)
    console.log('🔍 Checking for identical connection lists...');
    const connectionSignatures = new Map(); // signature -> [userIds]
    
    connectionMap.forEach((connections, userId) => {
      const signature = Array.from(connections).sort().join(',');
      if (!connectionSignatures.has(signature)) {
        connectionSignatures.set(signature, []);
      }
      connectionSignatures.get(signature).push(userId);
    });
    
    const identicalLists = [];
    connectionSignatures.forEach((userIds, signature) => {
      if (userIds.length > 1 && signature !== '') {
        identicalLists.push({
          users: userIds,
          connectionCount: signature.split(',').length,
          signature: signature.substring(0, 100) + (signature.length > 100 ? '...' : '')
        });
      }
    });
    
    if (identicalLists.length > 0) {
      console.log(`⚠️ Found ${identicalLists.length} groups of users with identical connection lists:`);
      identicalLists.forEach((group, index) => {
        console.log(`   ${index + 1}. Users ${group.users.join(', ')} have ${group.connectionCount} identical connections`);
        if (group.connectionCount > 5) {
          suspiciousPatterns.push({
            userId: group.users.join(', '),
            issue: `Identical connection lists (${group.connectionCount} connections)`,
            severity: 'critical'
          });
        }
      });
    } else {
      console.log('✅ No identical connection lists found');
    }
    console.log('');
    
    // Summary of findings
    console.log('📋 DIAGNOSIS SUMMARY:');
    console.log(`   Total users with connections: ${usersWithConnections.length}`);
    console.log(`   Total connection records: ${totalConnections}`);
    console.log(`   Bidirectional inconsistencies: ${inconsistencies.length}`);
    console.log(`   Suspicious patterns: ${suspiciousPatterns.length}`);
    console.log(`   Identical connection lists: ${identicalLists.length}`);
    console.log('');
    
    if (suspiciousPatterns.length > 0) {
      console.log('⚠️ SUSPICIOUS PATTERNS DETECTED:');
      suspiciousPatterns.forEach((pattern, index) => {
        console.log(`   ${index + 1}. [${pattern.severity.toUpperCase()}] User ${pattern.userId}: ${pattern.issue}`);
      });
      console.log('');
      console.log('🚨 RECOMMENDATION: Clear all connections to fix potential sharing issues');
    } else if (inconsistencies.length > 0) {
      console.log('⚠️ RECOMMENDATION: Fix bidirectional inconsistencies or clear all connections');
    } else {
      console.log('✅ No major issues detected. Connections appear to be working correctly.');
    }
    
    // Show top users by connection count
    const sortedUsers = Array.from(userConnectionCounts.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 10);
    
    if (sortedUsers.length > 0) {
      console.log('');
      console.log('👥 Top users by connection count:');
      sortedUsers.forEach(([userId, count], index) => {
        const user = usersWithConnections.find(u => u.userId === userId);
        console.log(`   ${index + 1}. ${user?.name || 'Unknown'} (${userId}): ${count} connections`);
      });
    }
    
  } catch (error) {
    console.error('❌ Error during diagnosis:', error);
  } finally {
    // Close database connection
    await mongoose.connection.close();
    console.log('🔌 Database connection closed');
    process.exit(0);
  }
};

// Run diagnosis
diagnoseConnectionSharing();
