const express = require('express');
const router = express.Router();
const { isOptionalAuth } = require('../middleware/auth');
const path = require('path');
const fs = require('fs');

// Try to require multer, fallback if not installed
let multer;
try {
  multer = require('multer');
} catch (error) {
  console.warn('⚠️ Multer not installed. File upload functionality will be limited.');
  console.warn('   Install with: npm install multer');
}

// Configure multer for file uploads (if available)
let upload;
if (multer) {
  const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    const uploadDir = path.join(__dirname, '../../uploads/assessment');
    // Create directory if it doesn't exist
    if (!fs.existsSync(uploadDir)) {
      fs.mkdirSync(uploadDir, { recursive: true });
    }
    cb(null, uploadDir);
  },
  filename: function (req, file, cb) {
    // Generate unique filename: timestamp-originalname
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    const ext = path.extname(file.originalname);
    const name = path.basename(file.originalname, ext);
    cb(null, `${name}-${uniqueSuffix}${ext}`);
  }
});

// File filter
const fileFilter = (req, file, cb) => {
  // Accept all file types for now (can be restricted later)
  cb(null, true);
};

  upload = multer({
    storage: storage,
    limits: {
      fileSize: 10 * 1024 * 1024 // 10MB limit
    },
    fileFilter: fileFilter
  });
} else {
  // Fallback: create a dummy upload middleware
  upload = {
    single: () => (req, res, next) => {
      res.status(503).json({
        success: false,
        message: 'File upload not available. Please install multer: npm install multer'
      });
    }
  };
}

/**
 * POST /api/v1/assessment/upload
 * Upload attachment file
 */
router.post('/', isOptionalAuth, upload.single('file'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({
        success: false,
        message: 'No file uploaded'
      });
    }

    // Generate file URL (adjust based on your server configuration)
    const baseUrl = process.env.SERVER_URL || 'http://localhost:3000';
    const fileUrl = `${baseUrl}/uploads/assessment/${req.file.filename}`;

    res.status(200).json({
      success: true,
      data: {
        fileId: req.file.filename,
        fileName: req.file.originalname,
        fileUrl: fileUrl,
        fileSize: req.file.size,
        mimeType: req.file.mimetype,
        uploadedAt: new Date().toISOString()
      }
    });
  } catch (error) {
    console.error('❌ Error uploading file:', error.message);
    res.status(500).json({
      success: false,
      message: 'Failed to upload file',
      error: process.env.NODE_ENV !== 'production' ? error.message : undefined
    });
  }
});

module.exports = router;

