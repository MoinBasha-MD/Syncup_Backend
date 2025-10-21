const mongoose = require('mongoose');
const dotenv = require('dotenv');
const readline = require('readline');
const Admin = require('../models/adminModel');

// Load environment variables
dotenv.config();

// Create readline interface
const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout
});

// Promisify readline question
const question = (query) => new Promise((resolve) => rl.question(query, resolve));

// Connect to MongoDB
const connectDB = async () => {
  try {
    await mongoose.connect(process.env.MONGO_URI);
    console.log('✅ MongoDB Connected');
  } catch (error) {
    console.error('❌ MongoDB Connection Error:', error.message);
    process.exit(1);
  }
};

// Create admin user
const createAdmin = async () => {
  try {
    console.log('\n🔐 Create Sync-Up Admin User\n');
    console.log('This script will create a new admin user for the Sync-Up backend.\n');

    // Get admin details
    const username = await question('Enter username: ');
    const email = await question('Enter email: ');
    const password = await question('Enter password (min 6 characters): ');
    
    console.log('\nSelect role:');
    console.log('1. Super Admin (Full access)');
    console.log('2. Admin (Most access)');
    console.log('3. Moderator (Content management)');
    console.log('4. Viewer (Read-only)');
    
    const roleChoice = await question('\nEnter role number (1-4): ');
    
    const roles = {
      '1': 'super-admin',
      '2': 'admin',
      '3': 'moderator',
      '4': 'viewer'
    };
    
    const role = roles[roleChoice] || 'admin';

    // Validate input
    if (!username || username.length < 3) {
      throw new Error('Username must be at least 3 characters');
    }
    
    if (!email || !email.match(/^\w+([\.-]?\w+)*@\w+([\.-]?\w+)*(\.\w{2,3})+$/)) {
      throw new Error('Please provide a valid email');
    }
    
    if (!password || password.length < 6) {
      throw new Error('Password must be at least 6 characters');
    }

    // Check if admin already exists
    const existingAdmin = await Admin.findOne({ $or: [{ email }, { username }] });
    
    if (existingAdmin) {
      throw new Error('Admin with this email or username already exists');
    }

    // Create admin
    const admin = await Admin.create({
      username,
      email,
      password,
      role,
      isActive: true
    });

    console.log('\n✅ Admin user created successfully!');
    console.log('\n📋 Admin Details:');
    console.log(`   Username: ${admin.username}`);
    console.log(`   Email: ${admin.email}`);
    console.log(`   Role: ${admin.role}`);
    console.log(`   ID: ${admin._id}`);
    console.log('\n🌐 You can now login at: http://localhost:5000/admin');
    console.log('\n');

  } catch (error) {
    console.error('\n❌ Error creating admin:', error.message);
  } finally {
    rl.close();
    await mongoose.connection.close();
    console.log('✅ Database connection closed');
    process.exit(0);
  }
};

// Main function
const main = async () => {
  await connectDB();
  await createAdmin();
};

// Run the script
main();
