const express = require('express');
const router = express.Router();
const mongoose = require('mongoose');
const Project = require('../models/Project');
const Course = require('../models/Course');
const { isOptionalAuth } = require('../middleware/auth');
const Joi = require('joi');

// Validation schemas
const createProjectSchema = Joi.object({
  projectTitle: Joi.string().required().trim().min(1),
  courseId: Joi.string().required().trim().min(1),
  courseDescription: Joi.string().optional().allow('', null).trim(),
  learningOutcome: Joi.string().optional().allow('', null).trim(),
  keyMilestones: Joi.string().optional().allow('', null).trim(),
  attachments: Joi.array().items(Joi.string()).optional().default([]),
  availableStakeholders: Joi.array().items(Joi.string()).optional().default([]),
  coverPhoto: Joi.object({
    fileId: Joi.string().required().trim(),
    fileName: Joi.string().required().trim(),
    fileUrl: Joi.string().uri().required().trim(),
    fileSize: Joi.number().required(),
    mimeType: Joi.string().required().trim(),
    uploadedAt: Joi.date().required()
  }).optional(),
  teacherId: Joi.string().optional().trim(),
  additionalInfo: Joi.object().optional().default({})
});

const updateProjectSchema = Joi.object({
  projectTitle: Joi.string().optional().allow('', null).trim(),
  courseDescription: Joi.string().optional().allow('', null).trim(),
  learningOutcome: Joi.string().optional().allow('', null).trim(),
  keyMilestones: Joi.string().optional().allow('', null).trim(),
  attachments: Joi.array().items(Joi.string()).optional(),
  availableStakeholders: Joi.array().items(Joi.string()).optional(),
  coverPhoto: Joi.object({
    fileId: Joi.string().required().trim(),
    fileName: Joi.string().required().trim(),
    fileUrl: Joi.string().uri().required().trim(),
    fileSize: Joi.number().required(),
    mimeType: Joi.string().required().trim(),
    uploadedAt: Joi.date().required()
  }).optional(),
  additionalInfo: Joi.object().optional()
}).min(1);

/**
 * POST /api/v1/projects
 * Create a new project
 */
router.post('/', isOptionalAuth, async (req, res) => {
  try {
    const { error, value } = createProjectSchema.validate(req.body);
    if (error) {
      return res.status(400).json({
        success: false,
        message: 'Invalid request body',
        error: error.details[0].message
      });
    }

    // Validate courseId exists
    if (!mongoose.Types.ObjectId.isValid(value.courseId)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid courseId format'
      });
    }

    const course = await Course.findById(value.courseId);
    if (!course) {
      return res.status(404).json({
        success: false,
        message: 'Course not found'
      });
    }

    // Check if project already exists for this course
    const existingProject = await Project.findOne({ courseId: value.courseId });
    if (existingProject) {
      return res.status(400).json({
        success: false,
        message: 'Project already exists for this course'
      });
    }

    const projectData = {
      projectTitle: value.projectTitle,
      courseId: value.courseId,
      courseDescription: value.courseDescription || null,
      learningOutcome: value.learningOutcome || null,
      keyMilestones: value.keyMilestones || null,
      attachments: value.attachments || [],
      availableStakeholders: value.availableStakeholders || [],
      coverPhoto: value.coverPhoto || null,
      teacherId: value.teacherId || course.teacherId || null,
      additionalInfo: value.additionalInfo || {}
    };

    const project = new Project(projectData);
    await project.save();

    console.log(`✅ Project created successfully: ID=${project._id.toString()}, CourseID=${project.courseId.toString()}`);

    res.status(201).json({
      success: true,
      data: {
        id: project._id.toString(),
        projectTitle: project.projectTitle,
        courseId: project.courseId.toString(),
        courseDescription: project.courseDescription,
        learningOutcome: project.learningOutcome,
        keyMilestones: project.keyMilestones,
        attachments: project.attachments,
        availableStakeholders: project.availableStakeholders,
        coverPhoto: project.coverPhoto,
        createdAt: project.createdAt,
        updatedAt: project.updatedAt
      }
    });
  } catch (error) {
    console.error('❌ Error creating project:', error.message);
    if (error.code === 11000) {
      return res.status(400).json({
        success: false,
        message: 'Project already exists for this course'
      });
    }
    res.status(500).json({
      success: false,
      message: 'Failed to create project',
      error: process.env.NODE_ENV !== 'production' ? error.message : undefined
    });
  }
});

/**
 * GET /api/v1/projects/:id
 * Get project by ID
 */
router.get('/:id', isOptionalAuth, async (req, res) => {
  try {
    if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid project ID format'
      });
    }

    const project = await Project.findById(req.params.id);
    if (!project) {
      return res.status(404).json({
        success: false,
        message: 'Project not found'
      });
    }

    res.status(200).json({
      success: true,
      data: {
        id: project._id.toString(),
        projectTitle: project.projectTitle,
        courseId: project.courseId.toString(),
        courseDescription: project.courseDescription,
        learningOutcome: project.learningOutcome,
        keyMilestones: project.keyMilestones,
        attachments: project.attachments,
        availableStakeholders: project.availableStakeholders,
        coverPhoto: project.coverPhoto,
        createdAt: project.createdAt,
        updatedAt: project.updatedAt
      }
    });
  } catch (error) {
    console.error('❌ Error fetching project:', error.message);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch project',
      error: process.env.NODE_ENV !== 'production' ? error.message : undefined
    });
  }
});

/**
 * GET /api/v1/projects/course/:courseId
 * Get project by course ID
 */
router.get('/course/:courseId', isOptionalAuth, async (req, res) => {
  try {
    if (!mongoose.Types.ObjectId.isValid(req.params.courseId)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid course ID format'
      });
    }

    const project = await Project.findOne({ courseId: req.params.courseId });
    if (!project) {
      return res.status(200).json({
        success: true,
        data: null
      });
    }

    res.status(200).json({
      success: true,
      data: {
        id: project._id.toString(),
        projectTitle: project.projectTitle,
        courseId: project.courseId.toString(),
        courseDescription: project.courseDescription,
        learningOutcome: project.learningOutcome,
        keyMilestones: project.keyMilestones,
        attachments: project.attachments,
        availableStakeholders: project.availableStakeholders,
        coverPhoto: project.coverPhoto,
        createdAt: project.createdAt,
        updatedAt: project.updatedAt
      }
    });
  } catch (error) {
    console.error('❌ Error fetching project by course:', error.message);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch project',
      error: process.env.NODE_ENV !== 'production' ? error.message : undefined
    });
  }
});

/**
 * GET /api/v1/projects
 * List all projects
 */
router.get('/', isOptionalAuth, async (req, res) => {
  try {
    const schema = Joi.object({
      userName: Joi.string().optional().trim(),
      courseId: Joi.string().optional().trim(),
      teacherId: Joi.string().optional().trim()
    });

    const { error, value } = schema.validate(req.query);
    if (error) {
      return res.status(400).json({
        success: false,
        message: 'Invalid query parameters',
        error: error.details[0].message
      });
    }

    const query = {};
    if (value.courseId) {
      if (!mongoose.Types.ObjectId.isValid(value.courseId)) {
        return res.status(400).json({
          success: false,
          message: 'Invalid courseId format'
        });
      }
      query.courseId = value.courseId;
    }
    if (value.teacherId) {
      query.teacherId = value.teacherId;
    }

    const projects = await Project.find(query).sort({ createdAt: -1 });

    const formattedProjects = projects.map(project => ({
      id: project._id.toString(),
      projectTitle: project.projectTitle,
      courseId: project.courseId.toString(),
      courseDescription: project.courseDescription,
      learningOutcome: project.learningOutcome,
      keyMilestones: project.keyMilestones,
      attachments: project.attachments,
      availableStakeholders: project.availableStakeholders,
      coverPhoto: project.coverPhoto,
      createdAt: project.createdAt,
      updatedAt: project.updatedAt
    }));

    res.status(200).json({
      success: true,
      data: formattedProjects
    });
  } catch (error) {
    console.error('❌ Error fetching projects:', error.message);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch projects',
      error: process.env.NODE_ENV !== 'production' ? error.message : undefined
    });
  }
});

/**
 * PUT /api/v1/projects/:id
 * Update project
 */
router.put('/:id', isOptionalAuth, async (req, res) => {
  try {
    if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid project ID format'
      });
    }

    const { error, value } = updateProjectSchema.validate(req.body);
    if (error) {
      return res.status(400).json({
        success: false,
        message: 'Invalid request body',
        error: error.details[0].message
      });
    }

    const project = await Project.findById(req.params.id);
    if (!project) {
      return res.status(404).json({
        success: false,
        message: 'Project not found'
      });
    }

    // Update fields
    if (value.projectTitle !== undefined) project.projectTitle = value.projectTitle;
    if (value.courseDescription !== undefined) project.courseDescription = value.courseDescription;
    if (value.learningOutcome !== undefined) project.learningOutcome = value.learningOutcome;
    if (value.keyMilestones !== undefined) project.keyMilestones = value.keyMilestones;
    if (value.attachments !== undefined) project.attachments = value.attachments;
    if (value.availableStakeholders !== undefined) project.availableStakeholders = value.availableStakeholders;
    if (value.coverPhoto !== undefined) project.coverPhoto = value.coverPhoto;
    if (value.additionalInfo !== undefined) project.additionalInfo = value.additionalInfo;

    await project.save();

    res.status(200).json({
      success: true,
      data: {
        id: project._id.toString(),
        projectTitle: project.projectTitle,
        courseId: project.courseId.toString(),
        courseDescription: project.courseDescription,
        learningOutcome: project.learningOutcome,
        keyMilestones: project.keyMilestones,
        attachments: project.attachments,
        availableStakeholders: project.availableStakeholders,
        coverPhoto: project.coverPhoto,
        createdAt: project.createdAt,
        updatedAt: project.updatedAt
      }
    });
  } catch (error) {
    console.error('❌ Error updating project:', error.message);
    res.status(500).json({
      success: false,
      message: 'Failed to update project',
      error: process.env.NODE_ENV !== 'production' ? error.message : undefined
    });
  }
});

/**
 * DELETE /api/v1/projects/:id
 * Delete project
 */
router.delete('/:id', isOptionalAuth, async (req, res) => {
  try {
    if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid project ID format'
      });
    }

    const project = await Project.findById(req.params.id);
    if (!project) {
      return res.status(404).json({
        success: false,
        message: 'Project not found'
      });
    }

    // Note: In a production system, you might want to handle cascading deletes
    // for associated tasks, roles, quizzes, and submissions here
    await Project.findByIdAndDelete(req.params.id);

    res.status(200).json({
      success: true,
      message: 'Project deleted successfully'
    });
  } catch (error) {
    console.error('❌ Error deleting project:', error.message);
    res.status(500).json({
      success: false,
      message: 'Failed to delete project',
      error: process.env.NODE_ENV !== 'production' ? error.message : undefined
    });
  }
});

module.exports = router;

