const socketIO = require('socket.io');
const jwt = require('jsonwebtoken');
const { v4: uuidv4 } = require('uuid');
const User = require('./models/userModel');
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
    console.log(`🔗 User connected with userId: ${userId} (ObjectId: ${userObjectId})`);
    
    console.log(`🔗 User connected: ${userName} (userId: ${userId})`);
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
          receiverSocket.emit('call:incoming', callNotificationData);
          notificationSent = true;
          console.log(`✅ [CALL] Notification sent via WebSocket`);
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
      console.log(`📞 Call answered: ${data.callId}`);
      
      try {
        const { callId, answer } = data;
        
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
        }
        
        // Confirm to receiver
        socket.emit('call:connected', { callId });
        
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
          connectionTypes
        } = statusUpdateData;
        
        // Get the user from database
        const user = await User.findById(socket.user.id);
        if (!user) {
          console.error(`❌ [STATUS] User not found for status update: ${userId}`);
          return;
        }
        
        console.log(`📡 [STATUS] Processing status update with privacy scope: ${broadcastScope}`);
        console.log(`📡 [STATUS] Connection types:`, connectionTypes);
        console.log(`📡 [STATUS] Privacy settings:`, privacySettings);
        
        // Apply the comprehensive privacy and targeting logic
        // The frontend has already done the privacy checking, so we trust the broadcastScope
        
        // Don't broadcast if private
        if (broadcastScope === 'private' || privacySettings?.visibility === 'private') {
          console.log(`🔒 [STATUS] Status is private - not broadcasting`);
          return;
        }
        
        // Prepare the status data for broadcasting
        const broadcastStatusData = {
          status: status,
          customStatus: customStatus || '',
          statusUntil: statusUntil,
          statusLocation: location
        };
        
        // NO LOCATION RESTRICTIONS - If location exists, broadcast to EVERYONE
        if (location) {
          console.log(`📍 [BACKEND] Location data received:`, JSON.stringify(location));
          console.log(`✅ [BACKEND] Location will be broadcast to ALL contacts & app connections`);
        } else {
          console.log(`⚠️ [BACKEND] No location data provided`);
        }
        
        console.log(`📡 [STATUS] Broadcasting status update with frontend privacy controls applied`);
        
        // Use the existing broadcastStatusUpdate function with the privacy-filtered data
        // This will apply additional server-side privacy checks as a safety layer
        broadcastStatusUpdate(user, broadcastStatusData);
        
        console.log(`✅ [STATUS] Successfully processed direct status update from ${userName}`);
        
      } catch (error) {
        console.error(`❌ [STATUS] Error processing direct status update from ${userName}:`, error);
      }
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
        const recipient = await User.findById(recipientId).select('userId name');
        const recipientUserId = recipient?.userId;
        
        if (!recipientUserId) {
          console.log(`❌ Could not find userId for recipient ${recipientId}`);
          continue;
        }
        
        console.log(`🔍 Looking up socket for recipient: ObjectId=${recipientId}, userId=${recipientUserId}, name=${recipient.name}`);
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

// Export enhanced functions and data
module.exports = {
  initializeSocketIO,
  broadcastStatusUpdate,
  refreshUserContacts,
  broadcastToUser,
  broadcastSystemAnnouncement,
  getConnectionStats,
  getUserSockets: () => userSockets,
  getConnectionStats: () => connectionStats
};
