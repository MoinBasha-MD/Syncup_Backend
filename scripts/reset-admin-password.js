const mongoose = require('mongoose');
const readline = require('readline');
const Admin = require('../models/adminModel');
require('dotenv').config();

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout
});

function question(query) {
  return new Promise(resolve => rl.question(query, resolve));
}

async function resetAdminPassword() {
  try {
    // Connect to MongoDB
    await mongoose.connect(process.env.MONGO_URI);
    console.log('✅ Connected to MongoDB\n');
    
    // Get all admins
    const admins = await Admin.find();
    
    console.log('📋 Available Admin Users:');
    admins.forEach((admin, index) => {
      console.log(`${index + 1}. ${admin.username} (${admin.email}) - ${admin.role}`);
    });
    
    console.log('');
    const choice = await question('Select admin number to reset password: ');
    const selectedIndex = parseInt(choice) - 1;
    
    if (selectedIndex < 0 || selectedIndex >= admins.length) {
      console.log('❌ Invalid selection');
      process.exit(1);
    }
    
    const selectedAdmin = admins[selectedIndex];
    console.log(`\n✅ Selected: ${selectedAdmin.username} (${selectedAdmin.email})`);
    
    const newPassword = await question('\nEnter new password: ');
    
    if (!newPassword || newPassword.length < 6) {
      console.log('❌ Password must be at least 6 characters');
      process.exit(1);
    }
    
    // Update password (it will be hashed automatically by the pre-save hook)
    selectedAdmin.password = newPassword;
    await selectedAdmin.save();
    
    console.log('\n✅ Password reset successfully!');
    console.log('\n📝 Login Details:');
    console.log('   Email:', selectedAdmin.email);
    console.log('   Password:', newPassword);
    console.log('   URL: http://localhost:5000/admin/login');
    
    rl.close();
    process.exit(0);
  } catch (error) {
    console.error('❌ Error:', error);
    rl.close();
    process.exit(1);
  }
}

resetAdminPassword();
