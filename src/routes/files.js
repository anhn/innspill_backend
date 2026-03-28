const express = require('express');
const router = express.Router();
const path = require('path');
const fs = require('fs');
const { isOptionalAuth } = require('../middleware/auth');

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
      // Store files in uploads/assessment directory
      const uploadDir = path.join(__dirname, '../../uploads/assessment');
      
      // Create directory if it doesn't exist
      if (!fs.existsSync(uploadDir)) {
        fs.mkdirSync(uploadDir, { recursive: true });
      }
      
      cb(null, uploadDir);
    },
    filename: function (req, file, cb) {
      // Generate unique filename to prevent conflicts
      const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
      const ext = path.extname(file.originalname);
      const name = path.basename(file.originalname, ext);
      cb(null, `${name}-${uniqueSuffix}${ext}`);
    }
  });

  upload = multer({
    storage: storage,
    limits: {
      fileSize: 10 * 1024 * 1024 // 10MB limit (adjust as needed)
    }
    // No fileFilter - allows all file types
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
 * POST /api/v1/files/upload
 * Upload attachment file
 * Query params: userName (optional)
 * Body: FormData with 'file' field
 */
router.post('/upload', isOptionalAuth, upload.single('file'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({
        success: false,
        message: 'No file uploaded'
      });
    }

    const userName = req.query.userName || 'anonymous';

    // Return the filename (relative path that can be used for download)
    // The filename is what gets stored in the database
    const filename = req.file.filename;

    res.json({
      success: true,
      filename: filename, // This is what the frontend expects
      path: `uploads/assessment/${filename}`, // Optional: full path
      originalName: req.file.originalname,
      size: req.file.size
    });
  } catch (error) {
    console.error('❌ File upload error:', error.message);
    res.status(500).json({
      success: false,
      message: error.message || 'Failed to upload file'
    });
  }
});

/**
 * GET /api/v1/files/:filename
 * Download/serve uploaded files
 */
router.get('/:filename', isOptionalAuth, async (req, res) => {
  try {
    const filename = req.params.filename;
    
    // Security: Prevent directory traversal attacks
    if (filename.includes('..') || filename.includes('/') || filename.includes('\\')) {
      return res.status(400).json({
        success: false,
        message: 'Invalid filename'
      });
    }

    // Construct file path - files are stored in uploads/assessment/
    const filePath = path.join(__dirname, '../../uploads/assessment', filename);

    // Check if file exists
    if (!fs.existsSync(filePath)) {
      return res.status(404).json({
        success: false,
        message: 'File not found'
      });
    }

    // Get file stats
    const stats = fs.statSync(filePath);
    
    // Set appropriate headers for file download
    const ext = path.extname(filename).toLowerCase();
    const contentTypeMap = {
      '.pdf': 'application/pdf',
      '.doc': 'application/msword',
      '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      '.xls': 'application/vnd.ms-excel',
      '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      '.txt': 'text/plain',
      '.jpg': 'image/jpeg',
      '.jpeg': 'image/jpeg',
      '.png': 'image/png',
      '.gif': 'image/gif',
      '.zip': 'application/zip',
      '.rar': 'application/x-rar-compressed'
    };

    const contentType = contentTypeMap[ext] || 'application/octet-stream';
    
    // Decode filename for display (in case it was encoded)
    const displayName = decodeURIComponent(filename);

    // Set headers
    res.setHeader('Content-Type', contentType);
    res.setHeader('Content-Disposition', `attachment; filename="${displayName}"`);
    res.setHeader('Content-Length', stats.size);
    res.setHeader('Cache-Control', 'private, max-age=3600');

    // Stream the file
    const fileStream = fs.createReadStream(filePath);
    fileStream.pipe(res);

    fileStream.on('error', (error) => {
      console.error('❌ Error streaming file:', error.message);
      if (!res.headersSent) {
        res.status(500).json({
          success: false,
          message: 'Error reading file'
        });
      }
    });

  } catch (error) {
    console.error('❌ Error serving file:', error.message);
    if (!res.headersSent) {
      res.status(500).json({
        success: false,
        message: 'Failed to serve file',
        error: process.env.NODE_ENV !== 'production' ? error.message : undefined
      });
    }
  }
});

module.exports = router;

