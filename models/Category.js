const mongoose = require('mongoose');

/**
 * Category Model - User-defined document categories
 * Allows users to organize documents into custom categories
 */
const categorySchema = new mongoose.Schema(
  {
    userId: {
      type: String,
      required: true,
      index: true
    },
    
    name: {
      type: String,
      required: true,
      maxlength: 50
    },
    
    icon: {
      type: String,
      default: '📁'
    },
    
    color: {
      type: String,
      default: '#3B82F6' // Blue
    },
    
    description: {
      type: String,
      maxlength: 200,
      default: ''
    },
    
    isDefault: {
      type: Boolean,
      default: false
    },
    
    documentCount: {
      type: Number,
      default: 0
    },
    
    order: {
      type: Number,
      default: 0
    }
  },
  {
    timestamps: true
  }
);

// Compound index for user's categories
categorySchema.index({ userId: 1, name: 1 }, { unique: true });
categorySchema.index({ userId: 1, order: 1 });

// Static method: Get or create default categories
categorySchema.statics.getOrCreateDefaults = async function(userId) {
  const defaultCategories = [
    { name: 'Identity', icon: '🆔', color: '#3B82F6', order: 1 },
    { name: 'Financial', icon: '💰', color: '#10B981', order: 2 },
    { name: 'Medical', icon: '🏥', color: '#EF4444', order: 3 },
    { name: 'Education', icon: '🎓', color: '#8B5CF6', order: 4 },
    { name: 'Personal', icon: '👤', color: '#F59E0B', order: 5 },
    { name: 'Work', icon: '💼', color: '#6366F1', order: 6 },
    { name: 'Other', icon: '📄', color: '#6B7280', order: 7 }
  ];
  
  const existingCategories = await this.find({ userId });
  
  if (existingCategories.length === 0) {
    // Create default categories
    const categories = await this.insertMany(
      defaultCategories.map(cat => ({
        ...cat,
        userId,
        isDefault: true
      }))
    );
    return categories;
  }
  
  return existingCategories;
};

module.exports = mongoose.model('Category', categorySchema);
