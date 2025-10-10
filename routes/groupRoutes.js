const express = require('express');
const {
  getGroups: getUserGroups,
  createGroup,
  updateGroup,
  deleteGroup,
  addMemberToGroup,
  removeMemberFromGroup,
  getContactGroups: getGroupsForContact,
  updateContactGroupMemberships
} = require('../controllers/groupController');

const { protect } = require('../middleware/authMiddleware');

const router = express.Router();

// All routes require authentication
router.use(protect);

// Group CRUD operations
router.route('/')
  .get(getUserGroups)      // GET /api/groups - Get all user's groups
  .post(createGroup);      // POST /api/groups - Create new group

router.route('/:groupId')
  .put(updateGroup)        // PUT /api/groups/:groupId - Update group
  .delete(deleteGroup);    // DELETE /api/groups/:groupId - Delete group

// Group membership operations
router.route('/:groupId/members')
  .post(addMemberToGroup); // POST /api/groups/:groupId/members - Add member to group

router.route('/:groupId/members/:phoneNumber')
  .delete(removeMemberFromGroup); // DELETE /api/groups/:groupId/members/:phoneNumber - Remove member

// Contact-based group operations
router.route('/contact/:phoneNumber')
  .get(getGroupsForContact)        // GET /api/groups/contact/:phoneNumber - Get groups for contact
  .put(updateContactGroupMemberships); // PUT /api/groups/contact/:phoneNumber - Bulk update memberships

module.exports = router;
