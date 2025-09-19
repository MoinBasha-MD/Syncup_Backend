const mongoose = require('mongoose');
require('dotenv').config();

// Import models
const User = require('../models/userModel');
const ConnectionRequest = require('../models/connectionRequestModel');

/**
 * Script to clear all connections for all users
 * This will:
 * 1. Clear all appConnections arrays from all users
 * 2. Delete all connection requests
 * 3. Provide a summary of cleared data
 */

const clearAllConnections = async () => {
  try {
    console.log('🚀 Starting connection cleanup process...');
    
    // Connect to MongoDB
    await mongoose.connect(process.env.MONGO_URI);
    console.log('✅ Connected to MongoDB');
    
    // Get initial counts for reporting
    const totalUsers = await User.countDocuments({});
    const usersWithConnections = await User.countDocuments({
      'appConnections.0': { $exists: true }
    });
    const totalConnectionRequests = await ConnectionRequest.countDocuments({});
    
    console.log(`📊 Initial State:`);
    console.log(`   Total Users: ${totalUsers}`);
    console.log(`   Users with Connections: ${usersWithConnections}`);
    console.log(`   Total Connection Requests: ${totalConnectionRequests}`);
    
    // Count total connections before clearing
    const usersWithConnectionsData = await User.find({
      'appConnections.0': { $exists: true }
    }, 'userId appConnections');
    
    let totalConnections = 0;
    usersWithConnectionsData.forEach(user => {
      totalConnections += user.appConnections.length;
    });
    
    console.log(`   Total Connection Records: ${totalConnections}`);
    console.log('');
    
    // Clear all appConnections arrays
    console.log('🧹 Clearing all user connections...');
    const userUpdateResult = await User.updateMany(
      {},
      { $set: { appConnections: [] } }
    );
    
    console.log(`✅ Updated ${userUpdateResult.modifiedCount} users`);
    
    // Delete all connection requests
    console.log('🧹 Clearing all connection requests...');
    const requestDeleteResult = await ConnectionRequest.deleteMany({});
    
    console.log(`✅ Deleted ${requestDeleteResult.deletedCount} connection requests`);
    
    // Verify cleanup
    const remainingConnections = await User.countDocuments({
      'appConnections.0': { $exists: true }
    });
    const remainingRequests = await ConnectionRequest.countDocuments({});
    
    console.log('');
    console.log('📊 Final State:');
    console.log(`   Users with Connections: ${remainingConnections}`);
    console.log(`   Remaining Connection Requests: ${remainingRequests}`);
    
    if (remainingConnections === 0 && remainingRequests === 0) {
      console.log('✅ All connections and requests successfully cleared!');
    } else {
      console.log('⚠️ Some connections or requests may still remain');
    }
    
    console.log('');
    console.log('📋 Summary:');
    console.log(`   - Cleared connections for ${userUpdateResult.modifiedCount} users`);
    console.log(`   - Deleted ${requestDeleteResult.deletedCount} connection requests`);
    console.log(`   - Total connection records removed: ${totalConnections}`);
    
  } catch (error) {
    console.error('❌ Error during connection cleanup:', error);
  } finally {
    // Close database connection
    await mongoose.connection.close();
    console.log('🔌 Database connection closed');
    process.exit(0);
  }
};

// Add confirmation prompt
const readline = require('readline');
const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout
});

console.log('⚠️  WARNING: This will permanently delete ALL connections and connection requests!');
console.log('This action cannot be undone.');
console.log('');

rl.question('Are you sure you want to proceed? Type "YES" to confirm: ', (answer) => {
  if (answer === 'YES') {
    rl.close();
    clearAllConnections();
  } else {
    console.log('❌ Operation cancelled');
    rl.close();
    process.exit(0);
  }
});
