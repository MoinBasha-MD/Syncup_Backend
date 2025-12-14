/**
 * Script to fix double-hashed passwords for affected users
 * 
 * PROBLEM: When users changed their password via EditProfileModal or PasswordResetModal,
 * the password was being double-hashed, making it impossible to login.
 * 
 * SOLUTION: This script resets the password to a known value that the user can use to login,
 * then they should change it again (which will now work correctly after the fix).
 * 
 * USAGE:
 * node scripts/fixDoubleHashedPassword.js <identifier> <newPassword>
 * 
 * Example:
 * node scripts/fixDoubleHashedPassword.js user@example.com TempPass123
 * node scripts/fixDoubleHashedPassword.js 9876543210 TempPass123
 * node scripts/fixDoubleHashedPassword.js abc-123-def TempPass123
 */

const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');
require('dotenv').config();

// Import User model
const User = require('../models/userModel');

async function fixUserPassword(identifier, newPassword) {
  try {
    console.log('🔧 [PASSWORD FIX] Starting password reset process...');
    console.log('🔍 [PASSWORD FIX] Searching for user:', identifier);
    
    // Connect to MongoDB
    await mongoose.connect(process.env.MONGO_URI, {
      useNewUrlParser: true,
      useUnifiedTopology: true,
    });
    console.log('✅ [PASSWORD FIX] Connected to MongoDB');

    // Find user by email, phone, or userId
    let user;
    if (identifier.includes('@')) {
      user = await User.findOne({ email: identifier }).select('+password');
      console.log('🔍 [PASSWORD FIX] Searched by email');
    } else if (/^\d+$/.test(identifier)) {
      user = await User.findOne({ phoneNumber: identifier }).select('+password');
      console.log('🔍 [PASSWORD FIX] Searched by phone number');
    } else {
      user = await User.findOne({ userId: identifier }).select('+password');
      console.log('🔍 [PASSWORD FIX] Searched by userId');
    }

    if (!user) {
      console.error('❌ [PASSWORD FIX] User not found');
      process.exit(1);
    }

    console.log('✅ [PASSWORD FIX] User found:', {
      name: user.name,
      email: user.email,
      phone: user.phoneNumber,
      userId: user.userId
    });

    // Validate new password
    if (newPassword.length < 6) {
      console.error('❌ [PASSWORD FIX] Password must be at least 6 characters long');
      process.exit(1);
    }

    console.log('🔐 [PASSWORD FIX] Old password hash:', user.password.substring(0, 20) + '...');

    // Manually hash the password to bypass the pre-save hook
    // This ensures we only hash once
    const salt = await bcrypt.genSalt(10);
    const hashedPassword = await bcrypt.hash(newPassword, salt);
    
    console.log('🔐 [PASSWORD FIX] New password hash:', hashedPassword.substring(0, 20) + '...');

    // Update password directly in database to bypass pre-save hook
    await User.updateOne(
      { _id: user._id },
      { $set: { password: hashedPassword } }
    );

    console.log('✅ [PASSWORD FIX] Password updated successfully!');
    console.log('');
    console.log('📋 [PASSWORD FIX] User can now login with:');
    console.log('   Phone/Email:', identifier);
    console.log('   Password: [the password you just set]');
    console.log('');
    console.log('⚠️  [PASSWORD FIX] IMPORTANT: Ask the user to change their password after logging in.');
    console.log('   The password change feature is now fixed and will work correctly.');

    // Verify the password works
    const testUser = await User.findById(user._id).select('+password');
    const isMatch = await bcrypt.compare(newPassword, testUser.password);
    
    if (isMatch) {
      console.log('✅ [PASSWORD FIX] Verification successful - password can be used to login');
    } else {
      console.error('❌ [PASSWORD FIX] Verification failed - something went wrong');
      process.exit(1);
    }

  } catch (error) {
    console.error('❌ [PASSWORD FIX] Error:', error.message);
    console.error(error.stack);
    process.exit(1);
  } finally {
    await mongoose.connection.close();
    console.log('🔌 [PASSWORD FIX] Database connection closed');
    process.exit(0);
  }
}

// Get command line arguments
const args = process.argv.slice(2);

if (args.length !== 2) {
  console.error('❌ Usage: node scripts/fixDoubleHashedPassword.js <identifier> <newPassword>');
  console.error('');
  console.error('Examples:');
  console.error('  node scripts/fixDoubleHashedPassword.js user@example.com TempPass123');
  console.error('  node scripts/fixDoubleHashedPassword.js 9876543210 TempPass123');
  console.error('  node scripts/fixDoubleHashedPassword.js abc-123-def TempPass123');
  process.exit(1);
}

const [identifier, newPassword] = args;
fixUserPassword(identifier, newPassword);
