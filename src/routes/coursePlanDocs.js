const express = require('express');
const router = express.Router();
const CoursePlanDoc = require('../models/CoursePlanDoc');
const { isOptionalAuth } = require('../middleware/auth');

/**
 * POST /api/v1/course-plan-docs
 * Save a course plan document version (original, analysis, or revision)
 */
router.post('/', isOptionalAuth, async (req, res) => {
  try {
    console.log('📝 Save Course Plan Doc - Request received');
    
    const {
      coursePlanName,
      sessionId,
      versionType,
      versionNumber = 1,
      title,
      content,
      teacherInfo,
      userName,
      createdAt,
      tags,
      metadata
    } = req.body;

    console.log(`📝 Course: ${coursePlanName}`);
    console.log(`📝 User: ${userName || req.user?.id || 'anonymous'}`);
    console.log(`📝 Session: ${sessionId}`);
    console.log(`📝 Version: ${versionType} v${versionNumber}`);
    console.log(`📝 Title: ${title}`);

    // Validate required fields
    if (!coursePlanName || !sessionId || !versionType || !title || !content) {
      console.log('❌ Validation failed: Missing required fields');
      return res.status(400).json({
        success: false,
        message: 'coursePlanName, sessionId, versionType, title, and content are required'
      });
    }

    // Validate versionType
    if (!['original', 'analysis', 'revision'].includes(versionType)) {
      return res.status(400).json({
        success: false,
        message: 'versionType must be "original", "analysis", or "revision"'
      });
    }

    // Create document
    const coursePlanDoc = new CoursePlanDoc({
      userId: req.user?.id || null,
      userName: userName || null,
      coursePlanName,
      sessionId,
      versionType,
      versionNumber,
      title,
      content,
      teacherInfo: teacherInfo || {},
      tags: tags || [],
      metadata: {
        notes: metadata?.notes || '',
        frontend_version_id: metadata?.frontend_version_id || null,
        agent: metadata?.agent || null,
        tokenUsage: metadata?.tokenUsage || null,
        processingTime: metadata?.processingTime || null,
        fileSize: content.length
      }
    });

    const saved = await coursePlanDoc.save();

    console.log(`✅ Course plan document saved successfully`);
    console.log(`   Document ID: ${saved._id}`);
    console.log(`   Session ID: ${saved.sessionId}`);
    console.log(`   Version: ${saved.versionType} v${saved.versionNumber}`);
    console.log(`   Collection: course_plan_docs`);
    console.log(`   Database: ai4edu_database`);

    res.status(201).json({
      success: true,
      message: 'Course plan document saved successfully',
      documentId: saved._id,
      data: {
        _id: saved._id
      }
    });

  } catch (error) {
    console.error('❌ Error saving course plan document:', error.message);
    console.error('   Error code:', error.code);
    console.error('   Error name:', error.name);
    res.status(500).json({
      success: false,
      message: 'Internal server error',
      error: error.message
    });
  }
});

/**
 * PATCH /api/v1/course-plan-docs/:id
 * Update an existing course plan document
 */
router.patch('/:id', isOptionalAuth, async (req, res) => {
  try {
    console.log(`📝 Update Course Plan Doc - Request received for ID: ${req.params.id}`);
    
    const { id } = req.params;
    const updates = req.body;

    console.log(`📝 Update fields:`, Object.keys(updates));

    const doc = await CoursePlanDoc.findById(id);

    if (!doc) {
      console.log(`❌ Document not found: ${id}`);
      return res.status(404).json({
        success: false,
        message: 'Course plan document not found'
      });
    }
    
    console.log(`📝 Found document: ${doc.coursePlanName} (${doc.versionType} v${doc.versionNumber})`);

    // Update allowed fields
    const allowedUpdates = [
      'title', 
      'content', 
      'coursePlanName', 
      'teacherInfo', 
      'tags', 
      'metadata'
    ];

    allowedUpdates.forEach(field => {
      if (updates[field] !== undefined) {
        if (field === 'metadata') {
          // Merge metadata instead of replacing
          doc.metadata = { ...doc.metadata, ...updates.metadata };
        } else {
          doc[field] = updates[field];
        }
      }
    });

    const updated = await doc.save();

    console.log(`✅ Course plan document updated successfully`);
    console.log(`   Document ID: ${updated._id}`);
    console.log(`   Version: ${updated.versionType} v${updated.versionNumber}`);

    res.status(200).json({
      success: true,
      message: 'Course plan document updated successfully',
      data: {
        _id: updated._id
      }
    });

  } catch (error) {
    console.error('❌ Error updating course plan document:', error.message);
    console.error('   Document ID:', req.params.id);
    res.status(500).json({
      success: false,
      message: 'Internal server error',
      error: error.message
    });
  }
});

/**
 * GET /api/v1/course-plan-docs
 * Get all course plan documents for the current user (with pagination and filtering)
 */
router.get('/', isOptionalAuth, async (req, res) => {
  try {
    console.log('📋 Get Course Plan Docs - Request received');
    
    const {
      page = 1,
      limit = 20,
      status,
      coursePlanName,
      userName,
      sortBy = 'createdAt',
      sortOrder = 'desc'
    } = req.query;
    
    // NEW: Extract additional query params
    const sessionIdParam = req.query.sessionId;
    const versionTypeParam = req.query.versionType;

    console.log(`📋 Query params:`, {
      page,
      limit,
      userName: userName || 'any',
      coursePlanName: coursePlanName || 'any',
      sessionId: sessionIdParam || 'any',
      versionType: versionTypeParam || 'any',
      status: status || 'any'
    });

    // Build query
    const query = {};
    
    // Filter by userName if provided, otherwise by userId
    // If neither is provided, show all documents (for anonymous access)
    if (userName) {
      query.userName = userName;
      console.log(`📋 Filtering by userName: ${userName}`);
    } else if (req.user?.id) {
      query.userId = req.user.id;
      console.log(`📋 Filtering by userId: ${req.user.id}`);
    } else {
      console.log(`📋 No user filter - showing all documents`);
    }
    
    // NEW: Filter by sessionId to get all related documents
    if (sessionIdParam) {
      query.sessionId = sessionIdParam;
      console.log(`📋 Filtering by sessionId: ${sessionIdParam}`);
    }
    
    // NEW: Filter by versionType
    if (versionTypeParam) {
      query.versionType = versionTypeParam;
      console.log(`📋 Filtering by versionType: ${versionTypeParam}`);
    }
    
    if (status) {
      query.status = status;
      console.log(`📋 Filtering by status: ${status}`);
    }
    if (coursePlanName) {
      query.coursePlanName = new RegExp(coursePlanName, 'i');
      console.log(`📋 Filtering by coursePlanName: ${coursePlanName}`);
    }
    
    console.log(`📋 Final query:`, JSON.stringify(query));

    // Calculate pagination
    const skip = (page - 1) * limit;
    const sort = { [sortBy]: sortOrder === 'desc' ? -1 : 1 };

    // Execute query
    const [docs, total] = await Promise.all([
      CoursePlanDoc.find(query)
        .sort(sort)
        .skip(skip)
        .limit(parseInt(limit))
        .lean(),
      CoursePlanDoc.countDocuments(query)
    ]);

    console.log(`✅ Found ${docs.length} documents (total: ${total})`);
    if (docs.length > 0) {
      console.log(`📋 Sample document:`, {
        id: docs[0]._id,
        coursePlanName: docs[0].coursePlanName,
        userName: docs[0].userName,
        sessionId: docs[0].sessionId,
        versionType: docs[0].versionType,
        versionNumber: docs[0].versionNumber
      });
    }

    res.status(200).json({
      success: true,
      data: docs,
      total: total,
      page: parseInt(page),
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
        total,
        pages: Math.ceil(total / limit)
      }
    });

  } catch (error) {
    console.error('❌ Error getting course plan documents:', error.message);
    res.status(500).json({
      success: false,
      message: 'Internal server error',
      error: error.message
    });
  }
});

/**
 * GET /api/v1/course-plan-docs/:id
 * Get a specific course plan document by ID
 */
router.get('/:id', isOptionalAuth, async (req, res) => {
  try {
    console.log(`📋 Get Course Plan Doc by ID: ${req.params.id}`);
    
    const { id } = req.params;

    const doc = await CoursePlanDoc.findById(id).lean();

    if (!doc) {
      console.log(`❌ Document not found: ${id}`);
      return res.status(404).json({
        success: false,
        message: 'Course plan document not found'
      });
    }

    console.log(`✅ Document found: ${doc.coursePlanName} (${doc.versionType} v${doc.versionNumber})`);

    res.status(200).json({
      success: true,
      data: doc
    });

  } catch (error) {
    console.error('❌ Error getting course plan document:', error.message);
    res.status(500).json({
      success: false,
      message: 'Internal server error',
      error: error.message
    });
  }
});

/**
 * DELETE /api/v1/course-plan-docs/:id
 * Delete a course plan document
 */
router.delete('/:id', isOptionalAuth, async (req, res) => {
  try {
    console.log(`🗑️ Delete Course Plan Doc - Request received for ID: ${req.params.id}`);
    
    const { id } = req.params;

    const doc = await CoursePlanDoc.findById(id);

    if (!doc) {
      console.log(`❌ Document not found: ${id}`);
      return res.status(404).json({
        success: false,
        message: 'Course plan document not found'
      });
    }
    
    console.log(`📋 Deleting document: ${doc.coursePlanName}`);

    // Optional: Check if user owns this document
    // if (req.user?.id && doc.userId && doc.userId !== req.user.id) {
    //   return res.status(403).json({
    //     success: false,
    //     message: 'Unauthorized to delete this document'
    //   });
    // }

    await doc.deleteOne();

    console.log(`✅ Document deleted successfully: ${id}`);

    res.status(200).json({
      success: true,
      message: 'Course plan document deleted successfully'
    });

  } catch (error) {
    console.error('❌ Error deleting course plan document:', error.message);
    res.status(500).json({
      success: false,
      message: 'Internal server error',
      error: error.message
    });
  }
});

/**
 * GET /api/v1/course-plan-docs/stats/summary
 * Get summary statistics for course plan documents
 */
router.get('/stats/summary', isOptionalAuth, async (req, res) => {
  try {
    console.log('📊 Get Course Plan Stats - Request received');
    
    const { userName } = req.query;
    
    const query = {};
    if (userName) {
      query.userName = userName;
      console.log(`📊 Filtering by userName: ${userName}`);
    } else if (req.user?.id) {
      query.userId = req.user.id;
      console.log(`📊 Filtering by userId: ${req.user.id}`);
    }

    const stats = await CoursePlanDoc.aggregate([
      { $match: query },
      {
        $group: {
          _id: null,
          totalDocuments: { $sum: 1 },
          originalCount: {
            $sum: { $cond: [{ $eq: ['$versionType', 'original'] }, 1, 0] }
          },
          analysisCount: {
            $sum: { $cond: [{ $eq: ['$versionType', 'analysis'] }, 1, 0] }
          },
          revisionCount: {
            $sum: { $cond: [{ $eq: ['$versionType', 'revision'] }, 1, 0] }
          },
          avgAnalysisTokens: {
            $avg: {
              $cond: [
                { $eq: ['$versionType', 'analysis'] },
                '$metadata.tokenUsage.totalTokens',
                null
              ]
            }
          },
          avgRevisionTokens: {
            $avg: {
              $cond: [
                { $eq: ['$versionType', 'revision'] },
                '$metadata.tokenUsage.totalTokens',
                null
              ]
            }
          }
        }
      }
    ]);

    const versionTypeBreakdown = await CoursePlanDoc.aggregate([
      { $match: query },
      {
        $group: {
          _id: '$versionType',
          count: { $sum: 1 }
        }
      },
      { $sort: { count: -1 } }
    ]);

    const overall = stats[0] || {
      totalDocuments: 0,
      originalCount: 0,
      analysisCount: 0,
      revisionCount: 0,
      avgAnalysisTokens: 0,
      avgRevisionTokens: 0
    };

    console.log(`✅ Stats retrieved: ${overall.totalDocuments} total documents`);
    console.log(`   Original: ${overall.originalCount}, Analysis: ${overall.analysisCount}, Revision: ${overall.revisionCount}`);

    res.status(200).json({
      success: true,
      data: {
        overall,
        versionTypeBreakdown
      }
    });

  } catch (error) {
    console.error('❌ Error getting course plan stats:', error.message);
    res.status(500).json({
      success: false,
      message: 'Internal server error',
      error: error.message
    });
  }
});

module.exports = router;

