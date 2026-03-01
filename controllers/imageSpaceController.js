const ImageSpace = require('../models/ImageSpace');
const { v4: uuidv4 } = require('uuid');

// Upload image to Your Space
exports.uploadImage = async (req, res) => {
  try {
    const { receiverId, imageUrl, caption, metadata } = req.body;
    const senderId = req.user.userId;

    if (!receiverId || !imageUrl) {
      return res.status(400).json({ 
        success: false, 
        message: 'Receiver ID and image URL are required' 
      });
    }

    // Generate chatId (sorted user IDs)
    const chatId = ImageSpace.generateChatId(senderId, receiverId);
    const [userId1, userId2] = [senderId, receiverId].sort();

    // Find or create ImageSpace document
    let imageSpace = await ImageSpace.findOne({ chatId });

    if (!imageSpace) {
      imageSpace = new ImageSpace({
        chatId,
        userId1,
        userId2,
        items: [],
        images: [],
      });
    }

    // Create item entry
    const itemEntry = {
      itemId: uuidv4(),
      type: 'image',
      imageUrl,
      uploadedBy: senderId,
      uploadedAt: new Date(),
      caption: caption || '',
      metadata: metadata || {},
    };

    // Add to items array
    if (!imageSpace.items) {
      imageSpace.items = [];
    }
    imageSpace.items.push(itemEntry);
    
    // Legacy support - also add to images array
    const imageEntry = {
      imageId: itemEntry.itemId,
      imageUrl,
      uploadedBy: senderId,
      uploadedAt: new Date(),
      caption: caption || '',
      metadata: metadata || {},
    };
    imageSpace.images.push(imageEntry);
    
    // Increment unread count for receiver
    if (!imageSpace.unreadCount) {
      imageSpace.unreadCount = new Map();
    }
    const currentUnread = imageSpace.unreadCount.get(receiverId) || 0;
    imageSpace.unreadCount.set(receiverId, currentUnread + 1);
    
    await imageSpace.save();

    console.log(`✅ [YOUR SPACE] Image uploaded to space: ${chatId}`);
    console.log(`📊 [YOUR SPACE] Unread count for ${receiverId}: ${currentUnread + 1}`);

    // Emit socket event to notify receiver
    const io = req.app.get('io');
    if (io) {
      io.to(receiverId).emit('yourSpace:new', {
        senderId,
        receiverId,
        chatId,
        item: itemEntry,
        totalCount: imageSpace.items.length,
        unreadCount: currentUnread + 1,
      });
      console.log(`📡 [YOUR SPACE] Socket event sent to receiver: ${receiverId}`);
    }

    res.status(200).json({
      success: true,
      message: 'Image uploaded to Your Space',
      imageSpace: {
        chatId: imageSpace.chatId,
        itemCount: imageSpace.items.length,
        latestItem: itemEntry,
      },
    });
  } catch (error) {
    console.error('❌ [YOUR SPACE] Upload error:', error);
    res.status(500).json({ 
      success: false, 
      message: 'Failed to upload image to Your Space',
      error: error.message 
    });
  }
};

// Save text message to Your Space
exports.saveText = async (req, res) => {
  try {
    const { receiverId, text, originalMessageId, originalTimestamp } = req.body;
    const senderId = req.user.userId;

    if (!receiverId || !text) {
      return res.status(400).json({ 
        success: false, 
        message: 'Receiver ID and text are required' 
      });
    }

    // Generate chatId (sorted user IDs)
    const chatId = ImageSpace.generateChatId(senderId, receiverId);
    const [userId1, userId2] = [senderId, receiverId].sort();

    // Find or create ImageSpace document
    let imageSpace = await ImageSpace.findOne({ chatId });

    if (!imageSpace) {
      imageSpace = new ImageSpace({
        chatId,
        userId1,
        userId2,
        items: [],
        images: [],
      });
    }

    // Create text item entry
    const itemEntry = {
      itemId: uuidv4(),
      type: 'text',
      text,
      uploadedBy: senderId,
      uploadedAt: new Date(),
      caption: '',
      metadata: {
        originalMessageId: originalMessageId || '',
        originalTimestamp: originalTimestamp || new Date(),
      },
    };

    // Add to items array
    if (!imageSpace.items) {
      imageSpace.items = [];
    }
    imageSpace.items.push(itemEntry);
    
    // Increment unread count for receiver
    if (!imageSpace.unreadCount) {
      imageSpace.unreadCount = new Map();
    }
    const currentUnread = imageSpace.unreadCount.get(receiverId) || 0;
    imageSpace.unreadCount.set(receiverId, currentUnread + 1);
    
    await imageSpace.save();

    console.log(`✅ [YOUR SPACE] Text message saved to space: ${chatId}`);
    console.log(`📊 [YOUR SPACE] Unread count for ${receiverId}: ${currentUnread + 1}`);

    // Emit socket event to notify receiver
    const io = req.app.get('io');
    if (io) {
      io.to(receiverId).emit('yourSpace:new', {
        senderId,
        receiverId,
        chatId,
        item: itemEntry,
        totalCount: imageSpace.items.length,
        unreadCount: currentUnread + 1,
      });
      console.log(`📡 [YOUR SPACE] Socket event sent to receiver: ${receiverId}`);
    }

    res.status(200).json({
      success: true,
      message: 'Text message saved to Your Space',
      imageSpace: {
        chatId: imageSpace.chatId,
        itemCount: imageSpace.items.length,
        latestItem: itemEntry,
      },
    });
  } catch (error) {
    console.error('❌ [YOUR SPACE] Save text error:', error);
    res.status(500).json({ 
      success: false, 
      message: 'Failed to save text to Your Space',
      error: error.message 
    });
  }
};

// Get all items (images and text) for a chat
exports.getImages = async (req, res) => {
  try {
    const { contactId } = req.params;
    const userId = req.user.userId;

    if (!contactId) {
      return res.status(400).json({ 
        success: false, 
        message: 'Contact ID is required' 
      });
    }

    // Generate chatId
    const chatId = ImageSpace.generateChatId(userId, contactId);

    // Find ImageSpace document
    const imageSpace = await ImageSpace.findOne({ chatId });

    if (!imageSpace) {
      return res.status(200).json({
        success: true,
        items: [],
        images: [], // Legacy support
        chatId,
      });
    }

    // Use items array if available, otherwise fall back to images array
    let items = [];
    if (imageSpace.items && imageSpace.items.length > 0) {
      items = imageSpace.items;
    } else if (imageSpace.images && imageSpace.images.length > 0) {
      // Convert legacy images to items format
      items = imageSpace.images.map(img => ({
        itemId: img.imageId || img._id,
        type: 'image',
        imageUrl: img.imageUrl,
        uploadedBy: img.uploadedBy,
        uploadedAt: img.uploadedAt,
        caption: img.caption || '',
        metadata: img.metadata || {},
      }));
    }

    // Sort items by uploadedAt (newest first)
    const sortedItems = items.sort((a, b) => 
      new Date(b.uploadedAt) - new Date(a.uploadedAt)
    );

    console.log(`✅ [YOUR SPACE] Retrieved ${sortedItems.length} items for chat: ${chatId}`);

    res.status(200).json({
      success: true,
      items: sortedItems,
      images: sortedItems.filter(item => item.type === 'image'), // Legacy support
      chatId,
      totalCount: sortedItems.length,
    });
  } catch (error) {
    console.error('❌ [YOUR SPACE] Get items error:', error);
    res.status(500).json({ 
      success: false, 
      message: 'Failed to retrieve items',
      error: error.message 
    });
  }
};

// Delete specific image
exports.deleteImage = async (req, res) => {
  try {
    const { contactId, imageId } = req.params;
    const userId = req.user.userId;

    if (!contactId || !imageId) {
      return res.status(400).json({ 
        success: false, 
        message: 'Contact ID and Image ID are required' 
      });
    }

    // Generate chatId
    const chatId = ImageSpace.generateChatId(userId, contactId);

    // Find ImageSpace document
    const imageSpace = await ImageSpace.findOne({ chatId });

    if (!imageSpace) {
      return res.status(404).json({
        success: false,
        message: 'Image Space not found',
      });
    }

    // Find image
    const imageIndex = imageSpace.images.findIndex(img => img.imageId === imageId);

    if (imageIndex === -1) {
      return res.status(404).json({
        success: false,
        message: 'Image not found',
      });
    }

    // Check if user is the uploader
    const image = imageSpace.images[imageIndex];
    if (image.uploadedBy !== userId) {
      return res.status(403).json({
        success: false,
        message: 'You can only delete images you uploaded',
      });
    }

    // Remove image from array
    imageSpace.images.splice(imageIndex, 1);
    await imageSpace.save();

    console.log(`✅ [IMAGE SPACE] Image deleted: ${imageId} from chat: ${chatId}`);

    res.status(200).json({
      success: true,
      message: 'Image deleted successfully',
      remainingCount: imageSpace.images.length,
    });
  } catch (error) {
    console.error('❌ [IMAGE SPACE] Delete image error:', error);
    res.status(500).json({ 
      success: false, 
      message: 'Failed to delete image',
      error: error.message 
    });
  }
};

// Get image count for a chat (for badge display)
exports.getImageCount = async (req, res) => {
  try {
    const { contactId } = req.params;
    const userId = req.user.userId;

    if (!contactId) {
      return res.status(400).json({ 
        success: false, 
        message: 'Contact ID is required' 
      });
    }

    // Generate chatId
    const chatId = ImageSpace.generateChatId(userId, contactId);

    // Find ImageSpace document
    const imageSpace = await ImageSpace.findOne({ chatId });

    const count = imageSpace ? imageSpace.images.length : 0;

    res.status(200).json({
      success: true,
      count,
      chatId,
    });
  } catch (error) {
    console.error('❌ [IMAGE SPACE] Get count error:', error);
    res.status(500).json({ 
      success: false, 
      message: 'Failed to get image count',
      error: error.message 
    });
  }
};

// Get unread count for a chat
exports.getUnreadCount = async (req, res) => {
  try {
    const { contactId } = req.params;
    const userId = req.user.userId;

    if (!contactId) {
      return res.status(400).json({ 
        success: false, 
        message: 'Contact ID is required' 
      });
    }

    // Generate chatId
    const chatId = ImageSpace.generateChatId(userId, contactId);

    // Find ImageSpace document
    const imageSpace = await ImageSpace.findOne({ chatId });

    const unreadCount = imageSpace && imageSpace.unreadCount 
      ? imageSpace.unreadCount.get(userId) || 0 
      : 0;

    res.status(200).json({
      success: true,
      unreadCount,
      chatId,
    });
  } catch (error) {
    console.error('❌ [IMAGE SPACE] Get unread count error:', error);
    res.status(500).json({ 
      success: false, 
      message: 'Failed to get unread count',
      error: error.message 
    });
  }
};

// Mark images as read
exports.markAsRead = async (req, res) => {
  try {
    const { contactId } = req.params;
    const userId = req.user.userId;

    if (!contactId) {
      return res.status(400).json({ 
        success: false, 
        message: 'Contact ID is required' 
      });
    }

    // Generate chatId
    const chatId = ImageSpace.generateChatId(userId, contactId);

    // Find ImageSpace document
    const imageSpace = await ImageSpace.findOne({ chatId });

    if (!imageSpace) {
      return res.status(200).json({
        success: true,
        message: 'No Image Space found',
      });
    }

    // Reset unread count for this user
    if (!imageSpace.unreadCount) {
      imageSpace.unreadCount = new Map();
    }
    imageSpace.unreadCount.set(userId, 0);
    
    await imageSpace.save();

    console.log(`✅ [IMAGE SPACE] Marked as read for user: ${userId} in chat: ${chatId}`);

    res.status(200).json({
      success: true,
      message: 'Marked as read',
    });
  } catch (error) {
    console.error('❌ [IMAGE SPACE] Mark as read error:', error);
    res.status(500).json({ 
      success: false, 
      message: 'Failed to mark as read',
      error: error.message 
    });
  }
};
