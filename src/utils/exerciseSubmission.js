const fs = require('fs');
const path = require('path');

const MAX_CODEBASE_BYTES = 10 * 1024 * 1024;
const UPLOAD_DIR = path.join(__dirname, '../../uploads/assessment');

function githubRepoUrl(value) {
  let url;
  try {
    url = new URL(String(value || '').trim());
  } catch (error) {
    return null;
  }
  if (url.protocol !== 'https:') return null;
  if (url.username || url.password) return null;
  const host = url.hostname.toLowerCase();
  if (host !== 'github.com' && host !== 'www.github.com') return null;
  const parts = url.pathname.split('/').filter(Boolean);
  if (parts.length < 2) return null;
  const owner = parts[0];
  const repo = parts[1].replace(/\.git$/i, '');
  if (!/^[A-Za-z0-9_.-]+$/.test(owner) || !/^[A-Za-z0-9_.-]+$/.test(repo)) return null;
  return url.toString();
}

function codebaseFromUpload(input) {
  const fileId = path.basename(String(input && input.fileId || ''));
  if (!fileId || fileId !== String(input.fileId) || fileId.includes('..')) {
    return { error: 'Codebase file was not uploaded' };
  }
  if (!fileId.toLowerCase().endsWith('.zip')) {
    return { error: 'A codebase upload must be a .zip under 10 MB' };
  }
  const full = path.resolve(UPLOAD_DIR, fileId);
  const root = path.resolve(UPLOAD_DIR);
  if (full !== root && !full.startsWith(root + path.sep)) {
    return { error: 'Codebase file was not uploaded' };
  }
  if (!fs.existsSync(full)) return { error: 'Codebase file was not uploaded' };
  const size = fs.statSync(full).size;
  if (size <= 0 || size > MAX_CODEBASE_BYTES) {
    return { error: 'A codebase upload must be a .zip under 10 MB' };
  }
  const base = process.env.SERVER_URL || 'http://localhost:3000';
  return {
    codebase: {
      fileId,
      fileName: path.basename(String(input.fileName || fileId)),
      fileSize: size,
      fileUrl: `${base.replace(/\/$/, '')}/uploads/assessment/${fileId}`,
    },
  };
}

/**
 * A submission is text, a GitHub repository link, or a zip already stored
 * by the assessment upload. The link is stored. The zip is not extracted.
 */
function exerciseSource({ submission, repoUrl, codebase }) {
  let link = null;
  if (repoUrl) {
    link = githubRepoUrl(repoUrl);
    if (!link) return { error: 'repoUrl must be an https://github.com/owner/repo link' };
  }
  let stored = null;
  if (codebase) {
    const checked = codebaseFromUpload(codebase);
    if (checked.error) return checked;
    stored = checked.codebase;
  }
  let text = String(submission || '').trim();
  if (!text && link) text = link;
  if (!text && stored) text = stored.fileName;
  if (!text) return { error: 'A submission needs text, a GitHub link, or a codebase under 10 MB' };
  return { submission: text, repoUrl: link, codebase: stored };
}

function codeSourceView(submission) {
  const raw = submission && submission.codebase;
  const codebase = raw && raw.fileId ? {
    fileId: raw.fileId,
    fileName: raw.fileName || '',
    fileSize: raw.fileSize || 0,
    fileUrl: raw.fileUrl || '',
  } : null;
  return {
    repoUrl: (submission && submission.repoUrl) || null,
    codebase,
  };
}

module.exports = {
  MAX_CODEBASE_BYTES,
  githubRepoUrl,
  codebaseFromUpload,
  exerciseSource,
  codeSourceView,
};
