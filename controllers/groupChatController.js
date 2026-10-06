const asyncHandler = require('express-async-handler');
const GroupChat = require('../models/groupChatModel');
const GroupMessage = require('../models/groupMessageModel');
const GroupMember = require('../models/groupMemberModel');
const User = require('../models/userModel');
const mongoose = require('mongoose');
const { broadcastToUser } = require('../socketManager');

/**
 * Notify every current member (plus affected user(s), e.g. just-removed/left)
 * that the roster changed so their E2EE member-id caches invalidate. Bodies
 * carry only the groupId — members re-fetch the roster.
 */
const broadcastMembersChanged = async (groupId, extraUserIds = []) => {
  try {
    const members = await GroupMember.find({ groupId, isActive: true }).select('userId');
    const targets = new Set(members.map((m) => m.userId));
    for (const id of extraUserIds) targets.add(id);
    for (const userId of targets) {
      broadcastToUser(userId, 'group:members-changed', { groupId: String(groupId) });
    }
  } catch (e) {
    console.warn('⚠️ [GROUP MEMBERS] members-changed broadcast failed:', e.message);
  }
};

const {
  validateEnvelope,
  isE2eeV2,
  e2eeGroupEnforced,
  MAX_GROUP_KEY_ENTRIES,
  MAX_GROUP_ENVELOPE_BYTES,
} = require('../utils/e2eeEnvelope');

/**
 * @desc    Create a new group chat
 * @route   POST /api/group-chats
 * @access  Private
 */
const createGroupChat = asyncHandler(async (req, res) => {
  const { groupName, description, initialMembers = [], groupImage = '' } = req.body;
  const createdBy = req.user.userId;

  // Validate input
  if (!groupName || groupName.trim().length === 0) {
    res.status(400);
    throw new Error('Group name is required');
  }

  const memberIds = [...new Set([createdBy, ...initialMembers])]; // Include creator and remove duplicates
  
  console.log('🔍 [GROUP CHAT] Received data:', {
    groupName,
    description,
    initialMembers,
    createdBy,
    memberIds,
    memberIdTypes: memberIds.map(id => typeof id)
  });
  
  if (memberIds.length < 2) {
    res.status(400);
    throw new Error('Group must have at least 2 members');
  }
  if (memberIds.length > 256) {
    res.status(400);
    throw new Error('Group cannot have more than 256 members');
  }

  // Verify all members exist
  const existingUsers = await User.find({ 
    userId: { $in: memberIds } 
  }).select('userId name profileImage');

  if (existingUsers.length !== memberIds.length) {
    res.status(400);
    throw new Error('One or more members not found');
  }

  try {
    // Create group chat
    const groupChat = await GroupChat.create({
      groupName: groupName.trim(),
      description: description?.trim() || '',
      groupImage,
      createdBy,
      admins: [createdBy],
      members: memberIds,
      memberCount: memberIds.length
    });

    // Create group member records
    const memberRecords = memberIds.map(memberId => ({
      groupId: groupChat._id,
      userId: memberId,
      role: memberId.toString() === createdBy.toString() ? 'admin' : 'member',
      addedBy: createdBy,
      joinedAt: new Date()
    }));

    await GroupMember.insertMany(memberRecords);

    // Get the created group (no population needed since we're using String IDs)
    const populatedGroup = await GroupChat.findById(groupChat._id);

    console.log(`✅ [GROUP CHAT] Created group "${groupName}" with ${memberIds.length} members`);

    // Broadcast group creation notification to all members (except creator)
    const notificationData = {
      type: 'group_created',
      groupId: groupChat._id,
      groupName: groupChat.groupName,
      groupImage: groupChat.groupImage,
      createdBy: createdBy,
      memberCount: memberIds.length,
      timestamp: new Date().toISOString()
    };

    memberIds.forEach(memberId => {
      if (memberId !== createdBy) {
        try {
          broadcastToUser(memberId, 'group:created', notificationData);
          console.log(`📢 [GROUP CHAT] Notified member ${memberId} about new group`);
        } catch (error) {
          console.error(`❌ [GROUP CHAT] Failed to notify member ${memberId}:`, error);
        }
      }
    });

    res.status(201).json({
      success: true,
      data: populatedGroup,
      message: 'Group chat created successfully'
    });
  } catch (error) {
    console.error('❌ [GROUP CHAT] Error creating group:', error);
    
    // Handle specific MongoDB errors
    if (error.code === 11000) {
      res.status(400);
      throw new Error('Group with this name already exists');
    }
    
    if (error.name === 'ValidationError') {
      res.status(400);
      throw new Error(error.message);
    }
    
    res.status(500);
    throw new Error('Failed to create group chat');
  }
});

/**
 * @desc    Get user's group chats
 * @route   GET /api/group-chats
 * @access  Private
 */
const getUserGroupChats = asyncHandler(async (req, res) => {
  const userId = req.user.userId;

  console.log('📱 [GET GROUPS] ========================================');
  console.log('📱 [GET GROUPS] API Called');
  console.log('📱 [GET GROUPS] User ID:', userId);

  try {
    const groupChats = await GroupChat.findUserGroups(userId);
    console.log('📱 [GET GROUPS] Found', groupChats.length, 'groups');
    
    // ✅ Use base URL without /api for image URLs (images are served from root domain)
    const imageBaseUrl = process.env.IMAGE_BASE_URL || 'https://api.crackman.in';

    // Get unread counts for each group and transform image URLs
    const groupsWithUnread = await Promise.all(
      groupChats.map(async (group) => {
        console.log('📱 [GET GROUPS] Processing group:', group.groupName);
        
        // Get member record to check lastSeenMessageId
        const member = await GroupMember.findOne({
          groupId: group._id,
          userId,
          isActive: true
        });
        
        console.log('📱 [GET GROUPS] Member lastSeenMessageId:', member?.lastSeenMessageId);
        console.log('📱 [GET GROUPS] Member lastSeenAt:', member?.lastSeenAt);
        
        const unreadCount = await GroupMember.getUnreadCount(group._id, userId);
        console.log('📱 [GET GROUPS] Calculated unread count:', unreadCount);
        
        const groupObj = group.toObject();
        
        // Transform groupImage to full URL
        if (groupObj.groupImage && !groupObj.groupImage.startsWith('http')) {
          groupObj.groupImage = `${imageBaseUrl}${groupObj.groupImage}`;
        }
        
        return {
          ...groupObj,
          unreadCount
        };
      })
    );

    console.log('📱 [GET GROUPS] Groups with unread counts:');
    groupsWithUnread.forEach(g => {
      console.log(`   - ${g.groupName}: ${g.unreadCount} unread`);
    });
    console.log('📱 [GET GROUPS] ========================================');

    res.status(200).json({
      success: true,
      data: groupsWithUnread,
      count: groupChats.length
    });
  } catch (error) {
    console.error('❌ [GET GROUPS] Error fetching user groups:', error);
    console.error('❌ [GET GROUPS] Error stack:', error.stack);
    res.status(500);
    throw new Error('Failed to fetch group chats');
  }
});

/**
 * @desc    Get group chat details
 * @route   GET /api/group-chats/:groupId
 * @access  Private
 */
const getGroupChatDetails = asyncHandler(async (req, res) => {
  const { groupId } = req.params;
  const userId = req.user.userId;

  try {
    // Check if user is a member
    const membership = await GroupMember.isMember(groupId, userId);
    if (!membership) {
      res.status(403);
      throw new Error('You are not a member of this group');
    }

    const groupChat = await GroupChat.findById(groupId);
    if (!groupChat) {
      res.status(404);
      throw new Error('Group chat not found');
    }

    // Get group members with their roles
    const memberRecords = await GroupMember.findGroupMembers(groupId);
    
    // Get user details for each member
    const memberUserIds = memberRecords.map(member => member.userId);
    const users = await User.find({ userId: { $in: memberUserIds } }).select('userId name profileImage phoneNumber');
    
    // Combine member records with user details
    const imageBaseUrl = process.env.IMAGE_BASE_URL || 'https://api.crackman.in';
    const members = memberRecords.map(member => {
      const user = users.find(u => u.userId === member.userId);
      return {
        ...member.toObject(),
        userId: member.userId,
        name: user?.name || 'Unknown User',
        profileImage: user?.profileImage || '',
        phoneNumber: user?.phoneNumber || 'No phone'
      };
    });

    // Transform group image to full URL
    const groupObj = groupChat.toObject();
    if (groupObj.groupImage && !groupObj.groupImage.startsWith('http')) {
      groupObj.groupImage = `${baseUrl}${groupObj.groupImage}`;
    }

    res.status(200).json({
      success: true,
      data: {
        ...groupObj,
        members
      }
    });
  } catch (error) {
    console.error('❌ [GROUP CHAT] Error fetching group details:', error);
    res.status(500);
    throw new Error('Failed to fetch group details');
  }
});

/**
 * @desc    Send message to group chat
 * @route   POST /api/group-chats/:groupId/messages
 * @access  Private
 */
const sendGroupMessage = asyncHandler(async (req, res) => {
  const { groupId } = req.params;
  const { message, messageType = 'text', replyTo, imageUrl, voiceMetadata, fileMetadata, encrypted = false, encryptionData, e2ee } = req.body;
  const senderId = req.user.userId;

  console.log('🔍 [GROUP MESSAGE] Request params:', { groupId, senderId, messageType });

  // Validate groupId is a valid ObjectId
  if (!mongoose.Types.ObjectId.isValid(groupId)) {
    res.status(400);
    throw new Error('Invalid group ID');
  }

  try {
    console.log('🔍 [GROUP MESSAGE] Checking membership for:', { groupId, senderId });
    
    // Check if user is a member and can send messages
    const membership = await GroupMember.findOne({
      groupId,
      userId: senderId,
      isActive: true
    });

    console.log('🔍 [GROUP MESSAGE] Membership found:', membership);

    if (!membership) {
      res.status(403);
      throw new Error('You are not a member of this group');
    }

    if (!membership.permissions.canSendMessages) {
      res.status(403);
      throw new Error('You do not have permission to send messages in this group');
    }

    // Get group settings
    const groupChat = await GroupChat.findById(groupId);
    if (!groupChat) {
      res.status(404);
      throw new Error('Group chat not found');
    }

    // Check if only admins can message
    if (groupChat.settings.onlyAdminsCanMessage && membership.role !== 'admin') {
      res.status(403);
      throw new Error('Only admins can send messages in this group');
    }

    // Get sender info
    const sender = await User.findOne({ userId: senderId }).select('name');
    if (!sender) {
      res.status(404);
      throw new Error('Sender not found');
    }

    // Load all active members once — used for envelope validation, delivery
    // marks, the broadcast loop and notifications below.
    const allActiveMembers = await GroupMember.find({ groupId, isActive: true });

    // E2EE v2: the envelope must be bound to this group's ctx and only wrap
    // keys for current active members.
    if (isE2eeV2(e2ee)) {
      const envelopeError = validateEnvelope(e2ee, {
        senderId,
        expectedCtx: `group:${groupId}`,
        allowedUserIds: new Set(allActiveMembers.map((m) => m.userId)),
        maxKeys: MAX_GROUP_KEY_ENTRIES,
        maxBytes: MAX_GROUP_ENVELOPE_BYTES,
      });
      if (envelopeError) {
        // INVALID_KEYS usually means a member cache is stale (member added or
        // removed mid-send) — tell the client so it can refresh and retry.
        const code = envelopeError === 'INVALID_KEYS' ? 'E2EE_STALE_MEMBERS' : envelopeError;
        return res.status(400).json({ success: false, message: 'Invalid e2ee envelope', code });
      }
    } else if (e2eeGroupEnforced()) {
      res.status(400);
      throw new Error('E2EE_REQUIRED');
    }

    // Create message — for v2 the server stores only the envelope; plaintext
    // content and the replied-to snippet never touch the record.
    const groupMessage = await GroupMessage.create({
      groupId,
      senderId,
      senderName: sender.name,
      message: isE2eeV2(e2ee) ? '' : (message || ''),
      messageType,
      ...(isE2eeV2(e2ee) ? {
        e2ee: { v: 2, envelope: e2ee.envelope },
      } : {
        imageUrl,
        voiceMetadata,
        fileMetadata,
        encrypted,
        encryptionData,
      }),
      replyTo: replyTo ? (
        isE2eeV2(e2ee)
          ? { messageId: replyTo.messageId } // client resolves the snippet locally
          : {
              messageId: replyTo.messageId,
              message: replyTo.message,
              senderName: replyTo.senderName
            }
      ) : undefined
    });

    // Update group's last message and activity
    await groupChat.updateLastMessage(groupMessage);
    await groupChat.save();

    // Mark as delivered to all active members
    const activeMembers = allActiveMembers.filter((m) => m.userId !== senderId);

    const deliveryPromises = activeMembers.map(member =>
      groupMessage.markAsDelivered(member.userId)
    );
    await Promise.all(deliveryPromises);
    await groupMessage.save();

    console.log(`💬 [GROUP MESSAGE] Message sent to group ${groupId} by ${sender.name}`);

    // CRITICAL: Broadcast group message to all active members via WebSocket
    try {
      console.log('📡 [GROUP MESSAGE] Broadcasting message to group members...');
      
      const broadcastData = {
        _id: groupMessage._id,
        senderId: groupMessage.senderId,
        receiverId: groupId, // Group ID as receiver for group messages
        message: groupMessage.message,
        messageType: groupMessage.messageType,
        timestamp: groupMessage.createdAt,
        status: 'delivered',
        groupId: groupId,
        senderName: groupMessage.senderName,
        isGroupMessage: true,
        ...(groupMessage.e2ee && groupMessage.e2ee.v === 2 ? { e2ee: groupMessage.e2ee } : {})
      };

      let successfulBroadcasts = 0;
      
      // Broadcast to each active member (except sender)
      for (const member of activeMembers) {
        try {
          const broadcastSuccess = broadcastToUser(member.userId, 'message:new', broadcastData);
          if (broadcastSuccess) {
            successfulBroadcasts++;
            console.log(`✅ [GROUP MESSAGE] Broadcasted to member: ${member.userId}`);
          } else {
            console.log(`⚠️ [GROUP MESSAGE] Member ${member.userId} offline, message saved for later`);
          }
        } catch (memberError) {
          console.error(`❌ [GROUP MESSAGE] Error broadcasting to member ${member.userId}:`, memberError);
        }
      }
      
      console.log(`📊 [GROUP MESSAGE] Successfully broadcast to ${successfulBroadcasts}/${activeMembers.length} members`);
      
      // 🔔 Send notifications to group members via socket
      console.log('🔔 [GROUP MESSAGE] Sending notifications to group members...');
      let notificationsSent = 0;
      
      for (const member of activeMembers) {
        try {
          const notificationData = {
            type: 'group_message',
            title: `${groupChat.groupName} - ${sender.name}`,
            body: isE2eeV2(groupMessage.e2ee)
              ? 'New message'
              : (groupMessage.message || 'Sent a message'),
            data: {
              type: 'group_message',
              groupId: groupId,
              groupName: groupChat.groupName,
              senderId: senderId,
              senderName: sender.name,
              messageId: groupMessage._id.toString(),
              chatId: groupId,
              timestamp: groupMessage.createdAt.toISOString(),
              isGroupMessage: true
            }
          };
          
          // Broadcast notification event to member
          const notifSuccess = broadcastToUser(member.userId, 'notification:new', notificationData);
          if (notifSuccess) {
            notificationsSent++;
            console.log(`✅ [GROUP MESSAGE] Notification sent to member: ${member.userId}`);
          } else {
            console.log(`⚠️ [GROUP MESSAGE] Member ${member.userId} offline, notification queued`);
          }
        } catch (notifError) {
          console.error(`❌ [GROUP MESSAGE] Failed to send notification to ${member.userId}:`, notifError.message);
        }
      }
      
      console.log(`🔔 [GROUP MESSAGE] Sent ${notificationsSent}/${activeMembers.length} notifications`);
      
    } catch (broadcastError) {
      console.error('❌ [GROUP MESSAGE] Error broadcasting group message:', broadcastError);
      // Don't fail the request if broadcasting fails - message is still saved
    }

    res.status(201).json({
      success: true,
      data: groupMessage,
      message: 'Message sent successfully'
    });
  } catch (error) {
    console.error('❌ [GROUP MESSAGE] Error sending message:', error);
    // Preserve a more specific status set earlier (400 envelope, 403 member)
    const statusCode = res.statusCode && res.statusCode !== 200 ? res.statusCode : 500;
    res.status(statusCode);
    throw statusCode === 500 ? new Error('Failed to send message') : error;
  }
});

/**
 * @desc    Get group chat messages
 * @route   GET /api/group-chats/:groupId/messages
 * @access  Private
 */
const getGroupMessages = asyncHandler(async (req, res) => {
  const { groupId } = req.params;
  const { page = 1, limit = 50 } = req.query;
  const userId = req.user.userId;

  try {
    // Check if user is a member
    const membership = await GroupMember.isMember(groupId, userId);
    if (!membership) {
      res.status(403);
      throw new Error('You are not a member of this group');
    }

    const messages = await GroupMessage.findGroupMessages(
      groupId, 
      parseInt(page), 
      parseInt(limit)
    );

    // Only update lastSeenAt, NOT lastSeenMessageId
    // lastSeenMessageId should only be updated by markGroupAsRead endpoint
    await GroupMember.findOneAndUpdate(
      { groupId, userId },
      { 
        lastSeenAt: new Date()
        // REMOVED: lastSeenMessageId update - this was causing the bug
        // It was overwriting the correct value set by markGroupAsRead
      }
    );

    res.status(200).json({
      success: true,
      data: messages,
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
        hasMore: messages.length === parseInt(limit)
      }
    });
  } catch (error) {
    console.error('❌ [GROUP MESSAGES] Error fetching messages:', error);
    res.status(500);
    throw new Error('Failed to fetch messages');
  }
});

/**
 * @desc    Add members to group chat
 * @route   POST /api/group-chats/:groupId/members
 * @access  Private
 */
const addGroupMembers = asyncHandler(async (req, res) => {
  const { groupId } = req.params;
  const { memberIds } = req.body;
  const userId = req.user.userId;

  try {
    // Check if user is admin or has permission
    const membership = await GroupMember.findOne({
      groupId,
      userId,
      isActive: true
    });

    if (!membership) {
      res.status(403);
      throw new Error('You are not a member of this group');
    }

    const groupChat = await GroupChat.findById(groupId);
    if (!groupChat) {
      res.status(404);
      throw new Error('Group chat not found');
    }

    // Check permissions
    if (groupChat.settings.onlyAdminsCanAddMembers && membership.role !== 'admin') {
      res.status(403);
      throw new Error('Only admins can add members to this group');
    }

    if (!membership.permissions.canAddMembers && membership.role !== 'admin') {
      res.status(403);
      throw new Error('You do not have permission to add members');
    }

    // Validate member IDs
    if (!Array.isArray(memberIds) || memberIds.length === 0) {
      res.status(400);
      throw new Error('Member IDs are required');
    }

    // Check if adding these members would exceed limit
    if (groupChat.memberCount + memberIds.length > 256) {
      res.status(400);
      throw new Error('Group member limit exceeded (256 members max)');
    }

    // Verify users exist
    const existingUsers = await User.find({
      userId: { $in: memberIds }
    }).select('userId name profileImage');

    if (existingUsers.length !== memberIds.length) {
      res.status(400);
      throw new Error('One or more users not found');
    }

    // Check which users are already members
    const existingMembers = await GroupMember.find({
      groupId,
      userId: { $in: memberIds },
      isActive: true
    });

    const existingMemberIds = existingMembers.map(m => m.userId.toString());
    const newMemberIds = memberIds.filter(id => !existingMemberIds.includes(id.toString()));

    if (newMemberIds.length === 0) {
      res.status(400);
      throw new Error('All specified users are already members');
    }

    // Add new members
    const memberRecords = newMemberIds.map(memberId => ({
      groupId,
      userId: memberId,
      role: 'member',
      addedBy: userId,
      joinedAt: new Date()
    }));

    await GroupMember.insertMany(memberRecords);

    // Update group chat
    await GroupChat.findByIdAndUpdate(groupId, {
      $addToSet: { members: { $each: newMemberIds } },
      $inc: { memberCount: newMemberIds.length },
      lastActivity: new Date()
    });

    console.log(`👥 [GROUP MEMBERS] Added ${newMemberIds.length} members to group ${groupId}`);

    // Rosters changed — tell members (and the new members themselves) so
    // E2EE member caches refresh before their next send.
    broadcastMembersChanged(groupId, newMemberIds);

    // Create system message for each added member (like WhatsApp)
    const adderUser = await User.findOne({ userId }).select('name');
    const adderName = adderUser?.name || 'Someone';

    for (const memberId of newMemberIds) {
      const addedUser = await User.findOne({ userId: memberId }).select('name');
      const addedName = addedUser?.name || 'Unknown';

      // Create system message
      const systemMessage = await GroupMessage.create({
        groupId,
        senderId: 'system',
        senderName: adderName,
        message: `${adderName} added ${addedName}`,
        messageType: 'system',
        timestamp: new Date()
      });

      // Broadcast system message to all group members
      try {
        groupChat.members.forEach(member => {
          broadcastToUser(member, 'group:message', {
            groupId,
            message: systemMessage,
            messageType: 'system'
          });
        });
      } catch (broadcastError) {
        console.error('❌ [GROUP MEMBERS] Failed to broadcast system message:', broadcastError);
      }
    }

    res.status(200).json({
      success: true,
      data: {
        addedMembers: newMemberIds,
        addedCount: newMemberIds.length
      },
      message: `${newMemberIds.length} members added successfully`
    });
  } catch (error) {
    console.error('❌ [GROUP MEMBERS] Error adding members:', error);
    res.status(500);
    throw new Error('Failed to add members');
  }
});

/**
 * @desc    Mark group messages as read
 * @route   POST /api/group-chats/:groupId/mark-read
 * @access  Private
 */
const markGroupMessagesAsRead = asyncHandler(async (req, res) => {
  const { groupId } = req.params;
  const userId = req.user.userId;

  console.log('🔵 [MARK READ] ========================================');
  console.log('🔵 [MARK READ] API Called');
  console.log('🔵 [MARK READ] Group ID:', groupId);
  console.log('🔵 [MARK READ] User ID:', userId);

  try {
    // Find the member record
    const member = await GroupMember.findOne({
      groupId,
      userId,
      isActive: true
    });

    console.log('🔵 [MARK READ] Member found:', !!member);
    if (member) {
      console.log('🔵 [MARK READ] Current lastSeenMessageId:', member.lastSeenMessageId);
      console.log('🔵 [MARK READ] Current lastSeenAt:', member.lastSeenAt);
    }

    if (!member) {
      console.error('❌ [MARK READ] User is not a member of this group');
      res.status(404);
      throw new Error('You are not a member of this group');
    }

    // Get the latest message in the group
    const latestMessage = await GroupMessage.findOne({
      groupId,
      deletedAt: null
    }).sort({ createdAt: -1 });

    console.log('🔵 [MARK READ] Latest message found:', !!latestMessage);
    if (latestMessage) {
      console.log('🔵 [MARK READ] Latest message ID:', latestMessage._id);
      console.log('🔵 [MARK READ] Latest message text:', latestMessage.message?.substring(0, 50));
      console.log('🔵 [MARK READ] Latest message createdAt:', latestMessage.createdAt);
    }

    if (latestMessage) {
      // Update lastSeenMessageId to the latest message
      const oldLastSeenMessageId = member.lastSeenMessageId;
      member.lastSeenMessageId = latestMessage._id;
      member.lastSeenAt = new Date();
      
      console.log('🔵 [MARK READ] Updating member record...');
      console.log('🔵 [MARK READ] Old lastSeenMessageId:', oldLastSeenMessageId);
      console.log('🔵 [MARK READ] New lastSeenMessageId:', member.lastSeenMessageId);
      
      await member.save();

      console.log('✅ [MARK READ] Member record saved successfully');
      console.log(`✅ [MARK READ] Marked messages as read for user ${userId} in group ${groupId}`);
      
      // Verify the save
      const verifyMember = await GroupMember.findOne({
        groupId,
        userId,
        isActive: true
      });
      console.log('🔵 [MARK READ] Verification - lastSeenMessageId after save:', verifyMember?.lastSeenMessageId);
    } else {
      console.log('⚠️ [MARK READ] No messages in group to mark as read');
    }

    console.log('🔵 [MARK READ] ========================================');

    res.status(200).json({
      success: true,
      message: 'Messages marked as read'
    });
  } catch (error) {
    console.error('❌ [MARK READ] Error marking messages as read:', error);
    console.error('❌ [MARK READ] Error stack:', error.stack);
    res.status(500);
    throw new Error('Failed to mark messages as read');
  }
});

/**
 * @desc    Remove member from group chat
 * @route   DELETE /api/group-chats/:groupId/members/:memberId
 * @access  Private
 */
const removeGroupMember = asyncHandler(async (req, res) => {
  const { groupId, memberId } = req.params;
  const userId = req.user.userId;

  try {
    // Check if user is admin or removing themselves
    const membership = await GroupMember.findOne({
      groupId,
      userId,
      isActive: true
    });

    if (!membership) {
      res.status(403);
      throw new Error('You are not a member of this group');
    }

    const groupChat = await GroupChat.findById(groupId);
    if (!groupChat) {
      res.status(404);
      throw new Error('Group chat not found');
    }

    // Check if member exists
    const memberToRemove = await GroupMember.findOne({
      groupId,
      userId: memberId,
      isActive: true
    });

    if (!memberToRemove) {
      res.status(404);
      throw new Error('Member not found in this group');
    }

    // Check permissions
    const isSelfRemoval = userId.toString() === memberId.toString();
    const isCreatorBeingRemoved = groupChat.createdBy.toString() === memberId.toString();
    
    if (!isSelfRemoval) {
      if (membership.role !== 'admin') {
        res.status(403);
        throw new Error('Only admins can remove other members');
      }
      
      if (isCreatorBeingRemoved) {
        res.status(403);
        throw new Error('Cannot remove group creator');
      }
    }

    // Remove member
    if (isSelfRemoval) {
      await memberToRemove.leaveGroup();
    } else {
      await memberToRemove.removeFromGroup(userId);
    }
    await memberToRemove.save();

    // Update group chat
    await GroupChat.findByIdAndUpdate(groupId, {
      $pull: { 
        members: memberId,
        admins: memberId
      },
      $inc: { memberCount: -1 },
      lastActivity: new Date()
    });

    console.log(`👥 [GROUP MEMBERS] Removed member ${memberId} from group ${groupId}`);

    // Include the removed user — their app should drop the cached roster too.
    broadcastMembersChanged(groupId, [memberId]);

    res.status(200).json({
      success: true,
      message: isSelfRemoval ? 'Left group successfully' : 'Member removed successfully'
    });
  } catch (error) {
    console.error('❌ [GROUP MEMBERS] Error removing member:', error);
    res.status(500);
    throw new Error('Failed to remove member');
  }
});

/**
 * @desc    Upload group image
 * @route   POST /api/group-chats/:groupId/upload-image
 * @access  Private
 */
const uploadGroupImage = asyncHandler(async (req, res) => {
  const { groupId } = req.params;
  const userId = req.user.userId;

  try {
    // Check if user is admin
    const membership = await GroupMember.isAdmin(groupId, userId);
    if (!membership) {
      res.status(403);
      throw new Error('Only admins can update group image');
    }

    // Check if file was uploaded
    if (!req.file) {
      res.status(400);
      throw new Error('No image file provided');
    }

    // Construct the image path (relative to server)
    const imagePath = `/uploads/group-images/${req.file.filename}`;
    
    console.log('📸 [GROUP IMAGE] Uploaded:', imagePath);

    // Update group with new image path
    const updatedGroup = await GroupChat.findByIdAndUpdate(
      groupId,
      { 
        groupImage: imagePath,
        lastActivity: new Date()
      },
      { new: true, runValidators: true }
    );

    if (!updatedGroup) {
      res.status(404);
      throw new Error('Group chat not found');
    }

    console.log(`✅ [GROUP IMAGE] Group ${groupId} image updated by admin ${userId}`);

    // Return full URL
    const imageBaseUrl = process.env.IMAGE_BASE_URL || 'https://api.crackman.in';
    const fullImageUrl = `${imageBaseUrl}${imagePath}`;

    res.status(200).json({
      success: true,
      data: {
        groupImage: fullImageUrl
      },
      message: 'Group image uploaded successfully'
    });
  } catch (error) {
    console.error('❌ [GROUP IMAGE] Error uploading group image:', error);
    throw error;
  }
});

/**
 * @desc    Update group chat info
 * @route   PUT /api/group-chats/:groupId
 * @access  Private
 */
const updateGroupChat = asyncHandler(async (req, res) => {
  const { groupId } = req.params;
  const { groupName, description, groupImage, settings } = req.body;
  const userId = req.user.userId;

  try {
    // Check if user is admin
    const membership = await GroupMember.isAdmin(groupId, userId);
    if (!membership) {
      res.status(403);
      throw new Error('Only admins can update group information');
    }

    const updateData = {};
    
    if (groupName !== undefined) {
      if (!groupName || groupName.trim().length === 0) {
        res.status(400);
        throw new Error('Group name cannot be empty');
      }
      updateData.groupName = groupName.trim();
    }
    
    if (description !== undefined) {
      updateData.description = description.trim();
    }
    
    if (groupImage !== undefined) {
      updateData.groupImage = groupImage;
    }
    
    if (settings) {
      updateData.settings = { ...settings };
    }

    updateData.lastActivity = new Date();

    const updatedGroup = await GroupChat.findByIdAndUpdate(
      groupId,
      updateData,
      { new: true, runValidators: true }
    );

    if (!updatedGroup) {
      res.status(404);
      throw new Error('Group chat not found');
    }

    console.log(`📝 [GROUP UPDATE] Group ${groupId} updated by admin ${userId}`);

    // Transform groupImage to full URL
    const imageBaseUrl = process.env.IMAGE_BASE_URL || 'https://api.crackman.in';
    const groupObj = updatedGroup.toObject();
    if (groupObj.groupImage && !groupObj.groupImage.startsWith('http')) {
      groupObj.groupImage = `${imageBaseUrl}${groupObj.groupImage}`;
    }

    res.status(200).json({
      success: true,
      data: groupObj,
      message: 'Group updated successfully'
    });
  } catch (error) {
    console.error('❌ [GROUP UPDATE] Error updating group:', error);
    res.status(500);
    throw new Error('Failed to search messages');
  }
});

/**
 * @desc    Delete a group chat
 * @route   DELETE /api/group-chats/:groupId
 * @access  Private
 */
const deleteGroupChat = asyncHandler(async (req, res) => {
  const { groupId } = req.params;
  const userId = req.user.userId;

  try {
    // Check if group exists
    const group = await GroupChat.findById(groupId);
    if (!group) {
      res.status(404);
      throw new Error('Group chat not found');
    }

    // Check if user is the creator or admin
    const membership = await GroupMember.findOne({ groupId, userId });
    if (!membership || (group.createdBy !== userId && membership.role !== 'admin')) {
      res.status(403);
      throw new Error('Only group creator or admins can delete the group');
    }

    // Delete all group members
    await GroupMember.deleteMany({ groupId });

    // Delete all group messages
    await GroupMessage.deleteMany({ groupId });

    // Delete the group chat
    await GroupChat.findByIdAndDelete(groupId);

    console.log(`🗑️ [GROUP DELETE] Group ${groupId} deleted by ${userId}`);

    res.status(200).json({
      success: true,
      message: 'Group deleted successfully'
    });
  } catch (error) {
    console.error('❌ [GROUP DELETE] Error deleting group:', error);
    res.status(500);
    throw new Error('Failed to delete group');
  }
});

/**
 * @desc    Toggle reaction on group message
 * @route   POST /api/group-chats/:groupId/messages/:messageId/reactions
 * @access  Private
 */
const toggleGroupMessageReaction = asyncHandler(async (req, res) => {
  const { groupId, messageId } = req.params;
  const { emoji } = req.body;
  const userId = req.user.userId;

  try {
    console.log('🎭 [GROUP REACTION] Toggling reaction:', { groupId, messageId, emoji, userId });

    // Validate inputs
    if (!mongoose.Types.ObjectId.isValid(groupId) || !mongoose.Types.ObjectId.isValid(messageId)) {
      res.status(400);
      throw new Error('Invalid group or message ID');
    }

    if (!emoji || typeof emoji !== 'string') {
      res.status(400);
      throw new Error('Valid emoji is required');
    }

    // Check if user is a member of the group
    const membership = await GroupMember.findOne({
      groupId,
      userId,
      isActive: true
    });

    if (!membership) {
      res.status(403);
      throw new Error('You are not a member of this group');
    }

    // Find the message
    const message = await GroupMessage.findOne({
      _id: messageId,
      groupId,
      deletedAt: null
    });

    if (!message) {
      res.status(404);
      throw new Error('Message not found');
    }

    // Get user details for reaction
    const user = await User.findOne({ userId }).select('name');
    const userName = user?.name || 'Unknown User';

    // Check if user already reacted with this emoji
    const existingReactionIndex = message.reactions.findIndex(
      reaction => reaction.userId === userId && reaction.emoji === emoji
    );

    if (existingReactionIndex > -1) {
      // Remove existing reaction
      message.reactions.splice(existingReactionIndex, 1);
      console.log('🎭 [GROUP REACTION] Removed reaction');
    } else {
      // Add new reaction
      message.reactions.push({
        emoji,
        userId,
        userName,
        createdAt: new Date()
      });
      console.log('🎭 [GROUP REACTION] Added reaction');
    }

    await message.save();

    res.status(200).json({
      success: true,
      message: 'Reaction updated successfully',
      data: {
        messageId: message._id,
        reactions: message.reactions
      }
    });

  } catch (error) {
    console.error('❌ [GROUP REACTION] Error toggling reaction:', error);
    res.status(500);
    throw new Error('Failed to toggle reaction');
  }
});

/**
 * @desc    Search messages in group
 * @route   GET /api/group-chats/:groupId/messages/search
 * @access  Private
 */
const searchGroupMessages = asyncHandler(async (req, res) => {
  const { groupId } = req.params;
  const { query, limit = 20, page = 1 } = req.query;
  const userId = req.user.userId;

  try {
    console.log('🔍 [GROUP SEARCH] Searching messages:', { groupId, query, userId });

    // Validate inputs
    if (!mongoose.Types.ObjectId.isValid(groupId)) {
      res.status(400);
      throw new Error('Invalid group ID');
    }

    if (!query || query.trim().length < 2) {
      res.status(400);
      throw new Error('Search query must be at least 2 characters');
    }

    // Check if user is a member of the group
    const membership = await GroupMember.findOne({
      groupId,
      userId,
      isActive: true
    });

    if (!membership) {
      res.status(403);
      throw new Error('You are not a member of this group');
    }

    // Search messages
    const searchResults = await GroupMessage.find({
      groupId,
      deletedAt: null,
      $text: { $search: query.trim() }
    })
    .select('_id messageId senderId senderName message messageType createdAt')
    .sort({ score: { $meta: 'textScore' }, createdAt: -1 })
    .limit(parseInt(limit))
    .skip((parseInt(page) - 1) * parseInt(limit));

    console.log(`🔍 [GROUP SEARCH] Found ${searchResults.length} messages`);

    res.status(200).json({
      success: true,
      data: {
        messages: searchResults,
        totalResults: searchResults.length,
        page: parseInt(page),
        limit: parseInt(limit)
      }
    });

  } catch (error) {
    console.error('❌ [GROUP SEARCH] Error searching messages:', error);
    res.status(500);
    throw new Error('Failed to search group messages');
  }
});

/**
 * @desc    Mute group notifications for current user
 * @route   POST /api/group-chats/:groupId/mute
 * @access  Private
 */
const muteGroupNotifications = asyncHandler(async (req, res) => {
  const { groupId } = req.params;
  const userId = req.user.userId;

  try {
    // Find the group member record
    const member = await GroupMember.findOne({ groupId, userId });
    if (!member) {
      res.status(404);
      throw new Error('You are not a member of this group');
    }

    // Mute notifications
    member.muteNotifications();
    await member.save();

    console.log(`🔇 [GROUP CHAT] User ${userId} muted notifications for group ${groupId}`);

    res.status(200).json({
      success: true,
      message: 'Group notifications muted successfully'
    });
  } catch (error) {
    console.error('❌ [GROUP CHAT] Error muting group notifications:', error);
    res.status(500);
    throw new Error('Failed to mute group notifications');
  }
});

/**
 * @desc    Leave a group
 * @route   POST /api/group-chats/:groupId/leave
 * @access  Private
 */
const leaveGroup = asyncHandler(async (req, res) => {
  const { groupId } = req.params;
  const userId = req.user.userId;

  try {
    // Check if user is a member
    const member = await GroupMember.findOne({ groupId, userId });
    if (!member) {
      res.status(404);
      throw new Error('You are not a member of this group');
    }

    // Check if user is the creator
    const group = await GroupChat.findById(groupId);
    if (!group) {
      res.status(404);
      throw new Error('Group not found');
    }

    if (group.createdBy === userId) {
      res.status(400);
      throw new Error('Group creator cannot leave the group. Transfer ownership first.');
    }

    // Remove the member
    await GroupMember.findOneAndDelete({ groupId, userId });

    // Update group member count
    await GroupChat.findByIdAndUpdate(groupId, {
      $pull: { members: userId, admins: userId },
      $inc: { memberCount: -1 }
    });

    console.log(`🚪 [GROUP CHAT] User ${userId} left group ${groupId}`);

    broadcastMembersChanged(groupId, [userId]);

    res.status(200).json({
      success: true,
      message: 'Successfully left the group'
    });
  } catch (error) {
    console.error('❌ [GROUP CHAT] Error leaving group:', error);
    res.status(500);
    throw new Error('Failed to leave group');
  }
});

/**
 * @desc    Update member role in group
 * @route   PUT /api/group-chats/:groupId/members/:memberId/role
 * @access  Private
 */
const updateMemberRole = asyncHandler(async (req, res) => {
  const { groupId, memberId } = req.params;
  const { role } = req.body;
  const userId = req.user.userId;

  try {
    // Check if user is admin
    const adminMembership = await GroupMember.isAdmin(groupId, userId);
    if (!adminMembership) {
      res.status(403);
      throw new Error('Only admins can update member roles');
    }

    // Validate role
    if (!['member', 'admin'].includes(role)) {
      res.status(400);
      throw new Error('Invalid role. Must be "member" or "admin"');
    }

    // Update member role
    const updatedMember = await GroupMember.findOneAndUpdate(
      { groupId, userId: memberId },
      { role },
      { new: true }
    );

    if (!updatedMember) {
      res.status(404);
      throw new Error('Member not found');
    }

    // Update group admins array if needed
    if (role === 'admin') {
      await GroupChat.findByIdAndUpdate(groupId, {
        $addToSet: { admins: memberId }
      });
    } else {
      await GroupChat.findByIdAndUpdate(groupId, {
        $pull: { admins: memberId }
      });
    }

    console.log(`👑 [GROUP ROLE] Updated ${memberId} role to ${role} in group ${groupId}`);

    res.status(200).json({
      success: true,
      data: updatedMember,
      message: 'Member role updated successfully'
    });
  } catch (error) {
    console.error('❌ [GROUP ROLE] Error updating member role:', error);
    res.status(500);
    throw new Error('Failed to update member role');
  }
});

/**
 * @desc    Health check for group chats API
 * @route   GET /api/group-chats/health
 * @access  Private
 */
const getGroupsHealth = asyncHandler(async (req, res) => {
  try {
    // Basic health check
    const groupCount = await GroupChat.countDocuments();
    const memberCount = await GroupMember.countDocuments();
    const messageCount = await GroupMessage.countDocuments();

    res.status(200).json({
      success: true,
      message: 'Group chats API is healthy',
      data: {
        totalGroups: groupCount,
        totalMembers: memberCount,
        totalMessages: messageCount,
        timestamp: new Date().toISOString()
      }
    });
  } catch (error) {
    console.error('❌ [GROUP HEALTH] Health check failed:', error);
    res.status(500).json({
      success: false,
      message: 'Group chats API health check failed'
    });
  }
});

module.exports = {
  createGroupChat,
  getUserGroupChats,
  getGroupChatDetails,
  updateGroupChat,
  uploadGroupImage,
  deleteGroupChat,
  addGroupMembers,
  markGroupMessagesAsRead,
  removeGroupMember,
  updateMemberRole,
  getGroupMessages,
  sendGroupMessage,
  muteGroupNotifications,
  leaveGroup,
  getGroupsHealth,
  toggleGroupMessageReaction,
  searchGroupMessages
};
