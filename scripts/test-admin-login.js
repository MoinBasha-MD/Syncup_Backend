const mongoose = require('mongoose');
const Admin = require('../models/adminModel');
require('dotenv').config();

async function testAdminLogin() {
  try {
    // Connect to MongoDB
    await mongoose.connect(process.env.MONGO_URI);
    console.log('✅ Connected to MongoDB');
    
    // Get all admins
    const admins = await Admin.find().select('+password');
    console.log('\n📋 All Admin Users:');
    console.log('Total admins:', admins.length);
    
    admins.forEach((admin, index) => {
      console.log(`\n${index + 1}. Admin:`);
      console.log('   Username:', admin.username);
      console.log('   Email:', admin.email);
      console.log('   Role:', admin.role);
      console.log('   Active:', admin.isActive);
      console.log('   Has Password:', !!admin.password);
      console.log('   Password Hash:', admin.password ? admin.password.substring(0, 20) + '...' : 'None');
    });
    
    // Test password comparison
    if (admins.length > 0) {
      const testAdmin = admins[0];
      console.log('\n🔐 Testing password comparison for:', testAdmin.email);
      
      // Try common test passwords
      const testPasswords = ['admin123456', 'Syncup@786', 'password', '123456'];
      
      for (const pwd of testPasswords) {
        const isMatch = await testAdmin.comparePassword(pwd);
        console.log(`   Password "${pwd}":`, isMatch ? '✅ MATCH' : '❌ No match');
      }
    }
    
    process.exit(0);
  } catch (error) {
    console.error('❌ Error:', error);
    process.exit(1);
  }
}

testAdminLogin();
