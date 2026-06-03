const fs = require('fs');
const path = require('path');

const DEFAULT_EMBEDDING_MODEL = process.env.RAG_EMBEDDING_MODEL || 'text-embedding-3-large';
const DEFAULT_MAX_CONTEXT_CHARS = Number.parseInt(process.env.RAG_MAX_CONTEXT_CHARS || '5000', 10);
const DEFAULT_MARKDOWN_MEMORY_DIR = path.join(__dirname, '..', '..', 'rag-memory');
const MARKDOWN_MEMORY_DIR = process.env.RAG_MARKDOWN_MEMORY_DIR || DEFAULT_MARKDOWN_MEMORY_DIR;
const MARKDOWN_CHUNK_MAX_CHARS = Number.parseInt(process.env.RAG_MARKDOWN_CHUNK_MAX_CHARS || '2600', 10);
const MARKDOWN_MEMORY_LIMIT = Number.parseInt(process.env.RAG_MARKDOWN_MEMORY_LIMIT || '2', 10);

function safeText(value) {
  if (value === null || value === undefined) return '';
  if (typeof value === 'string') return value;
  if (Array.isArray(value)) return value.map(safeText).filter(Boolean).join('\n');
  if (typeof value === 'object') return JSON.stringify(value);
  return String(value);
}

function tokenize(text) {
  return safeText(text)
    .toLowerCase()
    .replace(/[\W_]+/g, ' ')
    .split(/\s+/)
    .filter((token) => token && token.length > 2);
}

function lexicalOverlap(a, b) {
  const tokensA = new Set(tokenize(a));
  const tokensB = new Set(tokenize(b));
  if (!tokensA.size || !tokensB.size) return 0;
  let intersection = 0;
  for (const token of tokensA) {
    if (tokensB.has(token)) intersection++;
  }
  const union = tokensA.size + tokensB.size - intersection;
  return union ? intersection / union : 0;
}

function cosineSimilarity(a, b) {
  if (!Array.isArray(a) || !Array.isArray(b) || !a.length || !b.length) return 0;
  const len = Math.min(a.length, b.length);
  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < len; i++) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  if (!normA || !normB) return 0;
  return dot / (Math.sqrt(normA) * Math.sqrt(normB));
}

function includesAny(text, values = []) {
  const lower = safeText(text).toLowerCase();
  return values.some((value) => {
    const needle = safeText(value).trim().toLowerCase();
    return needle && lower.includes(needle);
  });
}

function normalizeDoc(raw, metadataById = new Map()) {
  const meta = metadataById.get(raw.id) || {};
  const text = safeText(raw.text || raw.chunk_text || meta.chunk_text || meta.text);
  return {
    id: raw.id || meta.id || '',
    text,
    embedding: raw.embedding || meta.embedding || null,
    documentTitle: raw.documentTitle || raw.document_title || meta.documentTitle || meta.document_title || '',
    sectionTitle: raw.sectionTitle || raw.section_title || meta.sectionTitle || meta.section_title || '',
    sourceUrl: raw.sourceUrl || raw.source_url || raw.url || meta.sourceUrl || meta.source_url || meta.url || '',
    sourceType: raw.sourceType || raw.source_type || meta.sourceType || meta.source_type || '',
    intendedUse: raw.intendedUse || raw.intended_use || meta.intendedUse || meta.intended_use || '',
    organization: raw.organization || meta.organization || '',
    country: raw.country || meta.country || '',
    language: raw.language || meta.language || '',
    tags: Array.isArray(raw.tags) ? raw.tags : Array.isArray(meta.tags) ? meta.tags : [],
    version: raw.version || meta.version || '',
    sourcePath: raw.sourcePath || raw.source_path || meta.sourcePath || meta.source_path || '',
  };
}

function compactDoc(doc, score, reason = '') {
  return {
    id: doc.id,
    score,
    reason,
    documentTitle: doc.documentTitle,
    sectionTitle: doc.sectionTitle,
    sourceUrl: doc.sourceUrl,
    sourceType: doc.sourceType,
    intendedUse: doc.intendedUse,
    organization: doc.organization,
    country: doc.country,
    language: doc.language,
    tags: doc.tags,
    sourcePath: doc.sourcePath,
    text: doc.text,
  };
}

function slugify(value) {
  return safeText(value)
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80) || 'section';
}

function listMarkdownFiles(dir) {
  if (!fs.existsSync(dir)) return [];
  const files = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name.startsWith('.') || entry.name.startsWith('_')) continue;
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...listMarkdownFiles(fullPath));
    } else if (entry.isFile() && entry.name.toLowerCase().endsWith('.md')) {
      files.push(fullPath);
    }
  }
  return files.sort();
}

function markdownMemorySignature(dir) {
  return listMarkdownFiles(dir)
    .map((file) => {
      const stat = fs.statSync(file);
      return `${path.relative(dir, file)}:${stat.size}:${stat.mtimeMs}`;
    })
    .join('|');
}

function parseFrontMatter(raw) {
  const text = safeText(raw);
  if (!text.startsWith('---')) return { metadata: {}, body: text };

  const end = text.indexOf('\n---', 3);
  if (end === -1) return { metadata: {}, body: text };

  const metadata = {};
  const frontMatter = text.slice(3, end).trim();
  const body = text.slice(end + 4).replace(/^\r?\n/, '');

  for (const line of frontMatter.split(/\r?\n/)) {
    const match = line.match(/^([A-Za-z0-9_-]+):\s*(.*)$/);
    if (!match) continue;
    const key = match[1].trim();
    let value = match[2].trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    if (value.startsWith('[') && value.endsWith(']')) {
      metadata[key] = value
        .slice(1, -1)
        .split(',')
        .map((item) => item.trim().replace(/^["']|["']$/g, ''))
        .filter(Boolean);
    } else {
      metadata[key] = value;
    }
  }

  return { metadata, body };
}

function splitMarkdownIntoSections(body) {
  const lines = safeText(body).split(/\r?\n/);
  const sections = [];
  let current = { heading: 'Overview', content: [] };

  for (const line of lines) {
    const heading = line.match(/^(#{1,3})\s+(.+)$/);
    if (heading && current.content.join('\n').trim()) {
      sections.push(current);
      current = { heading: heading[2].trim(), content: [line] };
    } else if (heading) {
      current.heading = heading[2].trim();
      current.content.push(line);
    } else {
      current.content.push(line);
    }
  }

  if (current.content.join('\n').trim()) sections.push(current);
  return sections;
}

function splitLongText(text, maxChars) {
  const clean = safeText(text).trim();
  if (!clean) return [];
  if (clean.length <= maxChars) return [clean];

  const parts = [];
  const paragraphs = clean.split(/\n\s*\n/);
  let buffer = '';
  for (const paragraph of paragraphs) {
    const candidate = buffer ? `${buffer}\n\n${paragraph}` : paragraph;
    if (candidate.length <= maxChars) {
      buffer = candidate;
      continue;
    }
    if (buffer) parts.push(buffer);
    if (paragraph.length <= maxChars) {
      buffer = paragraph;
      continue;
    }
    let start = 0;
    while (start < paragraph.length) {
      let end = Math.min(start + maxChars, paragraph.length);
      const breakAt = paragraph.lastIndexOf(' ', end);
      if (breakAt > start + Math.floor(maxChars * 0.6)) end = breakAt;
      parts.push(paragraph.slice(start, end).trim());
      start = end;
    }
    buffer = '';
  }
  if (buffer) parts.push(buffer);
  return parts;
}

function markdownFileToDocs(filePath, rootDir) {
  const relativePath = path.relative(rootDir, filePath);
  const raw = fs.readFileSync(filePath, 'utf8');
  const { metadata, body } = parseFrontMatter(raw);
  const baseId = slugify(metadata.id || relativePath.replace(/\.md$/i, ''));
  const documentTitle = metadata.title || path.basename(filePath, path.extname(filePath));
  const sourceType = metadata.source_type || metadata.sourceType || 'markdown_memory';
  const intendedUse = metadata.intended_use || metadata.intendedUse || 'feedback_guideline';
  const language = metadata.language || 'en';
  const tags = Array.isArray(metadata.tags)
    ? metadata.tags
    : safeText(metadata.tags).split(',').map((tag) => tag.trim()).filter(Boolean);

  const docs = [];
  for (const section of splitMarkdownIntoSections(body)) {
    const sectionSlug = slugify(section.heading);
    const chunks = splitLongText(section.content.join('\n'), MARKDOWN_CHUNK_MAX_CHARS);
    chunks.forEach((chunk, index) => {
      docs.push({
        id: `${baseId}-${sectionSlug}${index ? `-p${index + 1}` : ''}`,
        text: chunk,
        documentTitle,
        sectionTitle: section.heading,
        sourceUrl: metadata.source_url || metadata.sourceUrl || '',
        sourceType,
        intendedUse,
        organization: metadata.organization || '',
        country: metadata.country || '',
        language,
        tags,
        version: metadata.version || '',
        sourcePath: path.join(path.basename(rootDir), relativePath),
        embedding: null,
      });
    });
  }
  return docs;
}

class RagService {
  constructor(openaiClient, options = {}) {
    this.openaiClient = openaiClient;
    this.embeddingModel = options.embeddingModel || DEFAULT_EMBEDDING_MODEL;
    this.maxContextChars = options.maxContextChars || DEFAULT_MAX_CONTEXT_CHARS;
    this.embeddingCache = new Map();
  }

  static normalizedCache = null;
  static embeddingCache = null;
  static markdownMemoryCache = null;
  static markdownMemoryCacheSignature = null;
  static storeCacheMarkdownSignature = null;
  static storeCache = null;

  static loadNormalized() {
    if (this.normalizedCache) return this.normalizedCache;
    const file = path.join(__dirname, '..', 'models', 'RagDocument.normalized.jsonl');
    try {
      const lines = fs.readFileSync(file, 'utf8').split(/\r?\n/).filter(Boolean);
      this.normalizedCache = lines.map((line) => JSON.parse(line)).filter((item) => item && item.id);
    } catch (error) {
      console.warn('[RagService] Could not load normalized RAG file:', error.message);
      this.normalizedCache = [];
    }
    return this.normalizedCache;
  }

  static loadEmbeddings() {
    if (this.embeddingCache) return this.embeddingCache;
    const file = path.join(__dirname, '..', 'models', 'RagDocument.embeddings.json');
    try {
      const items = JSON.parse(fs.readFileSync(file, 'utf8'));
      this.embeddingCache = Array.isArray(items) ? items : [];
    } catch (error) {
      console.warn('[RagService] Could not load embedding RAG file:', error.message);
      this.embeddingCache = [];
    }
    return this.embeddingCache;
  }

  static loadMarkdownMemory() {
    const signature = markdownMemorySignature(MARKDOWN_MEMORY_DIR);
    if (this.markdownMemoryCache && this.markdownMemoryCacheSignature === signature) return this.markdownMemoryCache;
    try {
      const files = listMarkdownFiles(MARKDOWN_MEMORY_DIR);
      this.markdownMemoryCache = files.flatMap((file) => markdownFileToDocs(file, MARKDOWN_MEMORY_DIR));
      this.markdownMemoryCacheSignature = signature;
    } catch (error) {
      console.warn('[RagService] Could not load markdown RAG memory:', error.message);
      this.markdownMemoryCache = [];
      this.markdownMemoryCacheSignature = signature;
    }
    return this.markdownMemoryCache;
  }

  static loadStore() {
    const markdownSignature = markdownMemorySignature(MARKDOWN_MEMORY_DIR);
    if (this.storeCache && this.storeCacheMarkdownSignature === markdownSignature) return this.storeCache;
    const normalized = this.loadNormalized();
    const metadataById = new Map(normalized.map((item) => [item.id, item]));
    const embeddings = this.loadEmbeddings();
    const markdownMemory = this.loadMarkdownMemory();

    const embeddedIds = new Set(embeddings.map((item) => item.id).filter(Boolean));
    const embeddedDocs = embeddings.map((item) => normalizeDoc(item, metadataById));
    const normalizedOnlyDocs = normalized
      .filter((item) => item.id && !embeddedIds.has(item.id))
      .map((item) => normalizeDoc(item, metadataById));

    this.storeCache = [...embeddedDocs, ...normalizedOnlyDocs, ...markdownMemory].filter((doc) => doc.id && doc.text);
    this.storeCacheMarkdownSignature = markdownSignature;
    return this.storeCache;
  }

  getStore() {
    return RagService.loadStore();
  }

  async embed(text) {
    const input = safeText(text).slice(0, 8000);
    if (!input || !this.openaiClient?.embeddings?.create) return null;
    const cacheKey = `${this.embeddingModel}:${input}`;
    if (this.embeddingCache.has(cacheKey)) return this.embeddingCache.get(cacheKey);
    const response = await this.openaiClient.embeddings.create({
      model: this.embeddingModel,
      input,
    });
    const embedding = response.data?.[0]?.embedding || null;
    this.embeddingCache.set(cacheKey, embedding);
    return embedding;
  }

  buildDefaultQuery(request = {}) {
    return [
      request.taskTitle,
      request.keyword,
      request.description,
      request.taskOutcome,
      request.taskInstruction,
      request.evaluationCriteria,
      request.learningObjectives,
      safeText(request.submission).slice(0, 1200),
    ]
      .filter(Boolean)
      .join('\n');
  }

  inferFilters(request = {}) {
    const text = [
      request.taskTitle,
      request.keyword,
      request.description,
      request.taskOutcome,
      request.taskInstruction,
      request.evaluationCriteria,
      request.learningObjectives,
      request.submission,
    ].join('\n').toLowerCase();

    const intendedUse = [];
    if (/feedback|rubric|criteria|evaluate|assessment|score|vurder/i.test(text)) {
      intendedUse.push('assessment_design', 'feedback_guideline', 'faculty_exam_guideline_embedding');
    }
    if (/policy|privacy|gdpr|academic integrity|fusk|plagiarism|ki|ai use/i.test(text)) {
      intendedUse.push('compliance', 'institutional_policy_rag', 'student_ai_use_policy_rag', 'exam_policy_rag');
    }
    if (/learning outcome|competence|bloom|nokut|læringsutbytte/i.test(text)) {
      intendedUse.push('teaching_design', 'learning_outcome_mapping');
    }

    return {
      intendedUse: Array.from(new Set(intendedUse)),
      language: request.language || null,
      country: request.country || null,
      organization: request.organization || null,
    };
  }

  metadataBoost(doc, filters = {}, request = {}) {
    let boost = 0;
    const values = [
      request.taskTitle,
      request.keyword,
      request.description,
      request.taskOutcome,
      request.taskInstruction,
      request.evaluationCriteria,
      request.learningObjectives,
    ];
    const haystack = [
      doc.documentTitle,
      doc.sectionTitle,
      doc.sourceType,
      doc.intendedUse,
      doc.organization,
      doc.country,
      doc.language,
      ...(doc.tags || []),
    ].join(' ');

    if (includesAny(haystack, values)) boost += 0.08;
    if (filters.language && doc.language === filters.language) boost += 0.05;
    if (filters.country && doc.country === filters.country) boost += 0.05;
    if (filters.organization && doc.organization === filters.organization) boost += 0.05;
    if (filters.intendedUse?.length && filters.intendedUse.includes(doc.intendedUse)) boost += 0.1;
    return Math.min(boost, 0.25);
  }

  mergePinnedMemory(memoryChunks, retrievedChunks, limit) {
    const byId = new Map();
    for (const chunk of [...memoryChunks, ...retrievedChunks]) {
      if (!chunk?.id || byId.has(chunk.id)) continue;
      byId.set(chunk.id, chunk);
    }
    return Array.from(byId.values()).slice(0, limit);
  }

  async retrieveHybrid(query, request = {}, options = {}) {
    const store = this.getStore();
    if (!store.length) {
      return { chunks: [], debug: { reason: 'empty_store' } };
    }

    const limit = options.limit || 8;
    const candidateLimit = options.candidateLimit || Math.max(24, limit * 4);
    const filters = options.filters || this.inferFilters(request);
    const queryVector = await this.embed(query);

    const scored = store.map((doc) => {
      const vectorScore = queryVector && doc.embedding ? cosineSimilarity(queryVector, doc.embedding) : 0;
      const lexicalScore = lexicalOverlap(`${doc.documentTitle}\n${doc.sectionTitle}\n${doc.text}`, query);
      const boost = this.metadataBoost(doc, filters, request);
      const score = 0.6 * vectorScore + 0.28 * lexicalScore + boost;
      return {
        doc,
        score,
        reason: `vector=${vectorScore.toFixed(3)} lexical=${lexicalScore.toFixed(3)} boost=${boost.toFixed(3)}`,
      };
    });

    const ranked = scored
      .sort((a, b) => b.score - a.score)
      .slice(0, candidateLimit)
      .filter((item) => item.score > 0);

    const retrievedChunks = ranked
      .slice(0, limit)
      .map((item) => compactDoc(item.doc, item.score, item.reason));

    const markdownMemoryLimit = Math.max(0, Number.isFinite(MARKDOWN_MEMORY_LIMIT) ? MARKDOWN_MEMORY_LIMIT : 0);
    const markdownMemoryChunks = markdownMemoryLimit
      ? scored
        .filter((item) => item.score > 0 && item.doc.sourceType === 'markdown_memory')
        .sort((a, b) => b.score - a.score)
        .slice(0, markdownMemoryLimit)
        .map((item) => compactDoc(item.doc, item.score, `markdown-memory ${item.reason}`))
      : [];

    const chunks = this.mergePinnedMemory(markdownMemoryChunks, retrievedChunks, limit);

    return {
      chunks,
      debug: {
        mode: 'hybrid',
        query,
        filters,
        storeSize: store.length,
        markdownMemoryDir: MARKDOWN_MEMORY_DIR,
        markdownMemoryCount: RagService.loadMarkdownMemory().length,
        markdownMemoryInjected: markdownMemoryChunks.length,
        returned: chunks.length,
      },
    };
  }

  async planRetrieval(request = {}, options = {}) {
    const fallbackQuery = this.buildDefaultQuery(request);
    const fallback = {
      queries: [fallbackQuery],
      filters: this.inferFilters(request),
      rationale: 'fallback deterministic query',
    };

    if (!this.openaiClient?.chat?.completions?.create) return fallback;

    const prompt = [
      'You are a controlled retrieval planner for an educational feedback RAG system.',
      'Return JSON only. Do not answer the student task.',
      'Create 1-3 concise search queries and optional metadata filters for finding policy, rubric, pedagogy, or assessment guidance.',
      '',
      `Task title: ${request.taskTitle || ''}`,
      `Keyword: ${request.keyword || ''}`,
      `Description: ${safeText(request.description).slice(0, 1000)}`,
      `Outcome: ${safeText(request.taskOutcome).slice(0, 800)}`,
      `Instruction: ${safeText(request.taskInstruction).slice(0, 800)}`,
      `Evaluation criteria: ${safeText(request.evaluationCriteria).slice(0, 1200)}`,
      `Learning objectives: ${safeText(request.learningObjectives).slice(0, 1000)}`,
      `Submission excerpt: ${safeText(request.submission).slice(0, 900)}`,
      '',
      'Schema: {"queries":["string"],"filters":{"intendedUse":["string"],"language":"string|null","country":"string|null","organization":"string|null"},"rationale":"string"}',
    ].join('\n');

    try {
      const response = await this.openaiClient.chat.completions.create({
        model: options.model || request.feedbackModel || process.env.RAG_PLANNER_MODEL || 'gpt-5.4-mini',
        messages: [{ role: 'user', content: prompt }],
        response_format: { type: 'json_object' },
        max_completion_tokens: 700,
      });
      const parsed = JSON.parse(response.choices?.[0]?.message?.content || '{}');
      const queries = Array.isArray(parsed.queries)
        ? parsed.queries.map(safeText).map((q) => q.trim()).filter(Boolean).slice(0, 3)
        : [];
      return {
        queries: queries.length ? queries : fallback.queries,
        filters: {
          ...fallback.filters,
          ...(parsed.filters && typeof parsed.filters === 'object' ? parsed.filters : {}),
        },
        rationale: parsed.rationale || 'planner',
        usage: response.usage || null,
      };
    } catch (error) {
      return {
        ...fallback,
        error: error.message,
      };
    }
  }

  async gradeChunks(request = {}, chunks = [], options = {}) {
    if (!chunks.length || !this.openaiClient?.chat?.completions?.create) {
      return { chunks, debug: { reason: 'no_grader_or_chunks' } };
    }

    const prompt = [
      'You are a strict RAG context grader for educational feedback.',
      'Select only chunks that can help evaluate the submission or ground policy/rubric/pedagogical claims.',
      'Return JSON only with {"keep":[{"id":"chunk id","relevanceScore":0-5,"reason":"short"}]}',
      '',
      `Task: ${request.taskTitle || request.keyword || ''}`,
      `Description: ${safeText(request.description).slice(0, 800)}`,
      `Criteria: ${safeText(request.evaluationCriteria).slice(0, 1000)}`,
      `Submission excerpt: ${safeText(request.submission).slice(0, 1000)}`,
      '',
      chunks
        .map((chunk, index) => {
          return [
            `Chunk ${index + 1}`,
            `id: ${chunk.id}`,
            `title: ${chunk.documentTitle} — ${chunk.sectionTitle}`,
            `text: ${safeText(chunk.text).slice(0, 900)}`,
          ].join('\n');
        })
        .join('\n\n'),
    ].join('\n');

    try {
      const response = await this.openaiClient.chat.completions.create({
        model: options.model || request.feedbackModel || process.env.RAG_GRADER_MODEL || 'gpt-5.4-mini',
        messages: [{ role: 'user', content: prompt }],
        response_format: { type: 'json_object' },
        max_completion_tokens: 900,
      });
      const parsed = JSON.parse(response.choices?.[0]?.message?.content || '{}');
      const keep = Array.isArray(parsed.keep) ? parsed.keep : [];
      const byId = new Map(chunks.map((chunk) => [chunk.id, chunk]));
      const graded = keep
        .map((item) => {
          const chunk = byId.get(item.id);
          if (!chunk) return null;
          const relevanceScore = Number(item.relevanceScore);
          return {
            ...chunk,
            relevanceScore: Number.isFinite(relevanceScore) ? relevanceScore : null,
            graderReason: item.reason || '',
          };
        })
        .filter(Boolean)
        .filter((chunk) => chunk.relevanceScore === null || chunk.relevanceScore >= 3)
        .slice(0, 8);

      return {
        chunks: graded.length ? graded : chunks.slice(0, 5),
        debug: {
          graderUsed: true,
          kept: graded.length,
          usage: response.usage || null,
        },
      };
    } catch (error) {
      return {
        chunks: chunks.slice(0, 5),
        debug: {
          graderUsed: false,
          error: error.message,
        },
      };
    }
  }

  mergeChunks(chunkGroups) {
    const byId = new Map();
    for (const chunks of chunkGroups) {
      for (const chunk of chunks) {
        const existing = byId.get(chunk.id);
        if (!existing || (chunk.score || 0) > (existing.score || 0)) {
          byId.set(chunk.id, chunk);
        }
      }
    }
    return Array.from(byId.values()).sort((a, b) => (b.score || 0) - (a.score || 0));
  }

  async retrieveForFeedback(request = {}, options = {}) {
    const mode = options.mode || request.ragMode || 'legacy';
    if (mode === 'legacy' || mode === 'off' || mode === 'none') {
      return {
        chunks: [],
        contextText: '',
        debug: { mode: 'legacy' },
      };
    }

    if (mode === 'agentic') {
      const plan = await this.planRetrieval(request, { model: options.model });
      const groups = [];
      for (const query of plan.queries || []) {
        const result = await this.retrieveHybrid(query, request, {
          limit: options.candidateLimit || 10,
          candidateLimit: options.candidateLimit || 24,
          filters: plan.filters,
        });
        groups.push(result.chunks);
      }
      const merged = this.mergeChunks(groups).slice(0, options.candidateLimit || 12);
      const graded = await this.gradeChunks(request, merged, { model: options.model });
      const chunks = graded.chunks.slice(0, options.limit || 6);
      return {
        chunks,
        contextText: this.formatContext(chunks),
        debug: {
          mode: 'agentic',
          plan,
          graded: graded.debug,
          returned: chunks.length,
        },
      };
    }

    const query = options.query || this.buildDefaultQuery(request);
    const result = await this.retrieveHybrid(query, request, {
      limit: options.limit || 6,
      candidateLimit: options.candidateLimit || 24,
      filters: options.filters,
    });
    return {
      chunks: result.chunks,
      contextText: this.formatContext(result.chunks),
      debug: result.debug,
    };
  }

  formatContext(chunks = []) {
    if (!chunks.length) return '';
    let remaining = this.maxContextChars;
    const blocks = [];
    for (const [index, chunk] of chunks.entries()) {
      if (remaining <= 0) break;
      const title = [chunk.documentTitle, chunk.sectionTitle].filter(Boolean).join(' — ') || chunk.id;
      const source = chunk.sourceUrl || chunk.sourcePath || '';
      const url = source ? ` (${source})` : '';
      const score = typeof chunk.score === 'number' ? chunk.score.toFixed(3) : '';
      const reason = chunk.graderReason || chunk.reason || '';
      const textBudget = Math.max(300, Math.min(1100, remaining - 220));
      const text = safeText(chunk.text).slice(0, textBudget);
      const block = [
        `Source ${index + 1}: [${title}]${url}`,
        score ? `Retrieval score: ${score}` : '',
        reason ? `Reason: ${reason}` : '',
        text,
      ].filter(Boolean).join('\n');
      blocks.push(block);
      remaining -= block.length;
    }
    return blocks.join('\n\n');
  }
}

module.exports = RagService;
