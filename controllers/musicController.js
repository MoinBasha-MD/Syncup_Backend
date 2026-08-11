const fs = require('fs');
const path = require('path');
const MusicTrack = require('../models/MusicTrack');

const MUSIC_DIR = path.join(__dirname, '..', 'uploads', 'music-library');
const SUPPORTED_EXTENSIONS = ['.mp3', '.m4a', '.ogg', '.wav'];

// Auto-sync: scan folder for new files and add them to the database
// This runs once per server start (cached) and can be triggered manually
let lastSyncTime = 0;
const SYNC_INTERVAL = 60 * 1000; // Re-sync every 60 seconds max

const autoSyncMusicFolder = async () => {
  const now = Date.now();
  if (now - lastSyncTime < SYNC_INTERVAL) return; // Skip if recently synced
  lastSyncTime = now;

  try {
    if (!fs.existsSync(MUSIC_DIR)) return;

    const files = fs.readdirSync(MUSIC_DIR).filter(f =>
      SUPPORTED_EXTENSIONS.includes(path.extname(f).toLowerCase())
    );

    // Get all filenames already in DB
    const existingTracks = await MusicTrack.find({}).select('filename').lean();
    const existingFilenames = new Set(existingTracks.map(t => t.filename));

    // Find new files not in DB
    const newFiles = files.filter(f => !existingFilenames.has(f));

    if (newFiles.length === 0) return;

    console.log(`🎵 [AUTO-SYNC] Found ${newFiles.length} new music files, adding to library...`);

    for (const filename of newFiles) {
      // Generate a nice title from filename
      const baseName = path.basename(filename, path.extname(filename));
      const title = baseName
        .replace(/_/g, ' ')
        .replace(/-/g, ' ')
        .replace(/\b\w/g, c => c.toUpperCase())
        .trim();

      // Try to get file size to estimate duration (rough: ~16KB per second for 128kbps MP3)
      let duration = 30;
      try {
        const stat = fs.statSync(path.join(MUSIC_DIR, filename));
        duration = Math.round(stat.size / (16 * 1024)); // Rough estimate
        if (duration < 5) duration = 30; // Fallback for very small files
        if (duration > 600) duration = 600; // Cap at 10 minutes
      } catch (_) {}

      // Generate placeholder waveform
      const waveform = [];
      for (let i = 0; i < 50; i++) {
        const base = 0.3 + Math.random() * 0.5;
        const peak = Math.sin((i / 50) * Math.PI) * 0.3;
        waveform.push(parseFloat(Math.min(1, Math.max(0, base + peak)).toFixed(3)));
      }

      await MusicTrack.create({
        title,
        artist: 'SyncUp Originals',
        filename,
        duration,
        category: 'chill',
        tags: ['music'],
        waveform,
        isActive: true,
        usageCount: 0
      });

      console.log(`  ✅ Added: ${title} (${filename}, ~${duration}s)`);
    }

    console.log(`🎵 [AUTO-SYNC] Done! ${newFiles.length} tracks added.`);
  } catch (error) {
    console.error('⚠️ [AUTO-SYNC] Error syncing music folder:', error.message);
  }
};

// GET /api/music/library - Browse all tracks with filtering
const getMusicLibrary = async (req, res) => {
  try {
    // Auto-sync new files from the folder
    await autoSyncMusicFolder();

    const { category, search, page = 1, limit = 30 } = req.query;

    const filter = { isActive: true };

    if (category && category !== 'all') {
      filter.category = category;
    }

    if (search && search.trim()) {
      filter.$or = [
        { title: { $regex: search.trim(), $options: 'i' } },
        { artist: { $regex: search.trim(), $options: 'i' } },
        { tags: { $regex: search.trim(), $options: 'i' } }
      ];
    }

    const skip = (parseInt(page) - 1) * parseInt(limit);

    const [tracks, total] = await Promise.all([
      MusicTrack.find(filter)
        .sort({ usageCount: -1, createdAt: -1 })
        .skip(skip)
        .limit(parseInt(limit))
        .lean(),
      MusicTrack.countDocuments(filter)
    ]);

    res.json({
      success: true,
      data: tracks,
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
        total,
        pages: Math.ceil(total / parseInt(limit))
      }
    });
  } catch (error) {
    console.error('❌ Get music library error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch music library',
      error: error.message
    });
  }
};

// GET /api/music/trending - Top tracks by usage
const getTrendingTracks = async (req, res) => {
  try {
    const { limit = 10 } = req.query;

    const tracks = await MusicTrack.find({ isActive: true })
      .sort({ usageCount: -1 })
      .limit(parseInt(limit))
      .lean();

    res.json({
      success: true,
      data: tracks
    });
  } catch (error) {
    console.error('❌ Get trending tracks error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch trending tracks',
      error: error.message
    });
  }
};

// GET /api/music/stream/:filename - Stream audio with Range request support
const streamMusic = async (req, res) => {
  try {
    const { filename } = req.params;

    // Security: prevent path traversal
    const safeName = path.basename(filename);
    const filePath = path.join(MUSIC_DIR, safeName);

    if (!fs.existsSync(filePath)) {
      return res.status(404).json({
        success: false,
        message: 'Music file not found'
      });
    }

    const stat = fs.statSync(filePath);
    const fileSize = stat.size;
    const range = req.headers.range;

    // Determine content type
    const ext = path.extname(safeName).toLowerCase();
    const contentType = ext === '.mp3' ? 'audio/mpeg'
      : ext === '.m4a' ? 'audio/mp4'
      : ext === '.ogg' ? 'audio/ogg'
      : ext === '.wav' ? 'audio/wav'
      : 'audio/mpeg';

    if (!range) {
      // No range header — send entire file
      const head = {
        'Content-Length': fileSize,
        'Content-Type': contentType,
        'Accept-Ranges': 'bytes',
        'Cache-Control': 'public, max-age=31536000',
        'X-Content-Type-Options': 'nosniff'
      };
      res.writeHead(200, head);
      fs.createReadStream(filePath).pipe(res);
      return;
    }

    // Parse range header for seeking/partial content
    const parts = range.replace(/bytes=/, '').split('-');
    const start = parseInt(parts[0], 10);
    const end = parts[1] ? parseInt(parts[1], 10) : fileSize - 1;

    if (start >= fileSize || end >= fileSize) {
      res.writeHead(416, {
        'Content-Range': `bytes */${fileSize}`
      });
      return res.end();
    }

    const chunkSize = (end - start) + 1;
    const file = fs.createReadStream(filePath, { start, end });

    const head = {
      'Content-Range': `bytes ${start}-${end}/${fileSize}`,
      'Accept-Ranges': 'bytes',
      'Content-Length': chunkSize,
      'Content-Type': contentType,
      'Cache-Control': 'public, max-age=31536000',
      'X-Content-Type-Options': 'nosniff'
    };

    res.writeHead(206, head);
    file.pipe(res);
  } catch (error) {
    console.error('❌ Stream music error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to stream music',
      error: error.message
    });
  }
};

// GET /api/music/:trackId - Get single track details
const getTrackById = async (req, res) => {
  try {
    const { trackId } = req.params;

    const track = await MusicTrack.findById(trackId).lean();
    if (!track) {
      return res.status(404).json({
        success: false,
        message: 'Track not found'
      });
    }

    res.json({
      success: true,
      data: track
    });
  } catch (error) {
    console.error('❌ Get track error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch track',
      error: error.message
    });
  }
};

// POST /api/music/increment-usage/:trackId - Increment usage count when a post uses this track
const incrementUsage = async (req, res) => {
  try {
    const { trackId } = req.params;

    // Only increment for valid MongoDB ObjectIds
    if (!/^[0-9a-fA-F]{24}$/.test(trackId)) {
      return res.json({ success: true, data: { usageCount: 0 } });
    }

    const track = await MusicTrack.findByIdAndUpdate(
      trackId,
      { $inc: { usageCount: 1 } },
      { new: true }
    );

    if (!track) {
      return res.status(404).json({
        success: false,
        message: 'Track not found'
      });
    }

    res.json({
      success: true,
      data: { usageCount: track.usageCount }
    });
  } catch (error) {
    console.error('❌ Increment usage error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to increment usage',
      error: error.message
    });
  }
};

// GET /api/music/categories - Get available music categories
const getCategories = async (req, res) => {
  try {
    const categories = await MusicTrack.aggregate([
      { $match: { isActive: true } },
      { $group: { _id: '$category', count: { $sum: 1 } } },
      { $sort: { count: -1 } }
    ]);

    res.json({
      success: true,
      data: categories.map(c => ({ category: c._id, count: c.count }))
    });
  } catch (error) {
    console.error('❌ Get categories error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch categories',
      error: error.message
    });
  }
};

// POST /api/music/sync - Force re-sync the music folder (admin endpoint)
const forceSync = async (req, res) => {
  try {
    lastSyncTime = 0; // Reset timer to force sync
    await autoSyncMusicFolder();
    
    const total = await MusicTrack.countDocuments({ isActive: true });
    res.json({
      success: true,
      message: 'Music folder synced',
      totalTracks: total
    });
  } catch (error) {
    console.error('❌ Force sync error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to sync music folder',
      error: error.message
    });
  }
};

module.exports = {
  getMusicLibrary,
  getTrendingTracks,
  streamMusic,
  getTrackById,
  incrementUsage,
  getCategories,
  forceSync
};
