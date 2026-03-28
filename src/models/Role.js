const mongoose = require('mongoose');

const roleSchema = new mongoose.Schema({
  projectId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Project',
    required: true,
    index: true
  },
  name: {
    type: String,
    required: true,
    trim: true
  },
  persona: {
    type: String,
    required: true,
    trim: true
  },
  status: {
    type: String,
    required: false,
    trim: true,
    default: 'active'
  },
  avatarImage: {
    type: String,
    required: false,
    trim: true
  },
  attachments: {
    type: [String],
    required: false,
    default: []
  }
}, {
  collection: 'roles',
  timestamps: true
});

roleSchema.index({ projectId: 1 });

const Role = mongoose.model('Role', roleSchema);

module.exports = Role;

