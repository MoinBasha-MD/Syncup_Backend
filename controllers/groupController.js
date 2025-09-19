const Group = require('../models/groupModel');
const User = require('../models/userModel');
const asyncHandler = require('express-async-handler');

/**
 * @desc    Get all groups for a user
 * @route   GET /api/groups
 * @access  Private
 */
const getUserGroups = asyncHandler(async (req, res) => {
  try {
    const groups = await Group.findByUserId(req.user._id);
    
    // Transform groups to match frontend interface
    const transformedGroups = groups.map(group => ({
      id: group.groupId,
      name: group.name,
      description: group.description,
      memberCount: group.memberCount,
      members: group.members.map(member => {
        // Return phone numbers for backward compatibility
        return member.phoneNumber || member.userId || member.memberId;
      }),
      createdAt: group.createdAt.toISOString(),
      lastActivity: group.lastActivity.toISOString(),
      createdBy: group.createdBy,
      admins: group.admins
    }));

    res.status(200).json({
      success: true,
      count: transformedGroups.length,
      data: transformedGroups
    });
  } catch (error) {
    console.error('Error fetching user groups:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch groups'
    });
  }
});

/**
 * @desc    Create a new group
 * @route   POST /api/groups
 * @access  Private
 */
const createGroup = asyncHandler(async (req, res) => {
  try {
    const { name, description = '', members = [] } = req.body;

    if (!name || name.trim().length === 0) {
      return res.status(400).json({
        success: false,
        message: 'Group name is required'
      });
    }

    // Check if group name already exists for this user
    const existingGroup = await Group.findOne({
      userId: req.user._id,
      name: name.trim()
    });

    if (existingGroup) {
      return res.status(400).json({
        success: false,
        message: 'Group with this name already exists'
      });
    }

    // Process members for the new unified structure
    const processedMembers = [];
    for (const memberInput of members) {
      let memberData;
      
      if (typeof memberInput === 'string') {
        // Old format: just phone number
        if (!memberInput || memberInput.trim() === '') {
          console.warn('⚠️ Skipping empty member input');
          continue; // Skip empty members
        }
        
        memberData = {
          memberId: memberInput.trim(), // Use phone number as memberId for contacts
          memberType: 'contact',
          phoneNumber: memberInput.trim(),
          name: memberInput.trim(), // Will be updated when contact info is available
          profileImage: '',
          role: 'member',
          addedBy: req.user.userId || req.user._id.toString()
        };
      } else {
        // New format: member object with type info
        const memberId = memberInput.memberId || memberInput.phoneNumber || memberInput.userId;
        const memberName = memberInput.name || memberInput.phoneNumber || memberInput.userId;
        
        if (!memberId || memberId.trim() === '' || !memberName || memberName.trim() === '') {
          console.warn('⚠️ Skipping invalid member input:', memberInput);
          continue; // Skip invalid members
        }
        
        memberData = {
          memberId: memberId.trim(),
          memberType: memberInput.memberType || 'contact',
          name: memberName.trim(),
          profileImage: memberInput.profileImage || '',
          role: memberInput.role || 'member',
          addedBy: req.user.userId || req.user._id.toString()
        };
        
        if (memberInput.memberType === 'contact') {
          const phoneNumber = memberInput.phoneNumber || memberInput.memberId;
          if (!phoneNumber || phoneNumber.trim() === '') {
            console.warn('⚠️ Skipping contact member without phone number:', memberInput);
            continue;
          }
          memberData.phoneNumber = phoneNumber.trim();
        } else if (memberInput.memberType === 'app_connection') {
          const userId = memberInput.userId || memberInput.memberId;
          if (!userId || userId.trim() === '') {
            console.warn('⚠️ Skipping app connection member without userId:', memberInput);
            continue;
          }
          memberData.userId = userId.trim();
        }
      }
      
      processedMembers.push(memberData);
    }

    // Create the group with new structure
    const group = await Group.create({
      name: name.trim(),
      description: description.trim(),
      userId: req.user._id,
      createdBy: req.user.userId || req.user._id.toString(),
      members: processedMembers,
      admins: [req.user.userId || req.user._id.toString()], // Creator is admin
      settings: {
        isPrivate: true,
        allowMemberInvites: false,
        requireAdminApproval: true
      }
    });

    // Transform response to match frontend interface
    const transformedGroup = {
      id: group.groupId,
      name: group.name,
      description: group.description,
      memberCount: group.memberCount,
      members: group.members.map(member => {
        // Return phone numbers for backward compatibility
        return member.phoneNumber || member.userId || member.memberId;
      }),
      createdAt: group.createdAt.toISOString(),
      lastActivity: group.lastActivity.toISOString(),
      createdBy: group.createdBy,
      admins: group.admins
    };

    res.status(201).json({
      success: true,
      data: transformedGroup
    });
  } catch (error) {
    console.error('Error creating group:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to create group'
    });
  }
});


/**
 * @desc    Delete a group
 * @route   DELETE /api/groups/:groupId
 * @access  Private
 */
const deleteGroup = asyncHandler(async (req, res) => {
  try {
    const { groupId } = req.params;

    const group = await Group.findOneAndDelete({
      groupId,
      userId: req.user._id
    });

    if (!group) {
      return res.status(404).json({
        success: false,
        message: 'Group not found'
      });
    }

    res.status(200).json({
      success: true,
      message: 'Group deleted successfully'
    });
  } catch (error) {
    console.error('Error deleting group:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to delete group'
    });
  }
});

/**
 * @desc    Add member to group
 * @route   POST /api/groups/:groupId/members
 * @access  Private
 */
const addMemberToGroup = asyncHandler(async (req, res) => {
  try {
    const { groupId } = req.params;
    const { phoneNumber, memberData } = req.body;

    // Support both old format (phoneNumber) and new format (memberData)
    let memberInfo;
    if (memberData) {
      memberInfo = memberData;
    } else if (phoneNumber) {
      // Convert old format to new format
      // Check if it's a phone number or userId based on format
      const isPhoneNumber = /^[0-9+\-\s()]+$/.test(phoneNumber);
      
      memberInfo = {
        memberId: phoneNumber,
        memberType: isPhoneNumber ? 'contact' : 'app_connection',
        name: phoneNumber, // Will be updated when contact info is available
        profileImage: ''
      };
      
      if (isPhoneNumber) {
        memberInfo.phoneNumber = phoneNumber;
      } else {
        memberInfo.userId = phoneNumber;
      }
    } else {
      return res.status(400).json({
        success: false,
        message: 'Phone number or member data is required'
      });
    }

    const group = await Group.findOne({
      groupId,
      userId: req.user._id
    });

    if (!group) {
      return res.status(404).json({
        success: false,
        message: 'Group not found'
      });
    }

    // Add member using new method
    group.addMember(memberInfo, req.user.userId || req.user._id.toString());
    await group.save();

    // Transform response
    const transformedGroup = {
      id: group.groupId,
      name: group.name,
      description: group.description,
      memberCount: group.memberCount,
      members: group.members.map(member => {
        // Return phone numbers for backward compatibility
        return member.phoneNumber || member.userId || member.memberId;
      }),
      createdAt: group.createdAt.toISOString(),
      lastActivity: group.lastActivity.toISOString()
    };

    res.status(200).json({
      success: true,
      data: transformedGroup
    });
  } catch (error) {
    console.error('Error adding member to group:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to add member to group'
    });
  }
});

/**
 * @desc    Remove member from group
 * @route   DELETE /api/groups/:groupId/members/:memberId
 * @access  Private
 */
const removeMemberFromGroup = asyncHandler(async (req, res) => {
  try {
    const { groupId, memberId } = req.params;
    // Support old route with phoneNumber for backward compatibility
    const memberToRemove = memberId || req.params.phoneNumber;

    const group = await Group.findOne({
      groupId,
      userId: req.user._id
    });

    if (!group) {
      return res.status(404).json({
        success: false,
        message: 'Group not found'
      });
    }

    // Find the member to remove - check by memberId, phoneNumber, or userId
    const memberExists = group.members.find(member => 
      member.memberId === memberToRemove || 
      member.phoneNumber === memberToRemove || 
      member.userId === memberToRemove
    );
    
    if (!memberExists) {
      return res.status(404).json({
        success: false,
        message: 'Member not found in group'
      });
    }
    
    // Remove member using the actual memberId
    group.removeMember(memberExists.memberId);
    await group.save();

    // Transform response
    const transformedGroup = {
      id: group.groupId,
      name: group.name,
      description: group.description,
      memberCount: group.memberCount,
      members: group.members.map(member => {
        // Return phone numbers for backward compatibility
        return member.phoneNumber || member.userId || member.memberId;
      }),
      createdAt: group.createdAt.toISOString(),
      lastActivity: group.lastActivity.toISOString()
    };

    res.status(200).json({
      success: true,
      data: transformedGroup
    });
  } catch (error) {
    console.error('Error removing member from group:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to remove member from group'
    });
  }
});

/**
 * @desc    Get groups that contain a specific contact
 * @route   GET /api/groups/contact/:phoneNumber
 * @access  Private
 */
const getGroupsForContact = asyncHandler(async (req, res) => {
  try {
    const { phoneNumber } = req.params;

    const groups = await Group.findUserGroupsWithMember(req.user._id, phoneNumber);

    // Transform groups to match frontend interface
    const transformedGroups = groups.map(group => ({
      id: group.groupId,
      name: group.name,
      description: group.description,
      memberCount: group.memberCount,
      members: group.members.map(member => member.phoneNumber),
      createdAt: group.createdAt.toISOString(),
      lastActivity: group.lastActivity.toISOString()
    }));

    res.status(200).json({
      success: true,
      count: transformedGroups.length,
      data: transformedGroups
    });
  } catch (error) {
    console.error('Error fetching groups for contact:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch groups for contact'
    });
  }
});

/**
 * @desc    Bulk update group memberships for a contact
 * @route   PUT /api/groups/contact/:phoneNumber
 * @access  Private
 */
const updateContactGroupMemberships = asyncHandler(async (req, res) => {
  try {
    const { phoneNumber } = req.params;
    const { groupIds } = req.body; // Array of group IDs the contact should be in

    if (!Array.isArray(groupIds)) {
      return res.status(400).json({
        success: false,
        message: 'groupIds must be an array'
      });
    }

    // Get all user's groups
    const allGroups = await Group.findByUserId(req.user._id);
    
    // Update memberships
    for (const group of allGroups) {
      const shouldBeInGroup = groupIds.includes(group.groupId);
      const isCurrentlyInGroup = group.isMember(phoneNumber);

      if (shouldBeInGroup && !isCurrentlyInGroup) {
        group.addMember(phoneNumber);
        await group.save();
      } else if (!shouldBeInGroup && isCurrentlyInGroup) {
        group.removeMember(phoneNumber);
        await group.save();
      }
    }

    // Return updated groups for this contact
    const updatedGroups = await Group.findUserGroupsWithMember(req.user._id, phoneNumber);
    
    const transformedGroups = updatedGroups.map(group => ({
      id: group.groupId,
      name: group.name,
      description: group.description,
      memberCount: group.memberCount,
      members: group.members.map(member => member.phoneNumber),
      createdAt: group.createdAt.toISOString(),
      lastActivity: group.lastActivity.toISOString()
    }));

    res.status(200).json({
      success: true,
      count: transformedGroups.length,
      data: transformedGroups
    });
  } catch (error) {
    console.error('Error updating contact group memberships:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to update contact group memberships'
    });
  }
});

/**
 * @desc    Update group details (name, icon, description)
 * @route   PUT /api/groups/:groupId
 * @access  Private
 */
const updateGroup = async (req, res) => {
  try {
    const { groupId } = req.params;
    const { name, icon, description } = req.body;

    const group = await Group.findOne({
      groupId,
      userId: req.user._id
    });

    if (!group) {
      return res.status(404).json({
        success: false,
        message: 'Group not found'
      });
    }

    // Update fields if provided
    if (name !== undefined) {
      group.name = name.trim();
    }
    if (icon !== undefined) {
      group.icon = icon;
    }
    if (description !== undefined) {
      group.description = description.trim();
    }

    group.lastActivity = new Date();
    await group.save();

    // Transform response
    const transformedGroup = {
      id: group.groupId,
      name: group.name,
      description: group.description,
      memberCount: group.memberCount,
      members: group.members.map(member => {
        // Return phone numbers for backward compatibility
        return member.phoneNumber || member.userId || member.memberId;
      }),
      createdAt: group.createdAt.toISOString(),
      lastActivity: group.lastActivity.toISOString(),
      createdBy: group.createdBy,
      admins: group.admins,
      icon: group.icon,
      color: group.color
    };

    res.status(200).json({
      success: true,
      message: 'Group updated successfully',
      data: transformedGroup
    });
  } catch (error) {
    console.error('Error updating group:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error'
    });
  }
};

module.exports = {
  createGroup,
  getGroups: getUserGroups,
  addMemberToGroup,
  removeMemberFromGroup,
  getContactGroups: getGroupsForContact,
  updateContactGroupMemberships,
  updateGroup
};
