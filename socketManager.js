const socketIO = require('socket.io');
const jwt = require('jsonwebtoken');
const User = require('./models/userModel');
const StatusPrivacy = require('./models/statusPrivacyModel');
const AIMessageService = require('./services/aiMessageService');
const winston = require('winston');

// Configure logger for Socket.IO operations
const socketLogger = winston.createLogger({
  level: 'info',
  format: winston.format.combine(
    winston.format.timestamp(),
    winston.format.json()
  ),
  transports: [
    new winston.transports.File({ filename: 'logs/socket.log' }),
    new winston.transports.Console({
      format: winston.format.combine(
        winston.format.colorize(),
        winston.format.simple()
      )
    })
  ],
});

// Map to store active user socket connections
const userSockets = new Map();
// Map to store user's contacts for quick lookup
const userContactsMap = new Map();
// Connection statistics
const connectionStats = {
  totalConnections: 0,
  activeConnections: 0,
  totalDisconnections: 0,
  authFailures: 0
};

/**
 * Initialize Socket.IO with the HTTP server
 * @param {Object} server - HTTP server instance
 */
const initializeSocketIO = (server) => {
  const io = socketIO(server, {
    // Production-optimized configuration
    cors: {
      origin: process.env.NODE_ENV === 'production' 
        ? process.env.ALLOWED_ORIGINS?.split(',') || false
        : '*',
      methods: ['GET', 'POST'],
      credentials: true
    },
    // Connection settings
    pingTimeout: 60000, // 60 seconds
    pingInterval: 25000, // 25 seconds
    upgradeTimeout: 10000, // 10 seconds
    maxHttpBufferSize: 1e6, // 1MB
    allowEIO3: true, // Allow Engine.IO v3 clients
    
    // Transport settings
    transports: ['websocket', 'polling'],
    allowUpgrades: true,
    
    // Compression
    compression: true,
    
    // Connection state recovery (Socket.IO v4.6+)
    connectionStateRecovery: {
      maxDisconnectionDuration: 2 * 60 * 1000, // 2 minutes
      skipMiddlewares: true,
    }
  });

  // Enhanced authentication middleware with rate limiting
  const authAttempts = new Map();
  
  io.use(async (socket, next) => {
    const clientIP = socket.handshake.address;
    const now = Date.now();
    
    console.log('🔐 WebSocket Authentication Attempt:', {
      clientIP,
      userAgent: socket.handshake.headers['user-agent']?.substring(0, 50),
      socketId: socket.id
    });
    
    // Rate limiting for auth attempts
    const attempts = authAttempts.get(clientIP) || { count: 0, resetTime: now + 60000 };
    
    if (now > attempts.resetTime) {
      attempts.count = 0;
      attempts.resetTime = now + 60000;
    }
    
    if (attempts.count >= 10) { // Max 10 attempts per minute
      connectionStats.authFailures++;
      console.log('❌ Rate limit exceeded for IP:', clientIP);
      return next(new Error('Too many authentication attempts. Please try again later.'));
    }
    
    attempts.count++;
    authAttempts.set(clientIP, attempts);
    
    try {
      const token = socket.handshake.auth.token || socket.handshake.headers.authorization?.replace('Bearer ', '');
      
      console.log('🔍 Token check:', {
        hasAuthToken: !!socket.handshake.auth.token,
        hasHeaderToken: !!socket.handshake.headers.authorization,
        tokenLength: token?.length || 0,
        tokenPrefix: token?.substring(0, 20) + '...'
      });
      
      if (!token) {
        connectionStats.authFailures++;
        console.log('❌ No token provided in auth or headers');
        return next(new Error('Authentication error: Token missing'));
      }
      
      // Verify JWT token
      console.log('🔍 Verifying JWT token...');
      const decoded = jwt.verify(token, process.env.JWT_SECRET);
      console.log('✅ JWT token verified for user ID:', decoded.id);
      
      // Get user from database with minimal fields
      console.log('🔍 Looking up user in database...');
      const user = await User.findById(decoded.id).select('userId name isActive').lean();
      
      if (!user) {
        connectionStats.authFailures++;
        console.log('❌ User not found in database for ID:', decoded.id);
        return next(new Error('Authentication error: User not found'));
      }
      
      console.log('✅ User found:', {
        mongoId: user._id.toString(),
        userId: user.userId,
        name: user.name,
        isActive: user.isActive
      });
      
      // Check if user account is active
      if (user.isActive === false) {
        connectionStats.authFailures++;
        console.log('❌ User account is deactivated:', user.userId);
        return next(new Error('Authentication error: Account deactivated'));
      }
      
      // Attach user to socket
      socket.user = {
        id: user._id,
        userId: user.userId,
        name: user.name
      };
      
      console.log('✅ Authentication successful, user attached to socket:', {
        mongoId: socket.user.id.toString(),
        userId: socket.user.userId,
        name: socket.user.name
      });
      
      // Reset auth attempts on successful authentication
      authAttempts.delete(clientIP);
      
      next();
    } catch (error) {
      connectionStats.authFailures++;
      console.log('❌ Authentication error:', {
        error: error.message,
        stack: error.stack?.split('\n')[0],
        clientIP,
        tokenProvided: !!socket.handshake.auth.token || !!socket.handshake.headers.authorization
      });
      socketLogger.error('Socket authentication error:', {
        error: error.message,
        clientIP,
        userAgent: socket.handshake.headers['user-agent']
      });
      next(new Error('Authentication error: ' + error.message));
    }
  });

  // Connection handler with enhanced logging 
  io.on('connection', async (socket) => {
    console.log('🚀 New WebSocket connection attempt:', {
      socketId: socket.id,
      clientIP: socket.handshake.address,
      userAgent: socket.handshake.headers['user-agent']?.substring(0, 50)
    });
    
    // Validate that socket.user exists (should be set by auth middleware)
    if (!socket.user || !socket.user.id) {
      console.log('❌ Socket connection without proper authentication:', {
        hasSocketUser: !!socket.user,
        hasUserId: !!socket.user?.id,
        socketId: socket.id
      });
      socketLogger.error('Socket connection without proper authentication', {
        socketId: socket.id,
        clientIP: socket.handshake.address,
        userAgent: socket.handshake.headers['user-agent']
      });
      socket.disconnect(true);
      return;
    }
    
    const userObjectId = socket.user.id.toString(); // MongoDB _id
    const userId = socket.user.userId; // Actual userId field
    const userName = socket.user.name || 'Unknown';
    
    console.log('✅ Socket user validation passed:', {
      userObjectId,
      userId,
      userName,
      socketId: socket.id
    });
    
    // Update connection statistics
    connectionStats.totalConnections++;
    connectionStats.activeConnections++;
    
    // Store user socket connection using userId (NOT MongoDB _id)
    userSockets.set(userId, socket);
    console.log(`🔗 User connected with userId: ${userId} (ObjectId: ${userObjectId})`);
    
    console.log(`🔗 User connected: ${userName} (ObjectId: ${userId})`);
    console.log(`📊 Total active connections: ${connectionStats.activeConnections}`);
    console.log('🗂️ Current connected users:', Array.from(userSockets.keys()));
    
    socketLogger.info(`User connected: ${userName} (${userId})`, {
      socketId: socket.id,
      userId,
      userName,
      totalActive: connectionStats.activeConnections
    });
    
    // 🤖 AI-to-AI Communication: Set AI online
    try {
      await AIMessageService.setAIOnline(userId, socket.id);
    } catch (error) {
      console.error('Error setting AI online:', error);
    }
    
    // Cache user's contacts for quick lookup during status broadcasts
    try {
      const user = await User.findById(socket.user.id).select('contacts').lean();
      if (user && user.contacts) {
        userContactsMap.set(userId, new Set(user.contacts.map(id => id.toString())));
        console.log(`📋 Cached ${user.contacts.length} contacts for user ${userName}`);
      } else {
        console.log(`📋 No contacts found for user ${userName}`);
        userContactsMap.set(userId, new Set()); // Set empty set to prevent undefined errors
      }
      
      if (user && user.contacts && user.contacts.length > 0) {
        const contactIds = user.contacts.map(id => id.toString());
        userContactsMap.set(userId, new Set(contactIds));
        console.log(`✅ Successfully cached ${contactIds.length} contacts for user ${userId}:`, contactIds);
        
        // Also log the actual contact details for debugging
        const contactDetails = await User.find(
          { _id: { $in: user.contacts } },
          'name phoneNumber userId'
        );
        console.log(`📞 Contact details:`, contactDetails.map(c => ({
          name: c.name,
          phone: c.phoneNumber,
          id: c._id.toString()
        })));
      } else {
        console.log(`⚠️ User ${userId} has no contacts to cache - Reasons:`);
        console.log(`   - User found: ${!!user}`);
        console.log(`   - User has contacts array: ${!!(user && user.contacts)}`);
        console.log(`   - Contacts array length: ${user?.contacts?.length || 0}`);
        userContactsMap.set(userId, new Set()); // Set empty set to avoid undefined
      }
      
      // Send initial status of all contacts to the user
      if (user && user.contacts && user.contacts.length > 0) {
        const contacts = await User.find(
          { _id: { $in: user.contacts } },
          'userId name status customStatus statusUntil'
        );
        
        if (contacts.length > 0) {
          socket.emit('contacts_status_initial', contacts.map(contact => ({
            contactId: contact._id,
            userId: contact.userId,
            name: contact.name,
            status: contact.status,
            customStatus: contact.customStatus,
            statusUntil: contact.statusUntil
          })));
        }
      }
    } catch (error) {
      console.error('Error caching user contacts:', error);
    }
    
    // Handle disconnection with detailed logging
    socket.on('disconnect', (reason) => {
      connectionStats.activeConnections--;
      connectionStats.totalDisconnections++;
      
      // 🤖 AI-to-AI Communication: Set AI offline
      try {
        AIMessageService.setAIOffline(userId);
      } catch (error) {
        console.error('Error setting AI offline:', error);
      }
      
      socketLogger.info('User disconnected', {
        userId,
        userName: socket.user.name,
        socketId: socket.id,
        reason,
        duration: Date.now() - socket.handshake.time,
        totalActive: connectionStats.activeConnections
      });
      
      userSockets.delete(userId);
      userContactsMap.delete(userId);
    });
    
    // Handle connection errors
    socket.on('error', (error) => {
      socketLogger.error('Socket error', {
        userId,
        socketId: socket.id,
        error: error.message,
        stack: error.stack
      });
    });
    
    // Handle transport changes
    socket.conn.on('upgrade', () => {
      socketLogger.info('Transport upgraded', {
        userId,
        socketId: socket.id,
        transport: socket.conn.transport.name
      });
    });
    
    // Handle contact list update
    socket.on('update_contacts', async () => {
      try {
        // Refresh contacts cache when user updates their contacts
        const user = await User.findById(userId);
        if (user && user.contacts) {
          userContactsMap.set(userId, new Set(user.contacts.map(id => id.toString())));
        }
      } catch (error) {
        console.error('Error updating contacts cache:', error);
      }
    });
    
    // 💬 CHAT FEATURES: Typing Indicators
    socket.on('typing_start', async (data) => {
      console.log(`✍️ User ${socket.user.name} started typing to ${data.receiverId}`);
      
      try {
        // Convert receiverId (userId) to MongoDB _id for socket lookup
        const receiver = await User.findOne({ userId: data.receiverId }).select('_id userId name');
        if (!receiver) {
          console.log(`❌ Receiver not found in database: ${data.receiverId}`);
          return;
        }
        
        const receiverObjectId = receiver._id.toString();
        console.log(`🎯 Typing indicator receiver details:`, {
          receiverId: receiver.userId,
          receiverObjectId,
          receiverName: receiver.name
        });
        
        // Broadcast typing indicator to the receiver using MongoDB _id
        const receiverSocket = userSockets.get(receiverObjectId);
        if (receiverSocket && receiverSocket.connected) {
          receiverSocket.emit('typing:start', {
            userId: socket.user.userId,
            senderId: userId,
            name: socket.user.name,
            timestamp: new Date().toISOString()
          });
          console.log(`✅ Typing start successfully broadcasted to ${receiver.name} (${receiverObjectId})`);
        } else {
          console.log(`❌ Receiver ${receiver.name} (${receiverObjectId}) not found or offline`);
        }
      } catch (error) {
        console.error(`❌ Error broadcasting typing start:`, error);
      }
    });
    
    socket.on('typing_stop', async (data) => {
      console.log(`⏹️ User ${socket.user.name} stopped typing to ${data.receiverId}`);
      
      try {
        // Convert receiverId (userId) to MongoDB _id for socket lookup
        const receiver = await User.findOne({ userId: data.receiverId }).select('_id userId name');
        if (!receiver) {
          console.log(`❌ Receiver not found in database: ${data.receiverId}`);
          return;
        }
        
        const receiverObjectId = receiver._id.toString();
        console.log(`🎯 Typing stop receiver details:`, {
          receiverId: receiver.userId,
          receiverObjectId,
          receiverName: receiver.name
        });
        
        // Broadcast typing stop to the receiver using MongoDB _id
        const receiverSocket = userSockets.get(receiverObjectId);
        if (receiverSocket && receiverSocket.connected) {
          receiverSocket.emit('typing:stop', {
            userId: socket.user.userId,
            senderId: userId,
            name: socket.user.name,
            timestamp: new Date().toISOString()
          });
          console.log(`✅ Typing stop successfully broadcasted to ${receiver.name} (${receiverObjectId})`);
        } else {
          console.log(`❌ Receiver ${receiver.name} (${receiverObjectId}) not found or offline`);
        }
      } catch (error) {
        console.error(`❌ Error broadcasting typing stop:`, error);
      }
    });
    
    // Note: Client-side 'message:send' socket path is deprecated.
    // New messages are sent via REST controller, which persists and broadcasts.
    
    // 💬 CHAT FEATURES: Message Status Updates
    socket.on('message:delivered', (data) => {
      console.log(`✅ Message ${data.messageId} delivered`);
      
      // Notify sender that message was delivered
      const senderSocket = userSockets.get(data.senderId.toString());
      if (senderSocket && senderSocket.connected) {
        senderSocket.emit('message:delivered', {
          messageId: data.messageId,
          timestamp: new Date().toISOString()
        });
      }
    });
    
    socket.on('message:read', (data) => {
      console.log(`👁️ Message ${data.messageId} read`);
      
      // Notify sender that message was read
      const senderSocket = userSockets.get(data.senderId.toString());
      if (senderSocket && senderSocket.connected) {
        senderSocket.emit('message:read', {
          messageId: data.messageId,
          readBy: userId,
          timestamp: new Date().toISOString()
        });
      }
    });
    
    // 🤖 AI-to-AI Communication: Handle incoming AI messages
    socket.on('ai_message_received', async (data) => {
      console.log(`🤖 AI message received for user ${userId}:`, {
        fromAI: data.fromAI?.name,
        messageType: data.messageType,
        conversationId: data.conversationId
      });
      
      try {
        // Process the AI message and generate response
        if (data.requiresResponse) {
          await AIMessageService.generateInstantResponse(userId, data);
        }
        
        // Forward to frontend for UI display
        socket.emit('ai_conversation_update', {
          type: 'new_message',
          conversation: data,
          timestamp: new Date()
        });
        
      } catch (error) {
        console.error('Error processing AI message:', error);
        socket.emit('ai_message_error', {
          conversationId: data.conversationId,
          error: 'Failed to process AI message'
        });
      }
    });
    
    // 🤖 AI-to-AI Communication: Handle AI response received
    socket.on('ai_response_received', (data) => {
      console.log(`🤖 AI response received for user ${userId}:`, {
        fromAI: data.fromAI?.name,
        conversationId: data.conversationId
      });
      
      // Forward to frontend for UI display
      socket.emit('ai_conversation_update', {
        type: 'response_received',
        conversation: data,
        timestamp: new Date()
      });
    });
    
    // Handle user disconnection
    socket.on('disconnect', (reason) => {
      console.log(`🔌 User disconnected: ${userName} (${userId})`, {
        reason,
        socketId: socket.id,
        duration: Date.now() - socket.handshake.time
      });
      
      // 🤖 AI-to-AI Communication: Set AI offline
      try {
        AIMessageService.setAIOffline(userId);
      } catch (error) {
        console.error('Error setting AI offline:', error);
      }
      
      // Remove user from connected users map
      userSockets.delete(userId);
      userContactsMap.delete(userId);
      
      // Update connection statistics
      connectionStats.activeConnections = Math.max(0, connectionStats.activeConnections - 1);
      connectionStats.totalDisconnections++;
      
      console.log(`📊 Updated connection stats:`, {
        activeConnections: connectionStats.activeConnections,
        totalDisconnections: connectionStats.totalDisconnections
      });
      console.log('🗂️ Remaining connected users:', Array.from(userSockets.keys()));
      
      socketLogger.info(`User disconnected: ${userName} (${userId})`, {
        reason,
        socketId: socket.id,
        activeConnections: connectionStats.activeConnections
      });
    });
  });

  // Periodic cleanup and statistics logging
  setInterval(() => {
    // Clean up stale auth attempts
    const now = Date.now();
    for (const [ip, attempts] of authAttempts.entries()) {
      if (now > attempts.resetTime) {
        authAttempts.delete(ip);
      }
    }
    
    // Log connection statistics (only in development)
    if (process.env.NODE_ENV !== 'production') {
      socketLogger.info('Connection Statistics', connectionStats);
    }
  }, 300000); // Every 5 minutes
  
  // Graceful shutdown handler
  const gracefulShutdown = () => {
    socketLogger.info('Shutting down Socket.IO server...');
    
    // Notify all connected clients
    io.emit('server_shutdown', { message: 'Server is shutting down for maintenance' });
    
    // Close all connections
    io.close(() => {
      socketLogger.info('Socket.IO server closed');
    });
  };
  
  process.on('SIGTERM', gracefulShutdown);
  process.on('SIGINT', gracefulShutdown);
  
  socketLogger.info('Socket.IO initialized', {
    transports: ['websocket', 'polling'],
    cors: process.env.NODE_ENV === 'production' ? 'restricted' : 'open',
    compression: true
  });
  
  return io;
};

/**
 * Broadcast a message/event to a specific user by their userId
 * @param {string} userId - User ID to broadcast to
 * @param {string} event - Event name to emit
 * @param {Object} data - Data to send with the event
 */
const broadcastToUser = (userId, event, data) => {
  try {
    const userIdString = userId.toString();
    
    // Debug: Show all connected users for comparison
    const connectedUsers = Array.from(userSockets.keys());
    console.log(`🔍 Broadcasting ${event} to user: ${userIdString}`);
    console.log(`🔍 Currently connected users (${connectedUsers.length}):`, connectedUsers);
    
    const socket = userSockets.get(userIdString);
    
    if (socket && socket.connected) {
      console.log(`📨 Broadcasting ${event} to user ${userIdString}`);
      console.log(`📨 Broadcasting new message from ${socket.user?.name || 'Unknown'}`);
      socket.emit(event, data);
      return true;
    } else {
      console.log(`❌ Message receiver ${userIdString} not found or offline.`);
      
      // Additional debugging: Check if socket exists but is disconnected
      if (socket) {
        console.log(`🔍 Socket exists but connected status: ${socket.connected}`);
      } else {
        console.log(`🔍 No socket found for user ${userIdString}`);
      }
      
      return false;
    }
  } catch (error) {
    console.error('❌ Error broadcasting to user:', error);
    return false;
  }
};

/**
 * Broadcast status update to all users who have this user in their contacts
 * @param {Object} user - User who updated their status
 * @param {Object} statusData - New status data
 */
const broadcastStatusUpdate = async (user, statusData) => {
  try {
    const userIdString = user._id.toString();
    
    console.log(`🔍 Finding users to notify for status update from ${user.name} (${userIdString})`);
    console.log(`📊 Current userContactsMap has ${userContactsMap.size} entries`);
    console.log(`🔌 Current userSockets has ${userSockets.size} connected users`);
    
    // Use cached contacts if available for better performance
    let usersToNotify = [];
    
    // Find all users who have this user in their contacts
    for (const [recipientId, contacts] of userContactsMap.entries()) {
      console.log(`🔍 Checking user ${recipientId} with ${contacts.size} contacts`);
      if (contacts.has(userIdString)) {
        console.log(`✅ User ${recipientId} has ${userIdString} in their contacts`);
        usersToNotify.push(recipientId);
      }
    }
    
    console.log(`📋 Found ${usersToNotify.length} users from cache`);
    
    // Always also check database to ensure we don't miss anyone
    // (in case cache is incomplete or stale)
    try {
      console.log(`🔍 Querying database for users who have ${userIdString} in their contacts or appConnections...`);
      
      // Query for both contacts and appConnections
      const dbUsers = await User.find({
        $or: [
          { contacts: user._id },
          { 'appConnections.userId': user.userId }
        ]
      }, '_id name phoneNumber contacts appConnections');
      
      console.log(`🔍 Database query: User.find({ $or: [{ contacts: ${user._id} }, { 'appConnections.userId': '${user.userId}' }] })`);
      console.log(`🔍 Raw database results:`, dbUsers.map(u => ({
        id: u._id.toString(),
        name: u.name,
        phone: u.phoneNumber,
        contactsCount: u.contacts?.length || 0,
        appConnectionsCount: u.appConnections?.length || 0,
        hasTargetUserInContacts: u.contacts?.some(c => c.toString() === userIdString),
        hasTargetUserInAppConnections: u.appConnections?.some(ac => ac.userId === user.userId)
      })));
      
      const dbUserIds = dbUsers.map(u => u._id.toString());
      
      console.log(`📋 Found ${dbUserIds.length} users from database:`, dbUserIds);
      
      // Also check if there are any users in the database at all
      const totalUsers = await User.countDocuments({});
      const usersWithContacts = await User.countDocuments({ contacts: { $exists: true, $ne: [] } });
      console.log(`📊 Database stats: Total users: ${totalUsers}, Users with contacts: ${usersWithContacts}`);
      
      // Merge cache results with database results (remove duplicates)
      const allUsersToNotify = [...new Set([...usersToNotify, ...dbUserIds])];
      usersToNotify = allUsersToNotify;
      
      console.log(`📋 Total unique users to notify: ${usersToNotify.length}`);
    } catch (dbError) {
      console.error('❌ Error querying database for contacts:', dbError);
      // Continue with cache results if database query fails
    }
    
    console.log(`📢 Broadcasting status update for ${user.name} to ${usersToNotify.length} users`);
    
    // 🔒 PRIVACY CHECK: Filter users based on privacy settings
    console.log(`🔒 Checking privacy settings for status broadcast...`);
    console.log(`🔒 Status user details: ID=${userIdString}, Name=${user.name}, Phone=${user.phoneNumber}`);
    let authorizedUsers = [];
    
    for (const recipientId of usersToNotify) {
      try {
        console.log(`🔒 Checking privacy for recipient: ${recipientId}`);
        
        // Get recipient details for debugging
        const recipient = await User.findById(recipientId).select('name phoneNumber userId');
        console.log(`🔒 Recipient details: ID=${recipientId}, Name=${recipient?.name}, Phone=${recipient?.phoneNumber}, UserId=${recipient?.userId}`);
        
        // userIdString is already the MongoDB ObjectId string (user._id.toString())
        const statusOwnerObjectId = userIdString;
        
        const canSeeStatus = await StatusPrivacy.canUserSeeStatus(statusOwnerObjectId, recipientId);
        console.log(`🔒 Privacy check result - User ${recipientId} (${recipient?.name}) can see ${statusOwnerObjectId} (${user.name})'s status: ${canSeeStatus}`);
        
        if (canSeeStatus) {
          authorizedUsers.push(recipientId);
          console.log(`✅ Authorized: ${recipient?.name} can see ${user.name}'s status`);
        } else {
          console.log(`🚫 Privacy denied - ${recipient?.name} cannot see ${user.name}'s status`);
        }
      } catch (privacyError) {
        console.error(`❌ Error checking privacy for user ${recipientId}:`, privacyError);
        console.error(`❌ Privacy error details:`, privacyError.message);
        // On error, deny access for safety
      }
    }
    
    console.log(`🔒 Privacy filtering: ${usersToNotify.length} potential recipients → ${authorizedUsers.length} authorized recipients`);
    
    // Broadcast to each authorized user with multiple event types for better compatibility
    let successfulBroadcasts = 0;
    
    for (const recipientId of authorizedUsers) {
      try {
        // Convert MongoDB ObjectId to userId for socket lookup
        const recipient = await User.findById(recipientId).select('userId');
        const recipientUserId = recipient?.userId;
        
        if (!recipientUserId) {
          console.log(`❌ Could not find userId for recipient ${recipientId}`);
          continue;
        }
        
        console.log(`🔍 Looking up socket for recipient: ObjectId=${recipientId}, userId=${recipientUserId}`);
        const socket = userSockets.get(recipientUserId); // Use userId for socket lookup
        
        if (socket && socket.connected) {
          console.log(`✅ Emitting status update to authorized user ${recipientId} (userId: ${recipientUserId})`);
          
          const statusUpdateData = {
            contactId: user._id,
            userId: user.userId,
            phoneNumber: user.phoneNumber,
            name: user.name,
            status: statusData.status,
            customStatus: statusData.customStatus,
            statusUntil: statusData.statusUntil,
            statusLocation: statusData.statusLocation,
            timestamp: new Date().toISOString()
          };
          
          // Emit multiple event types to ensure frontend receives the update
          socket.emit('contact_status_update', statusUpdateData);
          socket.emit('status_update', statusUpdateData);
          socket.emit('user_status_update', statusUpdateData);
          socket.emit('contact_status_changed', statusUpdateData);
          
          successfulBroadcasts++;
        } else {
          console.log(`❌ User ${recipientId} (userId: ${recipientUserId}) socket not found or disconnected`);
        }
      } catch (lookupError) {
        console.error(`❌ Error looking up socket for user ${recipientId}:`, lookupError);
      }
    }
    
    console.log(`📊 Successfully broadcast to ${successfulBroadcasts}/${authorizedUsers.length} authorized users`);
    
  } catch (error) {
    console.error('❌ Error broadcasting status update:', error);
  }
};

/**
 * Update a user's contacts cache when they add or remove contacts
 * @param {string} userId - MongoDB ObjectId of the user
 */
const refreshUserContacts = async (userId) => {
  try {
    const userIdString = userId.toString();
    if (!userSockets.has(userIdString)) {
      return; // User not connected, no need to update cache
    }
    
    const user = await User.findById(userId);
    if (user && user.contacts) {
      userContactsMap.set(userIdString, new Set(user.contacts.map(id => id.toString())));
      console.log(`Refreshed contacts cache for user ${userIdString}`);
    }
  } catch (error) {
    console.error('Error refreshing user contacts cache:', error);
  }
};

// Export functions and data for use in other controllers
module.exports = {
  initializeSocketIO,
  broadcastStatusUpdate,
  refreshUserContacts,
  getUserSockets: () => userSockets,
  broadcastToUser: (userId, event, data) => {
    try {
      const userIdString = userId.toString();
      const socket = userSockets.get(userIdString);
      
      if (socket && socket.connected) {
        console.log(`📨 Broadcasting ${event} to user ${userIdString}`);
        socket.emit(event, data);
        return true;
      } else {
        console.log(`❌ User ${userIdString} not found or offline`);
        return false;
      }
    } catch (error) {
      console.error('❌ Error broadcasting to user:', error);
      return false;
    }
  }
};
