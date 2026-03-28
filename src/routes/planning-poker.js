const express = require('express');
const router = express.Router();
const mongoose = require('mongoose');
const PlanningPokerTask = require('../models/PlanningPokerTask');
const StudentGroup = require('../models/StudentGroup');
const User = require('../models/User');
const { isOptionalAuth } = require('../middleware/auth');
const Joi = require('joi');

// Valid Fibonacci numbers for voting
const VALID_FIBONACCI_VOTES = [1, 2, 3, 5, 8, 13, 21];
const VALID_VOTES = [...VALID_FIBONACCI_VOTES, '?'];

// Online member tracking (in-memory)
// Structure: Map<groupId, Map<userId, lastActivityTimestamp>>
const onlineMembers = new Map();

// Configuration
const ONLINE_TIMEOUT_MS = parseInt(process.env.PLANNING_POKER_ONLINE_TIMEOUT_MS) || 5 * 60 * 1000; // Default: 5 minutes
const CLEANUP_INTERVAL_MS = 60 * 1000; // Cleanup every minute

/**
 * Mark user as online for a group
 */
function markUserOnline(groupId, userId) {
  if (!onlineMembers.has(groupId)) {
    onlineMembers.set(groupId, new Map());
  }
  const groupMembers = onlineMembers.get(groupId);
  groupMembers.set(userId, Date.now());
}

/**
 * Mark user as offline for a group
 */
function markUserOffline(groupId, userId) {
  const groupMembers = onlineMembers.get(groupId);
  if (groupMembers) {
    groupMembers.delete(userId);
    // Remove group if empty
    if (groupMembers.size === 0) {
      onlineMembers.delete(groupId);
    }
  }
}

/**
 * Get online members for a group (returns array of user IDs)
 */
function getOnlineMembers(groupId) {
  const now = Date.now();
  const groupMembers = onlineMembers.get(groupId);
  
  if (!groupMembers || groupMembers.size === 0) {
    return [];
  }

  // Filter out expired members and return user IDs
  const onlineUserIds = [];
  for (const [userId, lastActivity] of groupMembers.entries()) {
    if (now - lastActivity < ONLINE_TIMEOUT_MS) {
      onlineUserIds.push(userId);
    } else {
      // Remove expired member
      groupMembers.delete(userId);
    }
  }

  // Remove group if empty
  if (groupMembers.size === 0) {
    onlineMembers.delete(groupId);
  }

  return onlineUserIds;
}

/**
 * Periodic cleanup of expired online members
 */
setInterval(() => {
  const now = Date.now();
  for (const [groupId, groupMembers] of onlineMembers.entries()) {
    for (const [userId, lastActivity] of groupMembers.entries()) {
      if (now - lastActivity >= ONLINE_TIMEOUT_MS) {
        groupMembers.delete(userId);
      }
    }
    // Remove group if empty
    if (groupMembers.size === 0) {
      onlineMembers.delete(groupId);
    }
  }
}, CLEANUP_INTERVAL_MS);

/**
 * Helper function to check if user is a member of a group
 */
async function isGroupMember(groupId, userName) {
  try {
    if (!mongoose.Types.ObjectId.isValid(groupId)) {
      return false;
    }
    const group = await StudentGroup.findById(groupId);
    if (!group || !group.isActive) {
      return false;
    }
    return group.studentIds.includes(userName);
  } catch (error) {
    console.error('❌ Error checking group membership:', error.message);
    return false;
  }
}

/**
 * Helper function to get group members
 */
async function getGroupMembers(groupId) {
  try {
    const group = await StudentGroup.findById(groupId);
    if (!group || !group.isActive) {
      return [];
    }
    return group.studentIds || [];
  } catch (error) {
    console.error('❌ Error getting group members:', error.message);
    return [];
  }
}

/**
 * Helper function to resolve user names from user IDs/usernames
 */
async function resolveUserNames(userIds) {
  if (!userIds || userIds.length === 0) return {};
  
  const userMap = {};
  const objectIdArray = userIds.filter(id => mongoose.Types.ObjectId.isValid(id));
  const usernameArray = userIds.filter(id => !mongoose.Types.ObjectId.isValid(id));

  if (objectIdArray.length > 0) {
    const usersById = await User.find({ 
      _id: { $in: objectIdArray.map(id => new mongoose.Types.ObjectId(id)) }
    }).select('_id username fullName').lean();
    
    usersById.forEach(user => {
      userMap[user._id.toString()] = {
        username: user.username,
        fullName: user.fullName || user.username
      };
    });
  }

  if (usernameArray.length > 0) {
    const usersByUsername = await User.find({ 
      username: { $in: usernameArray }
    }).select('_id username fullName').lean();
    
    usersByUsername.forEach(user => {
      userMap[user.username] = {
        username: user.username,
        fullName: user.fullName || user.username
      };
    });
  }

  return userMap;
}

/**
 * Helper function to format task response with vote filtering
 */
function formatTaskResponse(task, currentUserName = null, groupMembers = []) {
  const isRevealed = task.status === 'revealed' || task.revealed === true;
  
  // Filter votes based on revealed status
  let visibleVotes = [];
  if (isRevealed) {
    // All votes visible when revealed
    visibleVotes = task.votes;
  } else {
    // Only show votes for the current user if not revealed
    visibleVotes = task.votes.filter(vote => vote.userId === currentUserName);
  }

  // Get list of user IDs who have voted (without revealing votes if not revealed)
  const votedUserIds = task.votes.map(vote => vote.userId);
  
  // Calculate if all members have voted
  const totalMembers = groupMembers.length;
  const voteCount = task.votes.length;
  const allMembersVoted = totalMembers > 0 && voteCount >= totalMembers;
  
  // Calculate if moderator can reveal (at least one other user has voted)
  // Moderator can reveal if there are at least 2 votes (moderator + at least one other)
  const canReveal = voteCount >= 2;

  return {
    id: task._id.toString(),
    groupId: task.groupId.toString(),
    title: task.title,
    description: task.description || '',
    createdBy: task.createdBy,
    createdAt: task.createdAt.toISOString(),
    status: task.status,
    revealed: task.revealed || false,
    votes: visibleVotes.map(vote => ({
      id: vote._id.toString(),
      taskId: task._id.toString(),
      userId: vote.userId,
      userName: vote.userName,
      vote: vote.vote,
      votedAt: vote.votedAt.toISOString()
    })),
    averageVote: task.averageVote || undefined,
    // Voting status metadata
    votedUserIds: votedUserIds, // List of user IDs who have voted (for status display)
    voteCount: voteCount, // Number of votes
    totalMembers: totalMembers, // Total number of group members
    allMembersVoted: allMembersVoted, // Whether all members have voted
    canReveal: canReveal // Whether moderator can reveal votes (at least one other user voted)
  };
}

// Validation schemas
const createTaskSchema = Joi.object({
  groupId: Joi.string().required().trim().min(1),
  title: Joi.string().required().trim().min(1),
  description: Joi.string().optional().allow(null, '').trim().empty('').default('')
});

const submitVoteSchema = Joi.object({
  taskId: Joi.string().required().trim().min(1),
  groupId: Joi.string().required().trim().min(1),
  vote: Joi.alternatives().try(
    Joi.number().valid(...VALID_FIBONACCI_VOTES),
    Joi.string().valid('?')
  ).required()
});

/**
 * POST /api/v1/planning-poker/tasks
 * Create a new planning poker task
 */
router.post('/tasks', isOptionalAuth, async (req, res) => {
  try {
    const userName = req.query.userName || req.user?.username;
    if (!userName) {
      return res.status(400).json({
        success: false,
        message: 'userName is required'
      });
    }

    const { error, value } = createTaskSchema.validate(req.body);
    if (error) {
      return res.status(400).json({
        success: false,
        message: 'Invalid request body',
        error: error.details[0].message
      });
    }

    if (!mongoose.Types.ObjectId.isValid(value.groupId)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid groupId format'
      });
    }

    // Verify user is a member of the group
    const isMember = await isGroupMember(value.groupId, userName);
    if (!isMember) {
      return res.status(403).json({
        success: false,
        message: 'User is not a member of this group'
      });
    }

    // Get group members for metadata
    const groupMembers = await getGroupMembers(value.groupId);

    // Create task
    const task = new PlanningPokerTask({
      groupId: new mongoose.Types.ObjectId(value.groupId),
      title: value.title,
      description: value.description || '',
      createdBy: userName,
      status: 'voting',
      revealed: false,
      votes: []
    });

    await task.save();

    res.status(201).json({
      success: true,
      data: formatTaskResponse(task, userName, groupMembers)
    });
  } catch (error) {
    console.error('❌ Error creating planning poker task:', error.message);
    res.status(500).json({
      success: false,
      message: 'Failed to create task',
      error: process.env.NODE_ENV !== 'production' ? error.message : undefined
    });
  }
});

/**
 * GET /api/v1/planning-poker/tasks/group/:groupId
 * Get all tasks for a group
 */
router.get('/tasks/group/:groupId', isOptionalAuth, async (req, res) => {
  try {
    const userName = req.query.userName || req.user?.username;
    if (!userName) {
      return res.status(400).json({
        success: false,
        message: 'userName is required'
      });
    }

    const { groupId } = req.params;
    if (!mongoose.Types.ObjectId.isValid(groupId)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid groupId format'
      });
    }

    // Verify user is a member of the group
    const isMember = await isGroupMember(groupId, userName);
    if (!isMember) {
      return res.status(403).json({
        success: false,
        message: 'User is not a member of this group'
      });
    }

    // Get group members for metadata
    const groupMembers = await getGroupMembers(groupId);

    // Get all tasks for the group
    const tasks = await PlanningPokerTask.find({
      groupId: new mongoose.Types.ObjectId(groupId)
    }).sort({ createdAt: -1 });

    res.status(200).json({
      success: true,
      data: tasks.map(task => formatTaskResponse(task, userName, groupMembers))
    });
  } catch (error) {
    console.error('❌ Error fetching planning poker tasks:', error.message);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch tasks',
      error: process.env.NODE_ENV !== 'production' ? error.message : undefined
    });
  }
});

/**
 * POST /api/v1/planning-poker/votes
 * Submit a vote for a task
 */
router.post('/votes', isOptionalAuth, async (req, res) => {
  try {
    const userName = req.query.userName || req.user?.username;
    if (!userName) {
      return res.status(400).json({
        success: false,
        message: 'userName is required'
      });
    }

    const { error, value } = submitVoteSchema.validate(req.body);
    if (error) {
      return res.status(400).json({
        success: false,
        message: 'Invalid request body',
        error: error.details[0].message
      });
    }

    if (!mongoose.Types.ObjectId.isValid(value.taskId) || !mongoose.Types.ObjectId.isValid(value.groupId)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid taskId or groupId format'
      });
    }

    // Verify user is a member of the group
    const isMember = await isGroupMember(value.groupId, userName);
    if (!isMember) {
      return res.status(403).json({
        success: false,
        message: 'User is not a member of this group'
      });
    }

    // Find the task
    const task = await PlanningPokerTask.findOne({
      _id: new mongoose.Types.ObjectId(value.taskId),
      groupId: new mongoose.Types.ObjectId(value.groupId)
    });

    if (!task) {
      return res.status(404).json({
        success: false,
        message: 'Task not found or does not belong to this group'
      });
    }

    // Check if task is already revealed
    if (task.status === 'revealed' || task.revealed === true) {
      return res.status(409).json({
        success: false,
        message: 'Cannot vote on a revealed task'
      });
    }

    // Get user's display name
    const user = await User.findOne({ username: userName }).select('fullName username').lean();
    const displayName = user?.fullName || userName;

    // Check if user already voted, update if exists, otherwise add new vote
    const existingVoteIndex = task.votes.findIndex(vote => vote.userId === userName);
    
    if (existingVoteIndex >= 0) {
      // Update existing vote
      task.votes[existingVoteIndex].vote = value.vote;
      task.votes[existingVoteIndex].votedAt = new Date();
      task.votes[existingVoteIndex].userName = displayName;
    } else {
      // Add new vote
      task.votes.push({
        userId: userName,
        userName: displayName,
        vote: value.vote,
        votedAt: new Date()
      });
    }

    await task.save();

    // Find the vote that was just added/updated
    const vote = task.votes.find(v => v.userId === userName);

    res.status(200).json({
      success: true,
      data: {
        id: vote._id.toString(),
        taskId: task._id.toString(),
        userId: vote.userId,
        userName: vote.userName,
        vote: vote.vote,
        votedAt: vote.votedAt.toISOString()
      }
    });
  } catch (error) {
    console.error('❌ Error submitting vote:', error.message);
    res.status(500).json({
      success: false,
      message: 'Failed to submit vote',
      error: process.env.NODE_ENV !== 'production' ? error.message : undefined
    });
  }
});

/**
 * POST /api/v1/planning-poker/tasks/:taskId/reveal
 * Reveal votes for a task (moderator only)
 */
router.post('/tasks/:taskId/reveal', isOptionalAuth, async (req, res) => {
  try {
    const userName = req.query.userName || req.user?.username;
    if (!userName) {
      return res.status(400).json({
        success: false,
        message: 'userName is required'
      });
    }

    const { taskId } = req.params;
    if (!mongoose.Types.ObjectId.isValid(taskId)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid taskId format'
      });
    }

    // Find the task
    const task = await PlanningPokerTask.findById(taskId);
    if (!task) {
      return res.status(404).json({
        success: false,
        message: 'Task not found'
      });
    }

    // Verify user is the task creator (moderator)
    if (task.createdBy !== userName) {
      return res.status(403).json({
        success: false,
        message: 'Only the task creator can reveal votes'
      });
    }

    // Check if task is already revealed
    if (task.status === 'revealed' || task.revealed === true) {
      return res.status(409).json({
        success: false,
        message: 'Task votes are already revealed'
      });
    }

    // Get group members for metadata
    const groupMembers = await getGroupMembers(task.groupId.toString());

    // Calculate average vote (exclude '?' votes)
    const numericVotes = task.votes
      .filter(vote => typeof vote.vote === 'number')
      .map(vote => vote.vote);
    
    if (numericVotes.length > 0) {
      const sum = numericVotes.reduce((acc, val) => acc + val, 0);
      const average = sum / numericVotes.length;
      task.averageVote = Math.round(average * 100) / 100; // Round to 2 decimal places
    }

    // Update task status
    task.status = 'revealed';
    task.revealed = true;
    await task.save();

    res.status(200).json({
      success: true,
      data: formatTaskResponse(task, userName, groupMembers)
    });
  } catch (error) {
    console.error('❌ Error revealing votes:', error.message);
    res.status(500).json({
      success: false,
      message: 'Failed to reveal votes',
      error: process.env.NODE_ENV !== 'production' ? error.message : undefined
    });
  }
});

/**
 * POST /api/v1/planning-poker/tasks/:taskId/clear
 * Clear all votes for a task (moderator only) - allows re-estimation
 */
router.post('/tasks/:taskId/clear', isOptionalAuth, async (req, res) => {
  try {
    const userName = req.query.userName || req.user?.username;
    if (!userName) {
      return res.status(400).json({
        success: false,
        message: 'userName is required'
      });
    }

    const { taskId } = req.params;
    if (!mongoose.Types.ObjectId.isValid(taskId)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid taskId format'
      });
    }

    // Find the task
    const task = await PlanningPokerTask.findById(taskId);
    if (!task) {
      return res.status(404).json({
        success: false,
        message: 'Task not found'
      });
    }

    // Verify user is the task creator (moderator)
    if (task.createdBy !== userName) {
      return res.status(403).json({
        success: false,
        message: 'Only the task creator can clear votes'
      });
    }

    // Get group members for metadata
    const groupMembers = await getGroupMembers(task.groupId.toString());

    // Clear all votes and reset task
    task.votes = [];
    task.status = 'voting';
    task.revealed = false;
    task.averageVote = null;
    await task.save();

    res.status(200).json({
      success: true,
      data: formatTaskResponse(task, userName, groupMembers)
    });
  } catch (error) {
    console.error('❌ Error clearing votes:', error.message);
    res.status(500).json({
      success: false,
      message: 'Failed to clear votes',
      error: process.env.NODE_ENV !== 'production' ? error.message : undefined
    });
  }
});

/**
 * DELETE /api/v1/planning-poker/tasks/:taskId
 * Delete a planning poker task
 */
router.delete('/tasks/:taskId', isOptionalAuth, async (req, res) => {
  try {
    const userName = req.query.userName || req.user?.username;
    if (!userName) {
      return res.status(400).json({
        success: false,
        message: 'userName is required'
      });
    }

    const { taskId } = req.params;
    if (!mongoose.Types.ObjectId.isValid(taskId)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid taskId format'
      });
    }

    // Find the task
    const task = await PlanningPokerTask.findById(taskId);
    if (!task) {
      return res.status(404).json({
        success: false,
        message: 'Task not found'
      });
    }

    // Verify user is the creator
    if (task.createdBy !== userName) {
      return res.status(403).json({
        success: false,
        message: 'Only the task creator can delete the task'
      });
    }

    // Delete the task
    await PlanningPokerTask.findByIdAndDelete(taskId);

    res.status(200).json({
      success: true,
      message: 'Task deleted successfully'
    });
  } catch (error) {
    console.error('❌ Error deleting planning poker task:', error.message);
    res.status(500).json({
      success: false,
      message: 'Failed to delete task',
      error: process.env.NODE_ENV !== 'production' ? error.message : undefined
    });
  }
});

/**
 * GET /api/v1/planning-poker/groups/:groupId/members/online
 * Get online members for a group
 */
router.get('/groups/:groupId/members/online', isOptionalAuth, async (req, res) => {
  try {
    const userName = req.query.userName || req.user?.username;
    if (!userName) {
      return res.status(400).json({
        success: false,
        message: 'userName is required'
      });
    }

    const { groupId } = req.params;
    if (!mongoose.Types.ObjectId.isValid(groupId)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid groupId format'
      });
    }

    // Verify user is a member of the group
    const isMember = await isGroupMember(groupId, userName);
    if (!isMember) {
      return res.status(403).json({
        success: false,
        message: 'User is not a member of this group'
      });
    }

    // Get online members (returns array of user IDs)
    const onlineUserIds = getOnlineMembers(groupId);

    res.status(200).json({
      success: true,
      data: onlineUserIds
    });
  } catch (error) {
    console.error('❌ Error fetching online members:', error.message);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch online members',
      error: process.env.NODE_ENV !== 'production' ? error.message : undefined
    });
  }
});

/**
 * POST /api/v1/planning-poker/groups/:groupId/members/online
 * Mark user as online for a group
 */
router.post('/groups/:groupId/members/online', isOptionalAuth, async (req, res) => {
  try {
    const userName = req.query.userName || req.user?.username;
    if (!userName) {
      return res.status(400).json({
        success: false,
        message: 'userName is required'
      });
    }

    const { groupId } = req.params;
    if (!mongoose.Types.ObjectId.isValid(groupId)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid groupId format'
      });
    }

    // Verify user is a member of the group
    const isMember = await isGroupMember(groupId, userName);
    if (!isMember) {
      return res.status(403).json({
        success: false,
        message: 'User is not a member of this group'
      });
    }

    // Mark user as online
    markUserOnline(groupId, userName);

    res.status(200).json({
      success: true,
      message: 'User marked as online'
    });
  } catch (error) {
    console.error('❌ Error marking user as online:', error.message);
    res.status(500).json({
      success: false,
      message: 'Failed to mark user as online',
      error: process.env.NODE_ENV !== 'production' ? error.message : undefined
    });
  }
});

/**
 * DELETE /api/v1/planning-poker/groups/:groupId/members/online
 * Mark user as offline for a group
 */
router.delete('/groups/:groupId/members/online', isOptionalAuth, async (req, res) => {
  try {
    const userName = req.query.userName || req.user?.username;
    if (!userName) {
      return res.status(400).json({
        success: false,
        message: 'userName is required'
      });
    }

    const { groupId } = req.params;
    if (!mongoose.Types.ObjectId.isValid(groupId)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid groupId format'
      });
    }

    // Verify user is a member of the group
    const isMember = await isGroupMember(groupId, userName);
    if (!isMember) {
      return res.status(403).json({
        success: false,
        message: 'User is not a member of this group'
      });
    }

    // Mark user as offline
    markUserOffline(groupId, userName);

    res.status(200).json({
      success: true,
      message: 'User marked as offline'
    });
  } catch (error) {
    console.error('❌ Error marking user as offline:', error.message);
    res.status(500).json({
      success: false,
      message: 'Failed to mark user as offline',
      error: process.env.NODE_ENV !== 'production' ? error.message : undefined
    });
  }
});

module.exports = router;
