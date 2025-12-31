/**
 * Cleanup ALL Old Tokens Script (Root folder version)
 * Cleans both deviceTokens (old system) and fcmTokens (new system)
 * 
 * Usage: node cleanupAllTokensRoot.js
 */

const mongoose = require('mongoose');
const dotenv = require('dotenv');

// Load environment variables
dotenv.config();

// Import User model
const User = require('./models/userModel');

async function cleanupAllTokens() {
  try {
    console.log('🧹 [TOKEN CLEANUP] Starting complete token cleanup...');
    console.log('⏰ [TOKEN CLEANUP] Timestamp:', new Date().toISOString());

    // Connect to database
    await mongoose.connect(process.env.MONGO_URI, {
      useNewUrlParser: true,
      useUnifiedTopology: true,
    });
    console.log('✅ [TOKEN CLEANUP] Connected to database');

    // Get statistics before cleanup
    const beforeStats = await User.aggregate([
      {
        $project: {
          userId: 1,
          name: 1,
          deviceTokenCount: { $size: { $ifNull: ['$deviceTokens', []] } },
          fcmTokenCount: { $size: { $ifNull: ['$fcmTokens', []] } }
        }
      },
      {
        $group: {
          _id: null,
          totalUsers: { $sum: 1 },
          totalDeviceTokens: { $sum: '$deviceTokenCount' },
          totalFcmTokens: { $sum: '$fcmTokenCount' },
          usersWithDeviceTokens: { $sum: { $cond: [{ $gt: ['$deviceTokenCount', 0] }, 1, 0] } },
          usersWithFcmTokens: { $sum: { $cond: [{ $gt: ['$fcmTokenCount', 0] }, 1, 0] } }
        }
      }
    ]);

    console.log('\n📊 [TOKEN CLEANUP] Before cleanup:');
    console.log(beforeStats[0] || 'No data');

    // Clean ALL tokens from ALL users
    console.log('\n🧹 [TOKEN CLEANUP] Clearing all tokens...');
    
    const result = await User.updateMany(
      {},
      { 
        $set: { 
          deviceTokens: [],
          fcmTokens: []
        }
      }
    );

    console.log(`✅ [TOKEN CLEANUP] Updated ${result.modifiedCount} users`);

    // Get statistics after cleanup
    const afterStats = await User.aggregate([
      {
        $project: {
          userId: 1,
          name: 1,
          deviceTokenCount: { $size: { $ifNull: ['$deviceTokens', []] } },
          fcmTokenCount: { $size: { $ifNull: ['$fcmTokens', []] } }
        }
      },
      {
        $group: {
          _id: null,
          totalUsers: { $sum: 1 },
          totalDeviceTokens: { $sum: '$deviceTokenCount' },
          totalFcmTokens: { $sum: '$fcmTokenCount' }
        }
      }
    ]);

    console.log('\n📊 [TOKEN CLEANUP] After cleanup:');
    console.log(afterStats[0] || 'No data');

    console.log('\n✅ [TOKEN CLEANUP] Cleanup completed successfully!');
    console.log('📱 [TOKEN CLEANUP] All users will re-register tokens when they next open the app');

    // Close database connection
    await mongoose.connection.close();
    console.log('✅ [TOKEN CLEANUP] Database connection closed');
    
    process.exit(0);

  } catch (error) {
    console.error('❌ [TOKEN CLEANUP] Error during cleanup:', error);
    process.exit(1);
  }
}

// Run cleanup
cleanupAllTokens();
