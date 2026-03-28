const express = require('express');
const router = express.Router();
const mongoose = require('mongoose');
const Role = require('../models/Role');
const Project = require('../models/Project');
const { isOptionalAuth } = require('../middleware/auth');
const Joi = require('joi');

// Validation schemas
const createRoleSchema = Joi.object({
  projectId: Joi.string().required().trim().min(1),
  name: Joi.string().required().trim().min(1),
  persona: Joi.string().required().trim().min(1),
  status: Joi.string().optional().trim().min(1),
  avatarImage: Joi.string().optional().allow('', null).trim(),
  attachments: Joi.array().items(Joi.string()).optional().default([])
});

const updateRoleSchema = Joi.object({
  name: Joi.string().optional().trim().min(1),
  persona: Joi.string().optional().trim().min(1),
  status: Joi.string().optional().trim().min(1),
  avatarImage: Joi.string().optional().allow('', null).trim(),
  attachments: Joi.array().items(Joi.string()).optional()
}).min(1);

/**
 * POST /api/v1/assessment-roles
 * Create a new role
 */
router.post('/', isOptionalAuth, async (req, res) => {
  try {
    const { error, value } = createRoleSchema.validate(req.body);
    if (error) {
      return res.status(400).json({
        success: false,
        message: 'Invalid request body',
        error: error.details[0].message
      });
    }

    // Validate projectId exists
    if (!mongoose.Types.ObjectId.isValid(value.projectId)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid projectId format'
      });
    }

    const project = await Project.findById(value.projectId);
    if (!project) {
      return res.status(404).json({
        success: false,
        message: 'Project not found'
      });
    }

    const roleData = {
      projectId: value.projectId,
      name: value.name,
      persona: value.persona,
      status: value.status || 'active',
      avatarImage: value.avatarImage || null,
      attachments: value.attachments || []
    };

    const role = new Role(roleData);
    await role.save();

    res.status(201).json({
      success: true,
      data: {
        id: role._id.toString(),
        projectId: role.projectId.toString(),
        name: role.name,
        persona: role.persona,
        status: role.status,
        avatarImage: role.avatarImage,
        attachments: role.attachments,
        createdAt: role.createdAt,
        updatedAt: role.updatedAt
      }
    });
  } catch (error) {
    console.error('❌ Error creating role:', error.message);
    res.status(500).json({
      success: false,
      message: 'Failed to create role',
      error: process.env.NODE_ENV !== 'production' ? error.message : undefined
    });
  }
});

/**
 * GET /api/v1/assessment-roles/:id
 * Get role by ID
 */
router.get('/:id', isOptionalAuth, async (req, res) => {
  try {
    if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid role ID format'
      });
    }

    const role = await Role.findById(req.params.id);
    if (!role) {
      return res.status(404).json({
        success: false,
        message: 'Role not found'
      });
    }

    res.status(200).json({
      success: true,
      data: {
        id: role._id.toString(),
        projectId: role.projectId.toString(),
        name: role.name,
        persona: role.persona,
        status: role.status,
        avatarImage: role.avatarImage,
        attachments: role.attachments,
        createdAt: role.createdAt,
        updatedAt: role.updatedAt
      }
    });
  } catch (error) {
    console.error('❌ Error fetching role:', error.message);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch role',
      error: process.env.NODE_ENV !== 'production' ? error.message : undefined
    });
  }
});

/**
 * GET /api/v1/assessment-roles/project/:projectId
 * Get roles by project
 */
router.get('/project/:projectId', isOptionalAuth, async (req, res) => {
  try {
    if (!mongoose.Types.ObjectId.isValid(req.params.projectId)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid project ID format'
      });
    }

    const roles = await Role.find({ projectId: req.params.projectId }).sort({ createdAt: -1 });

    const formattedRoles = roles.map(role => ({
      id: role._id.toString(),
      projectId: role.projectId.toString(),
      name: role.name,
      persona: role.persona,
      status: role.status,
      avatarImage: role.avatarImage,
      attachments: role.attachments,
      createdAt: role.createdAt,
      updatedAt: role.updatedAt
    }));

    res.status(200).json({
      success: true,
      data: formattedRoles
    });
  } catch (error) {
    console.error('❌ Error fetching roles by project:', error.message);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch roles',
      error: process.env.NODE_ENV !== 'production' ? error.message : undefined
    });
  }
});

/**
 * GET /api/v1/assessment-roles
 * List all roles
 */
router.get('/', isOptionalAuth, async (req, res) => {
  try {
    const schema = Joi.object({
      userName: Joi.string().optional().trim(),
      projectId: Joi.string().optional().trim()
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
    if (value.projectId) {
      if (!mongoose.Types.ObjectId.isValid(value.projectId)) {
        return res.status(400).json({
          success: false,
          message: 'Invalid projectId format'
        });
      }
      query.projectId = value.projectId;
    }

    const roles = await Role.find(query).sort({ createdAt: -1 });

    const formattedRoles = roles.map(role => ({
      id: role._id.toString(),
      projectId: role.projectId.toString(),
      name: role.name,
      persona: role.persona,
      status: role.status,
      avatarImage: role.avatarImage,
      attachments: role.attachments,
      createdAt: role.createdAt,
      updatedAt: role.updatedAt
    }));

    res.status(200).json({
      success: true,
      data: formattedRoles
    });
  } catch (error) {
    console.error('❌ Error fetching roles:', error.message);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch roles',
      error: process.env.NODE_ENV !== 'production' ? error.message : undefined
    });
  }
});

/**
 * PUT /api/v1/assessment-roles/:id
 * Update role
 */
router.put('/:id', isOptionalAuth, async (req, res) => {
  try {
    if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid role ID format'
      });
    }

    const { error, value } = updateRoleSchema.validate(req.body);
    if (error) {
      return res.status(400).json({
        success: false,
        message: 'Invalid request body',
        error: error.details[0].message
      });
    }

    const role = await Role.findById(req.params.id);
    if (!role) {
      return res.status(404).json({
        success: false,
        message: 'Role not found'
      });
    }

    // Update fields
    if (value.name !== undefined) role.name = value.name;
    if (value.persona !== undefined) role.persona = value.persona;
    if (value.status !== undefined) role.status = value.status;
    if (value.avatarImage !== undefined) role.avatarImage = value.avatarImage;
    if (value.attachments !== undefined) role.attachments = value.attachments;

    await role.save();

    res.status(200).json({
      success: true,
      data: {
        id: role._id.toString(),
        projectId: role.projectId.toString(),
        name: role.name,
        persona: role.persona,
        status: role.status,
        avatarImage: role.avatarImage,
        attachments: role.attachments,
        createdAt: role.createdAt,
        updatedAt: role.updatedAt
      }
    });
  } catch (error) {
    console.error('❌ Error updating role:', error.message);
    res.status(500).json({
      success: false,
      message: 'Failed to update role',
      error: process.env.NODE_ENV !== 'production' ? error.message : undefined
    });
  }
});

/**
 * DELETE /api/v1/assessment-roles/:id
 * Delete role
 */
router.delete('/:id', isOptionalAuth, async (req, res) => {
  try {
    if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid role ID format'
      });
    }

    const role = await Role.findById(req.params.id);
    if (!role) {
      return res.status(404).json({
        success: false,
        message: 'Role not found'
      });
    }

    await Role.findByIdAndDelete(req.params.id);

    res.status(200).json({
      success: true,
      message: 'Role deleted successfully'
    });
  } catch (error) {
    console.error('❌ Error deleting role:', error.message);
    res.status(500).json({
      success: false,
      message: 'Failed to delete role',
      error: process.env.NODE_ENV !== 'production' ? error.message : undefined
    });
  }
});

module.exports = router;

