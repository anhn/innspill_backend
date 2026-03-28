// CoursePlanAnalysisAgent.js
const BaseAgent = require('./BaseAgent');
const PostProcessingFormatter = require('./PostProcessingFormatter');
const fs = require('fs');
const path = require('path');

class CoursePlanAnalysisAgent extends BaseAgent {
  constructor(openaiClient) {
    super('Course Plan Analysis Agent', openaiClient);
    this.postProcessingFormatter = new PostProcessingFormatter(openaiClient);
  }

  getSystemPrompt() {
    return `You are a Course Plan Analysis Agent.
Your job is to analyze course plans by sections using provided course text and retrieved RAG context only.
For each section, follow the specific analysis logic outlined below, citing RAG sources in the format [Title — Section] (URL).

Rules:
- Never invent policies or outcomes not supported by context.
- Use structured reasoning and concise prose.
- Each section's analysis should be independent.
- Write in the teacher’s preferred language if given.`;
  }

  getMaxTokens() {
    return 12000;
  }

  // ---------------------------------------------------------------------------
  // Loaders
  // ---------------------------------------------------------------------------
  static ragCache = null;
  static embeddingsCache = null;

  static loadRag() {
    if (this.ragCache) return this.ragCache;
    try {
      const file = path.join(__dirname, '..', 'models', 'RagDocument.normalized.jsonl');
      const lines = fs.readFileSync(file, 'utf8').split(/\r?\n/).filter(Boolean);
      this.ragCache = lines.map(l => JSON.parse(l)).filter(o => o.chunk_text);
    } catch (e) {
      console.warn('⚠️ RAG not found:', e.message);
      this.ragCache = [];
    }
    return this.ragCache;
  }

  static loadEmbeddings() {
    if (this.embeddingsCache) return this.embeddingsCache;
    try {
      const file = path.join(__dirname, '..', 'models', 'RagDocument.embeddings.json');
      const items = JSON.parse(fs.readFileSync(file, 'utf8'));
      const rag = this.loadRag();
      const byId = new Map();
      for (const r of rag) {
        byId.set(r.id, {
          id: r.id,
          documentTitle: r.document_title || r.documentTitle || '',
          sectionTitle: r.section_title || r.sectionTitle || '',
          url: r.url || r.source_url || '',
          organization: r.organization || '',
          country: r.country || '',
          source_type: r.source_type || r.sourceType || '',
          intended_use: r.intended_use || r.intendedUse || '',
          tags: r.tags || [],
          textFallback: typeof r.chunk_text === 'string' ? r.chunk_text : JSON.stringify(r.chunk_text)
        });
      }
      this.embeddingsCache = items
        .filter(it => it && it.id && it.embedding)
        .map(it => {
          const meta = byId.get(it.id) || { id: it.id };
          return {
            ...meta,
            id: it.id,
            text: it.text || meta.textFallback || '',
            embedding: it.embedding
          };
        });
    } catch (e) {
      console.warn('⚠️ Embeddings missing:', e.message);
      this.embeddingsCache = [];
    }
    return this.embeddingsCache;
  }

  static getDocsByIds(ids = []) {
    const store = CoursePlanAnalysisAgent.loadEmbeddings();
    if (!store.length || !ids.length) return [];
    const need = new Set(ids);
    return store.filter(d => need.has(d.id));
  }

  static deriveCourseMajor(courseName = '') {
    const lower = courseName.toLowerCase();
    if (lower.match(/math|physics|chemistry|biology|geology/)) return 'Natural Sciences';
    if (lower.match(/sociology|psychology|education|management|economics/)) return 'Social Sciences';
    if (lower.match(/philosophy|history|culture|language|literature/)) return 'Humanities';
    if (lower.match(/computer|ai|informatics|engineering|technology|data/)) return 'Formal Sciences';
    if (lower.match(/business|project|green|gis|health|medicine|law|architecture|design/)) return 'Applied Sciences';
    return 'General Studies';
  }

  static _tokens(s = '') {
    return String(s || '')
      .toLowerCase()
      .replace(/[\W_]+/g, ' ')
      .split(/\s+/)
      .filter(Boolean);
  }

  static _lexicalOverlap(a = '', b = '') {
    const A = new Set(this._tokens(a));
    const B = new Set(this._tokens(b));
    if (!A.size || !B.size) return 0;
    let inter = 0;
    for (const t of A) if (B.has(t)) inter++;
    const union = A.size + B.size - inter;
    return inter / union;
  }

  static _includesScore(text = '', terms = []) {
    const t = String(text || '').toLowerCase();
    let score = 0;
    for (const term of terms) {
      const q = String(term || '').toLowerCase();
      if (!q) continue;
      if (t.includes(q)) score += 1;
    }
    return score;
  }

  async embedText(text) {
    const res = await this.openaiClient.embeddings.create({
      model: 'text-embedding-3-large',
      input: text
    });
    return res.data[0].embedding;
  }

  async retrieveHybridForSection(sectionName, planText = '', teacher = {}, k = 8) {
    const store = CoursePlanAnalysisAgent.loadEmbeddings();
    if (!store.length) return [];

    const teacherTerms = [
      teacher.organization,
      teacher.country,
      teacher.educationLevel,
      teacher.subjectArea
    ].filter(Boolean);

    const planSlice = String(planText || '').slice(0, 800);
    const query = [sectionName, ...teacherTerms, planSlice].filter(Boolean).join('\n');
    
    // Cache embeddings to avoid redundant API calls
    const cacheKey = query.slice(0, 200); // Use first 200 chars as cache key
    if (!this._embeddingCache) {
      this._embeddingCache = new Map();
    }
    
    let qvec;
    if (this._embeddingCache.has(cacheKey)) {
      qvec = this._embeddingCache.get(cacheKey);
    } else {
      qvec = await this.embedText(query);
      this._embeddingCache.set(cacheKey, qvec);
    }
    
    const keywords = [sectionName, ...teacherTerms];

    const scored = store.map(doc => {
      const title = doc.documentTitle || '';
      const sec = doc.sectionTitle || '';
      const text = doc.text || '';

      const emb = Array.isArray(doc.embedding) ? doc.embedding : [];
      let embSim = 0;
      if (emb.length && qvec && qvec.length) {
        let dot = 0, na = 0, nb = 0;
        const len = Math.min(qvec.length, emb.length);
        for (let i = 0; i < len; i++) { dot += qvec[i] * emb[i]; na += qvec[i]*qvec[i]; nb += emb[i]*emb[i]; }
        embSim = (na && nb) ? dot / (Math.sqrt(na) * Math.sqrt(nb)) : 0;
      }

      const lex = CoursePlanAnalysisAgent._lexicalOverlap(`${title} ${sec} ${text}`, `${sectionName} ${planSlice}`);
      const inc = CoursePlanAnalysisAgent._includesScore(`${title} ${sec} ${text}`, keywords);
      const score = 0.55 * embSim + 0.25 * lex + 0.20 * Math.min(inc / 5, 1);
      return { doc, score };
    });

    return scored.sort((a,b) => b.score - a.score).slice(0, k).map(s => s.doc);
  }


  // ---------------------------------------------------------------------------
  // Section Prompt Builder (restored)
  // ---------------------------------------------------------------------------
  buildSectionPrompt(sectionTitle, planContent, ragDocs, teacher, instructions) {
    const teacherCtx = [
      teacher?.organization,
      teacher?.country,
      teacher?.educationLevel,
      teacher?.subjectArea,
      teacher?.language
    ].filter(Boolean).join(', ');

    const preferredLanguage = typeof teacher?.language === 'string'
      ? teacher.language.trim()
      : '';

    const languageDirective = preferredLanguage
      ? `\n### Language Requirement:\nRespond entirely in ${preferredLanguage}.`
      : '\n### Language Requirement:\nRespond in the same language as the source materials and teacher context.';

    const header = `## ${sectionTitle}\nTeacher Context: ${teacherCtx || 'Not specified'}`;
    const planBlock = `\n### Course Plan Section Content:\n${planContent || 'PLACE_HOLDER: Missing section.'}`;

    const context = (ragDocs || []).map(d => {
      const title = d.documentTitle || d.title || 'Unknown';
      const sec = d.sectionTitle ? ` — ${d.sectionTitle}` : '';
      const url = d.url || d.source_url ? ` (${d.url || d.source_url})` : '';
      const text = (d.text || '').length > 1200 ? (d.text || '').slice(0, 1200) + ' ...' : (d.text || '');
      return `\nSource: [${title}${sec}]${url}\n${text}`;
    }).join('\n');

    return `${this.getSystemPrompt()}\n${header}${languageDirective}\n${planBlock}\n\n### Analysis Instructions:\n${instructions}\n\n### Context Sources:\n${context}`;
  }

  // Section 1: Learning Outcomes — Revised Logic (2025-10-31)
  // ---------------------------------------------------------------------------
  async analyzeLearningOutcomesSection(plan, teacher, request, extractedLearningOutcomes = [], tokenUsage = null) {
    const sectionTitle = 'Learning Outcomes';
    const courseName = request?.context?.searchAIApplications || request?.context?.coursePlanName || 'this course';
    // Use extracted learning outcomes if provided, otherwise fallback to manual extraction
    const learningOutcomes = Array.isArray(extractedLearningOutcomes) && extractedLearningOutcomes.length > 0
      ? extractedLearningOutcomes
      : (() => {
          // Fallback: simple manual extraction if OpenAI extraction didn't work
          const lines = String(plan || '').split(/\n+/);
          return lines
            .filter(l => /learning outcome|læringsutbytte/i.test(l) || /^\s*(?:-\s+|\d+\.|•\s+)/.test(l))
            .slice(0, 20)
            .map(l => l.trim())
            .filter(Boolean);
        })();
    const courseContent = plan.slice(0, 2000); // Use first 2000 chars as course content excerpt

    // 1️⃣ Step 1: Search for "learning outcome" in NOKUT and GENAI mappings
    const loDocs = CoursePlanAnalysisAgent.getDocsByIds([
      'NOKUT_NQF_LEVELS_2025_01',
      'CHUNK_LEARNING_OUTCOMES_GENAI_2025'
    ]);

    // Add additional semantic + lexical search to enrich context
    const query1 = 'learning outcome competence level Bloom NOKUT';
    const semDocs = await this.retrieveHybridForSection(
      query1,
      plan,
      teacher,
      8
    );

    const step1Docs = [...loDocs, ...semDocs];

    // 2️⃣ Step 2: Prompt for Bloom/NOKUT mapping + human/AI competencies
    const mappingPrompt = this.buildSectionPrompt(
      'Learning Outcomes Competence Mapping',
      `
Course Name: ${courseName}
Course Content (excerpt):
${courseContent.slice(0, 1000)}

Extracted Learning Outcomes:
${learningOutcomes.length ? learningOutcomes.map((o, i) => `${i + 1}. ${o}`).join('\n') : plan.slice(0, 500)}
`,
      step1Docs,
      teacher,
      `
Use Bloom's taxonomy and NOKUT frameworks (from provided context) to:
1. Extract core human competencies implied by each outcome.
2. Considering the course content, evaluate if verbs like "analyze", "create", or "reflect" remain authentic in an AI-rich context.
3. If AI can automate part of the action, suggest a raised Bloom/NOKUT level or a revised phrasing.
4. Identify potential AI-augmented competencies.
5. Support statements with citations to provided chunks; do **not** fabricate new material. Cite sources as [Document Title — Section Title](URL).
Output your analysis in a structured format with clear citations to the provided chunks.
`
    );

    const mappingResp = await super.process({
      ...request,
      message: mappingPrompt
    });
    
    // Accumulate token usage
    if (tokenUsage && mappingResp.usageInternal) {
      tokenUsage.promptTokens += mappingResp.usageInternal.promptTokens || 0;
      tokenUsage.completionTokens += mappingResp.usageInternal.completionTokens || 0;
      tokenUsage.totalTokens += mappingResp.usageInternal.totalTokens || 0;
      tokenUsage.apiCallCount += 1;
      tokenUsage.breakdown.push({ section: 'Learning Outcomes - Competence Mapping', tokens: mappingResp.usageInternal.totalTokens || 0 });
    }

    // 3️⃣ Step 3: Search for AI literacy / workplace alignment chunks
    const aiLitDocs = CoursePlanAnalysisAgent.getDocsByIds([
      'UNESCO_AI_CFT_2024_01',
      'AILIT_FRAMEWORK_2025_01'
    ]);
    const query2 = `${courseName} ${courseContent.slice(0, 300)} AI literacy workplace competencies`;
    const aiLitSearch = await this.retrieveHybridForSection(
      'AI Literacy and Workplace Alignment',
      query2,
      teacher,
      8
    );
    const step3Docs = [...aiLitDocs, ...aiLitSearch];

    // 4️⃣ Step 4: Prompt for workplace alignment + AI literacy relevance
    const literacyPrompt = this.buildSectionPrompt(
      'Learning Outcomes — Workplace and AI Literacy Alignment',
      `
Course: ${courseName}
Course Content (excerpt):
${courseContent.slice(0, 1000)}

Learning Outcomes:
${learningOutcomes.length ? learningOutcomes.map(o => `- ${o}`).join('\n') : plan.slice(0, 500)}
`,
      step3Docs,
      teacher,
      `
For the whole learning outcomes section:
1. Evaluate whether **AI literacy** (from UNESCO/AILIT context) should be incorporated or rephrased.
2. Support statements with citations to provided chunks; do **not** fabricate new material.
Output your analysis with clear citations.
IMPORTANT: Limit your response to 200 words maximum.
`
    );

    const literacyResp = await super.process({
      ...request,
      message: literacyPrompt
    });
    
    // Accumulate token usage
    if (tokenUsage && literacyResp.usageInternal) {
      tokenUsage.promptTokens += literacyResp.usageInternal.promptTokens || 0;
      tokenUsage.completionTokens += literacyResp.usageInternal.completionTokens || 0;
      tokenUsage.totalTokens += literacyResp.usageInternal.totalTokens || 0;
      tokenUsage.apiCallCount += 1;
      tokenUsage.breakdown.push({ section: 'Learning Outcomes - AI Literacy', tokens: literacyResp.usageInternal.totalTokens || 0 });
    }

    // 5️⃣ Combine both analyses
    const mappingText = (mappingResp.response || 'Analysis completed').trim();
    const literacyText = (literacyResp.response || 'Analysis completed').trim();
    const combined =
      `### 1. Learning Outcomes\n` +
      `#### Competence Mapping & AI Impact\n${mappingText}\n\n` +
      `#### Workplace Alignment & AI Literacy\n${literacyText}`;

    return combined;
  }

  // Classification helper for teaching approaches and activities
  // ---------------------------------------------------------------------------
  async classifyTeachingApproachesAndActivities(courseName, activities, standardApproaches, standardActivities) {
    const classificationPrompt = `You are a course plan analyzer. Classify the course major and identify teaching approaches and activities used in this course.

Course Name: ${courseName}

Extracted Teaching Activities from Course Plan:
${Array.isArray(activities) && activities.length > 0 
  ? activities.map((a, i) => `${i + 1}. ${a}`).join('\n')
  : 'No activities found'}

Standard Teaching Approaches (choose matching ones):
${standardApproaches.map(a => `- ${a}`).join('\n')}

Standard Teaching Activities (choose matching ones):
${standardActivities.map(a => `- ${a}`).join('\n')}

Instructions:
1. Determine the course major/discipline (Natural Sciences, Social Sciences, Humanities, Formal Sciences, Applied Sciences, or other)
2. From the standard lists above, identify which teaching approaches are used in this course
3. From the standard lists above, identify which teaching activities are used in this course
4. Return ONLY a valid JSON object with these keys:
   - "major": string (one of the major categories)
   - "approaches": array of strings (matching items from standard teaching approaches list)
   - "activities": array of strings (matching items from standard teaching activities list)

Return ONLY valid JSON, no markdown, no explanation. Example:
{
  "major": "Applied Sciences",
  "approaches": ["Project-based Learning", "Experiential Learning"],
  "activities": ["Team Projects", "Workshops", "Hands-on Tutorials/Lab"]
}`;

    try {
      const classificationRequest = {
        message: classificationPrompt,
        context: {}
      };
      
      const response = await super.process(classificationRequest);
      let classification;
      
      try {
        let jsonText = response.response;
        // Remove markdown code blocks if present
        jsonText = jsonText.replace(/```(?:json)?\s*/g, '').replace(/```\s*/g, '').trim();
        // Try to find JSON object
        const jsonMatch = jsonText.match(/\{[\s\S]*\}/);
        if (jsonMatch) {
          classification = JSON.parse(jsonMatch[0]);
        } else {
          classification = JSON.parse(jsonText);
        }
        
        // Validate structure
        if (!classification || typeof classification !== 'object') {
          throw new Error('Invalid JSON structure');
        }
        
        // Ensure required keys exist
        classification = {
          major: classification.major || 'Applied Sciences',
          approaches: Array.isArray(classification.approaches) ? classification.approaches : [],
          activities: Array.isArray(classification.activities) ? classification.activities : []
        };
      } catch (parseError) {
        console.warn('⚠️ Failed to parse classification as JSON, using fallback:', parseError.message);
        classification = {
          major: 'Applied Sciences',
          approaches: [],
          activities: []
        };
      }
      
      return classification;
    } catch (error) {
      console.error('❌ Error classifying teaching approaches and activities:', error);
      return {
        major: 'Applied Sciences',
        approaches: [],
        activities: []
      };
    }
  }

  // Classification helper for assessment approaches and types
  // ---------------------------------------------------------------------------
  async classifyAssessmentApproachesAndTypes(courseName, assignments, standardApproaches, standardTypes) {
    const classificationPrompt = `You are a course plan analyzer. Classify the course major and identify assessment approaches and assessment types used in this course.

Course Name: ${courseName}

Extracted Assignments/Assessments from Course Plan:
${Array.isArray(assignments) && assignments.length > 0 
  ? assignments.map((a, i) => `${i + 1}. ${a}`).join('\n')
  : 'No assignments found'}

Standard Assessment Approaches (choose matching ones):
${standardApproaches.map(a => `- ${a}`).join('\n')}

Standard Assessment Types (choose matching ones):
${standardTypes.map(a => `- ${a}`).join('\n')}

Instructions:
1. Determine the course major/discipline (Natural Sciences, Social Sciences, Humanities, Formal Sciences, Applied Sciences, or other)
2. From the standard lists above, identify which assessment approaches are used in this course
3. From the standard lists above, identify which assessment types are used in this course
4. Return ONLY a valid JSON object with these keys:
   - "major": string (one of the major categories)
   - "approaches": array of strings (matching items from standard assessment approaches list)
   - "types": array of strings (matching items from standard assessment types list)

Return ONLY valid JSON, no markdown, no explanation. Example:
{
  "major": "Applied Sciences",
  "approaches": ["Project-based Assessment", "Portfolio Assessment"],
  "types": ["Essay / Written Report", "Project / Capstone Work"]
}`;

    try {
      const classificationRequest = {
        message: classificationPrompt,
        context: {}
      };
      
      const response = await super.process(classificationRequest);
      let classification;
      
      try {
        let jsonText = response.response;
        jsonText = jsonText.replace(/```(?:json)?\s*/g, '').replace(/```\s*/g, '').trim();
        const jsonMatch = jsonText.match(/\{[\s\S]*\}/);
        if (jsonMatch) {
          classification = JSON.parse(jsonMatch[0]);
        } else {
          classification = JSON.parse(jsonText);
        }
        
        if (!classification || typeof classification !== 'object') {
          throw new Error('Invalid JSON structure');
        }
        
        classification = {
          major: classification.major || 'Applied Sciences',
          approaches: Array.isArray(classification.approaches) ? classification.approaches : [],
          types: Array.isArray(classification.types) ? classification.types : []
        };
      } catch (parseError) {
        console.warn('⚠️ Failed to parse assessment classification as JSON, using fallback:', parseError.message);
        classification = {
          major: 'Applied Sciences',
          approaches: [],
          types: []
        };
      }
      
      return classification;
    } catch (error) {
      console.error('❌ Error classifying assessment approaches and types:', error);
      return {
        major: 'Applied Sciences',
        approaches: [],
        types: []
      };
    }
  }

  // Section 2: Teaching / Learning Activities — Revised Logic (2025-10-31)
  // ---------------------------------------------------------------------------
  async analyzeTeachingActivitiesSection(plan, teacher, request, extractedTeachingActivities = [], tokenUsage = null) {
    const sectionTitle = 'Teaching and Learning Activities';
    const courseName = request?.context?.searchAIApplications || request?.context?.coursePlanName || 'this course';
    // Use extracted teaching activities if provided, otherwise fallback to manual extraction
    const activities = Array.isArray(extractedTeachingActivities) && extractedTeachingActivities.length > 0
      ? extractedTeachingActivities
      : (() => {
          // Fallback: simple manual extraction if OpenAI extraction didn't work
          const lines = String(plan || '').split(/\n+/);
          return lines
            .filter(l => /lecture|seminar|lab|workshop|project|group|field|tutorial|simulation|exercise|activity/i.test(l))
            .slice(0, 15)
            .map(l => l.trim())
            .filter(Boolean);
        })();
    const courseContent = plan.slice(0, 2000);

    // Standard teaching approaches list
    const standardTeachingApproaches = [
      'Direct Instruction',
      'Inquiry-based Learning',
      'Problem-based Learning',
      'Project-based Learning',
      'Case-based Learning',
      'Experiential Learning',
      'Collaborative Learning',
      'Flipped Learning',
      'Reflective Learning',
      'Game-based Learning',
      'Work-based Learning',
      'AI-enhanced Learning'
    ];

    // Standard teaching activities list
    const standardTeachingActivities = [
      'Lectures',
      'Instructional Video',
      'Demonstrations',
      'Reading and Resource Study',
      'Expert Interviews',
      'In-class Q&A',
      'Concept Mapping',
      'Summarizing',
      'Terminology Matching',
      'Think-pair-share',
      'Group Discussion',
      'Team Projects',
      'Peer Teaching',
      'Role-Play',
      'Collaborative Note-taking',
      'Hands-on Tutorials/Lab',
      'Fieldwork/Observation',
      'Workshops',
      'Studio-based Practice',
      'Internships',
      'Data Analysis Exercise',
      'Case Study Analysis',
      'Problem Sets',
      'Research Projects',
      'Design Challenges',
      'Essays and Reports',
      'Reflective Journaling',
      'Creative Writing/Design',
      'Presentation/Pitches',
      'Digital Storytelling'
    ];

    // 1️⃣ Step 1: Classify major, teaching approaches, and activities
    const classification = await this.classifyTeachingApproachesAndActivities(
      courseName,
      activities,
      standardTeachingApproaches,
      standardTeachingActivities
    );
    
    const major = classification.major || CoursePlanAnalysisAgent.deriveCourseMajor(courseName);
    const classifiedApproaches = classification.approaches || [];
    const classifiedActivities = classification.activities || [];

    // 2️⃣ Step 2: Map major to teaching approach document and get teaching activity documents
    const majorMap = {
      'Natural Sciences': 'TEACH_APPROACH_NATSCI_2025_01',
      'Social Sciences': 'TEACH_APPROACH_SOCSCI_2025_02',
      'Humanities': 'TEACH_APPROACH_HUMANITIES_2025_03',
      'Formal Sciences': 'TEACH_APPROACH_FORMALSCI_2025_04',
      'Applied Sciences': 'TEACH_APPROACH_APPLIEDSCI_2025_05'
    };
    
    const teachingActivityDocIds = [
      'TEACH_ACTIVITY_KNOWLEDGE_2025_01',
      'TEACH_ACTIVITY_COMPREHENSION_2025_02',
      'TEACH_ACTIVITY_COLLABORATIVE_2025_03',
      'TEACH_ACTIVITY_PRACTICAL_2025_04',
      'TEACH_ACTIVITY_ANALYTICAL_2025_05',
      'TEACH_ACTIVITY_WRITING_2025_06',
      'TEACH_ACTIVITY_ASSESSMENT_2025_07',
      'TEACH_ACTIVITY_REFLECTION_2025_08'
    ];
    
    const majorTeachId = majorMap[major];
    const majorApproachDocs = majorTeachId
      ? CoursePlanAnalysisAgent.getDocsByIds([majorTeachId])
      : [];
    
    const teachingActivityDocs = CoursePlanAnalysisAgent.getDocsByIds(teachingActivityDocIds);

    // 3️⃣ Step 3: Search for relevant chunks based on classified approaches and activities
    const relevantChunks = [];
    
    // Batch search: combine approaches and activities into single query to reduce API calls
    const allSearchTerms = [...classifiedApproaches, ...classifiedActivities];
    if (allSearchTerms.length > 0) {
      const batchedQuery = allSearchTerms.slice(0, 5).join(' '); // Limit to top 5 to avoid too long query
      const batchedDocs = await this.retrieveHybridForSection(
        batchedQuery,
        plan,
        teacher,
        Math.min(15, allSearchTerms.length * 3)
      );
      relevantChunks.push(...batchedDocs);
    }
    
    // Merge all documents: major approach docs + teaching activity docs + relevant chunks
    const seen = new Set();
    const mergedDocs = [...majorApproachDocs, ...teachingActivityDocs, ...relevantChunks].filter((d) => {
      const key = d.id || `${d.document_title || d.documentTitle || ''}|${d.section_title || d.sectionTitle || ''}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });

    // 4️⃣ Step 4 – Prompt for AI-adjusted activity redesign
    const redesignPrompt = this.buildSectionPrompt(
      'Teaching / Learning Activities Redesign under AI Influence',
      `
Course Name: ${courseName}
Discipline/Major: ${major}

Classified Teaching Approaches:
${classifiedApproaches.length > 0 ? classifiedApproaches.map((a) => `- ${a}`).join('\n') : 'None identified'}

Classified Teaching Activities:
${classifiedActivities.length > 0 ? classifiedActivities.map((a) => `- ${a}`).join('\n') : 'None identified'}

Extracted Activities from Course Plan:
${activities.length ? activities.map((a) => `- ${a}`).join('\n') : plan.slice(0, 500)}

Major-Specific Teaching Approach Document: ${majorTeachId || 'N/A'}
Course Content (excerpt):
${courseContent.slice(0, 1000)}
`,
      mergedDocs,
      teacher,
      `
Based on the classified teaching approaches (${classifiedApproaches.length} identified) and teaching activities (${classifiedActivities.length} identified), analyze the teaching/learning activities:

For each teaching / learning activity in the course plan:
1. Map it to the classified teaching approaches and activities, then describe its **typical pedagogical purpose, use, risks, and opportunities** (refer to the provided documents that match the classified approaches and activities).
2. Propose an **AI-adjusted redesign** if relevant:
   - How the activity could integrate or respond to GenAI tools.
   - Emphasize **human judgment, collaboration, or reflection** elements that AI cannot replace.
3. For each activity, describe:
   a. The **instructor's role before** and **after AI adoption**.
   b. The **student's role before** and **after AI adoption**.
4. Use the relevant chunks from the provided documents that match the classified teaching approaches (${classifiedApproaches.join(', ')}) and activities (${classifiedActivities.join(', ')}).
5. Keep references only from the provided chunks; do **not** invent new sources.
6. Cite sources as [Document Title — Section Title](URL).
Output your analysis with clear structure and citations.
`
    );

    const redesignResp = await super.process({
      ...request,
      message: redesignPrompt
    });
    
    // Accumulate token usage
    if (tokenUsage && redesignResp.usageInternal) {
      tokenUsage.promptTokens += redesignResp.usageInternal.promptTokens || 0;
      tokenUsage.completionTokens += redesignResp.usageInternal.completionTokens || 0;
      tokenUsage.totalTokens += redesignResp.usageInternal.totalTokens || 0;
      tokenUsage.apiCallCount += 1;
      tokenUsage.breakdown.push({ section: 'Teaching Activities - Redesign', tokens: redesignResp.usageInternal.totalTokens || 0 });
    }

    // 4️⃣ Combine outputs
    const redesignText = (redesignResp.response || 'Analysis completed').trim();
    const combined =
      `### 2. Teaching / Learning Activities\n` +
      `#### Discipline: ${major}\n` +
      `#### AI-Adjusted Activity Redesign\n${redesignText}`;

    return combined;
  }

  // Section 3: Assessment / Assignment — Revised Logic (2025-11-01)
  // ---------------------------------------------------------------------------
  async analyzeAssessmentSection(plan, teacher, request, extractedAssignments = [], tokenUsage = null) {
    const sectionTitle = 'Assessment / Assignment';
    const courseName = request?.context?.searchAIApplications || request?.context?.coursePlanName || 'this course';
    
    // Use extracted assignments if provided, otherwise fallback to manual extraction
    const assignments = Array.isArray(extractedAssignments) && extractedAssignments.length > 0
      ? extractedAssignments
      : (() => {
          const lines = String(plan || '').split(/\n+/);
          return lines
            .filter(l => /assignment|assessment|exam|test|project|report|essay|portfolio|evaluation|grade/i.test(l))
            .slice(0, 15)
            .map(l => l.trim())
            .filter(Boolean);
        })();
    const courseContent = plan.slice(0, 2000);

    // Standard assessment approaches list (from ASSESS_APPROACH_* documents)
    const standardAssessmentApproaches = [
      'Pre-Assessment (Diagnostic)',
      'Formative Quiz / Knowledge Check',
      'Instructor Feedback Cycle',
      'Peer Review',
      'Self-Assessment',
      'Essay / Written Report',
      'Case or Problem Analysis',
      'Project / Capstone Work',
      'Portfolio Assessment',
      'Presentation / Oral Defense',
      'Performance / Practical Demonstration',
      'Simulation / Scenario Assessment',
      'Reflective Essay / Learning Journal',
      'Collaborative Group Assessment',
      'AI-Resistant Contextual Assessment'
    ];

    // Standard assessment types list (from AI_ASSESSMENT_TEMPLATES)
    const standardAssessmentTypes = [
      'Essay / Written Assignment',
      'Case Study Analysis',
      'Project / Capstone',
      'Research Report / Literature Review',
      'Oral Exam / Viva',
      'Portfolio / Reflective Journal',
      'Data Analysis Exercise',
      'Presentation / Pitch',
      'Exam / Test (Written or Online)',
      'Peer Assessment'
    ];

    // 1️⃣ Step 1: Classify major, assessment approaches, and types
    const classification = await this.classifyAssessmentApproachesAndTypes(
      courseName,
      assignments,
      standardAssessmentApproaches,
      standardAssessmentTypes
    );
    
    const major = classification.major || CoursePlanAnalysisAgent.deriveCourseMajor(courseName);
    const classifiedApproaches = classification.approaches || [];
    const classifiedTypes = classification.types || [];

    // 2️⃣ Step 2: Map major to assessment approach document and get assessment template document
    const majorMap = {
      'Natural Sciences': 'ASSESS_APPROACH_NATSCI_2025_01',
      'Social Sciences': 'ASSESS_APPROACH_SOCSCI_2025_02',
      'Humanities': 'ASSESS_APPROACH_HUMANITIES_2025_03',
      'Formal Sciences': 'ASSESS_APPROACH_FORMALSCI_2025_04',
      'Applied Sciences': 'ASSESS_APPROACH_APPLIEDSCI_2025_05'
    };
    
    const majorAssessId = majorMap[major];
    const majorApproachDocs = majorAssessId
      ? CoursePlanAnalysisAgent.getDocsByIds([majorAssessId])
      : [];
    
    const assessmentTemplateDocs = CoursePlanAnalysisAgent.getDocsByIds(['AI_ASSESSMENT_TEMPLATES_2025_01']);

    // 3️⃣ Step 3: Search for relevant chunks based on classified approaches and types
    const relevantChunks = [];
    
    // Batch search: combine approaches and types into single query to reduce API calls
    const allSearchTerms = [...classifiedApproaches, ...classifiedTypes];
    if (allSearchTerms.length > 0) {
      const batchedQuery = allSearchTerms.slice(0, 5).join(' '); // Limit to top 5 to avoid too long query
      const batchedDocs = await this.retrieveHybridForSection(
        batchedQuery,
        plan,
        teacher,
        Math.min(15, allSearchTerms.length * 3)
      );
      relevantChunks.push(...batchedDocs);
    }
    
    // Merge all documents: major approach docs + assessment template docs + relevant chunks
    const seen = new Set();
    const mergedDocs = [...majorApproachDocs, ...assessmentTemplateDocs, ...relevantChunks].filter((d) => {
      const key = d.id || `${d.document_title || d.documentTitle || ''}|${d.section_title || d.sectionTitle || ''}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });

    // 4️⃣ Step 4 – Prompt for AI-adjusted assessment redesign
    const redesignPrompt = this.buildSectionPrompt(
      'Assessment / Assignment Redesign under AI Influence',
      `
Course Name: ${courseName}
Discipline/Major: ${major}

Classified Assessment Approaches:
${classifiedApproaches.length > 0 ? classifiedApproaches.map((a) => `- ${a}`).join('\n') : 'None identified'}

Classified Assessment Types:
${classifiedTypes.length > 0 ? classifiedTypes.map((a) => `- ${a}`).join('\n') : 'None identified'}

Extracted Assignments/Assessments from Course Plan:
${assignments.length ? assignments.map((a) => `- ${a}`).join('\n') : plan.slice(0, 500)}

Major-Specific Assessment Approach Document: ${majorAssessId || 'N/A'}
Course Content (excerpt):
${courseContent.slice(0, 1000)}
`,
      mergedDocs,
      teacher,
      `
Based on the classified assessment approaches (${classifiedApproaches.length} identified) and assessment types (${classifiedTypes.length} identified), analyze the assessment/assignment section:

1. **Summarize current assessment types** with risks and opportunities in the presence of GenAI (refer to the provided documents that match the classified approaches and types).
2. **Identify where ChatGPT-like tools could complete tasks** and why:
   - Check which assessment types can be fully or partially completed by GenAI
   - Evaluate the AI-completability of each assessment
3. **Evaluate likely rubric/validity risks overall**:
   - Assess how GenAI affects the validity of current assessment rubrics
   - Identify potential academic integrity concerns
4. **Propose adjusted designs** (process evidence, oral checks, local data):
   - Suggest AI-augmented versions where appropriate
   - Propose AI-resistant alternatives where necessary
   - Include process evidence requirements (e.g., draft versions, reflection logs)
   - Consider oral verification components
   - Incorporate local or context-specific data requirements
5. Use the relevant chunks from the provided documents that match the classified assessment approaches (${classifiedApproaches.join(', ')}) and types (${classifiedTypes.join(', ')}).
6. Keep references only from the provided chunks; do **not** invent new sources.
7. Cite sources as [Document Title — Section Title](URL).
Output your analysis with clear structure and citations.
`
    );

    const redesignResp = await super.process({
      ...request,
      message: redesignPrompt
    });
    
    // Accumulate token usage
    if (tokenUsage && redesignResp.usageInternal) {
      tokenUsage.promptTokens += redesignResp.usageInternal.promptTokens || 0;
      tokenUsage.completionTokens += redesignResp.usageInternal.completionTokens || 0;
      tokenUsage.totalTokens += redesignResp.usageInternal.totalTokens || 0;
      tokenUsage.apiCallCount += 1;
      tokenUsage.breakdown.push({ section: 'Assessment - Redesign', tokens: redesignResp.usageInternal.totalTokens || 0 });
    }

    // Combine outputs
    const redesignText = (redesignResp.response || 'Analysis completed').trim();
    const combined =
      `### 3. Assessment / Assignment\n` +
      `#### Discipline: ${major}\n` +
      `#### AI-Adjusted Assessment Redesign\n${redesignText}`;

    return combined;
  }

  // ---------------------------------------------------------------------------
  // SECTION EXTRACTION (OpenAI-based)
  // ---------------------------------------------------------------------------
  async extractSectionsFromPlan(planContent) {
    const extractionPrompt = `You are a course plan parser. Extract structured information from the following course plan text.

Extract the following sections and return ONLY a valid JSON object (no markdown, no explanation, no additional text):
- "learningOutcomes": Array of strings containing learning outcomes (Knowledge, Skills, General Competence)
- "teachingActivities": Array of strings containing teaching/learning activity descriptions
- "assignments": Array of strings containing assignment/assessment descriptions  
- "readingMaterials": Array of strings containing reading material entries
- "policyAndTransparency": String or object containing policy/transparency information (can be empty string or empty object if not found)
- "otherSections": Object with any other relevant sections (can be empty object if none)

Rules:
- Only extract content that is explicitly stated in the course plan
- Do NOT invent, infer, or create new content
- If a section is not found, return an empty array [] for arrays or empty object {} for objects
- Return ONLY valid JSON format

Example output format:
{
  "learningOutcomes": ["outcome 1", "outcome 2"],
  "teachingActivities": ["activity 1", "activity 2"],
  "assignments": ["assignment 1"],
  "readingMaterials": ["reading 1"],
  "policyAndTransparency": "",
  "otherSections": {}
}

Course Plan:
${planContent}`;

    try {
      const extractionRequest = {
        message: extractionPrompt,
        context: {}
      };
      
      const response = await super.process(extractionRequest);
      let extractedSections;
      
      // Store usage data to return
      const usage = response.usageInternal || null;
      
      // Try to parse JSON from response
      try {
        let jsonText = response.response;
        
        // Remove markdown code blocks if present
        jsonText = jsonText.replace(/```(?:json)?\s*/g, '').replace(/```\s*/g, '').trim();
        
        // Try to find JSON object in the response
        const jsonMatch = jsonText.match(/\{[\s\S]*\}/);
        if (jsonMatch) {
          extractedSections = JSON.parse(jsonMatch[0]);
        } else {
          // Try parsing the whole response
          extractedSections = JSON.parse(jsonText);
        }
        
        // Validate structure
        if (!extractedSections || typeof extractedSections !== 'object') {
          throw new Error('Invalid JSON structure');
        }
        
        // Ensure all required keys exist
        extractedSections = {
          learningOutcomes: Array.isArray(extractedSections.learningOutcomes) ? extractedSections.learningOutcomes : [],
          teachingActivities: Array.isArray(extractedSections.teachingActivities) ? extractedSections.teachingActivities : [],
          assignments: Array.isArray(extractedSections.assignments) ? extractedSections.assignments : [],
          readingMaterials: Array.isArray(extractedSections.readingMaterials) ? extractedSections.readingMaterials : [],
          policyAndTransparency: extractedSections.policyAndTransparency || {},
          otherSections: extractedSections.otherSections || {}
        };
      } catch (parseError) {
        console.warn('⚠️ Failed to parse extracted sections as JSON, using fallback:', parseError.message);
        console.warn('⚠️ Raw response:', response.response?.slice(0, 500));
        // Fallback: return empty structure
        extractedSections = {
          learningOutcomes: [],
          teachingActivities: [],
          assignments: [],
          readingMaterials: [],
          policyAndTransparency: {},
          otherSections: {}
        };
      }
      
      // Return with usage data
      return { ...extractedSections, usage };
    } catch (error) {
      console.error('❌ Error extracting sections:', error);
      // Return empty structure on error
      return {
        learningOutcomes: [],
        teachingActivities: [],
        assignments: [],
        readingMaterials: [],
        policyAndTransparency: {},
        otherSections: {},
        usage: null
      };
    }
  }

  // ---------------------------------------------------------------------------
  // MAIN PROCESS (sections 1–6)
  // ---------------------------------------------------------------------------
  async process(request) {
    const startTime = Date.now();
    try {
      console.log('🚀 Starting Course Plan Analysis');
      
      // Initialize token usage accumulator
      const tokenUsage = {
        promptTokens: 0,
        completionTokens: 0,
        totalTokens: 0,
        apiCallCount: 0,
        breakdown: []
      };
      
      // Extract data from request object
      const plan = request?.context?.currentContent || '';
      const teacher = request?.context?.teacherInfo || {};
      const coursePlanName = request?.context?.searchAIApplications || request?.context?.coursePlanName || 'this course';
      const courseMajor = CoursePlanAnalysisAgent.deriveCourseMajor(coursePlanName);
      
      // Extract sections from course plan using OpenAI
      console.log('⏳ [1/7] Extracting sections');
      const extractedSections = await this.extractSectionsFromPlan(plan);
      
      // Accumulate token usage from extraction
      if (extractedSections.usage) {
        tokenUsage.promptTokens += extractedSections.usage.promptTokens || 0;
        tokenUsage.completionTokens += extractedSections.usage.completionTokens || 0;
        tokenUsage.totalTokens += extractedSections.usage.totalTokens || 0;
        tokenUsage.apiCallCount += 1;
        tokenUsage.breakdown.push({ section: 'Section Extraction', tokens: extractedSections.usage.totalTokens || 0 });
      }
      
      const results = [];

      const doSection = async (name, planText, ragDocs, instructions) => {
        const prompt = this.buildSectionPrompt(name, planText, ragDocs, teacher, instructions);
        const resp = await super.process({ ...request, message: prompt });
        const sectionOutput = `### ${name}\n${(resp.response || 'Analysis completed').trim()}`;
        results.push(sectionOutput);
        
        // Accumulate token usage
        if (resp.usageInternal) {
          tokenUsage.promptTokens += resp.usageInternal.promptTokens || 0;
          tokenUsage.completionTokens += resp.usageInternal.completionTokens || 0;
          tokenUsage.totalTokens += resp.usageInternal.totalTokens || 0;
          tokenUsage.apiCallCount += 1;
          tokenUsage.breakdown.push({ section: name, tokens: resp.usageInternal.totalTokens || 0 });
        }
        
        return sectionOutput;
      };

      // ------------------ 1. Learning Outcomes ------------------
      console.log('⏳ [2/7] Analyzing Learning Outcomes');
      const loAnalysis = await this.analyzeLearningOutcomesSection(
        plan, 
        teacher, 
        request, 
        extractedSections.learningOutcomes || [],
        tokenUsage
      );
      results.push(loAnalysis);

      // ------------------ 2. Teaching / Learning Activities ------------------
      console.log('⏳ [3/7] Analyzing Teaching & Learning Activities');
      const teachingAnalysis = await this.analyzeTeachingActivitiesSection(
        plan, 
        teacher, 
        request, 
        extractedSections.teachingActivities || [],
        tokenUsage
      );
      results.push(teachingAnalysis);
      
      // Note: Sections 4-6 are extracted but not yet processed
      // They are available in extractedSections: readingMaterials, policyAndTransparency

      // ------------------ 3. Assessment / Assignment ------------------
      console.log('⏳ [4/7] Analyzing Assessment & Assignment');
      const assessmentAnalysis = await this.analyzeAssessmentSection(
        plan, 
        teacher, 
        request, 
        extractedSections.assignments || [],
        tokenUsage
      );
      results.push(assessmentAnalysis);

      // ------------------ 4. Policy and Transparency ------------------
      console.log('⏳ [5/7] Analyzing Policy and Transparency');
      const polDocs = CoursePlanAnalysisAgent.getDocsByIds(['USN_KI_GUIDELINE_2025_01', 'USN_AI_ASSESSMENT_2025_02']).concat(
        await this.retrieveHybridForSection('Policy and Transparency', plan, teacher, 6)
      );
      const polInstr = `
1. Check national and institutional AI policy compliance.
2. Report separately on general, teaching, and exam aspects.
3. Flag possible violations or ambiguities and suggest remedies.
4. Cite sources as [Document Title — Section Title](URL). Use only provided context.
`;
      const sec4Out = await doSection('4. Policy and Transparency', plan, polDocs, polInstr);

/*      // ------------------ 5. Reading Materials ------------------
      console.log('⏳ [6/7] Analyzing Reading Materials');
      const readDocs = await this.retrieveHybridForSection('Reading Materials', plan, teacher, 10);
      const readInstr = `
1. List reading materials (type and availability if given).
2. Evaluate AI risks/opportunities for these readings vs learning outcomes.
3. Suggest AI literacy additions where relevant.
4. Cite sources as [Document Title — Section Title](URL). Use only provided context.
`;
      const sec5Out = await doSection('5. Reading Materials', plan, readDocs, readInstr);
*/
      // ------------------ 6. Meta Check ------------------
      console.log('⏳ [7/7] Performing Meta Check');
      const metaDocs = await this.retrieveHybridForSection('Meta Check', plan, teacher, 10);
      const metaInstr = `
1. Create a summary paragraph about the alignment between outcomes, activities, and assessments under AI conditions.
2. Identify elements trivially generatable by GenAI.
3. Cite sources as [Document Title — Section Title](URL). Use only provided context.

IMPORTANT: Limit your response to 200 words maximum.
`;
      const sec6Out = await doSection('6. Meta Check', plan, metaDocs, metaInstr);

      // Merge sections: trim each section, reduce multiple consecutive newlines, and join with single newline
      let final = results
        .map(section => section.trim().replace(/\n{2,}/g, '\n')) // Replace 2+ newlines with single newline
        .filter(section => section.length > 0)
        .join('\n');
      
      const totalTime = ((Date.now() - startTime) / 1000).toFixed(2);
      console.log(`✅ Course Plan Analysis completed in ${totalTime}s`);
      console.log(`📊 Total API calls: ${tokenUsage.apiCallCount}, Total tokens: ${tokenUsage.totalTokens}`);
      
      return { 
        success: true, 
        agent: this.name, 
        response: final,
        usage: {
          prompt_tokens: tokenUsage.promptTokens,
          completion_tokens: tokenUsage.completionTokens,
          total_tokens: tokenUsage.totalTokens
        },
        usageInternal: tokenUsage
      };
    } catch (err) {
      const totalTime = ((Date.now() - startTime) / 1000).toFixed(2);
      console.error(`❌ Course Plan Analysis failed after ${totalTime}s:`, err.message);
      return { success: false, agent: this.name, error: err.message };
    }
  }

  validateRequest(request) {
    return super.validateRequest(request);
  }
}

module.exports = CoursePlanAnalysisAgent;
