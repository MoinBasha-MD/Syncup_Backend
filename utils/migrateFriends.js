/**
 * Migration Script: Migrate existing contacts and appConnections to Friend model
 * 
 * This script safely migrates existing user relationships to the new Friend system
 * WITHOUT breaking existing functionality
 * 
 * Usage:
 * node utils/migrateFriends.js
 * 
 * Options:
 * --dry-run : Preview changes without applying them
 * --user=userId : Migrate specific user only
 */

const mongoose = require('mongoose');
const dotenv = require('dotenv');
const Friend = require('../models/Friend');
const User = require('../models/userModel');

// Load environment variables
dotenv.config();

// Parse command line arguments
const args = process.argv.slice(2);
const isDryRun = args.includes('--dry-run');
const specificUser = args.find(arg => arg.startsWith('--user='))?.split('=')[1];

// Migration statistics
const stats = {
  usersProcessed: 0,
  deviceContactsCreated: 0,
  appConnectionsCreated: 0,
  duplicatesSkipped: 0,
  errors: 0,
  startTime: Date.now()
};

/**
 * Connect to database
 */
async function connectDB() {
  try {
    const mongoUri = process.env.MONGO_URI;
    
    if (!mongoUri) {
      console.error('❌ MONGO_URI not found in environment variables');
      console.error('   Make sure .env file exists and contains MONGO_URI');
      process.exit(1);
    }
    
    console.log('🔌 Connecting to MongoDB...');
    console.log('   URI:', mongoUri.replace(/\/\/[^:]+:[^@]+@/, '//***:***@')); // Hide credentials
    
    await mongoose.connect(mongoUri);
    console.log('✅ MongoDB Connected');
    console.log('   Database:', mongoose.connection.db.databaseName);
  } catch (error) {
    console.error('❌ MongoDB Connection Error:', error);
    process.exit(1);
  }
}

/**
 * Migrate device contacts for a user
 */
async function migrateDeviceContacts(user) {
  let created = 0;
  let skipped = 0;
  
  if (!user.contacts || user.contacts.length === 0) {
    return { created, skipped };
  }
  
  console.log(`  📱 Migrating ${user.contacts.length} device contacts...`);
  
  for (const contactObjectId of user.contacts) {
    try {
      // Get contact user details
      const contactUser = await User.findById(contactObjectId).select('userId name phoneNumber profileImage username');
      
      if (!contactUser) {
        console.log(`    ⚠️ Contact not found: ${contactObjectId}`);
        skipped++;
        continue;
      }
      
      // Check if friendship already exists
      const existingFriendship = await Friend.findOne({
        userId: user.userId,
        friendUserId: contactUser.userId
      });
      
      if (existingFriendship) {
        console.log(`    ⏭️ Friendship already exists with ${contactUser.name}`);
        skipped++;
        continue;
      }
      
      if (isDryRun) {
        console.log(`    [DRY RUN] Would create friendship with ${contactUser.name} (${contactUser.phoneNumber})`);
        created++;
        continue;
      }
      
      // Create friendship
      const friendship = new Friend({
        userId: user.userId,
        friendUserId: contactUser.userId,
        source: 'device_contact',
        status: 'accepted',
        acceptedAt: user.contactsLastSynced || new Date(),
        isDeviceContact: true,
        phoneNumber: contactUser.phoneNumber,
        lastDeviceSync: user.contactsLastSynced || new Date(),
        cachedData: {
          name: contactUser.name,
          profileImage: contactUser.profileImage || '',
          username: contactUser.username || '',
          lastCacheUpdate: new Date()
        }
      });
      
      await friendship.save();
      
      // Create reciprocal friendship
      const reciprocalExists = await Friend.findOne({
        userId: contactUser.userId,
        friendUserId: user.userId
      });
      
      if (!reciprocalExists) {
        const reciprocal = new Friend({
          userId: contactUser.userId,
          friendUserId: user.userId,
          source: 'device_contact',
          status: 'accepted',
          acceptedAt: user.contactsLastSynced || new Date(),
          isDeviceContact: true,
          phoneNumber: user.phoneNumber,
          lastDeviceSync: user.contactsLastSynced || new Date(),
          cachedData: {
            name: user.name,
            profileImage: user.profileImage || '',
            username: user.username || '',
            lastCacheUpdate: new Date()
          }
        });
        
        await reciprocal.save();
      }
      
      console.log(`    ✅ Created friendship with ${contactUser.name}`);
      created++;
      
    } catch (error) {
      console.error(`    ❌ Error migrating contact ${contactObjectId}:`, error.message);
      stats.errors++;
    }
  }
  
  return { created, skipped };
}

/**
 * Migrate app connections for a user
 */
async function migrateAppConnections(user) {
  let created = 0;
  let skipped = 0;
  
  if (!user.appConnections || user.appConnections.length === 0) {
    return { created, skipped };
  }
  
  console.log(`  🌐 Migrating ${user.appConnections.length} app connections...`);
  
  for (const connection of user.appConnections) {
    try {
      // Get connection user details
      const connectionUser = await User.findOne({ userId: connection.userId })
        .select('userId name phoneNumber profileImage username');
      
      if (!connectionUser) {
        console.log(`    ⚠️ Connection user not found: ${connection.userId}`);
        skipped++;
        continue;
      }
      
      // Check if friendship already exists
      const existingFriendship = await Friend.findOne({
        userId: user.userId,
        friendUserId: connection.userId
      });
      
      if (existingFriendship) {
        console.log(`    ⏭️ Friendship already exists with ${connection.name}`);
        skipped++;
        continue;
      }
      
      if (isDryRun) {
        console.log(`    [DRY RUN] Would create app connection with ${connection.name}`);
        created++;
        continue;
      }
      
      // Create friendship
      const friendship = new Friend({
        userId: user.userId,
        friendUserId: connection.userId,
        source: 'app_search',
        status: connection.status === 'pending' ? 'pending' : 'accepted',
        acceptedAt: connection.status === 'accepted' ? (connection.connectionDate || new Date()) : null,
        isDeviceContact: false,
        cachedData: {
          name: connection.name || connectionUser.name,
          profileImage: connection.profileImage || connectionUser.profileImage || '',
          username: connection.username || connectionUser.username || '',
          lastCacheUpdate: new Date()
        }
      });
      
      await friendship.save();
      
      // Create reciprocal friendship if accepted
      if (connection.status === 'accepted') {
        const reciprocalExists = await Friend.findOne({
          userId: connection.userId,
          friendUserId: user.userId
        });
        
        if (!reciprocalExists) {
          const reciprocal = new Friend({
            userId: connection.userId,
            friendUserId: user.userId,
            source: 'app_search',
            status: 'accepted',
            acceptedAt: connection.connectionDate || new Date(),
            isDeviceContact: false,
            cachedData: {
              name: user.name,
              profileImage: user.profileImage || '',
              username: user.username || '',
              lastCacheUpdate: new Date()
            }
          });
          
          await reciprocal.save();
        }
      }
      
      console.log(`    ✅ Created app connection with ${connection.name}`);
      created++;
      
    } catch (error) {
      console.error(`    ❌ Error migrating app connection ${connection.userId}:`, error.message);
      stats.errors++;
    }
  }
  
  return { created, skipped };
}

/**
 * Migrate a single user
 */
async function migrateUser(user) {
  console.log(`\n👤 Migrating user: ${user.name} (${user.userId})`);
  
  try {
    // Migrate device contacts
    const deviceResults = await migrateDeviceContacts(user);
    stats.deviceContactsCreated += deviceResults.created;
    stats.duplicatesSkipped += deviceResults.skipped;
    
    // Migrate app connections
    const appResults = await migrateAppConnections(user);
    stats.appConnectionsCreated += appResults.created;
    stats.duplicatesSkipped += appResults.skipped;
    
    stats.usersProcessed++;
    
    console.log(`  ✅ User migration complete`);
    console.log(`     Device contacts: ${deviceResults.created} created, ${deviceResults.skipped} skipped`);
    console.log(`     App connections: ${appResults.created} created, ${appResults.skipped} skipped`);
    
  } catch (error) {
    console.error(`  ❌ Error migrating user ${user.userId}:`, error.message);
    stats.errors++;
  }
}

/**
 * Main migration function
 */
async function migrate() {
  console.log('\n🚀 Starting Friend Migration');
  console.log('================================');
  
  if (isDryRun) {
    console.log('⚠️ DRY RUN MODE - No changes will be made\n');
  }
  
  try {
    await connectDB();
    
    // Get users to migrate
    let users;
    if (specificUser) {
      console.log(`📌 Migrating specific user: ${specificUser}\n`);
      users = await User.find({ userId: specificUser });
      if (users.length === 0) {
        console.log('❌ User not found');
        
        // Debug: Check if any users exist
        const totalUsers = await User.countDocuments({});
        console.log(`   Total users in database: ${totalUsers}`);
        
        if (totalUsers > 0) {
          const sampleUser = await User.findOne({}).select('userId name');
          console.log(`   Sample user: ${sampleUser.name} (${sampleUser.userId})`);
        }
        
        process.exit(1);
      }
    } else {
      console.log('📌 Migrating all users\n');
      
      // First check if any users exist
      const totalUsers = await User.countDocuments({});
      console.log(`   Total users in database: ${totalUsers}`);
      
      if (totalUsers === 0) {
        console.log('\n⚠️  No users found in database!');
        console.log('   This could mean:');
        console.log('   1. Wrong database connection');
        console.log('   2. Users collection is empty');
        console.log('   3. Users are in a different collection name');
        console.log('\n   Checking collections...');
        
        const collections = await mongoose.connection.db.listCollections().toArray();
        console.log('   Available collections:', collections.map(c => c.name).join(', '));
        
        // Check if 'users' collection exists and has data
        if (collections.some(c => c.name === 'users')) {
          console.log('\n   ✅ "users" collection exists');
          const usersCount = await mongoose.connection.db.collection('users').countDocuments();
          console.log(`   📊 Documents in "users" collection: ${usersCount}`);
          
          if (usersCount > 0) {
            const sampleDoc = await mongoose.connection.db.collection('users').findOne({});
            console.log('\n   📄 Sample document from "users" collection:');
            console.log('      _id:', sampleDoc._id);
            console.log('      userId:', sampleDoc.userId);
            console.log('      name:', sampleDoc.name);
            console.log('      phoneNumber:', sampleDoc.phoneNumber);
            console.log('      contacts:', sampleDoc.contacts?.length || 0, 'contacts');
            console.log('      appConnections:', sampleDoc.appConnections?.length || 0, 'app connections');
            
            console.log('\n   ❌ Issue: Mongoose User model is not finding documents in "users" collection');
            console.log('      This is likely a model configuration issue.');
            console.log('\n   💡 Trying direct collection query...');
            
            // Try to get users directly from collection
            const directUsers = await mongoose.connection.db.collection('users').find({}).toArray();
            console.log(`   ✅ Found ${directUsers.length} users via direct query`);
            
            if (directUsers.length > 0) {
              console.log('\n   🔧 The migration can proceed using direct collection access.');
              console.log('      Re-running migration with direct access...\n');
              
              // Set users to the direct query result
              users = directUsers;
              console.log(`Found ${users.length} users to migrate\n`);
              
              // Continue with migration
              for (const user of users) {
                await migrateUser(user);
              }
              
              // Print final statistics
              const duration = ((Date.now() - stats.startTime) / 1000).toFixed(2);
              
              console.log('\n================================');
              console.log('✅ Migration Complete!');
              console.log('================================');
              console.log(`Users processed: ${stats.usersProcessed}`);
              console.log(`Device contacts created: ${stats.deviceContactsCreated}`);
              console.log(`App connections created: ${stats.appConnectionsCreated}`);
              console.log(`Duplicates skipped: ${stats.duplicatesSkipped}`);
              console.log(`Errors: ${stats.errors}`);
              console.log(`Duration: ${duration}s`);
              console.log('================================\n');
              
              if (isDryRun) {
                console.log('⚠️ This was a DRY RUN - no changes were made');
                console.log('Run without --dry-run to apply changes\n');
              }
              
              await mongoose.connection.close();
              console.log('👋 Database connection closed');
              process.exit(0);
            }
          }
        }
        
        process.exit(0);
      }
      
      users = await User.find({});
    }
    
    console.log(`Found ${users.length} users to migrate\n`);
    
    // Migrate each user
    for (const user of users) {
      await migrateUser(user);
    }
    
    // Print final statistics
    const duration = ((Date.now() - stats.startTime) / 1000).toFixed(2);
    
    console.log('\n================================');
    console.log('✅ Migration Complete!');
    console.log('================================');
    console.log(`Users processed: ${stats.usersProcessed}`);
    console.log(`Device contacts created: ${stats.deviceContactsCreated}`);
    console.log(`App connections created: ${stats.appConnectionsCreated}`);
    console.log(`Duplicates skipped: ${stats.duplicatesSkipped}`);
    console.log(`Errors: ${stats.errors}`);
    console.log(`Duration: ${duration}s`);
    console.log('================================\n');
    
    if (isDryRun) {
      console.log('⚠️ This was a DRY RUN - no changes were made');
      console.log('Run without --dry-run to apply changes\n');
    } else {
      console.log('✅ All changes have been applied to the database\n');
      console.log('📝 Note: Old contacts and appConnections fields are still intact');
      console.log('   You can safely remove them after verifying the migration\n');
    }
    
  } catch (error) {
    console.error('\n❌ Migration failed:', error);
    process.exit(1);
  } finally {
    await mongoose.connection.close();
    console.log('👋 Database connection closed');
  }
}

// Run migration
migrate();
