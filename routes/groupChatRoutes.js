const express = require('express');
const router = express.Router();
const { protect } = require('../middleware/authMiddleware');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const {
  createGroupChat,
  getUserGroupChats,
  getGroupChatDetails,
  updateGroupChat,
  uploadGroupImage,
  deleteGroupChat,
  addGroupMembers,
  removeGroupMember,
  updateMemberRole,
  getGroupMessages,
  sendGroupMessage,
  getGroupsHealth,
  toggleGroupMessageReaction,
  searchGroupMessages,
  muteGroupNotifications,
  leaveGroup
} = require('../controllers/groupChatController');

// Configure multer for group image uploads
const groupImagesDir = path.join(__dirname, '../uploads/group-images');
if (!fs.existsSync(groupImagesDir)) {
  fs.mkdirSync(groupImagesDir, { recursive: true });
}

const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, groupImagesDir);
  },
  filename: (req, file, cb) => {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    cb(null, 'group-' + uniqueSuffix + path.extname(file.originalname));
  }
});

const fileFilter = (req, file, cb) => {
  const allowedTypes = /jpeg|jpg|png|gif|webp/;
  const extname = allowedTypes.test(path.extname(file.originalname).toLowerCase());
  const mimetype = allowedTypes.test(file.mimetype);
  
  if (mimetype && extname) {
    return cb(null, true);
  } else {
    cb(new Error('Only image files are allowed (jpeg, jpg, png, gif, webp)'));
  }
};

const upload = multer({
  storage: storage,
  fileFilter: fileFilter,
  limits: {
    fileSize: 10 * 1024 * 1024 // 10MB limit
  }
});

// Apply authentication middleware to all routes
router.use(protect);

// Group Chat Management Routes
router.route('/')
  .get(getUserGroupChats)     // GET /api/group-chats - Get user's group chats
  .post(createGroupChat);     // POST /api/group-chats - Create new group chat

router.route('/:groupId')
  .get(getGroupChatDetails)   // GET /api/group-chats/:groupId - Get group details
  .put(updateGroupChat)       // PUT /api/group-chats/:groupId - Update group info
  .delete(deleteGroupChat);   // DELETE /api/group-chats/:groupId - Delete group

// Group Image Upload Route
router.post('/:groupId/upload-image', upload.single('groupImage'), uploadGroupImage);

// Group Message Search
router.post('/:groupId/messages/search', searchGroupMessages);

// Group Member Actions
router.post('/:groupId/mute', muteGroupNotifications);     // POST /api/group-chats/:groupId/mute - Mute group notifications
router.post('/:groupId/leave', leaveGroup);                // POST /api/group-chats/:groupId/leave - Leave group

// Group Messages Routes
router.route('/:groupId/messages')
  .get(getGroupMessages)      // GET /api/group-chats/:groupId/messages - Get messages
  .post(sendGroupMessage);    // POST /api/group-chats/:groupId/messages - Send message

// Group Members Routes
router.route('/:groupId/members')
  .post(addGroupMembers);     // POST /api/group-chats/:groupId/members - Add members

router.route('/:groupId/members/:memberId')
  .delete(removeGroupMember); // DELETE /api/group-chats/:groupId/members/:memberId - Remove member

router.route('/:groupId/members/:memberId/role')
  .put(updateMemberRole);     // PUT /api/group-chats/:groupId/members/:memberId/role - Update member role

// Advanced Features Routes
router.route('/:groupId/messages/search')
  .get(searchGroupMessages);  // GET /api/group-chats/:groupId/messages/search - Search messages

router.route('/:groupId/messages/:messageId/reactions')
  .post(toggleGroupMessageReaction); // POST /api/group-chats/:groupId/messages/:messageId/reactions - Toggle reaction

// Health Check Route
router.get('/health', getGroupsHealth);  // GET /api/group-chats/health - Health check

module.exports = router;
