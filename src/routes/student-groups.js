const express = require('express');
const router = express.Router();
const mongoose = require('mongoose');
const StudentGroup = require('../models/StudentGroup');
const User = require('../models/User');
const Course = require('../models/Course');
const Project = require('../models/Project');
const { isOptionalAuth } = require('../middleware/auth');
const Joi = require('joi');

// Validation schemas
const createGroupSchema = Joi.object({
  courseId: Joi.string().required().trim().min(1),
  projectId: Joi.string().optional().allow(null, '').trim().empty('').default(null),
  name: Joi.string().required().trim().min(1),
  description: Joi.string().optional().allow(null, '').trim().empty('').default(''),
  studentIds: Joi.array().items(Joi.string().trim().min(1)).min(2).required()
});

const updateGroupSchema = Joi.object({
  name: Joi.string().optional().trim().min(1),
  description: Joi.string().optional().allow(null, '').trim(),
  studentIds: Joi.array().items(Joi.string().trim()).min(2).optional(),
  isActive: Joi.boolean().optional()
}).min(1);

const assignStudentsSchema = Joi.object({
  studentIds: Joi.alternatives().try(
    Joi.array().items(Joi.string().trim().min(1)).min(1),
    Joi.string().trim().min(1) // Allow single string, will convert to array
  ).required(),
  studentId: Joi.string().trim().min(1).optional() // Also accept singular form
}).unknown(true); // Allow unknown fields

const removeStudentsSchema = Joi.object({
  studentIds: Joi.array().items(Joi.string().trim()).required().min(1)
});

/**
 * Helper function to resolve student names from student IDs
 */
async function resolveStudentNames(studentIds) {
  if (!studentIds || studentIds.length === 0) return {};
  
  const studentMap = {};
  const objectIdArray = studentIds.filter(id => mongoose.Types.ObjectId.isValid(id));
  const usernameArray = studentIds.filter(id => !mongoose.Types.ObjectId.isValid(id));

  if (objectIdArray.length > 0) {
    const usersById = await User.find({ 
      _id: { $in: objectIdArray.map(id => new mongoose.Types.ObjectId(id)) },
      type: 'student'
    }).select('_id username fullName').lean();
    
    usersById.forEach(user => {
      studentMap[user._id.toString()] = {
        id: user._id.toString(),
        username: user.username,
        fullName: user.fullName || ''
      };
    });
  }

  if (usernameArray.length > 0) {
    const usersByUsername = await User.find({ 
      username: { $in: usernameArray },
      type: 'student'
    }).select('_id username fullName').lean();
    
    usersByUsername.forEach(user => {
      studentMap[user.username] = {
        id: user._id.toString(),
        username: user.username,
        fullName: user.fullName || ''
      };
    });
  }

  return studentMap;
}

/**
 * Helper function to format group response with student names
 */
async function formatGroupResponse(group) {
  const studentMap = await resolveStudentNames(group.studentIds);
  const studentNames = group.studentIds.map(id => {
    const student = studentMap[id];
    return student ? (student.fullName || student.username) : id;
  });

  return {
    id: group._id.toString(),
    courseId: group.courseId ? group.courseId.toString() : null,
    projectId: group.projectId ? group.projectId.toString() : null,
    name: group.name,
    description: group.description || '',
    studentIds: group.studentIds,
    studentNames: studentNames,
    createdAt: group.createdAt,
    updatedAt: group.updatedAt,
    createdBy: group.createdBy,
    isActive: group.isActive
  };
}

/**
 * Helper function to check if students are in other active groups
 */
async function checkStudentGroupConflicts(courseId, projectId, studentIds, excludeGroupId = null) {
  const query = {
    courseId: new mongoose.Types.ObjectId(courseId),
    isActive: true,
    studentIds: { $in: studentIds }
  };
  
  if (projectId) {
    query.projectId = new mongoose.Types.ObjectId(projectId);
  } else {
    query.$or = [
      { projectId: null },
      { projectId: { $exists: false } }
    ];
  }
  
  if (excludeGroupId) {
    query._id = { $ne: new mongoose.Types.ObjectId(excludeGroupId) };
  }

  const conflictingGroups = await StudentGroup.find(query);
  const conflictingStudents = [];
  
  conflictingGroups.forEach(group => {
    studentIds.forEach(studentId => {
      if (group.studentIds.includes(studentId)) {
        if (!conflictingStudents.includes(studentId)) {
          conflictingStudents.push(studentId);
        }
      }
    });
  });

  return conflictingStudents;
}

/**
 * POST /api/v1/student-groups
 * Create a new student group
 */
router.post('/', isOptionalAuth, async (req, res) => {
  try {
    //console.log('📥 POST /api/v1/student-groups - Request body:', JSON.stringify(req.body, null, 2));
    
    const { error, value } = createGroupSchema.validate(req.body, { abortEarly: false });
    if (error) {
      console.error('❌ Validation error:', error.details);
      return res.status(400).json({
        success: false,
        message: 'Invalid request body',
        errors: error.details.map(detail => ({
          field: detail.path.join('.'),
          message: detail.message
        })),
        error: error.details[0].message
      });
    }

    // Normalize projectId: convert empty string to null
    if (value.projectId === '' || value.projectId === null) {
      value.projectId = null;
    }

    // Validate courseId
    if (!mongoose.Types.ObjectId.isValid(value.courseId)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid courseId format',
        received: value.courseId
      });
    }

    // Verify course exists
    const course = await Course.findById(value.courseId);
    if (!course) {
      return res.status(404).json({
        success: false,
        message: 'Course not found',
        courseId: value.courseId
      });
    }

    // Validate projectId if provided
    if (value.projectId) {
      if (!mongoose.Types.ObjectId.isValid(value.projectId)) {
        return res.status(400).json({
          success: false,
          message: 'Invalid projectId format',
          received: value.projectId
        });
      }
      const project = await Project.findById(value.projectId);
      if (!project) {
        return res.status(404).json({
          success: false,
          message: 'Project not found',
          projectId: value.projectId
        });
      }
    }

    // Validate studentIds array
    if (!Array.isArray(value.studentIds) || value.studentIds.length < 2) {
      return res.status(400).json({
        success: false,
        message: 'At least 2 students are required to create a group',
        received: value.studentIds?.length || 0
      });
    }

    // Filter out empty strings from studentIds
    value.studentIds = value.studentIds.filter(id => id && id.trim().length > 0);

    if (value.studentIds.length < 2) {
      return res.status(400).json({
        success: false,
        message: 'At least 2 valid student IDs are required to create a group',
        received: value.studentIds.length
      });
    }

    // Validate all students exist and are students
    const studentMap = await resolveStudentNames(value.studentIds);
    const invalidStudents = value.studentIds.filter(id => !studentMap[id]);
    
    if (invalidStudents.length > 0) {
      return res.status(400).json({
        success: false,
        message: `Invalid student IDs: ${invalidStudents.join(', ')}`,
        invalidIds: invalidStudents
      });
    }

    // Check for group name uniqueness within course
    const existingGroup = await StudentGroup.findOne({
      courseId: value.courseId,
      name: value.name
    });

    if (existingGroup) {
      return res.status(409).json({
        success: false,
        message: 'Group name already exists in this course'
      });
    }

    // Check if students are already in other active groups
    const conflictingStudents = await checkStudentGroupConflicts(
      value.courseId,
      value.projectId || null,
      value.studentIds
    );

    if (conflictingStudents.length > 0) {
      return res.status(409).json({
        success: false,
        message: `Students already in active groups: ${conflictingStudents.join(', ')}`
      });
    }

    // Get creator username from session or request
    const createdBy = req.user?.name || req.user?.username || req.body.createdBy || 'system';

    // Create group
    const group = new StudentGroup({
      courseId: value.courseId,
      projectId: value.projectId || null,
      name: value.name,
      description: value.description || '',
      studentIds: value.studentIds,
      createdBy: createdBy,
      isActive: true
    });

    await group.save();

    // Format response with student names
    const formattedGroup = await formatGroupResponse(group);

    res.status(201).json({
      success: true,
      data: formattedGroup
    });
  } catch (error) {
    console.error('❌ Error creating student group:', error.message);
    
    // Handle duplicate key error (unique index violation)
    if (error.code === 11000) {
      return res.status(409).json({
        success: false,
        message: 'Group name already exists in this course'
      });
    }

    res.status(500).json({
      success: false,
      message: 'Failed to create student group',
      error: process.env.NODE_ENV !== 'production' ? error.message : undefined
    });
  }
});

/**
 * GET /api/v1/student-groups/course/:courseId
 * Get groups by course
 */
router.get('/course/:courseId', isOptionalAuth, async (req, res) => {
  try {
    const courseId = req.params.courseId;

    if (!mongoose.Types.ObjectId.isValid(courseId)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid courseId format'
      });
    }

    const schema = Joi.object({
      projectId: Joi.string().optional().allow(null, '').trim().empty('').default(null),
      includeInactive: Joi.boolean().optional().default(false),
      userName: Joi.string().optional().trim() // Allow userName in query params
    }).unknown(true); // Explicitly allow unknown keys

    const { error, value } = schema.validate(req.query, {
      convert: true, // Convert string booleans to actual booleans
      allowUnknown: true // Allow unknown keys
    });
    if (error) {
      return res.status(400).json({
        success: false,
        message: 'Invalid query parameters',
        error: error.details[0].message
      });
    }

    // Normalize projectId: convert empty string to null
    if (value.projectId === '' || value.projectId === null) {
      value.projectId = null;
    }

    // Build query - convert courseId to ObjectId
    const query = { courseId: new mongoose.Types.ObjectId(courseId) };
    
    // Add debug logging
    //console.log('🔍 [GET /course/:courseId] Fetching groups - courseId:', courseId, 'projectId:', value.projectId, 'includeInactive:', value.includeInactive);
    
    if (value.projectId) {
      // If projectId is explicitly provided, filter by it
      if (!mongoose.Types.ObjectId.isValid(value.projectId)) {
        return res.status(400).json({
          success: false,
          message: 'Invalid projectId format'
        });
      }
      query.projectId = new mongoose.Types.ObjectId(value.projectId);
    }
    // If projectId is NOT provided, don't filter by projectId at all
    // This allows returning all groups for the course (with or without projectId)

    if (!value.includeInactive) {
      query.isActive = true;
    }

    // Convert ObjectIds to strings for logging
    const queryForLog = {
      courseId: query.courseId?.toString(),
      projectId: query.projectId?.toString(),
      isActive: query.isActive,
      $or: query.$or
    };
    //console.log('🔍 [GET /course/:courseId] Query:', JSON.stringify(queryForLog, null, 2));

    // Debug: Check all groups for this course (without filters)
    const allCourseGroups = await StudentGroup.find({ courseId: new mongoose.Types.ObjectId(courseId) });
    //console.log('🔍 [GET /course/:courseId] All groups for course (no filters):', allCourseGroups.length);
    //if (allCourseGroups.length > 0) {
      //console.log('🔍 [GET /course/:courseId] Sample group:', {
      //  _id: allCourseGroups[0]._id,
      //  name: allCourseGroups[0].name,
      //  projectId: allCourseGroups[0].projectId,
      //  isActive: allCourseGroups[0].isActive,
      //  studentIds: allCourseGroups[0].studentIds?.length || 0
      //});
    //}

    const groups = await StudentGroup.find(query).sort({ createdAt: -1 });

    //console.log('🔍 [GET /course/:courseId] Found groups (with filters):', groups.length);

    // Format all groups with student names
    const formattedGroups = await Promise.all(
      groups.map(group => formatGroupResponse(group))
    );

    res.status(200).json({
      success: true,
      data: formattedGroups
    });
  } catch (error) {
    console.error('❌ Error fetching groups by course:', error.message);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch groups',
      error: process.env.NODE_ENV !== 'production' ? error.message : undefined
    });
  }
});

/**
 * GET /api/v1/student-groups/:groupId
 * Get group by ID
 */
router.get('/:groupId', isOptionalAuth, async (req, res) => {
  try {
    const groupId = req.params.groupId;

    if (!mongoose.Types.ObjectId.isValid(groupId)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid groupId format'
      });
    }

    const group = await StudentGroup.findById(groupId);

    if (!group) {
      return res.status(404).json({
        success: false,
        message: 'Group not found'
      });
    }

    const formattedGroup = await formatGroupResponse(group);

    res.status(200).json({
      success: true,
      data: formattedGroup
    });
  } catch (error) {
    console.error('❌ Error fetching group:', error.message);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch group',
      error: process.env.NODE_ENV !== 'production' ? error.message : undefined
    });
  }
});

/**
 * PUT /api/v1/student-groups/:groupId
 * Update group
 */
router.put('/:groupId', isOptionalAuth, async (req, res) => {
  try {
    const groupId = req.params.groupId;

    if (!mongoose.Types.ObjectId.isValid(groupId)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid groupId format'
      });
    }

    const { error, value } = updateGroupSchema.validate(req.body);
    if (error) {
      return res.status(400).json({
        success: false,
        message: 'Invalid request body',
        error: error.details[0].message
      });
    }

    const group = await StudentGroup.findById(groupId);

    if (!group) {
      return res.status(404).json({
        success: false,
        message: 'Group not found'
      });
    }

    // Check name uniqueness if name is being updated
    if (value.name && value.name !== group.name) {
      const existingGroup = await StudentGroup.findOne({
        courseId: group.courseId,
        name: value.name,
        _id: { $ne: groupId }
      });

      if (existingGroup) {
        return res.status(409).json({
          success: false,
          message: 'Group name already exists in this course'
        });
      }
    }

    // Validate students if studentIds is being updated
    if (value.studentIds) {
      const studentMap = await resolveStudentNames(value.studentIds);
      const invalidStudents = value.studentIds.filter(id => !studentMap[id]);
      
      if (invalidStudents.length > 0) {
        return res.status(400).json({
          success: false,
          message: `Invalid student IDs: ${invalidStudents.join(', ')}`
        });
      }

      // Check for conflicts with other active groups
      const conflictingStudents = await checkStudentGroupConflicts(
        group.courseId.toString(),
        group.projectId ? group.projectId.toString() : null,
        value.studentIds,
        groupId
      );

      if (conflictingStudents.length > 0) {
        return res.status(409).json({
          success: false,
          message: `Students already in active groups: ${conflictingStudents.join(', ')}`
        });
      }
    }

    // Update fields
    if (value.name !== undefined) group.name = value.name;
    if (value.description !== undefined) group.description = value.description || '';
    if (value.studentIds !== undefined) group.studentIds = value.studentIds;
    if (value.isActive !== undefined) group.isActive = value.isActive;

    await group.save();

    const formattedGroup = await formatGroupResponse(group);

    res.status(200).json({
      success: true,
      data: formattedGroup
    });
  } catch (error) {
    console.error('❌ Error updating group:', error.message);
    
    if (error.code === 11000) {
      return res.status(409).json({
        success: false,
        message: 'Group name already exists in this course'
      });
    }

    res.status(500).json({
      success: false,
      message: 'Failed to update group',
      error: process.env.NODE_ENV !== 'production' ? error.message : undefined
    });
  }
});

/**
 * DELETE /api/v1/student-groups/:groupId
 * Delete group
 */
router.delete('/:groupId', isOptionalAuth, async (req, res) => {
  try {
    const groupId = req.params.groupId;

    if (!mongoose.Types.ObjectId.isValid(groupId)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid groupId format'
      });
    }

    const group = await StudentGroup.findByIdAndDelete(groupId);

    if (!group) {
      return res.status(404).json({
        success: false,
        message: 'Group not found'
      });
    }

    res.status(200).json({
      success: true,
      message: 'Group deleted successfully'
    });
  } catch (error) {
    console.error('❌ Error deleting group:', error.message);
    res.status(500).json({
      success: false,
      message: 'Failed to delete group',
      error: process.env.NODE_ENV !== 'production' ? error.message : undefined
    });
  }
});

/**
 * GET /api/v1/student-groups/:groupId/students
 * Get students by group
 */
router.get('/:groupId/students', isOptionalAuth, async (req, res) => {
  try {
    const groupId = req.params.groupId;

    if (!mongoose.Types.ObjectId.isValid(groupId)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid groupId format'
      });
    }

    const group = await StudentGroup.findById(groupId);

    if (!group) {
      return res.status(404).json({
        success: false,
        message: 'Group not found'
      });
    }

    const studentMap = await resolveStudentNames(group.studentIds);
    const students = group.studentIds.map(id => {
      const student = studentMap[id];
      if (student) {
        return {
          id: student.id,
          username: student.username,
          email: '', // Will be fetched if needed
          fullName: student.fullName,
          type: 'student'
        };
      }
      return null;
    }).filter(Boolean);

    // Fetch full student details including email
    const studentIds = students.map(s => s.id);
    const objectIdArray = studentIds.filter(id => mongoose.Types.ObjectId.isValid(id));
    const usernameArray = students.map(s => s.username);

    if (objectIdArray.length > 0) {
      const usersById = await User.find({ 
        _id: { $in: objectIdArray.map(id => new mongoose.Types.ObjectId(id)) }
      }).select('_id email').lean();
      
      usersById.forEach(user => {
        const student = students.find(s => s.id === user._id.toString());
        if (student) student.email = user.email || '';
      });
    }

    if (usernameArray.length > 0) {
      const usersByUsername = await User.find({ 
        username: { $in: usernameArray }
      }).select('_id email').lean();
      
      usersByUsername.forEach(user => {
        const student = students.find(s => s.username === user.username);
        if (student) student.email = user.email || '';
      });
    }

    res.status(200).json({
      success: true,
      data: students
    });
  } catch (error) {
    console.error('❌ Error fetching group students:', error.message);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch group students',
      error: process.env.NODE_ENV !== 'production' ? error.message : undefined
    });
  }
});

/**
 * POST /api/v1/student-groups/:groupId/students
 * Assign students to group
 */
router.post('/:groupId/students', isOptionalAuth, async (req, res) => {
  try {
    const groupId = req.params.groupId;

    //console.log('📥 POST /api/v1/student-groups/:groupId/students - Request:', {
    //  groupId,
    //  body: JSON.stringify(req.body, null, 2),
    //  bodyType: typeof req.body,
    //  bodyKeys: Object.keys(req.body || {}),
    //  contentType: req.get('Content-Type'),
    //  rawBody: req.body
    //});

    // Check if request body exists
    if (!req.body || typeof req.body !== 'object') {
      return res.status(400).json({
        success: false,
        message: 'Request body is required and must be a JSON object',
        received: typeof req.body
      });
    }

    if (!mongoose.Types.ObjectId.isValid(groupId)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid groupId format'
      });
    }

    // Normalize the request: handle both studentId (singular) and studentIds (plural)
    // Also handle single string vs array
    let normalizedBody = { ...req.body };
    
    // If frontend sent singular form, convert to plural
    if (normalizedBody.studentId && !normalizedBody.studentIds) {
      normalizedBody.studentIds = Array.isArray(normalizedBody.studentId) 
        ? normalizedBody.studentId 
        : [normalizedBody.studentId];
      delete normalizedBody.studentId;
    }
    
    // If frontend sent single string instead of array, convert to array
    if (typeof normalizedBody.studentIds === 'string') {
      normalizedBody.studentIds = [normalizedBody.studentIds];
    }
    
    // Ensure it's an array
    if (!Array.isArray(normalizedBody.studentIds)) {
      return res.status(400).json({
        success: false,
        message: 'studentIds must be an array or a string',
        received: typeof normalizedBody.studentIds,
        receivedValue: normalizedBody.studentIds
      });
    }

    // Filter out empty strings and null values from studentIds
    normalizedBody.studentIds = normalizedBody.studentIds
      .filter(id => id !== null && id !== undefined && String(id).trim().length > 0)
      .map(id => String(id).trim());

    // Check if we have at least one valid student ID after filtering
    if (normalizedBody.studentIds.length === 0) {
      return res.status(400).json({
        success: false,
        message: 'At least one valid student ID is required',
        received: req.body,
        afterFiltering: normalizedBody.studentIds
      });
    }

    const { error, value } = assignStudentsSchema.validate(normalizedBody, { 
      abortEarly: false,
      stripUnknown: true // Strip unknown fields after validation
    });
    
    if (error) {
      console.error('❌ Validation error when adding students:', {
        errors: error.details,
        receivedBody: req.body,
        normalizedBody: normalizedBody
      });
      return res.status(400).json({
        success: false,
        message: 'Invalid request body',
        errors: error.details.map(detail => ({
          field: detail.path.join('.'),
          message: detail.message
        })),
        error: error.details[0].message,
        received: req.body,
        normalized: normalizedBody,
        hint: 'Expected: { "studentIds": ["id1", "id2"] } or { "studentId": "id1" }'
      });
    }

    // Use the validated and normalized value
    const studentIds = value.studentIds;
    
    // If value.studentIds is still a string (from Joi alternative), convert to array
    const finalStudentIds = Array.isArray(studentIds) ? studentIds : [studentIds];

    const group = await StudentGroup.findById(groupId);

    if (!group) {
      return res.status(404).json({
        success: false,
        message: 'Group not found'
      });
    }

    // Validate all students exist and are students
    const studentMap = await resolveStudentNames(finalStudentIds);
    const invalidStudents = finalStudentIds.filter(id => !studentMap[id]);
    
    if (invalidStudents.length > 0) {
      return res.status(400).json({
        success: false,
        message: `Invalid student IDs: ${invalidStudents.join(', ')}`,
        invalidIds: invalidStudents
      });
    }

    // Check for duplicates
    const newStudentIds = finalStudentIds.filter(id => !group.studentIds.includes(id));
    
    if (newStudentIds.length === 0) {
      return res.status(400).json({
        success: false,
        message: 'All students are already in this group',
        attemptedIds: finalStudentIds,
        existingIds: group.studentIds
      });
    }

    // Check if new students are in other active groups
    const conflictingStudents = await checkStudentGroupConflicts(
      group.courseId.toString(),
      group.projectId ? group.projectId.toString() : null,
      newStudentIds,
      groupId
    );

    if (conflictingStudents.length > 0) {
      return res.status(409).json({
        success: false,
        message: `Students already in active groups: ${conflictingStudents.join(', ')}`,
        conflictingIds: conflictingStudents
      });
    }

    // Add students to group
    group.studentIds = [...group.studentIds, ...newStudentIds];
    await group.save();

    const formattedGroup = await formatGroupResponse(group);

    res.status(200).json({
      success: true,
      message: 'Students assigned to group successfully',
      data: formattedGroup
    });
  } catch (error) {
    console.error('❌ Error assigning students to group:', error.message);
    console.error('❌ Full error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to assign students to group',
      error: process.env.NODE_ENV !== 'production' ? error.message : undefined
    });
  }
});

/**
 * DELETE /api/v1/student-groups/:groupId/students
 * Remove students from group
 */
router.delete('/:groupId/students', isOptionalAuth, async (req, res) => {
  try {
    const groupId = req.params.groupId;

    if (!mongoose.Types.ObjectId.isValid(groupId)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid groupId format'
      });
    }

    const { error, value } = removeStudentsSchema.validate(req.body);
    if (error) {
      return res.status(400).json({
        success: false,
        message: 'Invalid request body',
        error: error.details[0].message
      });
    }

    const group = await StudentGroup.findById(groupId);

    if (!group) {
      return res.status(404).json({
        success: false,
        message: 'Group not found'
      });
    }

    // Remove students from group
    const removedStudentIds = value.studentIds.filter(id => group.studentIds.includes(id));
    group.studentIds = group.studentIds.filter(id => !value.studentIds.includes(id));

    // Ensure group has at least 2 students (or allow empty group if needed)
    if (group.studentIds.length < 2 && group.studentIds.length > 0) {
      return res.status(400).json({
        success: false,
        message: 'Group must have at least 2 students. Delete the group instead if you want to remove all students.'
      });
    }

    await group.save();

    res.status(200).json({
      success: true,
      message: 'Students removed from group successfully',
      data: {
        groupId: group._id.toString(),
        removedStudentIds: removedStudentIds,
        remainingStudentIds: group.studentIds
      }
    });
  } catch (error) {
    console.error('❌ Error removing students from group:', error.message);
    res.status(500).json({
      success: false,
      message: 'Failed to remove students from group',
      error: process.env.NODE_ENV !== 'production' ? error.message : undefined
    });
  }
});

/**
 * GET /api/v1/student-groups/course/:courseId/unassigned-students
 * Get students not in any group
 */
router.get('/course/:courseId/unassigned-students', isOptionalAuth, async (req, res) => {
  try {
    const courseId = req.params.courseId;

    if (!mongoose.Types.ObjectId.isValid(courseId)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid courseId format'
      });
    }

    const schema = Joi.object({
      projectId: Joi.string().optional().trim(),
      userName: Joi.string().optional().trim() // Allow userName in query params
    }).unknown(true); // Explicitly allow unknown keys

    const { error, value } = schema.validate(req.query, {
      convert: true, // Convert string booleans to actual booleans
      allowUnknown: true // Allow unknown keys
    });
    if (error) {
      return res.status(400).json({
        success: false,
        message: 'Invalid query parameters',
        error: error.details[0].message
      });
    }

    // Get all active groups for this course/project
    const groupQuery = {
      courseId: new mongoose.Types.ObjectId(courseId),
      isActive: true
    };

    if (value.projectId) {
      if (!mongoose.Types.ObjectId.isValid(value.projectId)) {
        return res.status(400).json({
          success: false,
          message: 'Invalid projectId format'
        });
      }
      groupQuery.projectId = new mongoose.Types.ObjectId(value.projectId);
    } else {
      groupQuery.$or = [
        { projectId: null },
        { projectId: { $exists: false } }
      ];
    }

    const groups = await StudentGroup.find(groupQuery);
    const assignedStudentIds = new Set();
    
    groups.forEach(group => {
      group.studentIds.forEach(id => assignedStudentIds.add(id));
    });

    // Get all students in the course (students with remark = courseId)
    const courseStudents = await User.find({
      remark: courseId,
      type: 'student'
    }).select('-password').lean();

    // Filter out students who are in groups
    const unassignedStudents = courseStudents.filter(student => {
      const studentId = student._id.toString();
      const username = student.username;
      return !assignedStudentIds.has(studentId) && !assignedStudentIds.has(username);
    });

    // Format response
    const formattedStudents = unassignedStudents.map(student => ({
      id: student._id.toString(),
      username: student.username,
      email: student.email || '',
      fullName: student.fullName || '',
      type: student.type
    }));

    res.status(200).json({
      success: true,
      data: formattedStudents
    });
  } catch (error) {
    console.error('❌ Error fetching unassigned students:', error.message);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch unassigned students',
      error: process.env.NODE_ENV !== 'production' ? error.message : undefined
    });
  }
});

module.exports = router;
