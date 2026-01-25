const fs = require('fs');
const path = require('path');
const { serverLogger } = require('../utils/loggerSetup');

/**
 * Optimized Video Streaming Middleware
 * Implements proper HTTP range requests for efficient video streaming
 */

/**
 * Stream video files with proper range request support
 * This significantly improves video loading performance
 */
const streamVideo = (req, res, next) => {
  const videoPath = req.videoPath; // Set by route handler
  
  if (!videoPath) {
    return next();
  }

  // Check if file exists
  if (!fs.existsSync(videoPath)) {
    return res.status(404).json({
      success: false,
      message: 'Video file not found'
    });
  }

  const stat = fs.statSync(videoPath);
  const fileSize = stat.size;
  const range = req.headers.range;

  // If no range header, send entire file
  if (!range) {
    const head = {
      'Content-Length': fileSize,
      'Content-Type': 'video/mp4',
      'Accept-Ranges': 'bytes',
      'Cache-Control': 'public, max-age=31536000', // Cache for 1 year
      'X-Content-Type-Options': 'nosniff'
    };
    
    res.writeHead(200, head);
    fs.createReadStream(videoPath).pipe(res);
    return;
  }

  // Parse range header
  const parts = range.replace(/bytes=/, '').split('-');
  const start = parseInt(parts[0], 10);
  const end = parts[1] ? parseInt(parts[1], 10) : fileSize - 1;
  
  // Validate range
  if (start >= fileSize || end >= fileSize) {
    res.writeHead(416, {
      'Content-Range': `bytes */${fileSize}`
    });
    return res.end();
  }

  const chunksize = (end - start) + 1;
  const file = fs.createReadStream(videoPath, { start, end });
  
  const head = {
    'Content-Range': `bytes ${start}-${end}/${fileSize}`,
    'Accept-Ranges': 'bytes',
    'Content-Length': chunksize,
    'Content-Type': 'video/mp4',
    'Cache-Control': 'public, max-age=31536000', // Cache for 1 year
    'X-Content-Type-Options': 'nosniff'
  };

  res.writeHead(206, head);
  file.pipe(res);

  // Log slow streaming (>5 seconds for range requests)
  const startTime = Date.now();
  file.on('end', () => {
    const duration = Date.now() - startTime;
    if (duration > 5000) {
      serverLogger.warn('Slow video streaming detected', {
        path: videoPath,
        duration: `${duration}ms`,
        chunkSize: chunksize,
        range: `${start}-${end}`
      });
    }
  });

  file.on('error', (error) => {
    serverLogger.error('Video streaming error', {
      path: videoPath,
      error: error.message
    });
    if (!res.headersSent) {
      res.status(500).json({
        success: false,
        message: 'Error streaming video'
      });
    }
  });
};

/**
 * Middleware to handle video file requests with optimization
 */
const videoStreamingHandler = (uploadDir = 'post-media') => {
  return (req, res, next) => {
    const requestedPath = req.path;
    
    // Only handle video files
    if (!requestedPath.match(/\.(mp4|webm|ogg|mov)$/i)) {
      return next();
    }

    // Construct full video path
    const videoPath = path.join(__dirname, '..', 'uploads', uploadDir, path.basename(requestedPath));
    
    // Set video path for streaming middleware
    req.videoPath = videoPath;
    
    // Stream the video
    streamVideo(req, res, next);
  };
};

/**
 * Cache control for static media files
 */
const mediaCacheControl = (req, res, next) => {
  // Set cache headers for images and videos
  if (req.path.match(/\.(jpg|jpeg|png|gif|webp|mp4|webm|ogg|mov)$/i)) {
    res.set('Cache-Control', 'public, max-age=31536000'); // 1 year
    res.set('X-Content-Type-Options', 'nosniff');
  }
  next();
};

module.exports = {
  streamVideo,
  videoStreamingHandler,
  mediaCacheControl
};
