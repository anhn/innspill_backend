const mongoose = require('mongoose');

const planningPokerVoteSchema = new mongoose.Schema({
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
  vote: {
    type: mongoose.Schema.Types.Mixed, // Can be Number or String ('?')
    required: true,
    validate: {
      validator: function(v) {
        // Valid Fibonacci numbers or '?'
        const validValues = [1, 2, 3, 5, 8, 13, 21, '?'];
        return validValues.includes(v);
      },
      message: 'Vote must be a valid Fibonacci number (1, 2, 3, 5, 8, 13, 21) or "?"'
    }
  },
  votedAt: {
    type: Date,
    default: Date.now
  }
}, { _id: true });

const planningPokerTaskSchema = new mongoose.Schema({
  groupId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'StudentGroup',
    required: true,
    index: true
  },
  title: {
    type: String,
    required: true,
    trim: true,
    minlength: 1
  },
  description: {
    type: String,
    required: false,
    trim: true,
    default: ''
  },
  createdBy: {
    type: String,
    required: true,
    trim: true,
    index: true
  },
  status: {
    type: String,
    enum: ['voting', 'revealed'],
    default: 'voting',
    index: true
  },
  revealed: {
    type: Boolean,
    default: false,
    index: true
  },
  votes: {
    type: [planningPokerVoteSchema],
    default: []
  },
  averageVote: {
    type: Number,
    required: false
  }
}, {
  collection: 'planning_poker_tasks',
  timestamps: true // Automatically adds createdAt and updatedAt
});

// Indexes for efficient queries
planningPokerTaskSchema.index({ groupId: 1, status: 1 });
planningPokerTaskSchema.index({ 'votes.userId': 1 });

const PlanningPokerTask = mongoose.model('PlanningPokerTask', planningPokerTaskSchema);

module.exports = PlanningPokerTask;
