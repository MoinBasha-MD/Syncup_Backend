const mongoose = require('mongoose');

async function fixDuplicateIndex() {
  try {
    // Connect to MongoDB
    await mongoose.connect('mongodb://localhost:27017/syncup');
    console.log('Connected to MongoDB');

    const db = mongoose.connection.db;
    const collection = db.collection('connectionrequests');

    // List current indexes
    const indexes = await collection.indexes();
    console.log('Current indexes:', indexes.map(idx => idx.name));

    // Try to drop the problematic unique index
    try {
      await collection.dropIndex('fromUserId_1_toUserId_1');
      console.log('✅ Dropped unique index: fromUserId_1_toUserId_1');
    } catch (error) {
      console.log('Index drop result:', error.message);
    }

    // Clean up duplicate entries
    const pipeline = [
      {
        $group: {
          _id: { fromUserId: "$fromUserId", toUserId: "$toUserId" },
          docs: { $push: "$_id" },
          count: { $sum: 1 }
        }
      },
      {
        $match: { count: { $gt: 1 } }
      }
    ];

    const duplicates = await collection.aggregate(pipeline).toArray();
    console.log(`Found ${duplicates.length} duplicate groups`);

    for (const duplicate of duplicates) {
      // Keep the first document, delete the rest
      const docsToDelete = duplicate.docs.slice(1);
      if (docsToDelete.length > 0) {
        await collection.deleteMany({ _id: { $in: docsToDelete } });
        console.log(`Deleted ${docsToDelete.length} duplicate documents`);
      }
    }

    console.log('✅ Database cleanup completed');
    process.exit(0);
  } catch (error) {
    console.error('Error:', error);
    process.exit(1);
  }
}

fixDuplicateIndex();
