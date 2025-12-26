const socketIO = require('socket.io');
const jwt = require('jsonwebtoken');
const { v4: uuidv4 } = require('uuid');
const User = require('./models/userModel');
const Friend = require('./models/Friend');
const StatusPrivacy = require('./models/statusPrivacyModel');
const Call = require('./models/callModel');
const AIMessageService = require('./services/aiMessageService');
const AISocketService = require('./services/aiSocketService');
const { connectionLogger } = require('./utils/loggerSetup');

// Use the enhanced logging system
const socketLogger = connectionLogger;

// Map to store active user socket connections
const userSockets = new Map();
// Map to store user's contacts for quick lookup
const userContactsMap = new Map();
// Enhanced connection statistics with analytics
const connectionStats = {
  totalConnections: 0,
  activeConnections: 0,
  totalDisconnections: 0,
  authFailures: 0,
  messagesSent: 0,
  messagesReceived: 0,
  messageDeliveryCount: 0,
  averageDeliveryTime: 0,
  notificationClicks: 0,
  notificationDismissals: 0,
  healthChecks: 0,
  averagePingTime: 0,
  startTime: Date.now()
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

  // Initialize AI Socket Service
  const aiSocketService = new AISocketService();
  aiSocketService.initialize(io);

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
    console.log(`\n${'='.repeat(80)}`);
    console.log(`🔗 [USER CONNECTED] User registered in userSockets Map`);
    console.log(`🔗 [USER CONNECTED] Name: ${userName}`);
    console.log(`🔗 [USER CONNECTED] UserId: ${userId}`);
    console.log(`🔗 [USER CONNECTED] MongoDB ObjectId: ${userObjectId}`);
    console.log(`🔗 [USER CONNECTED] Socket ID: ${socket.id}`);
    console.log(`📊 [USER CONNECTED] Total active connections: ${connectionStats.activeConnections}`);
    console.log(`🗂️ [USER CONNECTED] All connected userIds:`, Array.from(userSockets.keys()));
    console.log(`🗂️ [USER CONNECTED] userSockets Map size: ${userSockets.size}`);
    console.log(`${'='.repeat(80)}\n`);
    
    socketLogger.info(`User connected: ${userName} (${userId})`, {
      socketId: socket.id,
      userId,
      userName,
      totalActive: connectionStats.activeConnections
    });
    
    // ✅ Set user as online in database
    try {
      await User.findByIdAndUpdate(userObjectId, {
        isOnline: true,
        lastSeen: new Date(),
        socketId: socket.id
      });
      console.log(`✅ [ONLINE STATUS] User ${userName} set to ONLINE`);
    } catch (error) {
      console.error('❌ [ONLINE STATUS] Error setting user online:', error);
    }
    
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
      
      // ✅ Broadcast online status to user's contacts
      if (user && user.contacts && user.contacts.length > 0) {
        console.log(`📢 [ONLINE STATUS] Broadcasting ONLINE status to ${user.contacts.length} contacts`);
        
        for (const contactId of user.contacts) {
          const contactUserId = await User.findById(contactId).select('userId');
          if (contactUserId && contactUserId.userId) {
            const contactSocket = userSockets.get(contactUserId.userId);
            if (contactSocket && contactSocket.connected) {
              contactSocket.emit('contact_online_status', {
                userId: userId,
                isOnline: true,
                lastSeen: new Date()
              });
              console.log(`✅ [ONLINE STATUS] Notified contact ${contactUserId.userId} that ${userName} is ONLINE`);
            }
          }
        }
      }
      
      // Send initial status of all contacts to the user
      if (user && user.contacts && user.contacts.length > 0) {
        const contacts = await User.find(
          { _id: { $in: user.contacts } },
          'userId name status customStatus statusUntil isOnline lastSeen'
        );
        
        if (contacts.length > 0) {
          socket.emit('contacts_status_initial', contacts.map(contact => ({
            contactId: contact._id,
            userId: contact.userId,
            name: contact.name,
            status: contact.status,
            customStatus: contact.customStatus,
            statusUntil: contact.statusUntil,
            isOnline: contact.isOnline,
            lastSeen: contact.lastSeen
          })));
        }
      }
    } catch (error) {
      console.error('Error caching user contacts:', error);
    }
    
    // Handle disconnection with detailed logging
    socket.on('disconnect', async (reason) => {
      connectionStats.activeConnections--;
      connectionStats.totalDisconnections++;
      
      // ✅ Set user as offline in database
      try {
        await User.findByIdAndUpdate(userObjectId, {
          isOnline: false,
          lastSeen: new Date(),
          socketId: null
        });
        console.log(`✅ [ONLINE STATUS] User ${userName} set to OFFLINE`);
        
        // ✅ Broadcast offline status to user's contacts
        const user = await User.findById(userObjectId).select('contacts');
        if (user && user.contacts && user.contacts.length > 0) {
          console.log(`📢 [ONLINE STATUS] Broadcasting OFFLINE status to ${user.contacts.length} contacts`);
          
          for (const contactId of user.contacts) {
            const contactUserId = await User.findById(contactId).select('userId');
            if (contactUserId && contactUserId.userId) {
              const contactSocket = userSockets.get(contactUserId.userId);
              if (contactSocket && contactSocket.connected) {
                contactSocket.emit('contact_online_status', {
                  userId: userId,
                  isOnline: false,
                  lastSeen: new Date()
                });
                console.log(`✅ [ONLINE STATUS] Notified contact ${contactUserId.userId} that ${userName} is OFFLINE`);
              }
            }
          }
        }
      } catch (error) {
        console.error('❌ [ONLINE STATUS] Error setting user offline:', error);
      }
      
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
    
    // ✅ WhatsApp-style Heartbeat Mechanism
    // Client pings every 30 seconds to indicate they're active
    socket.on('user:heartbeat', async () => {
      console.log(`💓 [HEARTBEAT] *** RECEIVED *** from ${userName} (${userId})`);
      try {
        // Update lastSeen timestamp
        const result = await User.findByIdAndUpdate(userObjectId, {
          lastSeen: new Date(),
          isOnline: true
        });
        
        if (result) {
          console.log(`✅ [HEARTBEAT] Database updated for ${userName}`);
        } else {
          console.error(`❌ [HEARTBEAT] User not found in database: ${userObjectId}`);
        }
        
        // Acknowledge heartbeat
        socket.emit('heartbeat:ack', { timestamp: new Date() });
        console.log(`✅ [HEARTBEAT] ACK sent to ${userName}`);
        
        // Optional: Log every 10th heartbeat to avoid spam
        if (!socket.heartbeatCount) socket.heartbeatCount = 0;
        socket.heartbeatCount++;
        if (socket.heartbeatCount % 10 === 0) {
          console.log(`💓 [HEARTBEAT] User ${userName} active (${socket.heartbeatCount} heartbeats)`);
        }
      } catch (error) {
        console.error('❌ [HEARTBEAT] Error updating lastSeen:', error);
        console.error('❌ [HEARTBEAT] Error details:', error.message);
        console.error('❌ [HEARTBEAT] Stack:', error.stack);
      }
    });
    
    // Handle user registration event from frontend
    socket.on('user:register', async (data) => {
      try {
        console.log('🔌 [SOCKET] Manual user registration request:', data);
        
        // Confirm registration
        socket.emit('user:registered', {
          success: true,
          userId: userId,
          message: 'User successfully registered with socket'
        });
        
        console.log('✅ [SOCKET] Manual user registration confirmed for:', userId);
      } catch (error) {
        console.error('❌ [SOCKET] Error in manual user registration:', error);
        socket.emit('user:registered', {
          success: false,
          userId: userId,
          message: 'Registration failed: ' + error.message
        });
      }
    });

    // 📱 DEVICE REGISTRATION: Register device token for background notifications
    socket.on('device:register', async (data) => {
      try {
        const { deviceToken, platform } = data;
        
        console.log('📱 [DEVICE] Device registration request:', {
          userId,
          userName,
          deviceToken: deviceToken?.substring(0, 20) + '...',
          platform
        });
        
        if (!deviceToken || !platform) {
          throw new Error('Device token and platform are required');
        }
        
        // Update user with device token
        const user = await User.findById(socket.user.id);
        
        if (!user) {
          throw new Error('User not found');
        }
        
        // Check if device token already exists
        const existingTokenIndex = user.deviceTokens.findIndex(
          dt => dt.token === deviceToken
        );
        
        if (existingTokenIndex >= 0) {
          // Update existing token
          user.deviceTokens[existingTokenIndex].lastActive = new Date();
          user.deviceTokens[existingTokenIndex].isActive = true;
          console.log('📱 [DEVICE] Updated existing device token');
        } else {
          // Add new device token
          user.deviceTokens.push({
            token: deviceToken,
            platform,
            lastActive: new Date(),
            isActive: true,
            registeredAt: new Date()
          });
          console.log('📱 [DEVICE] Added new device token');
        }
        
        await user.save();
        
        // Confirm registration
        socket.emit('device:registered', {
          success: true,
          deviceToken,
          message: 'Device successfully registered'
        });
        
        console.log('✅ [DEVICE] Device registration successful:', {
          userId,
          totalDevices: user.deviceTokens.length
        });
        
      } catch (error) {
        console.error('❌ [DEVICE] Device registration error:', error);
        socket.emit('device:registered', {
          success: false,
          message: 'Device registration failed: ' + error.message
        });
      }
    });

    // Handle contact list update
    socket.on('update_contacts', async () => {
      try {
        // Refresh contacts cache when user updates their contacts
        const user = await User.findById(socket.user.id);
        if (user && user.contacts) {
          userContactsMap.set(userId, new Set(user.contacts.map(id => id.toString())));
        }
      } catch (error) {
        console.error('Error updating contacts cache:', error);
      }
    });

    // 🔒 PRIVACY MODE FEATURES: Ghost Mode and Timer Mode
    
    // Ghost Mode - Entered
    socket.on('ghost-mode-entered', async (data) => {
      console.log(`\n${'='.repeat(80)}`);
      console.log(`👻 [GHOST MODE ENTER] Received request from ${userName} (${userId})`);
      console.log(`👻 [GHOST MODE ENTER] Request data:`, JSON.stringify(data, null, 2));
      
      try {
        const { chatId, sessionId } = data;
        
        if (!chatId) {
          console.error(`❌ [GHOST MODE ENTER] Missing chatId in request data`);
          return;
        }
        
        console.log(`👻 [GHOST MODE ENTER] Looking up other user with userId: ${chatId}`);
        console.log(`👻 [GHOST MODE ENTER] Current userSockets Map size: ${userSockets.size}`);
        console.log(`👻 [GHOST MODE ENTER] All connected userIds:`, Array.from(userSockets.keys()));
        
        // Find the other user (chatId is the other user's userId)
        const otherUser = await User.findOne({ userId: chatId }).select('_id userId name');
        if (!otherUser) {
          console.error(`❌ [GHOST MODE ENTER] Other user not found in database: ${chatId}`);
          console.log(`❌ [GHOST MODE ENTER] Available userIds in userSockets:`, Array.from(userSockets.keys()));
          return;
        }
        
        console.log(`👻 [GHOST MODE ENTER] Found other user: ${otherUser.name} (userId: ${otherUser.userId})`);
        console.log(`👻 [GHOST MODE ENTER] Checking socket connection for ${otherUser.userId}...`);
        console.log(`👻 [GHOST MODE ENTER] Does userSockets have this userId?`, userSockets.has(otherUser.userId));
        
        // Notify the other user
        const otherUserSocket = userSockets.get(otherUser.userId);
        if (otherUserSocket && otherUserSocket.connected) {
          const payload = {
            chatId: userId, // The user who entered ghost mode
            userId: userId,
            sessionId: sessionId,
            userName: userName
          };
          console.log(`👻 [GHOST MODE ENTER] Emitting to ${otherUser.name} with payload:`, JSON.stringify(payload, null, 2));
          otherUserSocket.emit('ghost-mode-entered', payload);
          console.log(`✅ [GHOST MODE ENTER] Successfully notified ${otherUser.name}`);
        } else {
          console.error(`❌ [GHOST MODE ENTER] Other user ${otherUser.name} not connected or socket not found`);
          console.log(`❌ [GHOST MODE ENTER] Socket exists: ${!!otherUserSocket}, Connected: ${otherUserSocket?.connected}`);
        }
        console.log(`${'='.repeat(80)}\n`);
      } catch (error) {
        console.error('❌ [GHOST MODE ENTER] Error handling ghost-mode-entered:', error);
        console.error('❌ [GHOST MODE ENTER] Error stack:', error.stack);
        console.log(`${'='.repeat(80)}\n`);
      }
    });
    
    // Ghost Mode - Exited
    socket.on('ghost-mode-exited', async (data) => {
      console.log(`\n${'='.repeat(80)}`);
      console.log(`👻 [GHOST MODE EXIT] Received request from ${userName} (${userId})`);
      console.log(`👻 [GHOST MODE EXIT] Request data:`, JSON.stringify(data, null, 2));
      
      try {
        const { chatId, sessionId } = data;
        
        if (!chatId) {
          console.error(`❌ [GHOST MODE EXIT] Missing chatId in request data`);
          return;
        }
        
        console.log(`👻 [GHOST MODE EXIT] Looking up other user with userId: ${chatId}`);
        
        // Find the other user
        const otherUser = await User.findOne({ userId: chatId }).select('_id userId name');
        if (!otherUser) {
          console.error(`❌ [GHOST MODE EXIT] Other user not found in database: ${chatId}`);
          console.log(`❌ [GHOST MODE EXIT] Available userIds in userSockets:`, Array.from(userSockets.keys()));
          return;
        }
        
        console.log(`👻 [GHOST MODE EXIT] Found other user: ${otherUser.name} (userId: ${otherUser.userId})`);
        console.log(`👻 [GHOST MODE EXIT] Checking socket connection for ${otherUser.userId}...`);
        
        // Notify the other user
        const otherUserSocket = userSockets.get(otherUser.userId);
        if (otherUserSocket && otherUserSocket.connected) {
          const payload = {
            chatId: userId, // The user who exited ghost mode
            userId: userId,
            sessionId: sessionId,
            userName: userName
          };
          console.log(`👻 [GHOST MODE EXIT] Emitting to ${otherUser.name} with payload:`, JSON.stringify(payload, null, 2));
          otherUserSocket.emit('ghost-mode-exited', payload);
          console.log(`✅ [GHOST MODE EXIT] Successfully notified ${otherUser.name} about exit`);
        } else {
          console.error(`❌ [GHOST MODE EXIT] Other user ${otherUser.name} not connected or socket not found`);
          console.log(`❌ [GHOST MODE EXIT] Socket exists: ${!!otherUserSocket}, Connected: ${otherUserSocket?.connected}`);
        }
        console.log(`${'='.repeat(80)}\n`);
      } catch (error) {
        console.error('❌ [GHOST MODE EXIT] Error handling ghost-mode-exited:', error);
        console.error('❌ [GHOST MODE EXIT] Error stack:', error.stack);
        console.log(`${'='.repeat(80)}\n`);
      }
    });
    
    // Timer Mode - Activated
    socket.on('timer-mode-activated', async (data) => {
      console.log(`\n${'='.repeat(80)}`);
      console.log(`⏳ [TIMER MODE ACTIVATE] Received request from ${userName} (${userId})`);
      console.log(`⏳ [TIMER MODE ACTIVATE] Request data:`, JSON.stringify(data, null, 2));
      
      try {
        const { chatId, timerDuration } = data;
        
        if (!chatId) {
          console.error(`❌ [TIMER MODE ACTIVATE] Missing chatId in request data`);
          return;
        }
        
        if (!timerDuration) {
          console.error(`❌ [TIMER MODE ACTIVATE] Missing timerDuration in request data`);
          return;
        }
        
        console.log(`⏳ [TIMER MODE ACTIVATE] Timer duration: ${timerDuration} seconds`);
        console.log(`⏳ [TIMER MODE ACTIVATE] Looking up other user with userId: ${chatId}`);
        console.log(`⏳ [TIMER MODE ACTIVATE] Current userSockets Map size: ${userSockets.size}`);
        console.log(`⏳ [TIMER MODE ACTIVATE] All connected userIds:`, Array.from(userSockets.keys()));
        
        // Find the other user
        const otherUser = await User.findOne({ userId: chatId }).select('_id userId name');
        if (!otherUser) {
          console.error(`❌ [TIMER MODE ACTIVATE] Other user not found in database: ${chatId}`);
          console.log(`❌ [TIMER MODE ACTIVATE] Available userIds in userSockets:`, Array.from(userSockets.keys()));
          return;
        }
        
        console.log(`⏳ [TIMER MODE ACTIVATE] Found other user: ${otherUser.name} (userId: ${otherUser.userId})`);
        console.log(`⏳ [TIMER MODE ACTIVATE] Checking socket connection for ${otherUser.userId}...`);
        console.log(`⏳ [TIMER MODE ACTIVATE] Does userSockets have this userId?`, userSockets.has(otherUser.userId));
        
        // Notify the other user
        const otherUserSocket = userSockets.get(otherUser.userId);
        if (otherUserSocket && otherUserSocket.connected) {
          const payload = {
            chatId: userId, // The user who activated timer mode
            userId: userId,
            timerDuration: timerDuration,
            userName: userName
          };
          console.log(`⏳ [TIMER MODE ACTIVATE] Emitting to ${otherUser.name} with payload:`, JSON.stringify(payload, null, 2));
          otherUserSocket.emit('timer-mode-activated', payload);
          console.log(`✅ [TIMER MODE ACTIVATE] Successfully notified ${otherUser.name}`);
        } else {
          console.error(`❌ [TIMER MODE ACTIVATE] Other user ${otherUser.name} not connected or socket not found`);
          console.log(`❌ [TIMER MODE ACTIVATE] Socket exists: ${!!otherUserSocket}, Connected: ${otherUserSocket?.connected}`);
        }
        console.log(`${'='.repeat(80)}\n`);
      } catch (error) {
        console.error('❌ [TIMER MODE ACTIVATE] Error handling timer-mode-activated:', error);
        console.error('❌ [TIMER MODE ACTIVATE] Error stack:', error.stack);
        console.log(`${'='.repeat(80)}\n`);
      }
    });
    
    // Timer Mode - Deactivated
    socket.on('timer-mode-deactivated', async (data) => {
      console.log(`\n${'='.repeat(80)}`);
      console.log(`⏳ [TIMER MODE DEACTIVATE] Received request from ${userName} (${userId})`);
      console.log(`⏳ [TIMER MODE DEACTIVATE] Request data:`, JSON.stringify(data, null, 2));
      
      try {
        const { chatId } = data;
        
        if (!chatId) {
          console.error(`❌ [TIMER MODE DEACTIVATE] Missing chatId in request data`);
          return;
        }
        
        console.log(`⏳ [TIMER MODE DEACTIVATE] Looking up other user with userId: ${chatId}`);
        
        // Find the other user
        const otherUser = await User.findOne({ userId: chatId }).select('_id userId name');
        if (!otherUser) {
          console.error(`❌ [TIMER MODE DEACTIVATE] Other user not found in database: ${chatId}`);
          console.log(`❌ [TIMER MODE DEACTIVATE] Available userIds in userSockets:`, Array.from(userSockets.keys()));
          return;
        }
        
        console.log(`⏳ [TIMER MODE DEACTIVATE] Found other user: ${otherUser.name} (userId: ${otherUser.userId})`);
        console.log(`⏳ [TIMER MODE DEACTIVATE] Checking socket connection for ${otherUser.userId}...`);
        
        // ✅ CRITICAL FIX: Delete all timer mode messages between these users
        console.log(`🗑️ [TIMER MODE DEACTIVATE] Deleting timer mode messages...`);
        const Message = require('./models/Message');
        
        const timerMessages = await Message.find({
          $or: [
            { senderId: userId, receiverId: chatId, privacyMode: 'timer' },
            { senderId: chatId, receiverId: userId, privacyMode: 'timer' }
          ]
        }).select('_id senderId receiverId message');
        
        const messageIds = timerMessages.map(m => m._id.toString());
        
        console.log(`🗑️ [TIMER MODE DEACTIVATE] Found ${messageIds.length} timer messages to delete`);
        
        if (messageIds.length > 0) {
          // Delete from database
          const deleteResult = await Message.deleteMany({
            _id: { $in: messageIds }
          });
          
          console.log(`✅ [TIMER MODE DEACTIVATE] Deleted ${deleteResult.deletedCount} timer mode messages from database`);
          
          // Notify both users to remove messages from UI
          const notificationData = {
            messageIds: messageIds,
            reason: 'timer_mode_deactivated',
            timestamp: new Date().toISOString()
          };
          
          console.log(`📡 [TIMER MODE DEACTIVATE] Notifying users to remove messages from UI`);
          
          // Emit to current user (who deactivated)
          if (socket && socket.connected) {
            socket.emit('timer-messages-deleted', notificationData);
            console.log(`✅ [TIMER MODE DEACTIVATE] Notified current user (${userId})`);
          }
          
          // Emit to other user
          const otherUserSocket = userSockets.get(otherUser.userId);
          if (otherUserSocket && otherUserSocket.connected) {
            otherUserSocket.emit('timer-messages-deleted', notificationData);
            console.log(`✅ [TIMER MODE DEACTIVATE] Notified other user (${otherUser.userId})`);
          }
        } else {
          console.log(`ℹ️ [TIMER MODE DEACTIVATE] No timer messages found to delete`);
        }
        
        // Notify the other user about deactivation
        const otherUserSocket = userSockets.get(otherUser.userId);
        if (otherUserSocket && otherUserSocket.connected) {
          const payload = {
            chatId: userId, // The user who deactivated timer mode
            userId: userId,
            userName: userName
          };
          console.log(`⏳ [TIMER MODE DEACTIVATE] Emitting to ${otherUser.name} with payload:`, JSON.stringify(payload, null, 2));
          otherUserSocket.emit('timer-mode-deactivated', payload);
          console.log(`✅ [TIMER MODE DEACTIVATE] Successfully notified ${otherUser.name} about deactivation`);
        } else {
          console.error(`❌ [TIMER MODE DEACTIVATE] Other user ${otherUser.name} not connected or socket not found`);
          console.log(`❌ [TIMER MODE DEACTIVATE] Socket exists: ${!!otherUserSocket}, Connected: ${otherUserSocket?.connected}`);
        }
        console.log(`${'='.repeat(80)}\n`);
      } catch (error) {
        console.error('❌ [TIMER MODE DEACTIVATE] Error handling timer-mode-deactivated:', error);
        console.error('❌ [TIMER MODE DEACTIVATE] Error stack:', error.stack);
        console.log(`${'='.repeat(80)}\n`);
      }
    });
    
    // ⏳ Continuous Timer Mode - Activated
    socket.on('continuous-timer-activated', async (data) => {
      console.log(`\n${'='.repeat(80)}`);
      console.log(`🔄 [CONTINUOUS TIMER ACTIVATE] Received request from ${userName} (${userId})`);
      console.log(`🔄 [CONTINUOUS TIMER ACTIVATE] Request data:`, JSON.stringify(data, null, 2));
      
      try {
        const { chatId, timerDuration } = data;
        
        if (!chatId) {
          console.error(`❌ [CONTINUOUS TIMER ACTIVATE] Missing chatId in request data`);
          return;
        }
        
        if (!timerDuration) {
          console.error(`❌ [CONTINUOUS TIMER ACTIVATE] Missing timerDuration in request data`);
          return;
        }
        
        console.log(`🔄 [CONTINUOUS TIMER ACTIVATE] Timer duration: ${timerDuration}ms (${timerDuration / (1000 * 60 * 60)} hours)`);
        
        // Find the other user
        const otherUser = await User.findOne({ userId: chatId }).select('_id userId name');
        if (!otherUser) {
          console.error(`❌ [CONTINUOUS TIMER ACTIVATE] Other user not found in database: ${chatId}`);
          return;
        }
        
        console.log(`🔄 [CONTINUOUS TIMER ACTIVATE] Found other user: ${otherUser.name} (userId: ${otherUser.userId})`);
        
        // Activate continuous timer for both users
        const ContinuousTimerState = require('./models/ContinuousTimerState');
        await ContinuousTimerState.activateForChat(userId, chatId, timerDuration);
        
        console.log(`✅ [CONTINUOUS TIMER ACTIVATE] Continuous timer activated successfully`);
        
        // Notify the other user
        const otherUserSocket = userSockets.get(otherUser.userId);
        if (otherUserSocket && otherUserSocket.connected) {
          const payload = {
            chatId: userId, // The user who activated continuous timer
            userId: userId,
            userName: userName,
            timerDuration: timerDuration
          };
          console.log(`🔄 [CONTINUOUS TIMER ACTIVATE] Emitting to ${otherUser.name} with payload:`, JSON.stringify(payload, null, 2));
          otherUserSocket.emit('continuous-timer-activated', payload);
          console.log(`✅ [CONTINUOUS TIMER ACTIVATE] Successfully notified ${otherUser.name}`);
        } else {
          console.error(`❌ [CONTINUOUS TIMER ACTIVATE] Other user ${otherUser.name} not connected or socket not found`);
        }
        console.log(`${'='.repeat(80)}\n`);
      } catch (error) {
        console.error('❌ [CONTINUOUS TIMER ACTIVATE] Error handling continuous-timer-activated:', error);
        console.error('❌ [CONTINUOUS TIMER ACTIVATE] Error stack:', error.stack);
        console.log(`${'='.repeat(80)}\n`);
      }
    });
    
    // ⏳ Continuous Timer Mode - Deactivated
    socket.on('continuous-timer-deactivated', async (data) => {
      console.log(`\n${'='.repeat(80)}`);
      console.log(`🔄 [CONTINUOUS TIMER DEACTIVATE] Received request from ${userName} (${userId})`);
      console.log(`🔄 [CONTINUOUS TIMER DEACTIVATE] Request data:`, JSON.stringify(data, null, 2));
      
      try {
        const { chatId } = data;
        
        if (!chatId) {
          console.error(`❌ [CONTINUOUS TIMER DEACTIVATE] Missing chatId in request data`);
          return;
        }
        
        // Find the other user
        const otherUser = await User.findOne({ userId: chatId }).select('_id userId name');
        if (!otherUser) {
          console.error(`❌ [CONTINUOUS TIMER DEACTIVATE] Other user not found in database: ${chatId}`);
          return;
        }
        
        console.log(`🔄 [CONTINUOUS TIMER DEACTIVATE] Found other user: ${otherUser.name} (userId: ${otherUser.userId})`);
        
        // Deactivate continuous timer for both users
        const ContinuousTimerState = require('./models/ContinuousTimerState');
        await ContinuousTimerState.deactivateForChat(userId, chatId);
        
        console.log(`✅ [CONTINUOUS TIMER DEACTIVATE] Continuous timer deactivated successfully`);
        
        // Notify the other user
        const otherUserSocket = userSockets.get(otherUser.userId);
        if (otherUserSocket && otherUserSocket.connected) {
          const payload = {
            chatId: userId, // The user who deactivated continuous timer
            userId: userId,
            userName: userName
          };
          console.log(`🔄 [CONTINUOUS TIMER DEACTIVATE] Emitting to ${otherUser.name} with payload:`, JSON.stringify(payload, null, 2));
          otherUserSocket.emit('continuous-timer-deactivated', payload);
          console.log(`✅ [CONTINUOUS TIMER DEACTIVATE] Successfully notified ${otherUser.name}`);
        } else {
          console.error(`❌ [CONTINUOUS TIMER DEACTIVATE] Other user ${otherUser.name} not connected or socket not found`);
        }
        console.log(`${'='.repeat(80)}\n`);
      } catch (error) {
        console.error('❌ [CONTINUOUS TIMER DEACTIVATE] Error handling continuous-timer-deactivated:', error);
        console.error('❌ [CONTINUOUS TIMER DEACTIVATE] Error stack:', error.stack);
        console.log(`${'='.repeat(80)}\n`);
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
    
    // 📞 WEBRTC CALLING FEATURES
    // Track active calls to prevent duplicate calls (shared across all connections)
    const activeCalls = global.activeCalls || (global.activeCalls = new Map());
    
    // Helper function to check if user is on a call
    const isUserOnCall = (checkUserId) => {
      for (const [callId, callData] of activeCalls.entries()) {
        if (callData.callerId === checkUserId || callData.receiverId === checkUserId) {
          return true;
        }
      }
      return false;
    };
    
    // Call initiation
    socket.on('call:initiate', async (data) => {
      console.log(`📞 Call initiation from ${userId} to ${data.receiverId}`);
      
      try {
        const { receiverId, callType, offer } = data;
        
        // Validate call type
        if (!['voice', 'video'].includes(callType)) {
          socket.emit('call:failed', { reason: 'Invalid call type' });
          return;
        }
        
        // Find receiver
        const receiver = await User.findOne({ userId: receiverId }).select('_id userId name profileImage');
        if (!receiver) {
          console.log(`❌ Receiver not found: ${receiverId}`);
          socket.emit('call:failed', { reason: 'User not found' });
          return;
        }
        
        // Check if receiver is online (primary WebSocket)
        const receiverSocket = userSockets.get(receiver.userId);
        const isReceiverOnline = receiverSocket && receiverSocket.connected;
        
        console.log(`🔍 [CALL] Receiver online status:`, {
          receiverId: receiver.userId,
          hasSocket: !!receiverSocket,
          isConnected: receiverSocket?.connected || false,
          deviceTokens: receiver.deviceTokens?.length || 0
        });
        
        // Check if receiver is busy (already on a call)
        if (isUserOnCall(receiver.userId)) {
          console.log(`📞 Receiver ${receiverId} is busy on another call`);
          socket.emit('call:busy', { userId: receiverId });
          return;
        }
        
        // Check if caller is busy
        if (isUserOnCall(userId)) {
          console.log(`📞 Caller ${userId} is already on a call`);
          socket.emit('call:failed', { reason: 'You are already on a call' });
          return;
        }
        
        // Generate unique call ID
        const callId = `call_${Date.now()}_${uuidv4().slice(0, 8)}`;
        
        // Get caller details
        const caller = await User.findOne({ userId }).select('name profileImage');
        
        // Create call record in database
        const call = await Call.create({
          callId,
          callerId: userId,
          callerName: caller?.name || 'Unknown',
          callerAvatar: caller?.profileImage || null,
          receiverId: receiver.userId,
          receiverName: receiver.name,
          receiverAvatar: receiver.profileImage || null,
          callType,
          status: 'ringing',
          offerSDP: offer?.sdp || null
        });
        
        // Track active call with timeout
        const callTimeout = setTimeout(async () => {
          console.log(`⏰ Call ${callId} timed out after 60 seconds`);
          
          const call = await Call.findOne({ callId });
          if (call && call.status === 'ringing') {
            call.status = 'missed';
            call.endTime = new Date();
            call.endReason = 'timeout';
            await call.save();
            
            // Remove from active calls
            activeCalls.delete(callId);
            
            // Notify caller
            const callerSocket = userSockets.get(userId);
            if (callerSocket && callerSocket.connected) {
              callerSocket.emit('call:timeout', { callId });
            }
          }
        }, 60000); // 60 seconds
        
        activeCalls.set(callId, {
          callerId: userId,
          receiverId: receiver.userId,
          startTime: new Date(),
          callType,
          timeoutId: callTimeout
        });
        
        console.log(`✅ Call ${callId} created, notifying receiver ${receiver.name}`);
        
        // Prepare call notification data
        const callNotificationData = {
          callId,
          callerId: userId,
          callerName: caller?.name || 'Unknown',
          callerAvatar: caller?.profileImage || null,
          callType,
          offer
        };
        
        // MULTI-DEVICE NOTIFICATION STRATEGY
        let notificationSent = false;
        
        // Strategy 1: Primary WebSocket (if online)
        if (isReceiverOnline) {
          console.log(`📱 [CALL] Strategy 1: Sending via primary WebSocket`);
          console.log(`📱 [CALL] Receiver socket details:`, {
            socketId: receiverSocket.id,
            connected: receiverSocket.connected,
            userId: receiver.userId,
            eventName: 'call:incoming'
          });
          console.log(`📱 [CALL] Call data being sent:`, {
            callId: callNotificationData.callId,
            callerId: callNotificationData.callerId,
            callerName: callNotificationData.callerName,
            callType: callNotificationData.callType,
            hasOffer: !!callNotificationData.offer
          });
          
          receiverSocket.emit('call:incoming', callNotificationData);
          notificationSent = true;
          
          console.log(`✅ [CALL] call:incoming event emitted to socket ${receiverSocket.id}`);
          console.log(`✅ [CALL] Notification sent via WebSocket to user ${receiver.userId}`);
        }
        
        // Strategy 2: Fallback to all registered devices (if WebSocket failed or as backup)
        const receiverWithDevices = await User.findOne({ userId: receiverId }).select('deviceTokens');
        if (receiverWithDevices && receiverWithDevices.deviceTokens && receiverWithDevices.deviceTokens.length > 0) {
          console.log(`📱 [CALL] Strategy 2: Notifying ${receiverWithDevices.deviceTokens.length} registered device(s)`);
          
          // Emit to all active device tokens (for foreground services)
          receiverWithDevices.deviceTokens.forEach((device, index) => {
            if (device.isActive) {
              console.log(`📱 [CALL] Notifying device ${index + 1}:`, {
                platform: device.platform,
                tokenPreview: device.token.substring(0, 20) + '...',
                lastActive: device.lastActive
              });
              
              // Emit special event for background service
              io.emit(`call:incoming:${device.token}`, callNotificationData);
            }
          });
          
          notificationSent = true;
          console.log(`✅ [CALL] Notification sent to all active devices`);
        }
        
        // Strategy 3: If still no notification sent, mark as offline
        if (!notificationSent) {
          console.log(`❌ [CALL] No notification method available - user truly offline`);
          socket.emit('call:failed', { reason: 'User is offline' });
          
          // Clean up call
          activeCalls.delete(callId);
          clearTimeout(callTimeout);
          
          await Call.findOneAndUpdate(
            { callId },
            { status: 'failed', endTime: new Date(), endReason: 'receiver_offline' }
          );
          
          return;
        }
        
        // Confirm to caller that call is ringing
        socket.emit('call:ringing', {
          callId,
          receiverId: receiver.userId,
          receiverName: receiver.name
        });
        
        console.log(`📞 Call ${callId} is ringing - notification sent successfully`);
        
      } catch (error) {
        console.error('❌ Error initiating call:', error);
        socket.emit('call:failed', { reason: 'Server error' });
      }
    });
    
    // Call answer
    socket.on('call:answer', async (data) => {
      console.log(`📞 [CALL] ===== CALL ANSWER RECEIVED =====`);
      console.log(`📞 [CALL] Call ID: ${data.callId}`);
      console.log(`📞 [CALL] From User: ${userId}`);
      console.log(`📞 [CALL] Answer type: ${data.answer?.type}`);
      console.log(`📞 [CALL] Answer SDP length: ${data.answer?.sdp?.length || 0}`);
      
      try {
        const { callId, answer } = data;
        
        // Validate answer
        if (!answer || !answer.sdp || !answer.type) {
          console.error(`❌ [CALL] Invalid answer received for ${callId}`);
          socket.emit('call:failed', { reason: 'Invalid answer SDP' });
          return;
        }
        
        // Find call record
        const call = await Call.findOne({ callId });
        if (!call) {
          console.log(`❌ Call ${callId} not found`);
          socket.emit('call:failed', { reason: 'Call not found' });
          return;
        }
        
        // Clear timeout
        const activeCall = activeCalls.get(callId);
        if (activeCall && activeCall.timeoutId) {
          clearTimeout(activeCall.timeoutId);
          console.log(`⏰ Call timeout cleared for ${callId}`);
        }
        
        // Update call status
        call.status = 'connected';
        call.startTime = new Date();
        call.answerSDP = answer?.sdp || null;
        await call.save();
        
        console.log(`✅ Call ${callId} connected`);
        
        // Notify caller that call was answered
        const callerSocket = userSockets.get(call.callerId);
        if (callerSocket && callerSocket.connected) {
          callerSocket.emit('call:answered', {
            callId,
            answer
          });
          
          // CRITICAL FIX: Also notify caller that call is connected
          // This allows caller to transition from "connecting" to "connected" state
          callerSocket.emit('call:connected', { callId });
          console.log(`✅ Sent call:connected to caller ${call.callerId}`);
        }
        
        // Confirm to receiver
        socket.emit('call:connected', { callId });
        console.log(`✅ Sent call:connected to receiver ${userId}`);
        
      } catch (error) {
        console.error('❌ Error answering call:', error);
        socket.emit('call:failed', { reason: 'Failed to answer call' });
      }
    });
    
    // Call reject
    socket.on('call:reject', async (data) => {
      console.log(`📞 Call rejected: ${data.callId}`);
      
      try {
        const { callId } = data;
        
        // Find and update call record
        const call = await Call.findOne({ callId });
        if (call) {
          call.status = 'rejected';
          call.endTime = new Date();
          call.endReason = 'rejected';
          await call.save();
          
          // Clear timeout and remove from active calls
          const activeCall = activeCalls.get(callId);
          if (activeCall && activeCall.timeoutId) {
            clearTimeout(activeCall.timeoutId);
          }
          activeCalls.delete(callId);
          
          // Notify caller about rejection
          const callerSocket = userSockets.get(call.callerId);
          if (callerSocket && callerSocket.connected) {
            callerSocket.emit('call:rejected', { callId });
          }
        }
        
      } catch (error) {
        console.error('❌ Error rejecting call:', error);
      }
    });
    
    // Call end
    socket.on('call:end', async (data) => {
      console.log(`📞 Call ended: ${data.callId}`);
      
      try {
        const { callId } = data;
        
        // Find and update call record
        const call = await Call.findOne({ callId });
        if (call) {
          call.status = 'ended';
          call.endTime = new Date();
          call.endReason = 'user_ended';
          call.calculateDuration();
          await call.save();
          
          // Clear timeout and remove from active calls
          const activeCall = activeCalls.get(callId);
          if (activeCall && activeCall.timeoutId) {
            clearTimeout(activeCall.timeoutId);
          }
          activeCalls.delete(callId);
          
          console.log(`✅ Call ${callId} ended, duration: ${call.duration}s`);
          
          // Notify both parties
          const callerId = call.callerId;
          const receiverId = call.receiverId;
          
          [callerId, receiverId].forEach(notifyUserId => {
            if (notifyUserId !== userId) { // Don't notify the user who ended the call
              const userSocket = userSockets.get(notifyUserId);
              if (userSocket && userSocket.connected) {
                userSocket.emit('call:ended', {
                  callId,
                  duration: call.duration,
                  endReason: 'user_ended'
                });
              }
            }
          });
        }
        
      } catch (error) {
        console.error('❌ Error ending call:', error);
      }
    });
    
    // ICE candidate exchange
    socket.on('call:ice-candidate', async (data) => {
      console.log(`🧊 ICE candidate from ${userId} for call ${data.callId}`);
      
      try {
        const { callId, candidate, targetUserId } = data;
        
        // Forward ICE candidate to target user
        const targetSocket = userSockets.get(targetUserId);
        if (targetSocket && targetSocket.connected) {
          targetSocket.emit('call:ice-candidate', {
            callId,
            candidate,
            fromUserId: userId
          });
          console.log(`✅ ICE candidate forwarded to ${targetUserId}`);
        } else {
          console.log(`❌ Target user ${targetUserId} not connected`);
        }
        
      } catch (error) {
        console.error('❌ Error exchanging ICE candidate:', error);
      }
    });
    
    // Network quality update
    socket.on('call:quality-update', async (data) => {
      console.log(`📊 Quality update from ${userId} for call ${data.callId}: ${data.quality}`);
      
      try {
        const { callId, quality, metrics } = data;
        
        // Find call to get other participant
        const call = await Call.findOne({ callId });
        if (call) {
          const targetUserId = call.callerId === userId ? call.receiverId : call.callerId;
          const targetSocket = userSockets.get(targetUserId);
          
          if (targetSocket && targetSocket.connected) {
            targetSocket.emit('call:quality-update', {
              callId,
              quality,
              metrics
            });
            console.log(`✅ Quality update forwarded to ${targetUserId}`);
          }
        }
      } catch (error) {
        console.error('❌ Error forwarding quality update:', error);
      }
    });
    
    // ICE restart
    socket.on('call:ice-restart', async (data) => {
      console.log(`🔄 ICE restart from ${userId} for call ${data.callId}`);
      
      try {
        const { callId, offer } = data;
        
        // Find call to get other participant
        const call = await Call.findOne({ callId });
        if (call) {
          const targetUserId = call.callerId === userId ? call.receiverId : call.callerId;
          const targetSocket = userSockets.get(targetUserId);
          
          if (targetSocket && targetSocket.connected) {
            targetSocket.emit('call:ice-restart', {
              callId,
              offer
            });
            console.log(`✅ ICE restart offer forwarded to ${targetUserId}`);
          }
        }
      } catch (error) {
        console.error('❌ Error forwarding ICE restart:', error);
      }
    });
    
    // ICE restart answer
    socket.on('call:ice-restart-answer', async (data) => {
      console.log(`🔄 ICE restart answer from ${userId} for call ${data.callId}`);
      
      try {
        const { callId, answer } = data;
        
        // Find call to get other participant
        const call = await Call.findOne({ callId });
        if (call) {
          const targetUserId = call.callerId === userId ? call.receiverId : call.callerId;
          const targetSocket = userSockets.get(targetUserId);
          
          if (targetSocket && targetSocket.connected) {
            targetSocket.emit('call:ice-restart-answer', {
              callId,
              answer
            });
            console.log(`✅ ICE restart answer forwarded to ${targetUserId}`);
          }
        }
      } catch (error) {
        console.error('❌ Error forwarding ICE restart answer:', error);
      }
    });
    
    // Note: Call timeout is now handled per-call using setTimeout in call:initiate
    // This eliminates the need for inefficient polling every 30 seconds
    
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
    
    // 🏓 HEALTH MONITORING: Handle ping/pong for connection quality
    socket.on('ping', (data) => {
      const timestamp = data?.timestamp || Date.now();
      console.log(`🏓 [HEALTH] Ping received from ${userName} (${userId})`);
      
      // Respond with pong including original timestamp
      socket.emit('pong', {
        timestamp,
        serverTime: Date.now(),
        userId
      });
    });
    
    // 📊 CONNECTION ANALYTICS: Track message delivery
    socket.on('message:delivery_confirmation', (data) => {
      console.log(`📊 [ANALYTICS] Message delivery confirmed:`, {
        messageId: data.messageId,
        deliveryTime: data.deliveryTime,
        userId
      });
      
      // Update delivery statistics
      connectionStats.messageDeliveryCount = (connectionStats.messageDeliveryCount || 0) + 1;
      connectionStats.averageDeliveryTime = connectionStats.averageDeliveryTime 
        ? (connectionStats.averageDeliveryTime + data.deliveryTime) / 2
        : data.deliveryTime;
    });
    
    // 🔔 ENHANCED NOTIFICATIONS: Handle notification interactions
    socket.on('notification:clicked', (data) => {
      console.log(`🔔 [NOTIFICATIONS] Notification clicked by ${userName}:`, {
        notificationId: data.notificationId,
        type: data.type,
        timestamp: new Date().toISOString()
      });
      
      // Track notification analytics
      connectionStats.notificationClicks = (connectionStats.notificationClicks || 0) + 1;
    });
    
    socket.on('notification:dismissed', (data) => {
      console.log(`🔔 [NOTIFICATIONS] Notification dismissed by ${userName}:`, {
        notificationId: data.notificationId,
        type: data.type
      });
      
      connectionStats.notificationDismissals = (connectionStats.notificationDismissals || 0) + 1;
    });

    // 📡 STATUS BROADCASTING: Handle direct status update events from frontend
    socket.on('status_update', async (statusUpdateData) => {
      try {
        console.log(`📡 [STATUS] Direct status update received from ${userName} (${userId}):`, statusUpdateData);
        
        // Extract the comprehensive privacy and targeting data from frontend
        const {
          status,
          customStatus,
          statusUntil,
          location,
          broadcastScope,
          locationSharingScope,
          privacySettings,
          userGroups,
          connectionTypes,
          // ✅ FIX: Extract hierarchical status fields
          mainStatus,
          mainDuration,
          mainDurationLabel,
          mainStartTime,
          mainEndTime,
          subStatus,
          subDuration,
          subDurationLabel,
          subStartTime,
          subEndTime
        } = statusUpdateData;
        
        // Get the user from database
        const user = await User.findById(socket.user.id);
        if (!user) {
          console.error(`❌ [STATUS] User not found for status update: ${userId}`);
          return;
        }
        
        // ✅ FIX Bug #3, #4, #5: SERVER-SIDE PRIVACY VALIDATION
        console.log(`🔒 [STATUS] Validating privacy settings server-side...`);
        
        // Get user's saved privacy settings from database
        const dbPrivacySettings = await StatusPrivacy.getPrivacySettings(socket.user.id);
        console.log(`🔒 [STATUS] Database privacy settings:`, {
          visibility: dbPrivacySettings.visibility,
          allowedGroups: dbPrivacySettings.allowedGroups?.length || 0,
          allowedContacts: dbPrivacySettings.allowedContacts?.length || 0
        });
        
        // Use database settings as source of truth (don't trust frontend)
        const effectiveVisibility = dbPrivacySettings.visibility;
        const effectiveAllowedGroups = dbPrivacySettings.allowedGroups || [];
        const effectiveAllowedContacts = dbPrivacySettings.allowedContacts || [];
        
        console.log(`🔒 [STATUS] Effective privacy: ${effectiveVisibility}`);
        
        // Don't broadcast if private
        if (effectiveVisibility === 'private') {
          console.log(`🔒 [STATUS] Status is PRIVATE - not broadcasting`);
          // Still save to database but don't broadcast
          user.status = status;
          user.customStatus = customStatus || '';
          user.statusUntil = statusUntil;
          await user.save();
          return;
        }
        
        // Validate allowedGroups if using selected_groups visibility
        if (effectiveVisibility === 'selected_groups' && effectiveAllowedGroups.length === 0) {
          console.log(`⚠️ [STATUS] selected_groups visibility but no groups selected - treating as private`);
          user.status = status;
          user.customStatus = customStatus || '';
          user.statusUntil = statusUntil;
          await user.save();
          return;
        }
        
        // Validate allowedContacts if using custom_list visibility
        if (effectiveVisibility === 'custom_list' && effectiveAllowedContacts.length === 0) {
          console.log(`⚠️ [STATUS] custom_list visibility but no contacts selected - treating as private`);
          user.status = status;
          user.customStatus = customStatus || '';
          user.statusUntil = statusUntil;
          await user.save();
          return;
        }
        
        console.log(`✅ [STATUS] Privacy validation passed - proceeding with broadcast`);
        
        // ✅ FIX: Save hierarchical status to database
        user.status = status;
        user.customStatus = customStatus || '';
        user.statusUntil = statusUntil;
        user.mainStatus = mainStatus || status;
        user.mainDuration = mainDuration || 0;
        user.mainDurationLabel = mainDurationLabel || '';
        user.mainStartTime = mainStartTime || null;
        user.mainEndTime = mainEndTime || null;
        user.subStatus = subStatus || null;
        user.subDuration = subDuration || 0;
        user.subDurationLabel = subDurationLabel || '';
        user.subStartTime = subStartTime || null;
        user.subEndTime = subEndTime || null;
        
        if (location) {
          user.statusLocation = location;
        }
        
        await user.save();
        console.log(`✅ [STATUS] Saved hierarchical status to database for ${userName}`);
        
        // Prepare the status data for broadcasting
        const broadcastStatusData = {
          status: status,
          customStatus: customStatus || '',
          statusUntil: statusUntil,
          statusLocation: location,
          // ✅ FIX: Include hierarchical status in broadcast
          mainStatus: mainStatus || status,
          mainDuration: mainDuration,
          mainDurationLabel: mainDurationLabel,
          mainStartTime: mainStartTime,
          mainEndTime: mainEndTime,
          subStatus: subStatus,
          subDuration: subDuration,
          subDurationLabel: subDurationLabel,
          subStartTime: subStartTime,
          subEndTime: subEndTime
        };
        
        // NO LOCATION RESTRICTIONS - If location exists, broadcast to EVERYONE
        if (location) {
          console.log(`📍 [BACKEND] Location data received:`, JSON.stringify(location));
          console.log(`✅ [BACKEND] Location will be broadcast to ALL contacts & app connections`);
        } else {
          console.log(`⚠️ [BACKEND] No location data provided`);
        }
        
        console.log(`📡 [STATUS] Broadcasting status update with SERVER-VALIDATED privacy controls`);
        
        // Pass the validated privacy settings to broadcast function
        broadcastStatusUpdate(user, broadcastStatusData, {
          visibility: effectiveVisibility,
          allowedGroups: effectiveAllowedGroups,
          allowedContacts: effectiveAllowedContacts
        });
        
        console.log(`✅ [STATUS] Successfully processed direct status update from ${userName}`);
        
      } catch (error) {
        console.error(`❌ [STATUS] Error processing direct status update from ${userName}:`, error);
      }
    });

    // 📍 LOCATION TRACKING: Handle real-time location updates from Map Tab
    socket.on('location:update', async (locationData) => {
      try {
        console.log(`📍 [LOCATION] Location update received from ${userName} (${userId}):`, locationData);
        
        const { latitude, longitude, timestamp } = locationData;
        
        // Validate coordinates
        if (!latitude || !longitude || 
            typeof latitude !== 'number' || typeof longitude !== 'number' ||
            latitude < -90 || latitude > 90 || 
            longitude < -180 || longitude > 180) {
          console.error(`❌ [LOCATION] Invalid coordinates from ${userName}:`, { latitude, longitude });
          return;
        }
        
        // Update user's location in database
        const user = await User.findById(socket.user.id);
        if (!user) {
          console.error(`❌ [LOCATION] User not found: ${userId}`);
          return;
        }
        
        // Store location data
        user.currentLocation = {
          latitude,
          longitude,
          timestamp: timestamp || Date.now(),
          lastUpdated: new Date()
        };
        
        await user.save();
        console.log(`✅ [LOCATION] Location saved for ${userName}: ${latitude.toFixed(4)}, ${longitude.toFixed(4)}`);
        
        // Broadcast location update to user's contacts/friends
        // This will be used in Phase 2 to show friends on map
        const locationUpdateData = {
          userId: userId,
          userName: userName,
          profileImage: user.profileImage,
          latitude,
          longitude,
          timestamp: timestamp || Date.now()
        };
        
        // Get user's contacts to broadcast location
        const contacts = userContactsMap.get(userId) || [];
        let broadcastCount = 0;
        
        contacts.forEach(contactId => {
          const contactSocket = userSockets.get(contactId);
          if (contactSocket) {
            contactSocket.emit('location:friend_update', locationUpdateData);
            broadcastCount++;
          }
        });
        
        console.log(`📡 [LOCATION] Location broadcasted to ${broadcastCount} contacts`);
        
      } catch (error) {
        console.error(`❌ [LOCATION] Error processing location update from ${userName}:`, error);
      }
    });

    // Handle user disconnection
    socket.on('disconnect', (reason) => {
      console.log(`\n${'='.repeat(80)}`);
      console.log(`🔌 [USER DISCONNECTED] User disconnecting from socket`);
      console.log(`🔌 [USER DISCONNECTED] Name: ${userName}`);
      console.log(`🔌 [USER DISCONNECTED] UserId: ${userId}`);
      console.log(`🔌 [USER DISCONNECTED] Socket ID: ${socket.id}`);
      console.log(`🔌 [USER DISCONNECTED] Reason: ${reason}`);
      console.log(`🔌 [USER DISCONNECTED] Connection duration: ${Date.now() - socket.handshake.time}ms`);
      
      // 🤖 AI-to-AI Communication: Set AI offline
      try {
        AIMessageService.setAIOffline(userId);
      } catch (error) {
        console.error('Error setting AI offline:', error);
      }
      
      // Remove user from connected users map
      console.log(`🗑️ [USER DISCONNECTED] Removing userId from userSockets Map: ${userId}`);
      const wasInMap = userSockets.has(userId);
      userSockets.delete(userId);
      userContactsMap.delete(userId);
      console.log(`🗑️ [USER DISCONNECTED] Was in Map: ${wasInMap}, Successfully removed: ${!userSockets.has(userId)}`);
      
      // Update connection statistics
      connectionStats.activeConnections = Math.max(0, connectionStats.activeConnections - 1);
      connectionStats.totalDisconnections++;
      
      console.log(`📊 [USER DISCONNECTED] Updated connection stats:`, {
        activeConnections: connectionStats.activeConnections,
        totalDisconnections: connectionStats.totalDisconnections
      });
      console.log(`🗂️ [USER DISCONNECTED] Remaining connected userIds:`, Array.from(userSockets.keys()));
      console.log(`🗂️ [USER DISCONNECTED] userSockets Map size: ${userSockets.size}`);
      console.log(`${'='.repeat(80)}\n`);
      
      socketLogger.info(`User disconnected: ${userName} (${userId})`, {
        reason,
        socketId: socket.id,
        activeConnections: connectionStats.activeConnections
      });
    });
  });

  // Enhanced periodic cleanup and health monitoring
  setInterval(() => {
    // Clean up stale auth attempts
    const now = Date.now();
    for (const [ip, attempts] of authAttempts.entries()) {
      if (now > attempts.resetTime) {
        authAttempts.delete(ip);
      }
    }
    
    // Calculate uptime and performance metrics
    const uptime = now - connectionStats.startTime;
    const uptimeHours = Math.floor(uptime / (1000 * 60 * 60));
    const uptimeMinutes = Math.floor((uptime % (1000 * 60 * 60)) / (1000 * 60));
    
    const enhancedStats = {
      ...connectionStats,
      uptime: `${uptimeHours}h ${uptimeMinutes}m`,
      messagesPerMinute: connectionStats.messagesSent / (uptime / 60000),
      connectionSuccessRate: connectionStats.totalConnections > 0 
        ? ((connectionStats.totalConnections - connectionStats.authFailures) / connectionStats.totalConnections * 100).toFixed(2) + '%'
        : '0%',
      averageSessionDuration: connectionStats.totalDisconnections > 0
        ? Math.round(uptime / connectionStats.totalDisconnections / 1000) + 's'
        : 'N/A'
    };
    
    // Log enhanced statistics
    if (process.env.NODE_ENV !== 'production') {
      socketLogger.info('Enhanced Connection Statistics', enhancedStats);
    }
    
    // Health check: Send ping to all connected clients
    const connectedUsers = Array.from(userSockets.values());
    connectedUsers.forEach(socket => {
      if (socket.connected) {
        socket.emit('health_check', {
          timestamp: Date.now(),
          serverStats: {
            activeConnections: connectionStats.activeConnections,
            uptime: enhancedStats.uptime,
            messagesPerMinute: enhancedStats.messagesPerMinute
          }
        });
        connectionStats.healthChecks++;
      }
    });
    
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
 * Enhanced broadcast function with delivery tracking and analytics
 * @param {string} userId - User ID to broadcast to
 * @param {string} event - Event name to emit
 * @param {Object} data - Data to send with the event
 * @param {Object} options - Additional options (priority, retry, etc.)
 */
const broadcastToUser = (userId, event, data, options = {}) => {
  try {
    const userIdString = userId.toString();
    const messageId = data.messageId || `msg_${Date.now()}`;
    
    // Debug: Show all connected users for comparison
    const connectedUsers = Array.from(userSockets.keys());
    console.log(`🔍 Broadcasting ${event} to user: ${userIdString}`);
    console.log(`🔍 Currently connected users (${connectedUsers.length}):`, connectedUsers);
    
    const socket = userSockets.get(userIdString);
    
    if (socket && socket.connected) {
      console.log(`📨 Broadcasting ${event} to user ${userIdString}`);
      console.log(`📨 Broadcasting new message from ${socket.user?.name || 'Unknown'}`);
      
      // Enhanced data with delivery tracking
      const enhancedData = {
        ...data,
        messageId,
        timestamp: new Date().toISOString(),
        serverTime: Date.now(),
        priority: options.priority || 'normal'
      };
      
      // Emit with acknowledgment callback for delivery confirmation
      socket.emit(event, enhancedData, (ack) => {
        if (ack && ack.received) {
          console.log(`✅ Message ${messageId} delivered and acknowledged`);
          connectionStats.messageDeliveryCount++;
        } else {
          console.log(`⚠️ Message ${messageId} sent but not acknowledged`);
        }
      });
      
      // Update statistics
      connectionStats.messagesSent++;
      
      // Set delivery timeout if no acknowledgment received
      setTimeout(() => {
        socket.emit('delivery_timeout', { messageId, event });
      }, options.timeout || 30000);
      
      return true;
    } else {
      console.log(`❌ Message receiver ${userIdString} not found or offline.`);
      
      // Additional debugging: Check if socket exists but is disconnected
      if (socket) {
        console.log(`🔍 Socket exists but connected status: ${socket.connected}`);
      } else {
        console.log(`🔍 No socket found for user ${userIdString}`);
      }
      
      // Store message for delivery when user comes online (if priority is high)
      if (options.priority === 'high') {
        console.log(`📥 Storing high-priority message for offline user: ${userIdString}`);
        // TODO: Implement offline message queue
      }
      
      return false;
    }
  } catch (error) {
    console.error('❌ Error broadcasting to user:', error);
    return false;
  }
};

// ✅ FIX Bug #9: Cache for privacy check results to avoid repeated DB queries
const privacyCheckCache = new Map(); // Key: `${statusUserId}_${viewerUserId}`, Value: { canSee: boolean, timestamp: number }
const PRIVACY_CACHE_TTL = 5 * 60 * 1000; // 5 minutes

/**
 * Broadcast status update to all users who have this user in their contacts
 * @param {Object} user - User who updated their status
 * @param {Object} statusData - New status data
 * @param {Object} validatedPrivacySettings - Server-validated privacy settings (optional)
 */
const broadcastStatusUpdate = async (user, statusData, validatedPrivacySettings = null) => {
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
      console.log(`🔍 Querying database for users who have ${userIdString} in their contacts, appConnections, or Friends...`);
      
      // Query for contacts, appConnections, AND Friends (NEW)
      const dbUsers = await User.find({
        $or: [
          { contacts: user._id },
          { 'appConnections.userId': user.userId }
        ]
      }, '_id name phoneNumber contacts appConnections');
      
      // ALSO check Friends collection (NEW SYSTEM) - BIDIRECTIONAL
      // Friend is already imported at the top of the file
      
      // Find users who have THIS user as their friend (friendUserId = user.userId)
      const friendUsers1 = await Friend.find({
        friendUserId: user.userId,
        status: 'accepted',
        isDeleted: false
      }).distinct('userId');
      
      // ALSO find users who THIS user has as friends (userId = user.userId)
      // Because friendships should be bidirectional
      const friendUsers2 = await Friend.find({
        userId: user.userId,
        status: 'accepted',
        isDeleted: false
      }).distinct('friendUserId');
      
      // Merge both directions
      const friendUsers = [...new Set([...friendUsers1, ...friendUsers2])];
      
      console.log(`👥 Found ${friendUsers1.length} users who have ${user.name} as friend`);
      console.log(`👥 Found ${friendUsers2.length} users who ${user.name} has as friends`);
      console.log(`👥 Total unique friends: ${friendUsers.length}`);
      
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
      
      // Convert friendUsers (userId strings) to MongoDB ObjectIds for consistency
      // User is already imported at the top of the file
      const friendUserDocs = await User.find({ userId: { $in: friendUsers } }).select('_id');
      const friendUserObjectIds = friendUserDocs.map(u => u._id.toString());
      
      console.log(`👥 Converted ${friendUsers.length} friend userIds to ${friendUserObjectIds.length} ObjectIds`);
      
      // Also check if there are any users in the database at all
      const totalUsers = await User.countDocuments({});
      const usersWithContacts = await User.countDocuments({ contacts: { $exists: true, $ne: [] } });
      console.log(`📊 Database stats: Total users: ${totalUsers}, Users with contacts: ${usersWithContacts}`);
      
      // Merge ALL sources: cache + contacts + appConnections + Friends (remove duplicates)
      const allUsersToNotify = [...new Set([...usersToNotify, ...dbUserIds, ...friendUserObjectIds])];
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
    
    // ✅ FIX Bug #4: Use validated privacy settings if provided (already checked server-side)
    let authorizedUsers = [];
    
    if (validatedPrivacySettings) {
      console.log(`🔒 Using PRE-VALIDATED privacy settings from server:`, validatedPrivacySettings);
      
      // Fast path: Use validated settings without additional DB queries
      const { visibility, allowedGroups, allowedContacts } = validatedPrivacySettings;
      
      if (visibility === 'public') {
        // Everyone can see
        authorizedUsers = usersToNotify;
        console.log(`✅ PUBLIC visibility - all ${usersToNotify.length} users authorized`);
      } else if (visibility === 'selected_groups') {
        // Only users in allowed groups
        console.log(`🔒 Filtering by selected_groups: ${allowedGroups.length} groups`);
        for (const recipientId of usersToNotify) {
          const isInGroup = await StatusPrivacy.isUserInAllowedGroups(recipientId, allowedGroups);
          if (isInGroup) {
            authorizedUsers.push(recipientId);
          }
        }
        console.log(`✅ ${authorizedUsers.length}/${usersToNotify.length} users in allowed groups`);
      } else if (visibility === 'custom_list') {
        // Only specific allowed contacts
        console.log(`🔒 Filtering by custom_list: ${allowedContacts.length} contacts`);
        const allowedContactStrings = allowedContacts.map(id => id.toString());
        authorizedUsers = usersToNotify.filter(recipientId => 
          allowedContactStrings.includes(recipientId.toString())
        );
        console.log(`✅ ${authorizedUsers.length}/${usersToNotify.length} users in custom list`);
      } else if (visibility === 'selected_friends') {
        // Only specific allowed friends from Friend model
        console.log(`🔒 Filtering by selected_friends: ${allowedContacts.length} friends`);
        // allowedContacts in this context contains friend userIds
        for (const recipientId of usersToNotify) {
          const recipient = await User.findById(recipientId).select('userId');
          if (recipient && allowedContacts.includes(recipient.userId)) {
            authorizedUsers.push(recipientId);
          }
        }
        console.log(`✅ ${authorizedUsers.length}/${usersToNotify.length} users in selected friends list`);
      } else if (visibility === 'contacts_only' || visibility === 'app_connections_only' || visibility === 'friends') {
        // Check each recipient with caching
        for (const recipientId of usersToNotify) {
          const cacheKey = `${userIdString}_${recipientId}`;
          const cached = privacyCheckCache.get(cacheKey);
          
          let canSeeStatus;
          if (cached && (Date.now() - cached.timestamp) < PRIVACY_CACHE_TTL) {
            // Use cached result
            canSeeStatus = cached.canSee;
            console.log(`🔒 Using cached privacy result for ${recipientId}: ${canSeeStatus}`);
          } else {
            // Check privacy and cache result
            canSeeStatus = await StatusPrivacy.canUserSeeStatus(userIdString, recipientId);
            privacyCheckCache.set(cacheKey, { canSee: canSeeStatus, timestamp: Date.now() });
            console.log(`🔒 Checked and cached privacy for ${recipientId}: ${canSeeStatus}`);
          }
          
          if (canSeeStatus) {
            authorizedUsers.push(recipientId);
          }
        }
        console.log(`✅ ${authorizedUsers.length}/${usersToNotify.length} users authorized after privacy checks`);
      }
    } else {
      // Legacy path: Full privacy check for each recipient (slower)
      console.log(`⚠️ No validated privacy settings - performing full privacy checks`);
      
      for (const recipientId of usersToNotify) {
        try {
          const cacheKey = `${userIdString}_${recipientId}`;
          const cached = privacyCheckCache.get(cacheKey);
          
          let canSeeStatus;
          if (cached && (Date.now() - cached.timestamp) < PRIVACY_CACHE_TTL) {
            canSeeStatus = cached.canSee;
          } else {
            canSeeStatus = await StatusPrivacy.canUserSeeStatus(userIdString, recipientId);
            privacyCheckCache.set(cacheKey, { canSee: canSeeStatus, timestamp: Date.now() });
          }
          
          if (canSeeStatus) {
            authorizedUsers.push(recipientId);
          }
        } catch (privacyError) {
          console.error(`❌ Error checking privacy for user ${recipientId}:`, privacyError);
          // On error, deny access for safety
        }
      }
    }
    
    console.log(`🔒 Privacy filtering: ${usersToNotify.length} potential recipients → ${authorizedUsers.length} authorized recipients`);
    
    // Broadcast to each authorized user with multiple event types for better compatibility
    let successfulBroadcasts = 0;
    
    for (const recipientId of authorizedUsers) {
      try {
        // Convert MongoDB ObjectId to userId for socket lookup
        const recipient = await User.findById(recipientId).select('userId name phoneNumber');
        
        if (!recipient) {
          console.log(`❌ Recipient not found in database: ${recipientId}`);
          continue;
        }
        
        const recipientUserId = recipient.userId;
        
        if (!recipientUserId) {
          console.log(`❌ Could not find userId for recipient ${recipientId} (${recipient.name})`);
          console.log(`❌ Recipient data:`, { _id: recipient._id, name: recipient.name, phoneNumber: recipient.phoneNumber });
          continue;
        }
        
        console.log(`🔍 Looking up socket for recipient: ObjectId=${recipientId}, userId=${recipientUserId}, name=${recipient.name}`);
        console.log(`🔍 Current userSockets keys:`, Array.from(userSockets.keys()));
        console.log(`🔍 Searching for userId in userSockets:`, recipientUserId);
        
        const socket = userSockets.get(recipientUserId); // Use userId for socket lookup
        
        if (socket && socket.connected) {
          console.log(`✅ Emitting status update to authorized user ${recipient.name} (ObjectId: ${recipientId}, userId: ${recipientUserId})`);
          
          const statusUpdateData = {
            contactId: user._id,
            userId: user.userId,
            phoneNumber: user.phoneNumber,
            name: user.name,
            status: statusData.status,
            customStatus: statusData.customStatus,
            statusUntil: statusData.statusUntil,
            // ✅ CRITICAL: Always include online status in broadcasts
            isOnline: user.isOnline || false,
            lastSeen: user.lastSeen || new Date(),
            // Hierarchical status support for Bug #11
            mainStatus: statusData.mainStatus || statusData.status,
            mainDuration: statusData.mainDuration,
            mainDurationLabel: statusData.mainDurationLabel,
            mainEndTime: statusData.mainEndTime,
            subStatus: statusData.subStatus,
            subDuration: statusData.subDuration,
            subDurationLabel: statusData.subDurationLabel,
            subEndTime: statusData.subEndTime,
            timestamp: new Date().toISOString()
          };
          
          // CRITICAL: Only include location if it has valid data
          console.log(`🔍 [BROADCAST] Checking location for ${user.name}:`);
          console.log(`🔍 [BROADCAST] statusData.statusLocation:`, JSON.stringify(statusData.statusLocation));
          console.log(`🔍 [BROADCAST] user.statusLocation:`, JSON.stringify(user.statusLocation));
          
          if (statusData.statusLocation && statusData.statusLocation.placeName && 
              statusData.statusLocation.placeName.trim() !== '') {
            statusUpdateData.statusLocation = statusData.statusLocation;
            statusUpdateData.location = statusData.statusLocation.placeName;
            console.log(`✅ Including location in broadcast: ${statusData.statusLocation.placeName}`);
          } else if (user.statusLocation && user.statusLocation.placeName && 
                     user.statusLocation.placeName.trim() !== '') {
            // Fallback to user's saved location if statusData doesn't have it
            statusUpdateData.statusLocation = user.statusLocation;
            statusUpdateData.location = user.statusLocation.placeName;
            console.log(`✅ Including location from user object: ${user.statusLocation.placeName}`);
          } else {
            console.log(`⚠️ No valid location to broadcast (statusData: ${!!statusData.statusLocation}, user: ${!!user.statusLocation})`);
          }
          
          // Emit multiple event types to ensure frontend receives the update
          socket.emit('contact_status_update', statusUpdateData);
          socket.emit('status_update', statusUpdateData);
          socket.emit('user_status_update', statusUpdateData);
          socket.emit('contact_status_changed', statusUpdateData);
          
          successfulBroadcasts++;
        } else {
          console.log(`❌ User ${recipient.name} (ObjectId: ${recipientId}, userId: ${recipientUserId}) socket not found or disconnected`);
          console.log(`🔍 Available sockets: ${Array.from(userSockets.keys()).join(', ')}`);
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

/**
 * Get enhanced connection statistics
 */
const getConnectionStats = () => {
  const now = Date.now();
  const uptime = now - connectionStats.startTime;
  
  return {
    ...connectionStats,
    uptime,
    uptimeFormatted: `${Math.floor(uptime / (1000 * 60 * 60))}h ${Math.floor((uptime % (1000 * 60 * 60)) / (1000 * 60))}m`,
    messagesPerMinute: uptime > 0 ? (connectionStats.messagesSent / (uptime / 60000)).toFixed(2) : 0,
    connectionSuccessRate: connectionStats.totalConnections > 0 
      ? ((connectionStats.totalConnections - connectionStats.authFailures) / connectionStats.totalConnections * 100).toFixed(2)
      : 0,
    averageSessionDuration: connectionStats.totalDisconnections > 0
      ? Math.round(uptime / connectionStats.totalDisconnections / 1000)
      : 0,
    connectedUsers: Array.from(userSockets.keys()),
    timestamp: new Date().toISOString()
  };
};

/**
 * Broadcast system-wide announcement
 */
const broadcastSystemAnnouncement = (title, message, priority = 'normal') => {
  const connectedUsers = Array.from(userSockets.values());
  let successCount = 0;
  
  connectedUsers.forEach(socket => {
    if (socket.connected) {
      socket.emit('system_announcement', {
        title,
        message,
        priority,
        timestamp: new Date().toISOString()
      });
      successCount++;
    }
  });
  
  console.log(`📢 System announcement sent to ${successCount}/${connectedUsers.length} users`);
  return successCount;
};

/**
 * Broadcast to all connected users
 * @param {string} event - Event name to emit
 * @param {Object} data - Data to send with the event
 */
const broadcastToAll = (event, data) => {
  try {
    console.log(`📡 Broadcasting ${event} to all connected users (${userSockets.size} users)`);
    
    let successCount = 0;
    for (const [userId, socket] of userSockets.entries()) {
      if (socket && socket.connected) {
        socket.emit(event, data);
        successCount++;
      }
    }
    
    console.log(`✅ Broadcasted ${event} to ${successCount}/${userSockets.size} users`);
    return successCount;
  } catch (error) {
    console.error('❌ Error broadcasting to all users:', error);
    return 0;
  }
};

// Export enhanced functions and data
module.exports = {
  initializeSocketIO,
  broadcastStatusUpdate,
  refreshUserContacts,
  broadcastToUser,
  broadcastToAll, // ✅ FIX: Export broadcastToAll function
  broadcastSystemAnnouncement,
  getConnectionStats,
  getUserSockets: () => userSockets,
  getConnectionStats: () => connectionStats
};
