require('dotenv').config();

const mongoose = require('mongoose');
const Ripple = require('./models/Ripple');
const GroupChat = require('./models/groupChatModel');
const GroupMember = require('./models/groupMemberModel');
const GroupMessage = require('./models/groupMessageModel');

const run = async () => {
  if (process.argv.includes('--apply')) {
    throw new Error('Deletion is disabled: group messages may contain conversations that are not in the Ripple thread.');
  }
  if (!process.env.MONGO_URI) throw new Error('MONGO_URI is required');
  await mongoose.connect(process.env.MONGO_URI);

  const ripples = await Ripple.find({ groupChatId: { $ne: null } })
    .select('_id title lifecycle groupChatId')
    .lean();
  const groupIds = [...new Set(ripples.map((r) => String(r.groupChatId)))].map(
    (id) => new mongoose.Types.ObjectId(id),
  );

  const counts = {
    ripples: ripples.length,
    groups: await GroupChat.countDocuments({ _id: { $in: groupIds } }),
    members: await GroupMember.countDocuments({ groupId: { $in: groupIds } }),
    messages: await GroupMessage.countDocuments({ groupId: { $in: groupIds } }),
    memories: ripples.filter((r) => r.lifecycle === 'memory').length,
  };
  console.log('Ripple-linked groups found:', counts);

  console.log('Read-only report. No Ripple, group, member, or message data was changed.');
};

run()
  .catch((error) => {
    console.error('Ripple group cleanup failed:', error.message);
    process.exitCode = 1;
  })
  .finally(() => mongoose.disconnect());
