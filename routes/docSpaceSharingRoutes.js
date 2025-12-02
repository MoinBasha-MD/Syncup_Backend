const express = require('express');
const router = express.Router();
const { protect } = require('../middleware/authMiddleware');
const docSpaceSharingController = require('../controllers/docSpaceSharingController');

/**
 * DocSpace Sharing Routes
 * All routes require authentication
 */

// Get people who shared documents with me
router.get(
  '/shared-with-me/people',
  protect,
  docSpaceSharingController.getPeopleWhoSharedWithMe
);

// Get documents shared by a specific person
router.get(
  '/shared-with-me/people/:personId/documents',
  protect,
  docSpaceSharingController.getDocumentsSharedByPerson
);

// Get people I shared documents with
router.get(
  '/shared-by-me/people',
  protect,
  docSpaceSharingController.getPeopleISharedWith
);

// Get documents I shared with a specific person
router.get(
  '/shared-by-me/people/:personId/documents',
  protect,
  docSpaceSharingController.getDocumentsSharedWithPerson
);

// Revoke document access from a person
router.delete(
  '/shared-by-me/people/:personId/documents/:documentId',
  protect,
  docSpaceSharingController.revokeDocumentAccess
);

// Track document access (view/download)
router.post(
  '/access/:ownerId/documents/:documentId',
  protect,
  docSpaceSharingController.trackDocumentAccess
);

// Share document with enhanced access control
router.post(
  '/share-enhanced',
  protect,
  docSpaceSharingController.shareDocumentEnhanced
);

module.exports = router;
