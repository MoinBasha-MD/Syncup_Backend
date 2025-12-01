const express = require('express');
const router = express.Router();
const mayaDocumentController = require('../controllers/mayaDocumentController');
const { protect } = require('../middleware/authMiddleware');

// All routes require authentication
router.use(protect);

// Maya document request (User 1 requests document from User 2)
router.post('/request-document', mayaDocumentController.requestDocument);

// Maya document share (User 1 shares their own document with User 2)
router.post('/share-document', mayaDocumentController.shareDocument);

// Get shared documents (for Doc Space UI)
router.get('/shared-documents', mayaDocumentController.getSharedDocuments);

module.exports = router;
