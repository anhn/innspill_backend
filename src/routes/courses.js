const express = require('express');
const router = express.Router();
const mongoose = require('mongoose');
const Course = require('../models/Course');
const User = require('../models/User');
const { isOptionalAuth } = require('../middleware/auth');
const Joi = require('joi');

// Validation schemas
const courseCreateSchema = Joi.object({
  name: Joi.string().required().trim(),
  code: Joi.string().optional().allow('', null).trim(),
  academicYear: Joi.string().optional().allow('', null).trim(),
  university: Joi.string().optional().allow('', null).trim(),
  teacherId: Joi.string().optional().trim(), // Backward compatibility
  teacherIds: Joi.array().items(Joi.string().trim()).optional(), // New: array of teacher IDs
  userName: Joi.string().optional().trim()
});

const courseUpdateSchema = Joi.object({
  name: Joi.string().optional().trim(),
  code: Joi.string().optional().allow('', null).trim(),
  academicYear: Joi.string().optional().allow('', null).trim(),
  university: Joi.string().optional().allow('', null).trim(),
  teacherId: Joi.string().optional().trim(), // Backward compatibility
  teacherIds: Joi.array().items(Joi.string().trim()).optional() // New: array of teacher IDs
}).min(1);

/**
 * GET /api/v1/courses
 * Get list of available courses with course IDs
 * Optional filters: teacherId, academicYear, university
 */
router.get('/', isOptionalAuth, async (req, res) => {
  try {
    // Validate query parameters (all optional)
    const schema = Joi.object({
      teacherId: Joi.string().optional().trim(),
      academicYear: Joi.string().optional().trim(),
      university: Joi.string().optional().trim(),
      userName: Joi.string().optional().trim()
    });

    const { error, value } = schema.validate(req.query);
    if (error) {
      return res.status(400).json({
        success: false,
        message: 'Invalid query parameters',
        error: error.details[0].message
      });
    }

    // Check if teacherId exists in User collection (FIXED: don't try to cast email to ObjectId)
    if (value.teacherId) {
      // Only check _id if it's a valid ObjectId
      const userQuery = {
        $or: [
          { email: value.teacherId },
          { username: value.teacherId }
        ]
      };
      
      // Only add _id check if teacherId is a valid ObjectId
      if (mongoose.Types.ObjectId.isValid(value.teacherId)) {
        userQuery.$or.push({ _id: value.teacherId });
      }
      
      const user = await User.findOne(userQuery);
      if (user) {
        // Try alternative teacherId formats
        const alternativeTeacherIds = [user.email, user.username, user._id.toString()];
      }
    }

    // Build query filter (only include filters that are provided)
    const queryFilter = {};
    if (value.teacherId) {
      // Support filtering by teacherId in both teacherId field and teacherIds array
      // When combined with other filters (academicYear, university), MongoDB will AND them
      queryFilter.$or = [
        { teacherId: value.teacherId },
        { teacherIds: value.teacherId }
      ];
    }
    
    // Add academicYear and university filters (they will be ANDed with the $or above)
    if (value.academicYear) {
      // Trim to handle any whitespace issues
      queryFilter.academicYear = value.academicYear.trim();
    }
    if (value.university) {
      // Trim to handle any whitespace issues
      queryFilter.university = value.university.trim();
    }

    // Query courses with optional filters
    const courses = await Course.find(queryFilter).sort({ createdAt: -1 });

    // Format response with course IDs
    const formattedCourses = courses.map(course => {
      // Support both teacherIds array and teacherId (backward compatibility)
      const teacherIds = course.teacherIds && course.teacherIds.length > 0 
        ? course.teacherIds 
        : (course.teacherId ? [course.teacherId] : []);
      const teacherId = course.teacherId || (teacherIds.length > 0 ? teacherIds[0] : null);

      return {
        id: course._id.toString(),
        courseId: course._id.toString(), // Alias for clarity
        name: course.name,
        code: course.code || '',
        academicYear: course.academicYear,
        university: course.university,
        teacherIds: teacherIds, // Array of teacher IDs
        teacherId: teacherId, // Backward compatibility (first teacher ID)
        createdAt: course.createdAt,
        updatedAt: course.updatedAt
      };
    });

    res.status(200).json({
      success: true,
      data: formattedCourses,
      count: formattedCourses.length
    });
  } catch (error) {
    console.error('❌ Error fetching courses:', error.message);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch courses',
      error: process.env.NODE_ENV !== 'production' ? error.message : undefined
    });
  }
});

/**
 * POST /api/v1/courses
 * Create a new course
 */
router.post('/', isOptionalAuth, async (req, res) => {
  try {
    const { error, value } = courseCreateSchema.validate(req.body);
    if (error) {
      return res.status(400).json({
        success: false,
        message: 'Invalid request body',
        error: error.details[0].message
      });
    }

    // Handle both teacherIds (array) and teacherId (single, backward compatibility)
    let teacherIds = [];
    if (value.teacherIds && Array.isArray(value.teacherIds)) {
      teacherIds = value.teacherIds.filter(id => id && id.trim());
    } else if (value.teacherId) {
      teacherIds = [value.teacherId];
    }
    
    const course = new Course({
      name: value.name,
      code: value.code || '',
      academicYear: value.academicYear || '',
      university: value.university || '',
      teacherIds: teacherIds,
      teacherId: teacherIds.length > 0 ? teacherIds[0] : null, // Backward compatibility
      createdAt: new Date()
    });

    await course.save();

    return res.status(201).json({
      success: true,
      data: {
        id: course._id.toString(),
        courseId: course._id.toString(),
        name: course.name,
        code: course.code,
        academicYear: course.academicYear,
        university: course.university,
        teacherIds: course.teacherIds || [],
        teacherId: course.teacherId, // Backward compatibility
        createdAt: course.createdAt,
        updatedAt: course.updatedAt
      }
    });
  } catch (error) {
    console.error('❌ Error creating course:', error.message);
    return res.status(500).json({
      success: false,
      message: 'Failed to create course',
      error: process.env.NODE_ENV !== 'production' ? error.message : undefined
    });
  }
});

/**
 * PUT /api/v1/courses/:id
 * Update a course
 */
router.put('/:id', isOptionalAuth, async (req, res) => {
  try {
    if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
      return res.status(400).json({ success: false, message: 'Invalid course ID format' });
    }

    const { error, value } = courseUpdateSchema.validate(req.body);
    if (error) {
      return res.status(400).json({
        success: false,
        message: 'Invalid request body',
        error: error.details[0].message
      });
    }

    const course = await Course.findById(req.params.id);
    if (!course) {
      return res.status(404).json({ success: false, message: 'Course not found' });
    }

    if (value.name !== undefined) course.name = value.name;
    if (value.code !== undefined) course.code = value.code || '';
    if (value.academicYear !== undefined) course.academicYear = value.academicYear || '';
    if (value.university !== undefined) course.university = value.university || '';
    
    // Handle teacherIds array update
    if (value.teacherIds !== undefined) {
      course.teacherIds = Array.isArray(value.teacherIds) 
        ? value.teacherIds.filter(id => id && id.trim())
        : [];
      // Update teacherId for backward compatibility
      course.teacherId = course.teacherIds.length > 0 ? course.teacherIds[0] : null;
    }
    // Handle teacherId single update (backward compatibility)
    if (value.teacherId !== undefined && value.teacherIds === undefined) {
      // If only teacherId is provided, update teacherIds array
      if (!course.teacherIds || course.teacherIds.length === 0) {
        course.teacherIds = value.teacherId ? [value.teacherId] : [];
      } else if (value.teacherId && !course.teacherIds.includes(value.teacherId)) {
        course.teacherIds[0] = value.teacherId; // Update first teacher
      }
      course.teacherId = value.teacherId || null;
    }

    await course.save();

    return res.status(200).json({
      success: true,
      data: {
        id: course._id.toString(),
        courseId: course._id.toString(),
        name: course.name,
        code: course.code || '',
        academicYear: course.academicYear,
        university: course.university,
        teacherIds: course.teacherIds && course.teacherIds.length > 0 
          ? course.teacherIds 
          : (course.teacherId ? [course.teacherId] : []),
        teacherId: course.teacherId || (course.teacherIds && course.teacherIds[0]) || null,
        createdAt: course.createdAt,
        updatedAt: course.updatedAt
      }
    });
  } catch (error) {
    console.error('❌ Error updating course:', error.message);
    return res.status(500).json({
      success: false,
      message: 'Failed to update course',
      error: process.env.NODE_ENV !== 'production' ? error.message : undefined
    });
  }
});

/**
 * DELETE /api/v1/courses/:id
 * Delete a course
 */
router.delete('/:id', isOptionalAuth, async (req, res) => {
  try {
    if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
      return res.status(400).json({ success: false, message: 'Invalid course ID format' });
    }

    const course = await Course.findByIdAndDelete(req.params.id);
    if (!course) {
      return res.status(404).json({ success: false, message: 'Course not found' });
    }

    return res.status(200).json({ success: true, message: 'Course deleted' });
  } catch (error) {
    console.error('❌ Error deleting course:', error.message);
    return res.status(500).json({
      success: false,
      message: 'Failed to delete course',
      error: process.env.NODE_ENV !== 'production' ? error.message : undefined
    });
  }
});

/**
 * GET /api/v1/courses/student/:username
 * Get courses by student username
 * Note: courseId is stored in the remark field of the User schema
 */
router.get('/student/:username', isOptionalAuth, async (req, res) => {
  try {
    const schema = Joi.object({
      userName: Joi.string().optional().trim()
    });

    const { error } = schema.validate(req.query);
    if (error) {
      return res.status(400).json({
        success: false,
        message: 'Invalid query parameters',
        error: error.details[0].message
      });
    }

    const username = req.params.username;

    // Find student user by username
    const student = await User.findOne({
      username: username,
      type: 'student'
    });

    if (!student) {
      return res.status(404).json({
        success: false,
        message: 'Student not found'
      });
    }

    // Extract courseId from remark field
    const courseId = student.remark;

    if (!courseId || !mongoose.Types.ObjectId.isValid(courseId)) {
      return res.status(200).json({
        success: true,
        data: []
      });
    }

    // Find course by courseId
    const course = await Course.findById(courseId);

    if (!course) {
      return res.status(200).json({
        success: true,
        data: []
      });
    }

    // Format response
    const teacherIds = course.teacherIds && course.teacherIds.length > 0 
      ? course.teacherIds 
      : (course.teacherId ? [course.teacherId] : []);
    const teacherId = course.teacherId || (teacherIds.length > 0 ? teacherIds[0] : null);

    const formattedCourse = {
      id: course._id.toString(),
      name: course.name,
      code: course.code || '',
      academicYear: course.academicYear,
      university: course.university,
      teacherIds: teacherIds,
      teacherId: teacherId, // Backward compatibility
      createdAt: course.createdAt,
      updatedAt: course.updatedAt
    };

    res.status(200).json({
      success: true,
      data: [formattedCourse] // Return as array for consistency
    });
  } catch (error) {
    console.error('❌ Error fetching courses by student:', error.message);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch courses',
      error: process.env.NODE_ENV !== 'production' ? error.message : undefined
    });
  }
});

/**
 * POST /api/v1/courses/:id/assign-teacher
 * Assign a new teacher to an existing course
 */
router.post('/:id/assign-teacher', isOptionalAuth, async (req, res) => {
  try {
    if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
      return res.status(400).json({ 
        success: false, 
        message: 'Invalid course ID format' 
      });
    }

    const schema = Joi.object({
      teacherId: Joi.string().required().trim()
    });

    const { error, value } = schema.validate(req.body);
    if (error) {
      return res.status(400).json({
        success: false,
        message: 'Invalid request body',
        error: error.details[0].message
      });
    }

    const course = await Course.findById(req.params.id);
    if (!course) {
      return res.status(404).json({ 
        success: false, 
        message: 'Course not found' 
      });
    }

    // Initialize teacherIds array if it doesn't exist (migration support)
    if (!course.teacherIds || course.teacherIds.length === 0) {
      course.teacherIds = course.teacherId ? [course.teacherId] : [];
    }

    // Check if teacher is already assigned
    if (course.teacherIds.includes(value.teacherId)) {
      return res.status(400).json({
        success: false,
        message: 'Teacher is already assigned to this course'
      });
    }

    // Add teacher to the array
    course.teacherIds.push(value.teacherId);
    
    // Keep teacherId for backward compatibility (set to first teacher if not set)
    if (!course.teacherId) {
      course.teacherId = course.teacherIds[0];
    }

    await course.save();

    return res.status(200).json({
      success: true,
      data: {
        id: course._id.toString(),
        name: course.name,
        teacherIds: course.teacherIds,
        teacherId: course.teacherId, // Backward compatibility
        message: 'Teacher assigned successfully'
      }
    });
  } catch (error) {
    console.error('❌ Error assigning teacher to course:', error.message);
    return res.status(500).json({
      success: false,
      message: 'Failed to assign teacher to course',
      error: process.env.NODE_ENV !== 'production' ? error.message : undefined
    });
  }
});

/**
 * DELETE /api/v1/courses/:id/remove-teacher
 * Remove a teacher from a course
 */
router.delete('/:id/remove-teacher', isOptionalAuth, async (req, res) => {
  try {
    if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
      return res.status(400).json({ 
        success: false, 
        message: 'Invalid course ID format' 
      });
    }

    const schema = Joi.object({
      teacherId: Joi.string().required().trim()
    });

    const { error, value } = schema.validate(req.body);
    if (error) {
      return res.status(400).json({
        success: false,
        message: 'Invalid request body',
        error: error.details[0].message
      });
    }

    const course = await Course.findById(req.params.id);
    if (!course) {
      return res.status(404).json({ 
        success: false, 
        message: 'Course not found' 
      });
    }

    // Initialize teacherIds array if it doesn't exist (migration support)
    if (!course.teacherIds || course.teacherIds.length === 0) {
      course.teacherIds = course.teacherId ? [course.teacherId] : [];
    }

    // Check if teacher is assigned
    if (!course.teacherIds.includes(value.teacherId)) {
      return res.status(404).json({
        success: false,
        message: 'Teacher is not assigned to this course'
      });
    }

    // Prevent removing the last teacher (course must have at least one teacher)
    if (course.teacherIds.length === 1) {
      return res.status(400).json({
        success: false,
        message: 'Cannot remove the last teacher from the course. A course must have at least one teacher.'
      });
    }

    // Remove teacher from array
    course.teacherIds = course.teacherIds.filter(id => id !== value.teacherId);

    // Update teacherId for backward compatibility (set to first remaining teacher)
    course.teacherId = course.teacherIds.length > 0 ? course.teacherIds[0] : null;

    await course.save();

    return res.status(200).json({
      success: true,
      data: {
        id: course._id.toString(),
        name: course.name,
        teacherIds: course.teacherIds,
        teacherId: course.teacherId,
        message: 'Teacher removed successfully'
      }
    });
  } catch (error) {
    console.error('❌ Error removing teacher from course:', error.message);
    return res.status(500).json({
      success: false,
      message: 'Failed to remove teacher from course',
      error: process.env.NODE_ENV !== 'production' ? error.message : undefined
    });
  }
});

module.exports = router;

