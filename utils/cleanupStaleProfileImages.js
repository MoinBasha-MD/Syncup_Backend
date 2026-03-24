const mongoose = require('mongoose');
const fs = require('fs');
const path = require('path');
const User = require('../models/userModel');

/**
 * Script to clean up stale profile image references in database
 * Removes profileImage paths that point to non-existent files
 */
async function cleanupStaleProfileImages() {
  try {
    console.log('🧹 Starting profile image cleanup...');
    
    // Get all users with profile images
    const users = await User.find({ 
      profileImage: { $exists: true, $ne: '' } 
    }).select('userId name phoneNumber profileImage');
    
    console.log(`📊 Found ${users.length} users with profile images`);
    
    let validCount = 0;
    let invalidCount = 0;
    const invalidUsers = [];
    
    // Check each user's profile image
    for (const user of users) {
      const imagePath = user.profileImage;
      
      // Handle both absolute and relative paths
      let fullPath;
      if (imagePath.startsWith('/uploads/')) {
        fullPath = path.join(__dirname, '..', imagePath);
      } else if (imagePath.startsWith('uploads/')) {
        fullPath = path.join(__dirname, '..', imagePath);
      } else {
        fullPath = path.join(__dirname, '..', 'uploads', imagePath);
      }
      
      // Check if file exists
      const exists = fs.existsSync(fullPath);
      
      if (exists) {
        validCount++;
        console.log(`✅ Valid: ${user.name} - ${imagePath}`);
      } else {
        invalidCount++;
        invalidUsers.push({
          userId: user.userId,
          name: user.name,
          phoneNumber: user.phoneNumber,
          profileImage: imagePath
        });
        console.log(`❌ Invalid: ${user.name} - ${imagePath}`);
      }
    }
    
    console.log('\n📊 Summary:');
    console.log(`   Valid images: ${validCount}`);
    console.log(`   Invalid images: ${invalidCount}`);
    
    if (invalidCount > 0) {
      console.log('\n🗑️  Invalid profile images:');
      invalidUsers.forEach(u => {
        console.log(`   - ${u.name} (${u.phoneNumber}): ${u.profileImage}`);
      });
      
      // Ask for confirmation before cleanup
      console.log('\n⚠️  To remove these invalid references, run:');
      console.log('   node utils/cleanupStaleProfileImages.js --confirm');
      
      // If --confirm flag is passed, perform cleanup
      if (process.argv.includes('--confirm')) {
        console.log('\n🧹 Removing invalid profile image references...');
        
        for (const user of invalidUsers) {
          await User.updateOne(
            { userId: user.userId },
            { $set: { profileImage: '' } }
          );
          console.log(`   ✅ Cleared: ${user.name}`);
        }
        
        console.log(`\n✅ Cleanup complete! Removed ${invalidCount} invalid references.`);
      }
    } else {
      console.log('\n✅ All profile images are valid!');
    }
    
  } catch (error) {
    console.error('❌ Error during cleanup:', error);
  }
}

// Run if called directly
if (require.main === module) {
  const dotenv = require('dotenv');
  dotenv.config();
  
  mongoose.connect(process.env.MONGO_URI || 'mongodb://localhost:27017/syncup')
    .then(() => {
      console.log('📦 Connected to MongoDB');
      return cleanupStaleProfileImages();
    })
    .then(() => {
      console.log('\n✅ Script completed');
      process.exit(0);
    })
    .catch(error => {
      console.error('❌ Script failed:', error);
      process.exit(1);
    });
}

module.exports = { cleanupStaleProfileImages };
