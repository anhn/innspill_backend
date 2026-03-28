// Normalizes RAG source blocks into JSONL of clean chunks
// Usage: node scripts/normalize-rag.js

const fs = require('fs');
const path = require('path');

const INPUT_PATH = path.join(__dirname, '..', 'src', 'models', 'RagDocument.json');
const INPUT_PATH_2 = path.join(__dirname, '..', 'src', 'models', 'RagDocument2.json');
const INPUT_PATH_3 = path.join(__dirname, '..', 'src', 'models', 'RagDocument3.json');
const OUTPUT_PATH = path.join(__dirname, '..', 'src', 'models', 'RagDocument.normalized.jsonl');

function readFile(filepath) {
  return fs.readFileSync(filepath, 'utf8');
}

// Parse concatenated JSON objects reliably by tracking brace depth
function parseJsonObjects(input) {
  const objects = [];
  let depth = 0;
  let start = -1;
  let inString = false;
  let escape = false;

  for (let i = 0; i < input.length; i++) {
    const ch = input[i];

    if (inString) {
      if (escape) {
        escape = false;
      } else if (ch === '\\') {
        escape = true;
      } else if (ch === '"') {
        inString = false;
      }
      continue;
    }

    if (ch === '"') {
      inString = true;
      continue;
    }

    if (ch === '{') {
      if (depth === 0) start = i;
      depth++;
    } else if (ch === '}') {
      depth--;
      if (depth === 0 && start !== -1) {
        const slice = input.slice(start, i + 1);
        try {
          const obj = JSON.parse(slice);
          objects.push(obj);
        } catch (e) {
          // Skip invalid blocks but continue
          // Optionally write to stderr
          // console.error('Failed to parse a JSON block:', e.message);
        }
        start = -1;
      }
    }
  }
  return objects;
}

function flattenChunkText(value) {
  if (value == null) return '';
  if (typeof value === 'string') return value;
  if (Array.isArray(value)) {
    // If array of strings
    if (value.every(v => typeof v === 'string')) {
      return value.join('\n\n');
    }
    // If array of objects, render as bullet lines
    return value
      .map((item, idx) => formatObject(item, idx + 1))
      .join('\n\n');
  }
  if (typeof value === 'object') {
    return formatObject(value);
  }
  return String(value);
}

function formatObject(obj, index) {
  const prefix = index ? `${index}. ` : '';
  const lines = [];
  const entries = Object.entries(obj);
  if (entries.length === 0) return '';
  // If there is a clear title-like field, use it as header
  const titleKey = ['title', 'approach', 'name', 'heading'].find(k => k in obj);
  if (titleKey) {
    lines.push(`${prefix}${obj[titleKey]}`);
  }
  for (const [k, v] of entries) {
    if (k === titleKey) continue;
    if (v == null) continue;
    const valStr = typeof v === 'string' ? v : Array.isArray(v) ? v.join('; ') : JSON.stringify(v);
    lines.push(`   ${k}: ${valStr}`);
  }
  return lines.join('\n');
}

function splitByParagraphs(text, maxChars) {
  if (text.length <= maxChars) return [text];
  const parts = [];
  const paragraphs = text.split(/\n\n+/);
  let buf = '';
  for (const p of paragraphs) {
    const chunk = (buf ? buf + '\n\n' : '') + p;
    if (chunk.length <= maxChars) {
      buf = chunk;
    } else {
      if (buf) parts.push(buf);
      if (p.length <= maxChars) {
        buf = p;
      } else {
        // Paragraph itself is too long: hard split by spaces
        let start = 0;
        while (start < p.length) {
          let end = Math.min(start + maxChars, p.length);
          // try to break at space
          const space = p.lastIndexOf(' ', end);
          if (space > start + Math.floor(maxChars * 0.6)) end = space;
          parts.push(p.slice(start, end).trim());
          start = end;
        }
        buf = '';
      }
    }
  }
  if (buf) parts.push(buf);
  return parts;
}

function ensureDefaults(obj) {
  // id must exist
  if (!obj.id || String(obj.id).trim() === '') return { ok: false, reason: 'missing_id' };
  // section title fallback
  if (!obj.section_title || String(obj.section_title).trim() === '') {
    obj.section_title = obj.document_title || obj.section || 'General';
  }
  // language fallback
  if (!obj.language || String(obj.language).trim() === '') {
    obj.language = 'en';
  }
  // embedding model fallback
  if (!obj.embedding_model || String(obj.embedding_model).trim() === '') {
    obj.embedding_model = 'text-embedding-3-large';
  }
  return { ok: true };
}

function main() {
  // Source 1: possibly concatenated JSON blocks (or a JSON array). Try array parse first.
  const raw1 = readFile(INPUT_PATH);
  let objects1 = [];
  try {
    const parsed = JSON.parse(raw1);
    if (Array.isArray(parsed)) objects1 = parsed;
  } catch (_) {
    // Not a JSON array; fall back to concatenated object parse
    objects1 = parseJsonObjects(raw1);
  }

  // Source 2: RagDocument2.json (can be an object or an array)
  let objects2 = [];
  try {
    const raw2 = readFile(INPUT_PATH_2);
    const parsed2 = JSON.parse(raw2);
    if (Array.isArray(parsed2)) {
      objects2 = parsed2;
    } else if (parsed2 && Array.isArray(parsed2.items)) {
      objects2 = parsed2.items;
    } else if (parsed2 && typeof parsed2 === 'object') {
      // Support current structure where RagDocument2.json is a single object
      objects2 = [parsed2];
    }
  } catch (e) {
    console.warn('RagDocument2.json not loaded:', e.message);
  }

  // Source 3: RagDocument3.json (array or concatenated objects)
  let objects3 = [];
  try {
    const raw3 = readFile(INPUT_PATH_3);
    try {
      const parsed3 = JSON.parse(raw3);
      objects3 = Array.isArray(parsed3) ? parsed3 : [parsed3];
    } catch (_) {
      // if file is concatenated JSON objects, reuse parser
      objects3 = parseJsonObjects(raw3);
    }
  } catch (e) {
    console.warn('RagDocument3.json not loaded:', e.message);
  }

  const allObjects = [...objects1, ...objects2, ...objects3];

  const out = fs.createWriteStream(OUTPUT_PATH, 'utf8');
  let written = 0;
  let skipped = 0;
  const skippedDetails = [];
  const seenIds = new Set();

  for (const obj of allObjects) {
    const check = ensureDefaults(obj);
    if (!check.ok) {
      skipped++;
      skippedDetails.push({ id: obj.id ?? null, reason: check.reason });
      continue;
    }
    const baseId = String(obj.id);
    if (seenIds.has(baseId)) continue; // de-duplicate by id across sources
    seenIds.add(baseId);

    const text = flattenChunkText(obj.chunk_text);
    const parts = splitByParagraphs(text, 4000);
    parts.forEach((part, idx) => {
      const id = idx === 0 ? baseId : `${baseId}_p${idx + 1}`;
      const record = {
        ...obj,
        id,
        chunk_text: part
      };
      out.write(JSON.stringify(record) + '\n');
      written++;
    });
  }

  out.end();
  console.log(`Normalized ${allObjects.length} objects (from JSON1: ${objects1.length}, JSON2: ${objects2.length}, JSON3: ${objects3.length}) -> wrote ${written} chunks, skipped ${skipped}.`);
  if (skippedDetails.length) {
    const byReason = skippedDetails.reduce((acc, s) => {
      acc[s.reason] = (acc[s.reason] || 0) + 1;
      return acc;
    }, {});
    console.log('Skip summary by reason:', byReason);
    if (skippedDetails.length <= 50) {
      console.log('Skipped items:', skippedDetails);
    }
  }
  console.log(`Output: ${OUTPUT_PATH}`);
}

if (require.main === module) {
  main();
}


