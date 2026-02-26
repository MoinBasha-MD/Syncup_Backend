const ImageSpace = require('../models/ImageSpace');
const { v4: uuidv4 } = require('uuid');

// Upload image to Image Space
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
        images: [],
      });
    }

    // Create image entry
    const imageEntry = {
      imageId: uuidv4(),
      imageUrl,
      uploadedBy: senderId,
      uploadedAt: new Date(),
      caption: caption || '',
      metadata: metadata || {},
    };

    // Add image to array
    imageSpace.images.push(imageEntry);
    await imageSpace.save();

    console.log(`✅ [IMAGE SPACE] Image uploaded to space: ${chatId}`);

    res.status(200).json({
      success: true,
      message: 'Image uploaded to Image Space',
      imageSpace: {
        chatId: imageSpace.chatId,
        imageCount: imageSpace.images.length,
        latestImage: imageEntry,
      },
    });
  } catch (error) {
    console.error('❌ [IMAGE SPACE] Upload error:', error);
    res.status(500).json({ 
      success: false, 
      message: 'Failed to upload image to Image Space',
      error: error.message 
    });
  }
};

// Get all images for a chat
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
        images: [],
        chatId,
      });
    }

    // Sort images by uploadedAt (newest first)
    const sortedImages = imageSpace.images.sort((a, b) => 
      new Date(b.uploadedAt) - new Date(a.uploadedAt)
    );

    console.log(`✅ [IMAGE SPACE] Retrieved ${sortedImages.length} images for chat: ${chatId}`);

    res.status(200).json({
      success: true,
      images: sortedImages,
      chatId,
      totalCount: sortedImages.length,
    });
  } catch (error) {
    console.error('❌ [IMAGE SPACE] Get images error:', error);
    res.status(500).json({ 
      success: false, 
      message: 'Failed to retrieve images',
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
