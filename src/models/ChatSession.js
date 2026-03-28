const mongoose = require('mongoose');

// Chat Item subdocument schema
const chatItemSchema = new mongoose.Schema({
  sender: {
    type: String,
    required: true,
    trim: true
  },
  message: {
    type: String,
    required: true,
    trim: true
  },
  timestamp: {
    type: Date,
    required: true,
    default: Date.now
  },
  // OpenAI metrics (only for AI-generated messages)
  openAIMetrics: {
    responseSize: {
      type: Number,
      required: false
    },
    tokenUsage: {
      promptTokens: {
        type: Number,
        required: false
      },
      completionTokens: {
        type: Number,
        required: false
      },
      totalTokens: {
        type: Number,
        required: false
      }
    },
    responseTime: {
      type: Number, // in milliseconds
      required: false
    }
  }
}, {
  _id: true // Each chat item gets its own ID
});

// Chat Session schema
const chatSessionSchema = new mongoose.Schema({
  title: {
    type: String,
    required: true,
    trim: true
  },
  sender: {
    type: String,
    required: true,
    trim: true,
    index: true
  },
  stakeholderId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Role',
    required: true,
    index: true
  },
  projectId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Project',
    required: false,
    index: true
  },
  // Array of user IDs (participants) - can include students, teachers, stakeholders
  participants: [{
    type: String,
    trim: true
  }],
  startTime: {
    type: Date,
    required: true,
    default: Date.now,
    index: true
  },
  endTime: {
    type: Date,
    required: false,
    default: null
  },
  // Array of chat items (embedded documents)
  chatItems: [chatItemSchema],
  metadata: {
    type: mongoose.Schema.Types.Mixed,
    required: false,
    default: {}
  }
}, {
  collection: 'chat_sessions',
  timestamps: true
});

// Indexes for efficient queries
chatSessionSchema.index({ sender: 1, startTime: -1 });
chatSessionSchema.index({ stakeholderId: 1, startTime: -1 });
chatSessionSchema.index({ projectId: 1, startTime: -1 });
chatSessionSchema.index({ participants: 1, startTime: -1 });
chatSessionSchema.index({ 'chatItems.timestamp': 1 });

const ChatSession = mongoose.model('ChatSession', chatSessionSchema);

module.exports = ChatSession;


