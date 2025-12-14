/**
 * Quick Password Fix Script - Run from backend root directory
 * Usage: node quickPasswordFix.js <phone|email|userId> <newPassword>
 */

const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');
require('dotenv').config();

// Define User schema inline to avoid import issues
const userSchema = new mongoose.Schema({
  userId: String,
  name: String,
  phoneNumber: String,
  email: String,
  password: { type: String, select: false }
});

const User = mongoose.model('User', userSchema);

async function fixPassword(identifier, newPassword) {
  try {
    console.log('🔧 Starting password reset...');
    console.log('🔍 Searching for user:', identifier);
    
    await mongoose.connect(process.env.MONGO_URI);
    console.log('✅ Connected to MongoDB');

    let user;
    if (identifier.includes('@')) {
      user = await User.findOne({ email: identifier }).select('+password');
    } else if (/^\d+$/.test(identifier)) {
      user = await User.findOne({ phoneNumber: identifier }).select('+password');
    } else {
      user = await User.findOne({ userId: identifier }).select('+password');
    }

    if (!user) {
      console.error('❌ User not found');
      process.exit(1);
    }

    console.log('✅ User found:', user.name, '-', user.phoneNumber);

    if (newPassword.length < 6) {
      console.error('❌ Password must be at least 6 characters');
      process.exit(1);
    }

    // Hash password once
    const salt = await bcrypt.genSalt(10);
    const hashedPassword = await bcrypt.hash(newPassword, salt);
    
    // Update directly to bypass pre-save hook
    await User.updateOne(
      { _id: user._id },
      { $set: { password: hashedPassword } }
    );

    console.log('✅ Password updated successfully!');
    
    // Verify
    const testUser = await User.findById(user._id).select('+password');
    const isMatch = await bcrypt.compare(newPassword, testUser.password);
    
    if (isMatch) {
      console.log('✅ Verification successful - password works!');
      console.log('');
      console.log('📋 User can now login with:');
      console.log('   Phone:', user.phoneNumber);
      console.log('   Password: [the password you just set]');
    } else {
      console.error('❌ Verification failed');
      process.exit(1);
    }

  } catch (error) {
    console.error('❌ Error:', error.message);
    process.exit(1);
  } finally {
    await mongoose.connection.close();
    process.exit(0);
  }
}

const args = process.argv.slice(2);
if (args.length !== 2) {
  console.error('Usage: node quickPasswordFix.js <phone|email|userId> <newPassword>');
  process.exit(1);
}

fixPassword(args[0], args[1]);
