// ADMIN PANEL ROUTES - COMMENTED OUT FOR PRODUCTION
// Uncomment these routes if you need admin panel functionality

/*
const express = require('express');
const router = express.Router();
const User = require('../models/userModel');
const Message = require('../models/Message');
const Post = require('../models/postModel');
const AIInstance = require('../models/aiInstanceModel');

// CORS middleware for React Admin
router.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', 'http://localhost:3000');
  res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  res.header('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept, Authorization, Range');
  res.header('Access-Control-Expose-Headers', 'X-Total-Count, Content-Range');
  
  if (req.method === 'OPTIONS') {
    res.sendStatus(200);
  } else {
    next();
  }
});

// USERS RESOURCE
// GET /api/users - List users with pagination
router.get('/users', async (req, res) => {
  try {
    const page = parseInt(req.query._page) || 1;
    const limit = parseInt(req.query._limit) || 10;
    const sort = req.query._sort || 'createdAt';
    const order = req.query._order === 'ASC' ? 1 : -1;
    
    // Handle search/filter
    let filter = {};
    if (req.query.q) {
      filter = {
        $or: [
          { name: { $regex: req.query.q, $options: 'i' } },
          { email: { $regex: req.query.q, $options: 'i' } },
          { phoneNumber: { $regex: req.query.q, $options: 'i' } }
        ]
      };
    }
    
    const skip = (page - 1) * limit;
    
    const [users, total] = await Promise.all([
      User.find(filter)
        .sort({ [sort]: order })
        .skip(skip)
        .limit(limit)
        .lean(),
      User.countDocuments(filter)
    ]);
    
    // React Admin expects specific headers
    res.set('X-Total-Count', total);
    res.set('Content-Range', `users ${skip}-${skip + users.length - 1}/${total}`);
    
    res.json(users.map(user => ({
      ...user,
      id: user._id.toString()
    })));
  } catch (error) {
    console.error('Error fetching users:', error);
    res.status(500).json({ error: 'Failed to fetch users' });
  }
});

// GET /api/users/:id - Get single user
router.get('/users/:id', async (req, res) => {
  try {
    const user = await User.findById(req.params.id).lean();
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }
    
    res.json({
      ...user,
      id: user._id.toString()
    });
  } catch (error) {
    console.error('Error fetching user:', error);
    res.status(500).json({ error: 'Failed to fetch user' });
  }
});

// PUT /api/users/:id - Update user
router.put('/users/:id', async (req, res) => {
  try {
    const { id, ...updateData } = req.body;
    
    const user = await User.findByIdAndUpdate(
      req.params.id,
      updateData,
      { new: true, runValidators: true }
    ).lean();
    
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }
    
    res.json({
      ...user,
      id: user._id.toString()
    });
  } catch (error) {
    console.error('Error updating user:', error);
    res.status(500).json({ error: 'Failed to update user' });
  }
});

// POST /api/users - Create user
router.post('/users', async (req, res) => {
  try {
    const userData = req.body;
    const user = new User(userData);
    await user.save();
    
    res.status(201).json({
      ...user.toObject(),
      id: user._id.toString()
    });
  } catch (error) {
    console.error('Error creating user:', error);
    res.status(500).json({ error: 'Failed to create user' });
  }
});

// DELETE /api/users/:id - Delete user
router.delete('/users/:id', async (req, res) => {
  try {
    const user = await User.findByIdAndDelete(req.params.id).lean();
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }
    
    res.json({
      ...user,
      id: user._id.toString()
    });
  } catch (error) {
    console.error('Error deleting user:', error);
    res.status(500).json({ error: 'Failed to delete user' });
  }
});

// MESSAGES RESOURCE
// GET /api/messages - List messages
router.get('/messages', async (req, res) => {
  try {
    const page = parseInt(req.query._page) || 1;
    const limit = parseInt(req.query._limit) || 10;
    const sort = req.query._sort || 'timestamp';
    const order = req.query._order === 'ASC' ? 1 : -1;
    
    const skip = (page - 1) * limit;
    
    const [messages, total] = await Promise.all([
      Message.find()
        .sort({ [sort]: order })
        .skip(skip)
        .limit(limit)
        .lean(),
      Message.countDocuments()
    ]);
    
    res.set('X-Total-Count', total);
    res.set('Content-Range', `messages ${skip}-${skip + messages.length - 1}/${total}`);
    
    res.json(messages.map(message => ({
      ...message,
      id: message._id.toString()
    })));
  } catch (error) {
    console.error('Error fetching messages:', error);
    res.status(500).json({ error: 'Failed to fetch messages' });
  }
});

// GET /api/messages/:id - Get single message
router.get('/messages/:id', async (req, res) => {
  try {
    const message = await Message.findById(req.params.id).lean();
    if (!message) {
      return res.status(404).json({ error: 'Message not found' });
    }
    
    res.json({
      ...message,
      id: message._id.toString()
    });
  } catch (error) {
    console.error('Error fetching message:', error);
    res.status(500).json({ error: 'Failed to fetch message' });
  }
});

// POSTS RESOURCE
// GET /api/posts - List posts
router.get('/posts', async (req, res) => {
  try {
    const page = parseInt(req.query._page) || 1;
    const limit = parseInt(req.query._limit) || 10;
    const sort = req.query._sort || 'createdAt';
    const order = req.query._order === 'ASC' ? 1 : -1;
    
    const skip = (page - 1) * limit;
    
    const [posts, total] = await Promise.all([
      Post.find()
        .sort({ [sort]: order })
        .skip(skip)
        .limit(limit)
        .lean(),
      Post.countDocuments()
    ]);
    
    res.set('X-Total-Count', total);
    res.set('Content-Range', `posts ${skip}-${skip + posts.length - 1}/${total}`);
    
    res.json(posts.map(post => ({
      ...post,
      id: post._id.toString()
    })));
  } catch (error) {
    console.error('Error fetching posts:', error);
    res.status(500).json({ error: 'Failed to fetch posts' });
  }
});

// GET /api/posts/:id - Get single post
router.get('/posts/:id', async (req, res) => {
  try {
    const post = await Post.findById(req.params.id).lean();
    if (!post) {
      return res.status(404).json({ error: 'Post not found' });
    }
    
    res.json({
      ...post,
      id: post._id.toString()
    });
  } catch (error) {
    console.error('Error fetching post:', error);
    res.status(500).json({ error: 'Failed to fetch post' });
  }
});

// PUT /api/posts/:id - Update post
router.put('/posts/:id', async (req, res) => {
  try {
    const { id, ...updateData } = req.body;
    
    const post = await Post.findByIdAndUpdate(
      req.params.id,
      updateData,
      { new: true, runValidators: true }
    ).lean();
    
    if (!post) {
      return res.status(404).json({ error: 'Post not found' });
    }
    
    res.json({
      ...post,
      id: post._id.toString()
    });
  } catch (error) {
    console.error('Error updating post:', error);
    res.status(500).json({ error: 'Failed to update post' });
  }
});

// POST /api/posts - Create post
router.post('/posts', async (req, res) => {
  try {
    const postData = req.body;
    const post = new Post(postData);
    await post.save();
    
    res.status(201).json({
      ...post.toObject(),
      id: post._id.toString()
    });
  } catch (error) {
    console.error('Error creating post:', error);
    res.status(500).json({ error: 'Failed to create post' });
  }
});

// DELETE /api/posts/:id - Delete post
router.delete('/posts/:id', async (req, res) => {
  try {
    const post = await Post.findByIdAndDelete(req.params.id).lean();
    if (!post) {
      return res.status(404).json({ error: 'Post not found' });
    }
    
    res.json({
      ...post,
      id: post._id.toString()
    });
  } catch (error) {
    console.error('Error deleting post:', error);
    res.status(500).json({ error: 'Failed to delete post' });
  }
});

// AI INSTANCES RESOURCE
// GET /api/ai-instances - List AI instances
router.get('/ai-instances', async (req, res) => {
  try {
    const page = parseInt(req.query._page) || 1;
    const limit = parseInt(req.query._limit) || 10;
    const sort = req.query._sort || 'createdAt';
    const order = req.query._order === 'ASC' ? 1 : -1;
    
    // Handle search/filter
    let filter = {};
    if (req.query.q) {
      filter = {
        $or: [
          { aiName: { $regex: req.query.q, $options: 'i' } },
          { aiId: { $regex: req.query.q, $options: 'i' } },
          { userId: { $regex: req.query.q, $options: 'i' } }
        ]
      };
    }
    
    if (req.query.status) {
      filter.status = req.query.status;
    }
    
    const skip = (page - 1) * limit;
    
    const [aiInstances, total] = await Promise.all([
      AIInstance.find(filter)
        .sort({ [sort]: order })
        .skip(skip)
        .limit(limit)
        .lean(),
      AIInstance.countDocuments(filter)
    ]);
    
    res.set('X-Total-Count', total);
    res.set('Content-Range', `ai-instances ${skip}-${skip + aiInstances.length - 1}/${total}`);
    
    res.json(aiInstances.map(ai => ({
      ...ai,
      id: ai._id.toString()
    })));
  } catch (error) {
    console.error('Error fetching AI instances:', error);
    res.status(500).json({ error: 'Failed to fetch AI instances' });
  }
});

// GET /api/ai-instances/:id - Get single AI instance
router.get('/ai-instances/:id', async (req, res) => {
  try {
    const aiInstance = await AIInstance.findById(req.params.id).lean();
    if (!aiInstance) {
      return res.status(404).json({ error: 'AI instance not found' });
    }
    
    res.json({
      ...aiInstance,
      id: aiInstance._id.toString()
    });
  } catch (error) {
    console.error('Error fetching AI instance:', error);
    res.status(500).json({ error: 'Failed to fetch AI instance' });
  }
});

// PUT /api/ai-instances/:id - Update AI instance
router.put('/ai-instances/:id', async (req, res) => {
  try {
    const { id, ...updateData } = req.body;
    
    const aiInstance = await AIInstance.findByIdAndUpdate(
      req.params.id,
      updateData,
      { new: true, runValidators: true }
    ).lean();
    
    if (!aiInstance) {
      return res.status(404).json({ error: 'AI instance not found' });
    }
    
    res.json({
      ...aiInstance,
      id: aiInstance._id.toString()
    });
  } catch (error) {
    console.error('Error updating AI instance:', error);
    res.status(500).json({ error: 'Failed to update AI instance' });
  }
});

// POST /api/ai-instances - Create AI instance
router.post('/ai-instances', async (req, res) => {
  try {
    const aiData = req.body;
    const aiInstance = new AIInstance(aiData);
    await aiInstance.save();
    
    res.status(201).json({
      ...aiInstance.toObject(),
      id: aiInstance._id.toString()
    });
  } catch (error) {
    console.error('Error creating AI instance:', error);
    res.status(500).json({ error: 'Failed to create AI instance' });
  }
});

// DELETE /api/ai-instances/:id - Delete AI instance
router.delete('/ai-instances/:id', async (req, res) => {
  try {
    const aiInstance = await AIInstance.findByIdAndDelete(req.params.id).lean();
    if (!aiInstance) {
      return res.status(404).json({ error: 'AI instance not found' });
    }
    
    res.json({
      ...aiInstance,
      id: aiInstance._id.toString()
    });
  } catch (error) {
    console.error('Error deleting AI instance:', error);
    res.status(500).json({ error: 'Failed to delete AI instance' });
  }
});
*/

// Export empty router when admin routes are disabled
const express = require('express');
const router = express.Router();
module.exports = router;
