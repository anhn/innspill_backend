// Build embeddings for normalized RAG chunks
// Usage: node scripts/build-embeddings.js

const fs = require('fs');
const path = require('path');
// Load .env from project root so OPENAI_API_KEY is available when running standalone
try {
  require('dotenv').config({ path: path.join(__dirname, '..', '.env') });
} catch (_) {
  // dotenv optional
}
const OpenAI = require('openai');

const INPUT_JSONL = path.join(__dirname, '..', 'src', 'models', 'RagDocument.normalized.jsonl');
const OUTPUT_JSON = path.join(__dirname, '..', 'src', 'models', 'RagDocument.embeddings.json');

function readJsonl(filepath) {
  const content = fs.readFileSync(filepath, 'utf8');
  const lines = content.split(/\r?\n/).filter(Boolean);
  const out = [];
  for (const line of lines) {
    try {
      const obj = JSON.parse(line);
      if (obj && typeof obj.chunk_text === 'string' && obj.chunk_text.trim().length > 0) {
        out.push({ id: obj.id, text: obj.chunk_text });
      }
    } catch (_) {
      // ignore malformed lines
    }
  }
  return out;
}


async function buildEmbeddings() {
  if (!process.env.OPENAI_API_KEY) {
    console.error('❌ OPENAI_API_KEY is not set');
    process.exit(1);
  }

  const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  const allChunks = readJsonl(INPUT_JSONL);
  console.log(`📄 Loaded ${allChunks.length} chunks from ${INPUT_JSONL}`);

  // Load existing embeddings to avoid recomputing
  let existing = [];
  try {
    if (fs.existsSync(OUTPUT_JSON)) {
      existing = JSON.parse(fs.readFileSync(OUTPUT_JSON, 'utf8')) || [];
    }
  } catch (_) {
    existing = [];
  }
  const existingIds = new Set(existing.map(e => e.id));
  const toEmbed = allChunks.filter(c => !existingIds.has(c.id));
  console.log(`🎯 New chunks to embed (skipping existing): ${toEmbed.length}`);

  const newEmbeddings = [];

  for (const [i, chunk] of toEmbed.entries()) {
    try {
      const response = await client.embeddings.create({
        model: 'text-embedding-3-large',
        input: chunk.text
      });

      newEmbeddings.push({
        id: chunk.id || `chunk_${i}`,
        text: chunk.text,
        embedding: response.data[0].embedding
      });

      if ((i + 1) % 10 === 0 || i === toEmbed.length - 1) {
        console.log(`✅ Embedded chunk ${i + 1}/${toEmbed.length}`);
      }
    } catch (err) {
      console.error(`❌ Error embedding chunk ${i + 1}:`, err?.message || err);
    }
  }

  const merged = existing.concat(newEmbeddings);
  fs.writeFileSync(OUTPUT_JSON, JSON.stringify(merged, null, 2));
  console.log(`💾 Saved embeddings to ${OUTPUT_JSON}`);
  console.log(`📊 Total embeddings: ${merged.length} (added ${newEmbeddings.length})`);
}

if (require.main === module) {
  buildEmbeddings();
}


