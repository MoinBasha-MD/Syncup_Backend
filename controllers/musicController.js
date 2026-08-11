const fs = require('fs');
const path = require('path');
const MusicTrack = require('../models/MusicTrack');

const MUSIC_DIR = path.join(__dirname, '..', 'uploads', 'music-library');

// GET /api/music/library - Browse all tracks with filtering
const getMusicLibrary = async (req, res) => {
  try {
    const { category, search, page = 1, limit = 20 } = req.query;

    const filter = { isActive: true };

    if (category && category !== 'all') {
      filter.category = category;
    }

    let query;
    if (search && search.trim()) {
      // Text search on title, artist, tags
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

module.exports = {
  getMusicLibrary,
  getTrendingTracks,
  streamMusic,
  getTrackById,
  incrementUsage,
  getCategories
};
