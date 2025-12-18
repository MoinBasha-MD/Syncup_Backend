const mongoose = require('mongoose');
const dotenv = require('dotenv');
const path = require('path');

// Determine if running from scripts folder or root
const isInScriptsFolder = __dirname.endsWith('scripts');
const rootPath = isInScriptsFolder ? path.join(__dirname, '..') : __dirname;

// Load environment variables from the correct location
dotenv.config({ path: path.join(rootPath, '.env') });

// Hardcoded encryption key as fallback (TEMPORARY - for migration only)
if (!process.env.USER_ENCRYPTION_KEY) {
  console.log('⚠️  Using hardcoded encryption key for migration...');
  process.env.USER_ENCRYPTION_KEY = '1d33d1e3b2a8c30f61f0a24291e4e91710406b280ad06065fbbbbb67c86b4c88';
}

const User = require(path.join(rootPath, 'models', 'userModel'));
const { encryptUserData, isUserDataEncrypted } = require(path.join(rootPath, 'utils', 'userEncryption'));

/**
 * Migration Script: Encrypt Existing User Data
 * 
 * This script will:
 * 1. Connect to MongoDB
 * 2. Find all users with unencrypted data
 * 3. Encrypt their email, phone, and password
 * 4. Update the database
 * 5. Provide detailed logs
 */

async function migrateUserEncryption() {
  try {
    console.log('🔐 Starting User Data Encryption Migration...\n');
    
    // Connect to MongoDB
    console.log('📡 Connecting to MongoDB...');
    await mongoose.connect(process.env.MONGO_URI);
    console.log('✅ Connected to MongoDB\n');
    
    // Get all users
    console.log('📊 Fetching all users...');
    const users = await User.find({}).select('+password');
    console.log(`✅ Found ${users.length} users\n`);
    
    let encryptedCount = 0;
    let alreadyEncryptedCount = 0;
    let errorCount = 0;
    const errors = [];
    
    console.log('🔄 Processing users...\n');
    
    for (let i = 0; i < users.length; i++) {
      const user = users[i];
      
      try {
        // Check if user data is already encrypted
        if (isUserDataEncrypted(user)) {
          console.log(`⏭️  User ${i + 1}/${users.length}: ${user.name} - Already encrypted`);
          alreadyEncryptedCount++;
          continue;
        }
        
        console.log(`🔐 User ${i + 1}/${users.length}: Encrypting ${user.name}...`);
        
        // Store original values
        const originalEmail = user.email;
        const originalPhone = user.phoneNumber;
        const originalPassword = user.password;
        
        // Encrypt sensitive fields
        const encryptedData = encryptUserData({
          email: originalEmail,
          phoneNumber: originalPhone,
          password: originalPassword
        });
        
        // Update user with encrypted data
        user.encryptedEmail = encryptedData.encryptedEmail;
        user.encryptedPhone = encryptedData.encryptedPhone;
        user.encryptedPassword = encryptedData.encryptedPassword;
        
        // Clear plain text fields (but keep for schema compatibility)
        // We'll update the schema to make these optional later
        user.email = `encrypted_${user.userId}@encrypted.local`;
        user.phoneNumber = `encrypted_${user.userId}`;
        
        // Save user
        await user.save({ validateBeforeSave: false });
        
        console.log(`   ✅ Encrypted: ${user.name}`);
        console.log(`   📧 Email: ${originalEmail} → [ENCRYPTED]`);
        console.log(`   📱 Phone: ${originalPhone} → [ENCRYPTED]`);
        console.log(`   🔑 Password: [ENCRYPTED]\n`);
        
        encryptedCount++;
        
      } catch (error) {
        console.error(`   ❌ Error encrypting user ${user.name}:`, error.message);
        errors.push({
          user: user.name,
          userId: user.userId,
          error: error.message
        });
        errorCount++;
      }
    }
    
    // Summary
    console.log('\n' + '='.repeat(60));
    console.log('📊 MIGRATION SUMMARY');
    console.log('='.repeat(60));
    console.log(`✅ Successfully encrypted: ${encryptedCount} users`);
    console.log(`⏭️  Already encrypted: ${alreadyEncryptedCount} users`);
    console.log(`❌ Errors: ${errorCount} users`);
    console.log(`📊 Total processed: ${users.length} users`);
    console.log('='.repeat(60) + '\n');
    
    if (errors.length > 0) {
      console.log('❌ ERRORS:\n');
      errors.forEach((err, idx) => {
        console.log(`${idx + 1}. User: ${err.user} (${err.userId})`);
        console.log(`   Error: ${err.error}\n`);
      });
    }
    
    console.log('✅ Migration completed successfully!\n');
    
    // Disconnect
    await mongoose.disconnect();
    console.log('📡 Disconnected from MongoDB');
    
    process.exit(0);
    
  } catch (error) {
    console.error('❌ Migration failed:', error);
    process.exit(1);
  }
}

// Run migration
if (require.main === module) {
  console.log('\n' + '='.repeat(60));
  console.log('🔐 USER DATA ENCRYPTION MIGRATION');
  console.log('='.repeat(60) + '\n');
  
  console.log('⚠️  WARNING: This will encrypt all user data!');
  console.log('⚠️  Make sure you have backed up your database!\n');
  
  // Check if encryption key is set
  if (!process.env.USER_ENCRYPTION_KEY) {
    console.error('❌ ERROR: USER_ENCRYPTION_KEY not set in .env file!');
    console.error('Generate a key with: node -e "console.log(crypto.randomBytes(32).toString(\'hex\'))"');
    console.error('Add it to your .env file as: USER_ENCRYPTION_KEY=your_generated_key\n');
    process.exit(1);
  }
  
  console.log('Starting migration in 3 seconds...\n');
  
  setTimeout(() => {
    migrateUserEncryption();
  }, 3000);
}

module.exports = migrateUserEncryption;
