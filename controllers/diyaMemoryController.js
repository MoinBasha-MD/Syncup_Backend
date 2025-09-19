const DiyaMemory = require('../models/diyaMemoryModel');

// Helper to ensure memory doc exists
async function ensureConversation(userId, conversationId) {
  let doc = await DiyaMemory.findOne({ userId, conversationId });
  if (!doc) {
    doc = await DiyaMemory.create({ userId, conversationId, entries: [], summary: '' });
  }
  return doc;
}

// Summarize entries naively (placeholder for future NLP)
function summarizeEntries(entries, maxLen = 500) {
  const text = entries
    .slice(-25)
    .map(e => `${e.role}: ${e.content}`)
    .join(' \n ');
  if (text.length <= maxLen) return text;
  return text.slice(0, maxLen - 3) + '...';
}

exports.addEntry = async (req, res) => {
  try {
    const userId = req.user.userId;
    const { conversationId, entry } = req.body;
    if (!conversationId || !entry || !entry.role || !entry.content) {
      return res.status(400).json({ success: false, message: 'conversationId and entry {role, content} are required' });
    }
    const doc = await ensureConversation(userId, conversationId);
    doc.entries.push({
      role: entry.role,
      content: entry.content,
      entities: entry.entities || {},
      intent: entry.intent || '',
      tone: entry.tone || {},
      timestamp: entry.timestamp ? new Date(entry.timestamp) : new Date(),
    });
    await doc.save();
    return res.status(201).json({ success: true, data: { id: doc._id, count: doc.entries.length } });
  } catch (error) {
    return res.status(500).json({ success: false, message: 'Failed to add memory entry', error: error.message });
  }
};

exports.getConversation = async (req, res) => {
  try {
    const userId = req.user.userId;
    const { conversationId } = req.params;
    const doc = await DiyaMemory.findOne({ userId, conversationId });
    if (!doc) return res.status(404).json({ success: false, message: 'Conversation not found' });
    return res.json({ success: true, data: doc });
  } catch (error) {
    return res.status(500).json({ success: false, message: 'Failed to fetch conversation', error: error.message });
  }
};

exports.summarizeConversation = async (req, res) => {
  try {
    const userId = req.user.userId;
    const { conversationId } = req.params;
    const doc = await ensureConversation(userId, conversationId);
    doc.summary = summarizeEntries(doc.entries);
    await doc.save();
    return res.json({ success: true, data: { summary: doc.summary } });
  } catch (error) {
    return res.status(500).json({ success: false, message: 'Failed to summarize conversation', error: error.message });
  }
};

exports.clearConversation = async (req, res) => {
  try {
    const userId = req.user.userId;
    const { conversationId } = req.params;
    const doc = await DiyaMemory.findOne({ userId, conversationId });
    if (!doc) return res.status(404).json({ success: false, message: 'Conversation not found' });
    doc.entries = [];
    doc.summary = '';
    await doc.save();
    return res.json({ success: true, message: 'Conversation cleared' });
  } catch (error) {
    return res.status(500).json({ success: false, message: 'Failed to clear conversation', error: error.message });
  }
};
