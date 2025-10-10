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
const diyaRequestRoutes = require('./routes/diyaRequestRoutes');
const diyaMemoryRoutes = require('./routes/diyaMemoryRoutes');
const aiMessageRoutes = require('./routes/aiMessageRoutes');
const aiInstanceRoutes = require('./routes/aiInstanceRoutes');
const aiCommunicationRoutes = require('./routes/aiCommunicationRoutes');
const globalSearchRoutes = require('./routes/globalSearchRoutes');
const connectionRoutes = require('./routes/connectionRoutes');
const blockRoutes = require('./routes/blockRoutes');
const container = require('./config/container');
const { initializeSocketIO } = require('./socketManager');
const { logStartup, serverLogger } = require('./utils/loggerSetup');

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

// Start memory monitoring
memoryMonitor();

// Security middleware (order matters!)
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
  limit: '10mb',
  verify: (req, res, buf) => {
    // Store raw body for webhook verification if needed
    req.rawBody = buf;
  }
})); // Limit request body size
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

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
    // Allow requests with no origin (like mobile apps, curl, etc.)
    if (!origin) return callback(null, true);
    
    // Allow all origins in development mode
    if (process.env.NODE_ENV !== 'production') {
      return callback(null, true);
    }
    
    // In production, check allowed origins
    const allowedOrigins = process.env.ALLOWED_ORIGINS?.split(',') || [];
    if (allowedOrigins.includes(origin)) {
      return callback(null, true);
    }
    
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

// Health check and monitoring routes (before API versioning)
const { healthCheck, liveness, readiness, metrics } = require('./middleware/healthCheckMiddleware');
app.get('/health', healthCheck);
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
app.use('/api/bulk', apiLimiter, bulkOperationsRoutes); // Bulk operations
app.use('/api/contacts', contactLimiter, contactRoutes); // Contact management routes
app.use('/api/upload', apiLimiter, uploadRoutes); // File upload routes
app.use('/api/calendar', apiLimiter, calendarRoutes); // Calendar integration routes
app.use('/api/chat', apiLimiter, chatRoutes); // Chat messaging routes
app.use('/api/groups', apiLimiter, groupRoutes); // Contact group management routes
app.use('/api/group-chats', apiLimiter, groupChatRoutes); // Group chat messaging routes
app.use('/api/posts', apiLimiter, postRoutes); // User posts management routes
app.use('/api/stories', apiLimiter, storyRoutes); // Stories management routes
app.use('/api/diya', apiLimiter, diyaRequestRoutes); // Cross-user Diya communication routes
app.use('/api/diya', apiLimiter, diyaMemoryRoutes); // Diya conversation memory routes
app.use('/api/ai', apiLimiter, aiMessageRoutes); // AI-to-AI messaging routes (legacy)
app.use('/api/ai', apiLimiter, aiInstanceRoutes); // AI instance management routes
app.use('/api/ai', apiLimiter, aiCommunicationRoutes); // AI-to-AI communication routes
app.use('/api/search', apiLimiter, globalSearchRoutes); // Global user search routes
app.use('/api/connections', apiLimiter, connectionRoutes); // Connection request management routes
app.use('/api/blocks', apiLimiter, blockRoutes); // User blocking management routes

// Serve static files from the uploads directory
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));
app.use('/admin', express.static(path.join(__dirname, 'public/admin')));

// Also serve uploads under /api/uploads for compatibility
app.use('/api/uploads', express.static(path.join(__dirname, 'uploads')));

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
      ai: '/api/ai'
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

// Enhanced health check endpoint
app.get('/health', (req, res) => {
  const uptime = process.uptime();
  const memoryUsage = process.memoryUsage();
  
  res.status(200).json({
    status: 'UP',
    uptime: Math.floor(uptime),
    memory: {
      used: Math.round(memoryUsage.heapUsed / 1024 / 1024),
      total: Math.round(memoryUsage.heapTotal / 1024 / 1024),
      external: Math.round(memoryUsage.external / 1024 / 1024)
    },
    timestamp: new Date().toISOString(),
    version: '1.0.0'
  });
});

// Health check endpoint
app.get('/health', (req, res) => {
  res.status(200).json({ status: 'UP' });
});

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

// Start the scheduler for automatic status updates
const schedulerRunner = require('./utils/schedulerRunner');
schedulerRunner.start();
console.log('Status scheduler started');

// Graceful shutdown
process.on('SIGTERM', () => {
  console.log('SIGTERM received, shutting down gracefully');
  // Stop the scheduler
  if (schedulerRunner) {
    schedulerRunner.stop();
    console.log('Status scheduler stopped');
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
  // Stop the scheduler
  if (schedulerRunner) {
    schedulerRunner.stop();
    console.log('Status scheduler stopped');
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
