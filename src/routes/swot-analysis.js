const express = require('express');
const router = express.Router();
const mongoose = require('mongoose');
const SWOTAnalysis = require('../models/SWOTAnalysis');
const StudentGroup = require('../models/StudentGroup');
const Project = require('../models/Project');
const User = require('../models/User');
const { isOptionalAuth } = require('../middleware/auth');
const Joi = require('joi');

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
 * Helper function to aggregate SWOT from all group members
 */
function aggregateGroupSWOT(swotAnalyses, groupMembers) {
  const aggregated = {
    strengths: [],
    weaknesses: [],
    opportunities: [],
    threats: []
  };

  // Collect all SWOT items from all members
  swotAnalyses.forEach(swot => {
    if (swot.strengths && swot.strengths.length > 0) {
      aggregated.strengths.push(...swot.strengths.map(item => ({
        text: item,
        contributedBy: swot.userId,
        contributedByName: swot.userName
      })));
    }
    if (swot.weaknesses && swot.weaknesses.length > 0) {
      aggregated.weaknesses.push(...swot.weaknesses.map(item => ({
        text: item,
        contributedBy: swot.userId,
        contributedByName: swot.userName
      })));
    }
    if (swot.opportunities && swot.opportunities.length > 0) {
      aggregated.opportunities.push(...swot.opportunities.map(item => ({
        text: item,
        contributedBy: swot.userId,
        contributedByName: swot.userName
      })));
    }
    if (swot.threats && swot.threats.length > 0) {
      aggregated.threats.push(...swot.threats.map(item => ({
        text: item,
        contributedBy: swot.userId,
        contributedByName: swot.userName
      })));
    }
  });

  // Count contributions per user for statistics
  const contributorStats = {};
  swotAnalyses.forEach(swot => {
    if (!contributorStats[swot.userId]) {
      contributorStats[swot.userId] = {
        userId: swot.userId,
        userName: swot.userName,
        totalItems: 0
      };
    }
    contributorStats[swot.userId].totalItems += 
      (swot.strengths?.length || 0) +
      (swot.weaknesses?.length || 0) +
      (swot.opportunities?.length || 0) +
      (swot.threats?.length || 0);
  });

  return {
    strengths: aggregated.strengths,
    weaknesses: aggregated.weaknesses,
    opportunities: aggregated.opportunities,
    threats: aggregated.threats,
    totalItems: aggregated.strengths.length + aggregated.weaknesses.length + 
                 aggregated.opportunities.length + aggregated.threats.length,
    contributors: Object.values(contributorStats),
    totalContributors: swotAnalyses.length,
    totalMembers: groupMembers.length,
    completionRate: groupMembers.length > 0 ? (swotAnalyses.length / groupMembers.length) * 100 : 0
  };
}

/**
 * Helper function to extract text from SWOT items (handles both string and object formats)
 */
function extractTextFromItems(items) {
  if (!items) return [];
  if (!Array.isArray(items)) return [];
  return items.map(item => {
    if (item === null || item === undefined) return '';
    if (typeof item === 'string') {
      return item.trim();
    } else if (item && typeof item === 'object' && item.text) {
      return String(item.text).trim();
    }
    return '';
  }).filter(text => text.length > 0);
}

// Validation schemas
const swotAnalysisSchema = Joi.object({
  strengths: Joi.array().items(
    Joi.alternatives().try(
      Joi.string().trim().min(1),
      Joi.object({
        text: Joi.string().trim().min(1).required(),
        id: Joi.any().optional(),
        contributedBy: Joi.any().optional(),
        contributedByName: Joi.any().optional()
      }).unknown(true)
    ).allow(null)
  ).optional().default([]),
  weaknesses: Joi.array().items(
    Joi.alternatives().try(
      Joi.string().trim().min(1),
      Joi.object({
        text: Joi.string().trim().min(1).required(),
        id: Joi.any().optional(),
        contributedBy: Joi.any().optional(),
        contributedByName: Joi.any().optional()
      }).unknown(true)
    ).allow(null)
  ).optional().default([]),
  opportunities: Joi.array().items(
    Joi.alternatives().try(
      Joi.string().trim().min(1),
      Joi.object({
        text: Joi.string().trim().min(1).required(),
        id: Joi.any().optional(),
        contributedBy: Joi.any().optional(),
        contributedByName: Joi.any().optional()
      }).unknown(true)
    ).allow(null)
  ).optional().default([]),
  threats: Joi.array().items(
    Joi.alternatives().try(
      Joi.string().trim().min(1),
      Joi.object({
        text: Joi.string().trim().min(1).required(),
        id: Joi.any().optional(),
        contributedBy: Joi.any().optional(),
        contributedByName: Joi.any().optional()
      }).unknown(true)
    ).allow(null)
  ).optional().default([]),
  isComplete: Joi.boolean().optional().default(false)
}).unknown(true);

/**
 * GET /api/v1/swot-analysis/group/:groupId
 * Get SWOT analysis for a group (individual or aggregated)
 */
router.get('/group/:groupId', isOptionalAuth, async (req, res) => {
  try {
    const userName = req.query.userName || req.user?.username;
    if (!userName) {
      return res.status(400).json({
        success: false,
        message: 'userName is required'
      });
    }

    const { groupId } = req.params;
    const viewType = req.query.viewType || 'individual'; // 'individual' or 'aggregated'

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

    if (viewType === 'aggregated') {
      // Get aggregated SWOT from all members
      const groupMembers = await getGroupMembers(groupId);
      const swotAnalyses = await SWOTAnalysis.find({
        groupId: new mongoose.Types.ObjectId(groupId)
      });

      const aggregated = aggregateGroupSWOT(swotAnalyses, groupMembers);

      res.status(200).json({
        success: true,
        data: {
          groupId: groupId,
          viewType: 'aggregated',
          ...aggregated
        }
      });
    } else {
      // Get individual SWOT for current user
      const swot = await SWOTAnalysis.findOne({
        groupId: new mongoose.Types.ObjectId(groupId),
        userId: userName
      });

      if (!swot) {
        // Return empty SWOT if not found
        return res.status(200).json({
          success: true,
          data: {
            id: null,
            groupId: groupId,
            userId: userName,
            userName: userName,
            strengths: [],
            weaknesses: [],
            opportunities: [],
            threats: [],
            isComplete: false,
            createdAt: null,
            updatedAt: null
          }
        });
      }

      res.status(200).json({
        success: true,
        data: {
          id: swot._id.toString(),
          groupId: swot.groupId.toString(),
          userId: swot.userId,
          userName: swot.userName,
          strengths: swot.strengths || [],
          weaknesses: swot.weaknesses || [],
          opportunities: swot.opportunities || [],
          threats: swot.threats || [],
          isComplete: swot.isComplete || false,
          createdAt: swot.createdAt.toISOString(),
          updatedAt: swot.updatedAt.toISOString()
        }
      });
    }
  } catch (error) {
    console.error('❌ Error fetching SWOT analysis:', error.message);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch SWOT analysis',
      error: process.env.NODE_ENV !== 'production' ? error.message : undefined
    });
  }
});

/**
 * POST /api/v1/swot-analysis/group/:groupId
 * Create or update SWOT analysis for current user
 */
router.post('/group/:groupId', isOptionalAuth, async (req, res) => {
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

    // Debug: Log incoming request details
    console.log('📥 SWOT Analysis Request Details:');
    console.log('  - GroupId:', groupId);
    console.log('  - UserName:', userName);
    console.log('  - Request Body Type:', typeof req.body);
    console.log('  - Request Body Keys:', req.body ? Object.keys(req.body) : 'null/undefined');
    console.log('  - Request Body:', JSON.stringify(req.body, null, 2));
    console.log('  - Request Headers Content-Type:', req.headers['content-type']);

    // Check if body is empty or undefined
    if (!req.body || Object.keys(req.body).length === 0) {
      console.error('❌ Empty request body received');
      return res.status(400).json({
        success: false,
        message: 'Request body is empty or missing',
        received: req.body
      });
    }

    const { error, value } = swotAnalysisSchema.validate(req.body, {
      abortEarly: false,
      stripUnknown: true
    });
    
    if (error) {
      console.error('❌ SWOT validation error:', error.details);
      console.error('❌ Validated value:', JSON.stringify(value, null, 2));
      return res.status(400).json({
        success: false,
        message: 'Invalid request body',
        error: error.details.map(d => d.message).join('; '),
        details: error.details,
        received: req.body
      });
    }

    console.log('✅ Validation passed. Validated value:', JSON.stringify(value, null, 2));

    // Extract text values from items (handles both string and object formats)
    const strengths = extractTextFromItems(value.strengths);
    const weaknesses = extractTextFromItems(value.weaknesses);
    const opportunities = extractTextFromItems(value.opportunities);
    const threats = extractTextFromItems(value.threats);

    console.log('📊 Extracted SWOT items:');
    console.log('  - Strengths:', strengths);
    console.log('  - Weaknesses:', weaknesses);
    console.log('  - Opportunities:', opportunities);
    console.log('  - Threats:', threats);

    // Get user's display name
    const user = await User.findOne({ username: userName }).select('fullName username').lean();
    const displayName = user?.fullName || userName;

    // Check if SWOT already exists
    let swot = await SWOTAnalysis.findOne({
      groupId: new mongoose.Types.ObjectId(groupId),
      userId: userName
    });

    if (swot) {
      // Update existing SWOT
      console.log('🔄 Updating existing SWOT:', swot._id.toString());
      swot.strengths = strengths;
      swot.weaknesses = weaknesses;
      swot.opportunities = opportunities;
      swot.threats = threats;
      swot.isComplete = value.isComplete || false;
      swot.userName = displayName;
      await swot.save();
      console.log('✅ SWOT updated successfully');
    } else {
      // Create new SWOT
      console.log('🆕 Creating new SWOT');
      swot = new SWOTAnalysis({
        groupId: new mongoose.Types.ObjectId(groupId),
        userId: userName,
        userName: displayName,
        strengths: strengths,
        weaknesses: weaknesses,
        opportunities: opportunities,
        threats: threats,
        isComplete: value.isComplete || false
      });
      await swot.save();
      console.log('✅ SWOT created successfully:', swot._id.toString());
    }

    res.status(200).json({
      success: true,
      data: {
        id: swot._id.toString(),
        groupId: swot.groupId.toString(),
        userId: swot.userId,
        userName: swot.userName,
        strengths: swot.strengths || [],
        weaknesses: swot.weaknesses || [],
        opportunities: swot.opportunities || [],
        threats: swot.threats || [],
        isComplete: swot.isComplete || false,
        createdAt: swot.createdAt.toISOString(),
        updatedAt: swot.updatedAt.toISOString()
      }
    });
  } catch (error) {
    console.error('❌ Error saving SWOT analysis:', error.message);
    res.status(500).json({
      success: false,
      message: 'Failed to save SWOT analysis',
      error: process.env.NODE_ENV !== 'production' ? error.message : undefined
    });
  }
});

/**
 * GET /api/v1/swot-analysis/project/:projectId/description
 * Get project description
 */
router.get('/project/:projectId/description', isOptionalAuth, async (req, res) => {
  try {
    const userName = req.query.userName || req.user?.username;
    if (!userName) {
      return res.status(400).json({
        success: false,
        message: 'userName is required'
      });
    }

    const { projectId } = req.params;
    if (!mongoose.Types.ObjectId.isValid(projectId)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid projectId format'
      });
    }

    const project = await Project.findById(projectId);
    if (!project) {
      return res.status(404).json({
        success: false,
        message: 'Project not found'
      });
    }

    res.status(200).json({
      success: true,
      data: {
        projectId: project._id.toString(),
        title: project.projectTitle || '',
        description: project.courseDescription || '',
        learningOutcome: project.learningOutcome || '',
        keyMilestones: project.keyMilestones || '',
        additionalInfo: project.additionalInfo || {}
      }
    });
  } catch (error) {
    console.error('❌ Error fetching project description:', error.message);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch project description',
      error: process.env.NODE_ENV !== 'production' ? error.message : undefined
    });
  }
});

/**
 * GET /api/v1/swot-analysis/guidelines
 * Get AI guidelines and examples for SWOT analysis
 */
router.get('/guidelines', isOptionalAuth, async (req, res) => {
  try {
    res.status(200).json({
      success: true,
      data: {
        explanation: {
          title: 'SWOT Analysis Guide',
          description: 'SWOT Analysis is a strategic planning tool used to identify and analyze the Strengths, Weaknesses, Opportunities, and Threats of a project or organization.',
          sections: {
            strengths: {
              title: 'Strengths',
              description: 'Internal positive attributes and resources that give an advantage. These are things your team or project does well.',
              examples: [
                'Strong technical skills in the team',
                'Good communication among team members',
                'Access to necessary resources',
                'Previous experience with similar projects',
                'Clear project goals and objectives'
              ]
            },
            weaknesses: {
              title: 'Weaknesses',
              description: 'Internal negative attributes and limitations that put you at a disadvantage. These are areas that need improvement.',
              examples: [
                'Limited time for project completion',
                'Lack of experience in certain technologies',
                'Budget constraints',
                'Team members with conflicting schedules',
                'Unclear requirements or scope'
              ]
            },
            opportunities: {
              title: 'Opportunities',
              description: 'External factors that could be advantageous. These are favorable conditions in the environment that could be exploited.',
              examples: [
                'New technologies that could improve efficiency',
                'Market demand for the project outcome',
                'Potential partnerships or collaborations',
                'Available funding or resources',
                'Trends that align with project goals'
              ]
            },
            threats: {
              title: 'Threats',
              description: 'External factors that could cause problems. These are unfavorable conditions that could harm the project.',
              examples: [
                'Competing projects or solutions',
                'Changing market conditions',
                'Resource limitations',
                'Potential technical challenges',
                'Time constraints or deadlines'
              ]
            }
          },
          tips: [
            'Be honest and objective in your analysis',
            'Focus on factors that are relevant to your specific project',
            'Consider both internal (Strengths/Weaknesses) and external (Opportunities/Threats) factors',
            'Think about how different factors interact with each other',
            'Update your SWOT analysis as the project evolves'
          ]
        }
      }
    });
  } catch (error) {
    console.error('❌ Error fetching SWOT guidelines:', error.message);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch SWOT guidelines',
      error: process.env.NODE_ENV !== 'production' ? error.message : undefined
    });
  }
});

module.exports = router;
