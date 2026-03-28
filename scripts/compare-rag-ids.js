// Compares IDs between RagDocument.txt and RagDocument.normalized.jsonl
// Usage: node scripts/compare-rag-ids.js

const fs = require('fs');
const path = require('path');

const INPUT_TXT = path.join(__dirname, '..', 'src', 'models', 'RagDocument.json');
const INPUT_JSONL = path.join(__dirname, '..', 'src', 'models', 'RagDocument.normalized.jsonl');

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
        } catch (_) {
          // ignore bad block
        }
        start = -1;
      }
    }
  }
  return objects;
}

function main() {
  const rawTxt = readFile(INPUT_TXT);
  const objects = parseJsonObjects(rawTxt);
  const originalIds = new Set();
  for (const o of objects) {
    if (o && o.id) originalIds.add(String(o.id));
  }

  const jsonl = readFile(INPUT_JSONL).split(/\r?\n/).filter(Boolean);
  const normalizedIds = new Set();
  for (const line of jsonl) {
    try {
      const obj = JSON.parse(line);
      if (obj && obj.id) {
        normalizedIds.add(String(obj.id));
      }
    } catch (_) {
      // ignore malformed line
    }
  }

  const originalList = Array.from(originalIds).sort();
  const normalizedList = Array.from(normalizedIds).sort();
  const missing = originalList.filter(id => !normalizedIds.has(id));
  const extra = normalizedList.filter(id => !originalIds.has(id));

  console.log(`Original objects: ${originalIds.size}`);
  console.log(`Normalized lines: ${normalizedIds.size}`);
  console.log(`Missing (present in original, absent in normalized): ${missing.length}`);
  if (missing.length) {
    console.log('Missing IDs:');
    missing.forEach(id => console.log(`- ${id}`));
  }
  console.log(`Extra (present in normalized, absent in original): ${extra.length}`);
  if (extra.length) {
    console.log('Extra IDs:');
    extra.forEach(id => console.log(`- ${id}`));
  }

  console.log('\nOriginal IDs (sorted):');
  originalList.forEach(id => console.log(id));
  console.log('\nNormalized IDs (sorted):');
  normalizedList.forEach(id => console.log(id));
}

if (require.main === module) {
  main();
}


