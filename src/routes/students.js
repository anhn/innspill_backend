const express = require('express');
const router = express.Router();
const mongoose = require('mongoose');
const User = require('../models/User');
const { isOptionalAuth } = require('../middleware/auth');
const Joi = require('joi');

// Validation schemas
const updateStudentSchema = Joi.object({
  email: Joi.string().email().optional().allow('', null).trim(),
  fullName: Joi.string().optional().allow('', null).trim(),
  remark: Joi.string().optional().allow('', null).trim()
}).min(1);

/**
 * GET /api/v1/students
 * Get student users belonging to a course
 * Note: courseId is stored in the remark field of the User schema
 */
router.get('/', isOptionalAuth, async (req, res) => {
  try {
    const schema = Joi.object({
      courseId: Joi.string().required().trim().min(1),
      userName: Joi.string().optional().trim() // Optional, not used in query
    });

    const { error, value } = schema.validate(req.query);
    if (error) {
      return res.status(400).json({
        success: false,
        message: 'Invalid query parameters',
        error: error.details[0].message
      });
    }

    // Validate courseId format
    if (!mongoose.Types.ObjectId.isValid(value.courseId)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid courseId format'
      });
    }

    // Find User records where remark field equals courseId and type is 'student'
    const students = await User.find({
      remark: value.courseId,
      type: 'student'
    }).select('-password'); // Exclude password from response

    // Format response
    const formattedStudents = students.map(student => ({
      id: student._id.toString(),
      username: student.username,
      email: student.email || '',
      fullName: student.fullName || '',
      type: student.type,
      date_created: student.date_created,
      remark: student.remark || ''
    }));

    res.status(200).json({
      success: true,
      data: formattedStudents
    });
  } catch (error) {
    console.error('❌ Error fetching students:', error.message);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch students',
      error: process.env.NODE_ENV !== 'production' ? error.message : undefined
    });
  }
});

/**
 * PUT /api/v1/students/:id
 * Update student information
 */
router.put('/:id', isOptionalAuth, async (req, res) => {
  try {
    if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid student ID format'
      });
    }

    const { error, value } = updateStudentSchema.validate(req.body);
    if (error) {
      return res.status(400).json({
        success: false,
        message: 'Invalid request body',
        error: error.details[0].message
      });
    }

    const student = await User.findOne({
      _id: req.params.id,
      type: 'student'
    });

    if (!student) {
      return res.status(404).json({
        success: false,
        message: 'Student not found'
      });
    }

    // Only update allowed fields
    if (value.email !== undefined) student.email = value.email || null;
    if (value.fullName !== undefined) student.fullName = value.fullName || '';
    if (value.remark !== undefined) student.remark = value.remark || '';

    await student.save();

    res.status(200).json({
      success: true,
      data: {
        id: student._id.toString(),
        username: student.username,
        email: student.email || '',
        fullName: student.fullName || '',
        type: student.type,
        date_created: student.date_created,
        remark: student.remark || ''
      }
    });
  } catch (error) {
    console.error('❌ Error updating student:', error.message);
    res.status(500).json({
      success: false,
      message: 'Failed to update student',
      error: process.env.NODE_ENV !== 'production' ? error.message : undefined
    });
  }
});

/**
 * DELETE /api/v1/students/:id
 * Delete a student
 */
router.delete('/:id', isOptionalAuth, async (req, res) => {
  try {
    if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid student ID format'
      });
    }

    // Find and verify the student exists and is actually a student
    const student = await User.findOne({
      _id: req.params.id,
      type: 'student'
    });

    if (!student) {
      return res.status(404).json({
        success: false,
        message: 'Student not found'
      });
    }

    // Delete the student
    await User.findByIdAndDelete(req.params.id);

    res.status(200).json({
      success: true,
      message: 'Student deleted successfully'
    });
  } catch (error) {
    console.error('❌ Error deleting student:', error.message);
    res.status(500).json({
      success: false,
      message: 'Failed to delete student',
      error: process.env.NODE_ENV !== 'production' ? error.message : undefined
    });
  }
});

module.exports = router;

