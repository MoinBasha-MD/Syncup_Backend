const Category = require('../models/Category');
const DocSpace = require('../models/DocSpace');

/**
 * Get all categories for user
 * GET /api/categories
 */
exports.getCategories = async (req, res) => {
  try {
    const userId = req.user.userId;
    
    // Get or create default categories
    const categories = await Category.getOrCreateDefaults(userId);
    
    // Get document counts for each category
    const docSpace = await DocSpace.findOne({ userId });
    if (docSpace) {
      for (const category of categories) {
        const count = docSpace.documents.filter(doc => doc.category === category.name).length;
        category.documentCount = count;
      }
    }
    
    res.json({
      success: true,
      categories: categories.sort((a, b) => a.order - b.order)
    });
  } catch (error) {
    console.error('❌ [CATEGORIES] Error getting categories:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to get categories',
      error: error.message
    });
  }
};

/**
 * Create new category
 * POST /api/categories
 */
exports.createCategory = async (req, res) => {
  try {
    const userId = req.user.userId;
    const { name, icon, color, description } = req.body;
    
    if (!name) {
      return res.status(400).json({
        success: false,
        message: 'Category name is required'
      });
    }
    
    // Check if category already exists
    const existing = await Category.findOne({ userId, name });
    if (existing) {
      return res.status(400).json({
        success: false,
        message: 'Category already exists'
      });
    }
    
    // Get max order
    const categories = await Category.find({ userId });
    const maxOrder = categories.length > 0 ? Math.max(...categories.map(c => c.order)) : 0;
    
    const category = await Category.create({
      userId,
      name,
      icon: icon || '📁',
      color: color || '#3B82F6',
      description: description || '',
      order: maxOrder + 1
    });
    
    res.json({
      success: true,
      message: 'Category created',
      category
    });
  } catch (error) {
    console.error('❌ [CATEGORIES] Error creating category:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to create category',
      error: error.message
    });
  }
};

/**
 * Update category
 * PUT /api/categories/:categoryId
 */
exports.updateCategory = async (req, res) => {
  try {
    const userId = req.user.userId;
    const { categoryId } = req.params;
    const { name, icon, color, description, order } = req.body;
    
    const category = await Category.findOne({ _id: categoryId, userId });
    if (!category) {
      return res.status(404).json({
        success: false,
        message: 'Category not found'
      });
    }
    
    // Don't allow renaming default categories
    if (category.isDefault && name && name !== category.name) {
      return res.status(400).json({
        success: false,
        message: 'Cannot rename default categories'
      });
    }
    
    if (name) category.name = name;
    if (icon) category.icon = icon;
    if (color) category.color = color;
    if (description !== undefined) category.description = description;
    if (order !== undefined) category.order = order;
    
    await category.save();
    
    res.json({
      success: true,
      message: 'Category updated',
      category
    });
  } catch (error) {
    console.error('❌ [CATEGORIES] Error updating category:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to update category',
      error: error.message
    });
  }
};

/**
 * Delete category
 * DELETE /api/categories/:categoryId
 */
exports.deleteCategory = async (req, res) => {
  try {
    const userId = req.user.userId;
    const { categoryId } = req.params;
    
    const category = await Category.findOne({ _id: categoryId, userId });
    if (!category) {
      return res.status(404).json({
        success: false,
        message: 'Category not found'
      });
    }
    
    // Don't allow deleting default categories
    if (category.isDefault) {
      return res.status(400).json({
        success: false,
        message: 'Cannot delete default categories'
      });
    }
    
    // Move documents to "Other" category
    const docSpace = await DocSpace.findOne({ userId });
    if (docSpace) {
      docSpace.documents.forEach(doc => {
        if (doc.category === category.name) {
          doc.category = 'Other';
        }
      });
      await docSpace.save();
    }
    
    await category.deleteOne();
    
    res.json({
      success: true,
      message: 'Category deleted'
    });
  } catch (error) {
    console.error('❌ [CATEGORIES] Error deleting category:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to delete category',
      error: error.message
    });
  }
};

/**
 * Get documents by category
 * GET /api/categories/:categoryName/documents
 */
exports.getDocumentsByCategory = async (req, res) => {
  try {
    const userId = req.user.userId;
    const { categoryName } = req.params;
    
    const docSpace = await DocSpace.findOne({ userId });
    if (!docSpace) {
      return res.status(404).json({
        success: false,
        message: 'Doc space not found'
      });
    }
    
    const documents = docSpace.documents.filter(doc => doc.category === categoryName);
    
    res.json({
      success: true,
      category: categoryName,
      documents
    });
  } catch (error) {
    console.error('❌ [CATEGORIES] Error getting documents:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to get documents',
      error: error.message
    });
  }
};

module.exports = exports;
