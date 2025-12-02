const express = require('express');
const router = express.Router();
const { protect } = require('../middleware/authMiddleware');
const categoryController = require('../controllers/categoryController');

// All routes require authentication
router.use(protect);

// Category CRUD
router.get('/', categoryController.getCategories);
router.post('/', categoryController.createCategory);
router.put('/:categoryId', categoryController.updateCategory);
router.delete('/:categoryId', categoryController.deleteCategory);

// Get documents by category
router.get('/:categoryName/documents', categoryController.getDocumentsByCategory);

module.exports = router;
