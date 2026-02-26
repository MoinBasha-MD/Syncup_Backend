const express = require('express');

const dotenv = require('dotenv');

const cors = require('cors');

const compression = require('compression');

const fs = require('fs');

const path = require('path');

const https = require('https');

const http = require('http');

const os = require('os');

const { 

  setupClustering, 

  performanceOptimization, 

  memoryMonitor, 

  getPerformanceStats,

  optimizeConnectionPool 

} = require('./middleware/performanceMiddleware');

const { videoStreamingHandler, mediaCacheControl } = require('./middleware/videoStreamingMiddleware');

const connectDB = require('./config/db');

const { notFound, errorHandler } = require('./middleware/errorMiddleware');

const { 

  securityHeaders, 

  apiLimiter, 

  authLimiter, 

  userDataLimiter, 

  contactLimiter, 

  statusLimiter,

  mongoSanitizer,

  xssProtection,

  hppProtection,

  requestSizeLimiter

} = require('./middleware/securityMiddleware');

const authRoutes = require('./routes/authRoutes');

const userRoutes = require('./routes/userRoutes');

const statusRoutes = require('./routes/statusRoutes');

const statusManagementRoutes = require('./routes/statusManagementRoutes');

const statusPrivacyRoutes = require('./routes/statusPrivacyRoutes');

const bulkOperationsRoutes = require('./routes/bulkOperationsRoutes');

const userDataRoutes = require('./routes/userDataRoutes');

const contactRoutes = require('./routes/contactRoutes');

const uploadRoutes = require('./routes/uploadRoutes');

const calendarRoutes = require('./routes/calendarRoutes');

const chatRoutes = require('./routes/chatRoutes');

const groupRoutes = require('./routes/groupRoutes');

const groupChatRoutes = require('./routes/groupChatRoutes');

const postRoutes = require('./routes/postRoutes');

const storyRoutes = require('./routes/storyRoutes');

const friendRoutes = require('./routes/friendRoutes');

const profileRoutes = require('./routes/profileRoutes');

const diyaRequestRoutes = require('./routes/diyaRequestRoutes');

const diyaMemoryRoutes = require('./routes/diyaMemoryRoutes');

const aiMessageRoutes = require('./routes/aiMessageRoutes');

const aiInstanceRoutes = require('./routes/aiInstanceRoutes');

const aiCommunicationRoutes = require('./routes/aiCommunicationRoutes');

const globalSearchRoutes = require('./routes/globalSearchRoutes');

const connectionRoutes = require('./routes/connectionRoutes');

const blockRoutes = require('./routes/blockRoutes');

const callRoutes = require('./routes/callRoutes');

const locationRoutes = require('./routes/locationRoutes');

const agentRoutes = require('./routes/agentRoutes');

const agentDashboardRoutes = require('./routes/agentDashboardRoutes');

const advancedDashboardRoutes = require('./routes/advancedDashboardRoutes');

const pageRoutes = require('./routes/pageRoutes');

const pagePostRoutes = require('./routes/pagePostRoutes');

const dailyScheduleRoutes = require('./routes/dailyScheduleRoutes');

const docSpaceRoutes = require('./routes/docSpaceRoutes');

const docSpaceSharingRoutes = require('./routes/docSpaceSharingRoutes');

const docSpaceAnalyticsRoutes = require('./routes/docSpaceAnalyticsRoutes');

const docSpaceAccessRequestRoutes = require('./routes/docSpaceAccessRequestRoutes'); // ⚡ FIX: Access requests

const categoryRoutes = require('./routes/categoryRoutes');

const docSpaceSearchRoutes = require('./routes/docSpaceSearchRoutes');

const otpRoutes = require('./routes/otpRoutes');

const cryptoRoutes = require('./routes/cryptoRoutes');

const placesRoutes = require('./routes/placesRoutes');

const encryptedFileRoutes = require('./routes/encryptedFileRoutes');

const imageSpaceRoutes = require('./routes/imageSpaceRoutes');

const container = require('./config/container');

const { initializeSocketIO } = require('./socketManager');

const { logStartup, serverLogger } = require('./utils/loggerSetup');

const agentIntegrationService = require('./services/agentIntegrationService');

const SelfHealingService = require('./services/selfHealingService');

const DynamicScalingService = require('./services/dynamicScalingService');

const AgentIntelligenceService = require('./services/agentIntelligenceService');

const placesRefreshJob = require('./jobs/placesRefreshJob');

// Admin dependencies removed for production



// Load environment variables

dotenv.config();



// Setup clustering for production (must be before other initializations)

if (setupClustering()) {

  // This is the master process, exit here

  return;

}



// Connect to database with optimized connection pool

connectDB(optimizeConnectionPool());



// Initialize express

const app = express();



// Trust proxy - Required for rate limiting behind Nginx reverse proxy

app.set('trust proxy', 1);



// Start memory monitoring

memoryMonitor();



// Security middleware (order matters!)

const { ipBlocker, suspiciousPatternDetector } = require('./middleware/ipBlockMiddleware');

app.use(ipBlocker); // Block known malicious IPs (FIRST - before any processing)

app.use(suspiciousPatternDetector); // Monitor suspicious patterns

app.use(securityHeaders); // Add security headers

app.use(requestSizeLimiter); // Limit request size

// app.use(mongoSanitizer); // Temporarily disabled due to compatibility issue

app.use(hppProtection); // Prevent HTTP Parameter Pollution

app.use(xssProtection); // XSS protection



// Compression middleware (should be early in the stack)

app.use(compression({

  filter: (req, res) => {

    if (req.headers['x-no-compression']) {

      return false;

    }

    return compression.filter(req, res);

  },

  threshold: 1024 // Only compress responses larger than 1KB

}));



// Performance optimization middleware (early in the stack)

app.use(...performanceOptimization());



// Basic middleware

app.use(express.json({ 

  limit: '200mb', // Increased for video uploads

  verify: (req, res, buf) => {

    // Store raw body for webhook verification if needed

    req.rawBody = buf;

  }

})); // Limit request body size

app.use(express.urlencoded({ extended: true, limit: '200mb' })); // Increased for video uploads

app.use(express.raw({ limit: '200mb' })); // For raw binary data



// Create uploads directory if it doesn't exist

const uploadsDir = path.join(__dirname, 'uploads');

if (!fs.existsSync(uploadsDir)) {

  fs.mkdirSync(uploadsDir, { recursive: true });

  console.log('📁 Created uploads directory:', uploadsDir);

}



// Create story-images subdirectory if it doesn't exist

const storyImagesDir = path.join(uploadsDir, 'story-images');

if (!fs.existsSync(storyImagesDir)) {

  fs.mkdirSync(storyImagesDir, { recursive: true });

  console.log('📁 Created story-images directory:', storyImagesDir);

}



// Create profile-images subdirectory if it doesn't exist

const profileImagesDir = path.join(uploadsDir, 'profile-images');

if (!fs.existsSync(profileImagesDir)) {

  fs.mkdirSync(profileImagesDir, { recursive: true });

  console.log('📁 Created profile-images directory:', profileImagesDir);

}



// Create chat-images subdirectory if it doesn't exist

const chatImagesDir = path.join(uploadsDir, 'chat-images');

if (!fs.existsSync(chatImagesDir)) {

  fs.mkdirSync(chatImagesDir, { recursive: true });

  console.log('📁 Created chat-images directory:', chatImagesDir);

}



// Enhanced CORS configuration for better network accessibility

app.use(cors({

  origin: function(origin, callback) {

    console.log('🔍 CORS Request from origin:', origin);

    console.log('🔍 NODE_ENV:', process.env.NODE_ENV);

    

    // Allow requests with no origin (like mobile apps, curl, etc.)

    if (!origin) {

      console.log('✅ CORS: Allowing request with no origin');

      return callback(null, true);

    }

    

    // Allow all origins in development mode

    if (process.env.NODE_ENV !== 'production') {

      console.log('✅ CORS: Allowing all origins (development mode)');

      return callback(null, true);

    }

    

    // In production, check allowed origins

    const allowedOrigins = process.env.ALLOWED_ORIGINS?.split(',') || [];

    console.log('🔍 Allowed origins:', allowedOrigins);

    if (allowedOrigins.includes(origin)) {

      console.log('✅ CORS: Origin allowed');

      return callback(null, true);

    }

    

    console.log('❌ CORS: Origin not allowed');

    return callback(new Error('Not allowed by CORS'));

  },

  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS', 'HEAD'],

  allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With', 'Accept', 'Origin'],

  credentials: true,

  maxAge: 86400, // 24 hours

  preflightContinue: false,

  optionsSuccessStatus: 204

}));



// Make container available in requests

app.use((req, res, next) => {

  req.container = container;

  next();

});



// Production setup - Admin panels removed



// Handle Chrome DevTools request to prevent 404 errors

app.get('/.well-known/appspecific/com.chrome.devtools.json', (req, res) => {

  res.status(204).end(); // No Content - silently handle the request

});



// Health check and monitoring routes (before API versioning)

const { healthCheck, liveness, readiness, metrics } = require('./middleware/healthCheckMiddleware');

app.get('/health', healthCheck);

app.get('/api/health', healthCheck); // ✅ FIX: Add /api/health endpoint

app.get('/health/live', liveness);

app.get('/health/ready', readiness);

app.get('/metrics', metrics);



// Performance metrics endpoint

app.get('/performance', (req, res) => {

  const stats = getPerformanceStats();

  res.json({

    success: true,

    data: {

      ...stats,

      timestamp: new Date().toISOString(),

      server: {

        pid: process.pid,

        platform: process.platform,

        nodeVersion: process.version,

        cpuCount: os.cpus().length

      }

    }

  });

});



// API versioning middleware

const { apiVersioning } = require('./middleware/versionMiddleware');

app.use('/api', apiVersioning);



// Create logs directory if it doesn't exist

if (!fs.existsSync(path.join(__dirname, 'logs'))) {

  fs.mkdirSync(path.join(__dirname, 'logs'));

}



// Apply rate limiters to specific routes for better performance and security

app.use('/api/auth', authLimiter, authRoutes); // Authentication routes with stricter limits

app.use('/api/users', apiLimiter, userRoutes); // User routes

app.use('/api/users', userDataLimiter, userDataRoutes); // User data routes with userId parameter

app.use('/api/status', statusLimiter, statusRoutes); // Status history, templates, schedules

app.use('/api/status-management', statusLimiter, statusManagementRoutes); // Current status management

app.use('/api/status-privacy', statusLimiter, statusPrivacyRoutes); // Current status management

app.use('/api/primary-time', apiLimiter, require('./routes/primaryTimeRoutes')); // Primary Time profiles

app.use('/api/location', apiLimiter, locationRoutes); // Location and geocoding services

app.use('/api/location-sharing', apiLimiter, require('./routes/locationSharingRoutes')); // Location sharing controls

app.use('/api/bulk', apiLimiter, bulkOperationsRoutes); // Bulk operations

app.use('/api/contacts', contactLimiter, contactRoutes); // Contact management routes

app.use('/api/upload', apiLimiter, uploadRoutes); // File upload routes

app.use('/api/calendar', apiLimiter, calendarRoutes); // Calendar integration routes

app.use('/api/chat', apiLimiter, chatRoutes); // Chat messaging routes

app.use('/api/image-space', apiLimiter, imageSpaceRoutes); // Image Space (private image gallery)

app.use('/api/groups', apiLimiter, groupRoutes); // Contact group management routes

app.use('/api/group-chats', apiLimiter, groupChatRoutes); // Group chat messaging routes

app.use('/api/posts', apiLimiter, postRoutes); // User posts management routes

app.use('/api/stories', apiLimiter, storyRoutes); // Stories management routes

app.use('/api/friends', apiLimiter, friendRoutes); // Friends management routes (NEW)

app.use('/api', apiLimiter, profileRoutes); // Profile routes (public profile, friend profile, follow/unfollow)

app.use('/api/diya', apiLimiter, diyaRequestRoutes); // Cross-user Diya communication routes

app.use('/api/diya', apiLimiter, diyaMemoryRoutes); // Diya conversation memory routes

app.use('/api/ai', apiLimiter, aiMessageRoutes); // AI-to-AI messaging routes (legacy)

app.use('/api/ai', apiLimiter, aiInstanceRoutes); // AI instance management routes

app.use('/api/ai', apiLimiter, aiCommunicationRoutes); // AI-to-AI communication routes

app.use('/api/search', apiLimiter, globalSearchRoutes); // Global user search routes

app.use('/api/search', apiLimiter, require('./routes/searchRoutes')); // Unified search (people + pages)

app.use('/api/connections', apiLimiter, connectionRoutes); // Connection request management routes

app.use('/api/blocks', apiLimiter, blockRoutes); // User blocking management routes

app.use('/api/calls', apiLimiter, callRoutes); // Call history and management routes

app.use('/api/agents', apiLimiter, agentRoutes); // Agentic framework management routes

app.use('/api/pages', apiLimiter, pageRoutes); // Pages management routes (Phase 1)

app.use('/api/pages', apiLimiter, pagePostRoutes); // Page posts routes (Phase 2)

app.use('/api/daily-schedule', apiLimiter, dailyScheduleRoutes); // Daily schedule management routes

app.use('/api/doc-space', apiLimiter, docSpaceRoutes); // Doc Space management routes (Maya AI document sharing)

app.use('/api/doc-space-sharing', apiLimiter, docSpaceSharingRoutes); // Doc Space sharing with people view

app.use('/api/doc-space', apiLimiter, docSpaceAnalyticsRoutes); // Doc Space analytics and access control

app.use('/api/doc-space', apiLimiter, docSpaceSearchRoutes); // Doc Space search and collections

app.use('/api/doc-space-download', apiLimiter, require('./routes/docSpaceDownloadRoutes')); // Doc Space file download with proper headers

app.use('/api/doc-space-access-requests', apiLimiter, docSpaceAccessRequestRoutes); // ⚡ FIX: Doc Space access requests

app.use('/api/categories', apiLimiter, categoryRoutes); // Document categories

app.use('/api/maya', apiLimiter, require('./routes/mayaDocumentRoutes')); // Maya document request routes

app.use('/api/sos', apiLimiter, require('./routes/sosRoutes')); // SOS emergency alert routes

app.use('/api/otp', apiLimiter, otpRoutes); // OTP verification routes (email verification)

app.use('/api/crypto', apiLimiter, cryptoRoutes); // E2EE key exchange routes (Phase 1)

app.use('/api/hashtags', apiLimiter, require('./routes/hashtagRoutes')); // Hashtag management routes (trending, search, stats)

app.use('/api/notifications', apiLimiter, require('./routes/fcmRoutes')); // FCM token registration routes

app.use('/api/fcm-diagnostics', apiLimiter, require('./routes/fcmDiagnostics')); // FCM token diagnostics

app.use('/api/admin', apiLimiter, require('./routes/adminCleanupRoutes')); // Admin cleanup routes

app.use('/api', apiLimiter, require('./routes/savedVibesRoutes')); // Saved vibes and collections routes (Feature 1)

app.use('/api', apiLimiter, require('./routes/commentMentionsRoutes')); // Comment mentions/tagging routes (Feature 2)

app.use('/api/chat-games', apiLimiter, require('./routes/chatGameRoutes')); // In-chat games (Tic-Tac-Toe)

app.use('/api/intent-notifications', apiLimiter, require('./routes/intentNotificationRoutes')); // Intent notifications (visual contact indicators)

app.use('/api/places', apiLimiter, placesRoutes); // Places caching and nearby places (Geoapify integration)

app.use('/agent-dashboard', agentDashboardRoutes); // Agent visualization dashboard



// Admin Dashboard Routes (for admin panel at localhost:3001)

const adminDashboardRoutes = require('./routes/adminDashboardRoutes');

const { router: adminAuthRoutes, verifyToken: adminAuthMiddleware } = require('./routes/adminAuthRoutes');

const adminUserStatusRoutes = require('./routes/adminUserStatusRoutes');



// Admin authentication routes (public)

app.use('/api/admin/auth', adminAuthRoutes);



// Admin dashboard routes (protected)

app.use('/api/admin', adminAuthMiddleware, adminDashboardRoutes); // Admin panel API endpoints

app.use('/api/admin/users', adminUserStatusRoutes); // User status management API (JWT auth inside route)



// 🔐 ENCRYPTED FILE ROUTES (MUST BE BEFORE STATIC FILE SERVING)

// All file requests go through decryption middleware

app.use('/api', encryptedFileRoutes);



// 🔐 MEDIA DECRYPTION MIDDLEWARE - DISABLED (encryption disabled for better performance)

// const mediaDecryptionMiddleware = require('./middleware/mediaDecryptionMiddleware');

// app.use('/uploads', mediaDecryptionMiddleware);

// app.use('/api/uploads', mediaDecryptionMiddleware);



// ✅ Serve uploads directory with optimized video streaming

app.use('/uploads/post-media', mediaCacheControl, videoStreamingHandler('post-media'));

app.use('/uploads', mediaCacheControl, express.static(path.join(__dirname, 'uploads')));



// Serve static files from public directory (for JS, CSS, images)

app.use(express.static(path.join(__dirname, 'public')));



// API status and health check route

app.get('/', (req, res) => {

  res.json({ 

    message: 'API is running...', 

    version: '1.0.0',

    timestamp: new Date().toISOString()

  });

});



// API base route

app.get('/api', (req, res) => {

  res.json({

    message: 'API endpoints available',

    version: '1.0.0',

    endpoints: {

      auth: '/api/auth',

      users: '/api/users',

      status: '/api/status',

      statusManagement: '/api/status-management',

      bulk: '/api/bulk',

      contacts: '/api/contacts',

      uploads: '/api/uploads',

      calendar: '/api/calendar',

      chat: '/api/chat',

      stories: '/api/stories',

      diya: '/api/diya',

      ai: '/api/ai',

      agents: '/api/agents'

    },

    documentation: '/api/docs',

    timestamp: new Date().toISOString()

  });

});



// Network diagnostic endpoint

app.get('/api/network-test', (req, res) => {

  const clientIP = req.ip || req.connection.remoteAddress;

  res.json({

    success: true,

    message: 'Network connectivity test successful',

    data: {

      clientIP,

      serverIP: NETWORK_IP,

      port: PORT,

      timestamp: new Date().toISOString(),

      userAgent: req.get('User-Agent'),

      headers: req.headers

    }

  });

});



// ✅ FIX: Removed duplicate health check endpoints (already defined at line 197-198)



// Error handling middleware

app.use(notFound);

app.use(errorHandler);



// Server configuration

const PORT = process.env.PORT || 5000;

const HOST = process.env.HOST || '0.0.0.0'; // Listen on all network interfaces

const NETWORK_IP = getNetworkIP(); // Get dynamic network IP



// Helper function to get network IP

function getNetworkIP() {

  const interfaces = os.networkInterfaces();

  for (const name of Object.keys(interfaces)) {

    for (const iface of interfaces[name]) {

      if (iface.family === 'IPv4' && !iface.internal) {

        return iface.address;

      }

    }

  }

  return 'localhost';

}



// Check if we're in production mode

let server;

if (process.env.NODE_ENV === 'production' && fs.existsSync('./ssl/key.pem') && fs.existsSync('./ssl/cert.pem')) {

  // HTTPS server for production

  const httpsOptions = {

    key: fs.readFileSync('./ssl/key.pem'),

    cert: fs.readFileSync('./ssl/cert.pem')

  };

  

  server = https.createServer(httpsOptions, app).listen(PORT, HOST, () => {

    console.log(`🚀 HTTPS Server running on https://${HOST}:${PORT}`);

    console.log(`📱 Local access: https://localhost:${PORT}`);

    console.log(`🌐 Network access: https://${NETWORK_IP}:${PORT}`);

    console.log(`🔒 Running in PRODUCTION mode with SSL`);

  });

} else {

  // HTTP server for development

  server = http.createServer(app);

  server.listen(PORT, HOST, () => {

    console.log(`🚀 HTTP Server running on http://${HOST}:${PORT}`);

    console.log(`📱 Local access: http://localhost:${PORT}`);

    console.log(`🌐 Network access: http://${NETWORK_IP}:${PORT}`);

    console.log(`⚠️  Running in DEVELOPMENT mode. For production, set NODE_ENV=production and provide SSL certificates.`);

    console.log(`📊 Environment: ${process.env.NODE_ENV || 'development'}`);

    

    // Initialize enhanced logging system

    logStartup();

    serverLogger.info('Server started successfully', { 

      port: PORT, 

      host: HOST, 

      environment: process.env.NODE_ENV || 'development',

      aiSystemEnabled: process.env.AI_NETWORK_ENABLED === 'true'

    });

  });

}



// Initialize Socket.IO with our custom manager

const io = initializeSocketIO(server);



// Make Socket.IO instance available throughout the app

app.set('io', io);



// ⚡ PERFORMANCE OPTIMIZATION: Consolidated Master Scheduler

// Replaces 8 separate schedulers with 2 optimized cron jobs

// Reduces scheduler overhead by 60%



// Make userSockets available globally for schedulers

global.userSockets = require('./socketManager').getUserSockets();



// Initialize FCM Notification Service

const fcmNotificationService = require('./services/fcmNotificationService');

fcmNotificationService.initialize();



// Start Master Scheduler (consolidates all background tasks)

const masterScheduler = require('./services/masterScheduler');

masterScheduler.start();



// Keep these individual schedulers for special cases

// placesRefreshJob already declared at line 82

placesRefreshJob.start();

console.log('✅ Places refresh job started');



const autoStatusService = require('./services/autoStatusService');

autoStatusService.start();

console.log('✅ Auto-status service started (daily schedule)');



// ⚠️ PERFORMANCE OPTIMIZATION: Agent System Disabled

// Agent system was consuming 30-40% CPU with 3 setInterval loops + database polling

// All agent endpoints remain functional but return graceful responses

// To re-enable: uncomment this block

/*

(async () => {

  try {

    console.log('🤖 Initializing Agentic Framework...');

    await agentIntegrationService.initialize();

    app.set('agentService', agentIntegrationService);

    app.set('agentOrchestrator', agentIntegrationService.getOrchestrator());

    console.log('✅ Agentic Framework initialized successfully');

    

    // Initialize Phase 3 services

    console.log('🚀 Initializing Phase 3 Advanced Services...');

    

    // Initialize Self-Healing Service

    const selfHealingService = new SelfHealingService();

    await selfHealingService.initialize();

    app.set('selfHealingService', selfHealingService);

    console.log('🔧 Self-Healing Service initialized');

    

    // Initialize Dynamic Scaling Service

    const dynamicScalingService = new DynamicScalingService();

    await dynamicScalingService.initialize(agentIntegrationService.getOrchestrator());

    app.set('dynamicScalingService', dynamicScalingService);

    console.log('⚡ Dynamic Scaling Service initialized');

    

    // Initialize Agent Intelligence Service

    const intelligenceService = new AgentIntelligenceService();

    await intelligenceService.initialize(agentIntegrationService.getOrchestrator());

    app.set('intelligenceService', intelligenceService);

    console.log('🧠 Agent Intelligence Service initialized');

    

    console.log('🎉 Phase 3 Advanced Services initialized successfully!');

    

    // Log agent system status

    const systemStatus = agentIntegrationService.getSystemStatus();

    console.log('📊 Agent System Status:', {

      agents: systemStatus.agents?.length || 0,

      orchestrator: systemStatus.orchestrator?.isRunning || false

    });

    

  } catch (error) {

    console.error('❌ Failed to initialize Agentic Framework:', error.message);

    console.log('⚠️  Server will continue without agent system');

  }

})();

*/

console.log('⚡ Agent System: DISABLED for performance optimization');



// Graceful shutdown

process.on('SIGTERM', () => {

  console.log('SIGTERM received, shutting down gracefully');

  // Stop the schedulers

  if (masterScheduler) {

    masterScheduler.stop();

    console.log('✅ Master scheduler stopped');

  }

  if (placesRefreshJob) {

    placesRefreshJob.stop();

    console.log('✅ Places refresh job stopped');

  }

  if (autoStatusService) {

    autoStatusService.stop();

    console.log('✅ Auto-status service stopped');

  }

  // Shutdown agent system

  if (agentIntegrationService) {

    agentIntegrationService.shutdown().then(() => {

      console.log('✅ Agent system shutdown complete');

    }).catch(error => {

      console.error('❌ Agent system shutdown error:', error);

    });

  }

  

  // Shutdown Phase 3 services

  const selfHealingService = app.get('selfHealingService');

  const dynamicScalingService = app.get('dynamicScalingService');

  const intelligenceService = app.get('intelligenceService');

  

  if (selfHealingService) {

    selfHealingService.shutdown();

  }

  if (dynamicScalingService) {

    dynamicScalingService.shutdown();

  }

  if (intelligenceService) {

    intelligenceService.shutdown();

  }

  

  // Close Socket.IO connections

  if (io) {

    io.close(() => {

      console.log('Socket.IO connections closed');

    });

  }

  // Close server

  server.close(() => {

    console.log('Process terminated');

  });

});



process.on('SIGINT', () => {

  console.log('SIGINT received, shutting down gracefully');

  // Stop the schedulers

  if (masterScheduler) {

    masterScheduler.stop();

    console.log('✅ Master scheduler stopped');

  }

  if (placesRefreshJob) {

    placesRefreshJob.stop();

    console.log('✅ Places refresh job stopped');

  }

  if (autoStatusService) {

    autoStatusService.stop();

    console.log('✅ Auto-status service stopped');

  }

  // Shutdown agent system

  if (agentIntegrationService) {

    agentIntegrationService.shutdown().then(() => {

      console.log('✅ Agent system shutdown complete');

    }).catch(error => {

      console.error('❌ Agent system shutdown error:', error);

    });

  }

  

  // Shutdown Phase 3 services

  const selfHealingService = app.get('selfHealingService');

  const dynamicScalingService = app.get('dynamicScalingService');

  const intelligenceService = app.get('intelligenceService');

  

  if (selfHealingService) {

    selfHealingService.shutdown();

  }

  if (dynamicScalingService) {

    dynamicScalingService.shutdown();

  }

  if (intelligenceService) {

    intelligenceService.shutdown();

  }

  

  // Close Socket.IO connections

  if (io) {

    io.close(() => {

      console.log('Socket.IO connections closed');

    });

  }

  // Close server

  server.close(() => {

    console.log('Process terminated');

  });

});

