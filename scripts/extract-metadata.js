// Extract unique source_type and intended_use values from normalized JSONL
// Usage: node scripts/extract-metadata.js [path/to/RagDocument.normalized.jsonl]

const fs = require('fs');
const path = require('path');

const INPUT_JSONL = process.argv[2] || path.join(__dirname, '..', 'src', 'models', 'RagDocument.normalized.jsonl');

function readJsonl(filepath) {
  const content = fs.readFileSync(filepath, 'utf8');
  return content.split(/\r?\n/).filter(Boolean).map(line => {
    try {
      return JSON.parse(line);
    } catch (_) {
      return null;
    }
  }).filter(Boolean);
}

function count(values) {
  const map = new Map();
  for (const v of values) {
    const key = v == null ? 'null' : String(v);
    map.set(key, (map.get(key) || 0) + 1);
  }
  return Array.from(map.entries())
    .sort((a, b) => b[1] - a[1])
    .map(([value, count]) => ({ value, count }));
}

function main() {
  if (!fs.existsSync(INPUT_JSONL)) {
    console.error(`❌ File not found: ${INPUT_JSONL}`);
    process.exit(1);
  }

  const rows = readJsonl(INPUT_JSONL);
  const sourceTypes = rows.map(r => r.source_type).filter(v => v != null && String(v).trim() !== '');
  const intendedUses = rows.map(r => r.intended_use).filter(v => v != null && String(v).trim() !== '');

  const st = count(sourceTypes);
  const iu = count(intendedUses);

  console.log(`File: ${INPUT_JSONL}`);
  console.log(`Total rows: ${rows.length}`);
  console.log('source_type:');
  st.forEach(({ value, count }) => console.log(`- ${value}: ${count}`));
  console.log('intended_use:');
  iu.forEach(({ value, count }) => console.log(`- ${value}: ${count}`));
}

if (require.main === module) {
  main();
}


