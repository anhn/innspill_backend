const mongoose = require('mongoose');

const promptSchema = new mongoose.Schema({
  originalPrompt: {
    type: String,
    required: true,
    trim: true
  },
  revisedPrompt: {
    type: String,
    required: true,
    trim: true
  },
  analysis: {
    type: String,
    required: true,
    trim: true
  },
  topic: {
    type: String,
    required: false,
    trim: true
  },
  userName: {
    type: String,
    required: true,
    trim: true,
    index: true
  }
}, {
  collection: 'prompts',
  timestamps: true // Automatically adds createdAt and updatedAt
});

// Index for efficient querying by userName
promptSchema.index({ userName: 1 });

const Prompt = mongoose.model('Prompt', promptSchema);

module.exports = Prompt;

