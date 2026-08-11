/**
 * Seed script: Populates MusicTrack collection from files in uploads/music-library/
 * 
 * Usage:
 *   node seedMusicLibrary.js
 * 
 * This reads all MP3 files in uploads/music-library/, extracts metadata,
 * and upserts them into the MusicTrack collection.
 */

const path = require('path');
const fs = require('fs');
const mongoose = require('mongoose');

// Load environment
require('dotenv').config();

const MusicTrack = require('./models/MusicTrack');

const MUSIC_DIR = path.join(__dirname, 'uploads', 'music-library');

// Track metadata (manually curated for our initial library)
const TRACK_METADATA = {
  'between_the_lines.mp3': {
    title: 'Between The Lines',
    artist: 'SyncUp Originals',
    category: 'ambient',
    tags: ['calm', 'reflective', 'mood', 'chill'],
    duration: 30.7
  },
  'my_own_becoming.mp3': {
    title: 'My Own Becoming',
    artist: 'SyncUp Originals',
    category: 'indie',
    tags: ['growth', 'motivation', 'uplifting', 'journey'],
    duration: 30.7
  },
  'One_Little_Click.mp3': {
    title: 'One Little Click',
    artist: 'SyncUp Originals',
    category: 'pop',
    tags: ['fun', 'playful', 'social', 'connection'],
    duration: 30.7
  },
  'stillness_as_a_friend.mp3': {
    title: 'Stillness As A Friend',
    artist: 'SyncUp Originals',
    category: 'ambient',
    tags: ['peaceful', 'meditation', 'quiet', 'calm'],
    duration: 30.7
  },
  'still_becoming.mp3': {
    title: 'Still Becoming',
    artist: 'SyncUp Originals',
    category: 'lo-fi',
    tags: ['introspective', 'study', 'focus', 'soft'],
    duration: 30.7
  },
  'the_best_version_of_me.mp3': {
    title: 'The Best Version Of Me',
    artist: 'SyncUp Originals',
    category: 'upbeat',
    tags: ['positive', 'energy', 'confidence', 'happy'],
    duration: 30.7
  },
  'where_gravity_fails.mp3': {
    title: 'Where Gravity Fails',
    artist: 'SyncUp Originals',
    category: 'electronic',
    tags: ['dreamy', 'space', 'ethereal', 'float'],
    duration: 30.7
  }
};

// Generate a simple waveform (random normalized values) as placeholder
function generatePlaceholderWaveform(samples = 50) {
  const waveform = [];
  for (let i = 0; i < samples; i++) {
    const base = 0.3 + Math.random() * 0.5;
    const peak = Math.sin((i / samples) * Math.PI) * 0.3;
    waveform.push(parseFloat(Math.min(1, Math.max(0, base + peak)).toFixed(3)));
  }
  return waveform;
}

async function seedMusicLibrary() {
  try {
    const mongoUri = process.env.MONGODB_URI || process.env.MONGO_URI || 'mongodb://localhost:27017/syncup';
    console.log('🎵 Connecting to MongoDB...');
    await mongoose.connect(mongoUri);
    console.log('✅ Connected to MongoDB');

    if (!fs.existsSync(MUSIC_DIR)) {
      console.error('❌ Music directory not found:', MUSIC_DIR);
      process.exit(1);
    }

    const files = fs.readdirSync(MUSIC_DIR).filter(f => 
      ['.mp3', '.m4a', '.ogg', '.wav'].includes(path.extname(f).toLowerCase())
    );

    console.log(`🎵 Found ${files.length} audio files in ${MUSIC_DIR}`);

    let created = 0;
    let updated = 0;

    for (const filename of files) {
      const metadata = TRACK_METADATA[filename];

      if (!metadata) {
        console.log(`⚠️  No metadata for ${filename}, using defaults`);
        const baseName = path.basename(filename, path.extname(filename));
        const title = baseName.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
        
        await MusicTrack.findOneAndUpdate(
          { filename },
          {
            title,
            artist: 'SyncUp Originals',
            category: 'chill',
            tags: ['music'],
            duration: 30.7,
            filename,
            waveform: generatePlaceholderWaveform(),
            isActive: true
          },
          { upsert: true, new: true }
        );
        created++;
        continue;
      }

      const existing = await MusicTrack.findOne({ filename });
      
      await MusicTrack.findOneAndUpdate(
        { filename },
        {
          ...metadata,
          filename,
          waveform: generatePlaceholderWaveform(),
          isActive: true
        },
        { upsert: true, new: true, setDefaultsOnInsert: true }
      );

      if (!existing) {
        created++;
        console.log(`  ✅ Created: ${metadata.title}`);
      } else {
        updated++;
        console.log(`  🔄 Updated: ${metadata.title}`);
      }
    }

    console.log('\n🎵 Seed complete!');
    console.log(`   Created: ${created}`);
    console.log(`   Updated: ${updated}`);
    console.log(`   Total active tracks: ${await MusicTrack.countDocuments({ isActive: true })}`);

    await mongoose.disconnect();
    console.log('✅ Done');
    process.exit(0);
  } catch (error) {
    console.error('❌ Seed failed:', error);
    process.exit(1);
  }
}

seedMusicLibrary();
