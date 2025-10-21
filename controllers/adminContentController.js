const Post = require('../models/postModel');
const Story = require('../models/storyModel');

/**
 * Show content management page
 */
const showContentPage = async (req, res) => {
  try {
    const User = require('../models/userModel');
    
    const [totalPosts, totalStories, activeStories] = await Promise.all([
      Post.countDocuments(),
      Story.countDocuments(),
      Story.countDocuments({ expiresAt: { $gt: new Date() } })
    ]);
    
    // Get posts and manually populate user data
    const posts = await Post.find()
      .sort({ createdAt: -1 })
      .limit(10)
      .lean();
    
    const stories = await Story.find()
      .sort({ createdAt: -1 })
      .limit(10)
      .lean();
    
    // Get unique user IDs
    const postUserIds = [...new Set(posts.map(p => p.userId))];
    const storyUserIds = [...new Set(stories.map(s => s.userId))];
    const allUserIds = [...new Set([...postUserIds, ...storyUserIds])];
    
    // Fetch users
    const users = await User.find({ userId: { $in: allUserIds } })
      .select('userId name phoneNumber')
      .lean();
    
    // Create user map
    const userMap = {};
    users.forEach(u => {
      userMap[u.userId] = u;
    });
    
    // Attach user data to posts and stories
    const recentPosts = posts.map(p => ({
      ...p,
      user: userMap[p.userId] || null
    }));
    
    const recentStories = stories.map(s => ({
      ...s,
      user: userMap[s.userId] || null
    }));
    
    res.render('admin/content/index', {
      title: 'Content',
      layout: 'admin/layouts/main',
      totalPosts,
      totalStories,
      activeStories,
      recentPosts,
      recentStories
    });
    
  } catch (error) {
    console.error('Content page error:', error);
    res.status(500).send('Error loading content');
  }
};

/**
 * Delete post
 */
const deletePost = async (req, res) => {
  try {
    await Post.findByIdAndDelete(req.params.id);
    res.json({ success: true, message: 'Post deleted successfully' });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Error deleting post' });
  }
};

/**
 * Delete story
 */
const deleteStory = async (req, res) => {
  try {
    await Story.findByIdAndDelete(req.params.id);
    res.json({ success: true, message: 'Story deleted successfully' });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Error deleting story' });
  }
};

module.exports = {
  showContentPage,
  deletePost,
  deleteStory
};
