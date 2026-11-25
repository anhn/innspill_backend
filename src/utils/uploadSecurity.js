const path = require('path');

const ALLOWED_EXTENSIONS = new Set([
  '.pdf',
  '.doc',
  '.docx',
  '.ppt',
  '.pptx',
  '.xls',
  '.xlsx',
  '.txt',
  '.zip',
  '.png',
  '.jpg',
  '.jpeg',
  '.gif',
  '.webp'
]);

const BLOCKED_EXTENSIONS = new Set([
  '.html',
  '.htm',
  '.svg',
  '.js',
  '.mjs',
  '.exe',
  '.bat',
  '.cmd',
  '.sh',
  '.php',
  '.asp',
  '.aspx'
]);

function assessmentUploadFileFilter(req, file, cb) {
  const ext = path.extname(file.originalname || '').toLowerCase();
  if (BLOCKED_EXTENSIONS.has(ext)) {
    return cb(new Error(`File type not allowed: ${ext}`));
  }
  if (!ALLOWED_EXTENSIONS.has(ext)) {
    return cb(new Error(`File type not allowed: ${ext || 'unknown'}`));
  }
  return cb(null, true);
}

module.exports = {
  ALLOWED_EXTENSIONS,
  BLOCKED_EXTENSIONS,
  assessmentUploadFileFilter
};
