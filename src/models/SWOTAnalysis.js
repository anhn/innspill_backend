const mongoose = require('mongoose');

const swotAnalysisSchema = new mongoose.Schema({
  groupId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'StudentGroup',
    required: true,
    index: true
  },
  userId: {
    type: String,
    required: true,
    trim: true,
    index: true
  },
  userName: {
    type: String,
    required: true,
    trim: true
  },
  strengths: {
    type: [String],
    default: [],
    validate: {
      validator: function(v) {
        return Array.isArray(v);
      },
      message: 'Strengths must be an array'
    }
  },
  weaknesses: {
    type: [String],
    default: [],
    validate: {
      validator: function(v) {
        return Array.isArray(v);
      },
      message: 'Weaknesses must be an array'
    }
  },
  opportunities: {
    type: [String],
    default: [],
    validate: {
      validator: function(v) {
        return Array.isArray(v);
      },
      message: 'Opportunities must be an array'
    }
  },
  threats: {
    type: [String],
    default: [],
    validate: {
      validator: function(v) {
        return Array.isArray(v);
      },
      message: 'Threats must be an array'
    }
  },
  isComplete: {
    type: Boolean,
    default: false
  }
}, {
  collection: 'swot_analyses',
  timestamps: true // Automatically adds createdAt and updatedAt
});

// Compound index for unique SWOT per user per group
swotAnalysisSchema.index({ groupId: 1, userId: 1 }, { unique: true });

// Index for querying by group
swotAnalysisSchema.index({ groupId: 1, isComplete: 1 });

const SWOTAnalysis = mongoose.model('SWOTAnalysis', swotAnalysisSchema);

module.exports = SWOTAnalysis;
