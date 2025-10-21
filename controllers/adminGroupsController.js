const GroupModel = require('../models/groupModel');
const User = require('../models/userModel');

/**
 * Show groups list
 */
const showGroupsList = async (req, res) => {
  try {
    const page = parseInt(req.query.page) || 1;
    const limit = 20;
    const skip = (page - 1) * limit;
    const search = req.query.search || '';
    
    let query = {};
    if (search) {
      query.name = { $regex: search, $options: 'i' };
    }
    
    const [groups, totalGroups] = await Promise.all([
      GroupModel.find(query)
        .populate('createdBy', 'name phoneNumber')
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit)
        .lean(),
      GroupModel.countDocuments(query)
    ]);
    
    const totalPages = Math.ceil(totalGroups / limit);
    
    res.render('admin/groups/list', {
      title: 'Groups',
      layout: 'admin/layouts/main',
      groups,
      currentPage: page,
      totalPages,
      totalGroups,
      search
    });
  } catch (error) {
    console.error('Groups list error:', error);
    res.status(500).send('Error loading groups');
  }
};

/**
 * Show group details
 */
const showGroupDetails = async (req, res) => {
  try {
    const group = await GroupModel.findById(req.params.id)
      .populate('createdBy', 'name phoneNumber email')
      .populate('members', 'name phoneNumber email')
      .lean();
    
    if (!group) {
      return res.status(404).send('Group not found');
    }
    
    res.render('admin/groups/details', {
      title: 'Group Details',
      layout: 'admin/layouts/main',
      group
    });
  } catch (error) {
    console.error('Group details error:', error);
    res.status(500).send('Error loading group details');
  }
};

/**
 * Show create group form
 */
const showCreateGroupForm = async (req, res) => {
  try {
    const users = await User.find({ isActive: true })
      .select('name phoneNumber email')
      .limit(100)
      .lean();
    
    res.render('admin/groups/create', {
      title: 'Create Group',
      layout: 'admin/layouts/main',
      users
    });
  } catch (error) {
    console.error('Create group form error:', error);
    res.status(500).send('Error loading form');
  }
};

/**
 * Create group
 */
const createGroup = async (req, res) => {
  try {
    const { name, description, createdBy, members } = req.body;
    
    const group = new GroupModel({
      name,
      description,
      createdBy,
      members: members || [],
      membersCount: (members || []).length
    });
    
    await group.save();
    
    res.json({ success: true, message: 'Group created successfully', groupId: group._id });
  } catch (error) {
    console.error('Create group error:', error);
    res.status(500).json({ success: false, message: 'Error creating group' });
  }
};

/**
 * Show edit group form
 */
const showEditGroupForm = async (req, res) => {
  try {
    const group = await GroupModel.findById(req.params.id)
      .populate('members', 'name phoneNumber')
      .lean();
    
    if (!group) {
      return res.status(404).send('Group not found');
    }
    
    const users = await User.find({ isActive: true })
      .select('name phoneNumber email')
      .limit(100)
      .lean();
    
    res.render('admin/groups/edit', {
      title: 'Edit Group',
      layout: 'admin/layouts/main',
      group,
      users
    });
  } catch (error) {
    console.error('Edit group form error:', error);
    res.status(500).send('Error loading form');
  }
};

/**
 * Update group
 */
const updateGroup = async (req, res) => {
  try {
    const { name, description, members } = req.body;
    
    const group = await GroupModel.findById(req.params.id);
    
    if (!group) {
      return res.status(404).json({ success: false, message: 'Group not found' });
    }
    
    group.name = name || group.name;
    group.description = description || group.description;
    if (members) {
      group.members = members;
      group.membersCount = members.length;
    }
    
    await group.save();
    
    res.json({ success: true, message: 'Group updated successfully' });
  } catch (error) {
    console.error('Update group error:', error);
    res.status(500).json({ success: false, message: 'Error updating group' });
  }
};

/**
 * Delete group
 */
const deleteGroup = async (req, res) => {
  try {
    await GroupModel.findByIdAndDelete(req.params.id);
    res.json({ success: true, message: 'Group deleted successfully' });
  } catch (error) {
    console.error('Delete group error:', error);
    res.status(500).json({ success: false, message: 'Error deleting group' });
  }
};

module.exports = {
  showGroupsList,
  showGroupDetails,
  showCreateGroupForm,
  createGroup,
  showEditGroupForm,
  updateGroup,
  deleteGroup
};
