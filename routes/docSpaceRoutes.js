const express = require('express');
const router = express.Router();
const docSpaceController = require('../controllers/docSpaceController');
const { protect } = require('../middleware/authMiddleware');
const {
  documentRequestLimiter,
  documentUploadLimiter,
  sanitizeDocumentInput,
  validateFileContent,
  logSecurityEvent,
  validateDocumentAccess
} = require('../middleware/docSpaceSecurityMiddleware');
const multer = require('multer');
const path = require('path');
const fs = require('fs');

// Ensure uploads directory exists
const uploadsDir = path.join(__dirname, '../uploads/documents');
if (!fs.existsSync(uploadsDir)) {
  fs.mkdirSync(uploadsDir, { recursive: true });
}

// Configure multer for document uploads
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, uploadsDir);
  },
  filename: (req, file, cb) => {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    cb(null, 'doc-' + uniqueSuffix + path.extname(file.originalname));
  }
});

const fileFilter = (req, file, cb) => {
  // Allowed file types
  const allowedTypes = [
    'application/pdf',
    'image/jpeg',
    'image/jpg',
    'image/png',
    'application/msword',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
  ];
  
  if (allowedTypes.includes(file.mimetype)) {
    cb(null, true);
  } else {
    cb(new Error('Invalid file type. Only PDF, JPG, PNG, and DOC files are allowed.'), false);
  }
};

const upload = multer({
  storage: storage,
  fileFilter: fileFilter,
  limits: {
    fileSize: 10 * 1024 * 1024 // 10MB max file size
  }
});

// All routes require authentication
router.use(protect);

// Doc Space Management
router.get('/', docSpaceController.getDocSpace);
router.post('/upload', upload.single('document'), docSpaceController.uploadDocument);
router.delete('/document/:documentId', docSpaceController.deleteDocument);

// Access Management
router.get('/friends', docSpaceController.getFriendsForAccess);
router.post('/grant-access', docSpaceController.grantGeneralAccess);
router.delete('/revoke-access/:friendUserId', docSpaceController.revokeGeneralAccess);
router.get('/access-list', docSpaceController.getAccessList);

// Document Requests
router.post('/request-document', docSpaceController.requestDocument);
router.get('/requests/received', docSpaceController.getReceivedRequests);
router.get('/requests/sent', docSpaceController.getSentRequests);
router.post('/requests/:requestId/respond', docSpaceController.respondToRequest);

// Document Access
router.get('/document/:ownerId/:documentType', docSpaceController.getDocument);
router.get('/document/:documentId/access-log', docSpaceController.getAccessLog);

module.exports = router;
