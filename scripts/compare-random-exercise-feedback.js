#!/usr/bin/env node

require("dotenv").config();
const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const OpenAI = require("openai");
const pdfParse = require("pdf-parse");
const mammoth = require("mammoth");
const OriginalFeedbackGenerationAgent = require("../src/agents/OriginalFeedbackGenerationAgent");
const FeedbackGenerationAgent = require("../src/agents/FeedbackGenerationAgent");
const RagService = require("../src/services/RagService");

const DEFAULT_TASK_IDS = [
  // Current comparison scope: Task 8.2, 8.1, 7.2, 7.1.
  "698b52a32f06a6488ab454b9",
  "698b52182f06a6488ab454b1",
  "698b4f062f06a6488ab4548a",
  "698b4d732f06a6488ab4544d",
];

const BASE_URL = process.env.BASE_URL || "http://127.0.0.1:3000";
const PUBLIC_FILE_BASE_URL = process.env.PUBLIC_FILE_BASE_URL || "https://innspill.ai/microapi/api/v1/files";
const USER_NAME = process.env.USER_NAME || "teacher";
const AUTH_COOKIE = process.env.AUTH_COOKIE || "";
const OUTPUT_DIR = process.env.OUTPUT_DIR || path.join(process.cwd(), "tmp");
const OUTPUT_PREFIX =
  process.env.OUTPUT_PREFIX ||
  path.join(OUTPUT_DIR, `feedback-random-exercise-${new Date().toISOString().replace(/[:.]/g, "-")}`);
const TASK_IDS = (process.env.TASK_IDS || DEFAULT_TASK_IDS.join(","))
  .split(",")
  .map((id) => id.trim())
  .filter(Boolean);
const FEEDBACK_MODE_ALIASES = {
  few_shot: "fewshot",
  rule_based: "rule-based",
  student_involving: "student-involving",
};
const SUPPORTED_FEEDBACK_MODES = new Set(["general", "fewshot", "rule-based", "revision", "framework", "student-involving"]);
const FEEDBACK_MODES = (process.env.FEEDBACK_MODES || "general,few_shot,rule_based,revision,framework,student_involving")
  .split(",")
  .map((mode) => mode.trim().toLowerCase())
  .filter(Boolean)
  .map((mode) => FEEDBACK_MODE_ALIASES[mode] || mode)
  .filter((mode, index, modes) => modes.indexOf(mode) === index);
const RAG_MODES = (process.env.RAG_MODES || "legacy,hybrid,agentic")
  .split(",")
  .map((mode) => mode.trim())
  .filter(Boolean);
const GOOD_PER_EXERCISE = Number.parseInt(process.env.GOOD_PER_EXERCISE || "3", 10);
const BAD_PER_EXERCISE = Number.parseInt(process.env.BAD_PER_EXERCISE || "3", 10);
const RANDOM_SEED = Number.parseInt(process.env.RANDOM_SEED || "20260519", 10);
const INCLUDE_ATTACHMENTS = process.env.INCLUDE_ATTACHMENTS !== "false";
const STRICT_NO_ATTACHMENT_TEXT = process.env.STRICT_NO_ATTACHMENT_TEXT !== "false";
const ORIGINAL_MODEL = process.env.ORIGINAL_MODEL || "gpt-4o-mini";
const GPT54_MODEL = process.env.GPT54_MODEL || "gpt-5.4-mini";
const NEW_PROMPT_MODEL = process.env.NEW_PROMPT_MODEL || "gpt-4o-mini";
const MAX_ATTACHMENT_SIZE_BYTES = Number.parseInt(process.env.MAX_ATTACHMENT_SIZE_BYTES || `${10 * 1024 * 1024}`, 10);
const ALLOWED_ATTACHMENT_EXTENSIONS = new Set([".docx", ".pdf"]);
const RULE_BASED_INSTRUCTION =
  process.env.RULE_BASED_INSTRUCTION ||
  "Evaluate strictly against the provided task evaluation criteria. Ground feedback in concrete evidence from the submission, keep the same language as the student, and provide actionable feedforward.";
const RAG_LEARN_TO_MARKDOWN = process.env.RAG_LEARN_TO_MARKDOWN === "true";
const RAG_MEMORY_OUTPUT =
  process.env.RAG_MEMORY_OUTPUT ||
  path.join(process.cwd(), "rag-memory", "generated-feedback-memory.md");
const RAG_MEMORY_PENDING_OUTPUT =
  process.env.RAG_MEMORY_PENDING_OUTPUT ||
  path.join(path.dirname(RAG_MEMORY_OUTPUT), `_${path.basename(RAG_MEMORY_OUTPUT)}.pending`);
const RAG_MEMORY_APPROACHES = (process.env.RAG_MEMORY_APPROACHES || "gpt54NewFeedback")
  .split(",")
  .map((approach) => approach.trim())
  .filter(Boolean);
const RAG_MEMORY_MAX_ENTRIES = Number.parseInt(process.env.RAG_MEMORY_MAX_ENTRIES || "500", 10);
const RAG_MEMORY_INCLUDE_RAW = process.env.RAG_MEMORY_INCLUDE_RAW === "true";
let pendingMemoryWritten = 0;
let pendingMemorySkipped = 0;
let memoryFinalized = false;

const headers = {
  Accept: "*/*",
  "Content-Type": "application/json",
  ...(AUTH_COOKIE ? { Cookie: AUTH_COOKIE } : {}),
};

function csvEscape(value) {
  if (value === null || value === undefined) return "";
  const text = typeof value === "string" ? value : JSON.stringify(value);
  return `"${text.replace(/"/g, '""')}"`;
}

function parseJson(text, fallback = {}) {
  if (!text || typeof text !== "string") return fallback;
  try {
    return JSON.parse(text.replace(/```json\n?/g, "").replace(/```\n?/g, "").trim());
  } catch {
    return fallback;
  }
}

function makeSeededRandom(seed) {
  let value = seed % 2147483647;
  if (value <= 0) value += 2147483646;
  return () => {
    value = (value * 16807) % 2147483647;
    return (value - 1) / 2147483646;
  };
}

function shuffle(items, random) {
  const copy = [...items];
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}

function latestAnswer(answers) {
  if (!Array.isArray(answers) || answers.length === 0) return null;
  return answers[answers.length - 1]?.answer || null;
}

function latestFeedbackEntry(history) {
  if (!Array.isArray(history) || history.length === 0) return null;
  return history[history.length - 1] || null;
}

function scoreValue(submission) {
  const latest = latestFeedbackEntry(submission.feedbackHistory);
  const values = [
    submission.taskQualityScore ?? latest?.taskQualityScore,
    submission.reflectionScore ?? latest?.reflectionScore,
    submission.criticalthinkingScore ?? latest?.criticalthinkingScore,
    submission.conceptMasteryScore ?? latest?.conceptMasteryScore,
  ]
    .map((value) => (value === null || value === undefined ? NaN : Number(value)))
    .filter((value) => Number.isFinite(value));
  if (values.length === 0) return null;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function hasAttachmentMetadata(submission) {
  const possible = [
    submission.attachments,
    submission.files,
    submission.fileAttachments,
    submission.uploads,
    submission.submissionFiles,
  ];
  return possible.some((value) => Array.isArray(value) && value.length > 0);
}

function looksLikeAttachmentOnly(text) {
  if (!text) return false;
  const normalized = text.toLowerCase().replace(/---[\s\S]*?---/g, "").trim();
  if (normalized.length > 220) return false;
  return /\b(vedlagt|attached|attachment|se vedlegg|vedlegg|file|filen|dokument)\b/.test(normalized);
}

function normalizeId(item) {
  return item.id || item._id || item.submissionId || item.groupId || "";
}

function attachmentFilename(item) {
  if (!item) return "";
  if (typeof item === "string") return item;
  const candidates = [item.fileId, item.filename, item.fileName, item.name, item.path, item.url].filter(Boolean);
  return candidates.find((value) => path.extname(String(value).split("?")[0])) || candidates[0] || "";
}

function attachmentNamesForSubmission(submission) {
  if (!submission) return [];
  return [
    ...(Array.isArray(submission.attachments) ? submission.attachments : []),
    ...(Array.isArray(submission.files) ? submission.files : []),
    ...(Array.isArray(submission.fileAttachments) ? submission.fileAttachments : []),
    ...(Array.isArray(submission.uploads) ? submission.uploads : []),
    ...(Array.isArray(submission.submissionFiles) ? submission.submissionFiles : []),
  ]
    .map(attachmentFilename)
    .filter(Boolean);
}

function isSupportedAttachment(filename) {
  const ext = path.extname(String(filename || "").split("?")[0]).toLowerCase();
  return ALLOWED_ATTACHMENT_EXTENSIONS.has(ext);
}

function unsupportedAttachmentNames(taskEntry) {
  const names = [];
  const task = taskEntry.task || null;
  for (const filename of attachmentNamesForSubmission(task)) {
    if (!isSupportedAttachment(filename)) names.push(filename);
  }
  for (const submission of taskEntry.submissions || []) {
    for (const filename of attachmentNamesForSubmission(submission)) {
      if (!isSupportedAttachment(filename)) names.push(filename);
    }
  }
  return Array.from(new Set(names));
}

function isAttachmentFree(submission) {
  if (INCLUDE_ATTACHMENTS) return true;
  if (hasAttachmentMetadata(submission)) return false;
  if (STRICT_NO_ATTACHMENT_TEXT && looksLikeAttachmentOnly(submission.submission || "")) return false;
  return true;
}

async function postJson(url, body) {
  let response;
  try {
    response = await fetch(url, {
      method: "POST",
      headers,
      body: JSON.stringify(body),
    });
  } catch (error) {
    throw new Error(`Cannot connect to backend at ${url}. Make sure the backend is running and BASE_URL is correct. Original error: ${error.message}`);
  }
  const text = await response.text();
  const json = parseJson(text, null);
  if (!json) throw new Error(`Non-JSON response from ${url}: ${text.slice(0, 500)}`);
  if (!response.ok || json.success === false) {
    throw new Error(`Request failed ${response.status} ${url}: ${JSON.stringify(json).slice(0, 1000)}`);
  }
  return json;
}

async function getJson(url) {
  let response;
  try {
    response = await fetch(url, { headers });
  } catch (error) {
    throw new Error(`Cannot connect to backend at ${url}. Make sure the backend is running and BASE_URL is correct. Original error: ${error.message}`);
  }
  const text = await response.text();
  const json = parseJson(text, null);
  if (!json) throw new Error(`Non-JSON response from ${url}: ${text.slice(0, 500)}`);
  if (!response.ok || json.success === false) {
    throw new Error(`Request failed ${response.status} ${url}: ${JSON.stringify(json).slice(0, 1000)}`);
  }
  return json;
}

async function getTaskMap(taskIds) {
  const entries = await Promise.all(
    taskIds.map(async (taskId) => {
      try {
        const json = await getJson(`${BASE_URL}/api/v1/assessment-tasks/${taskId}?userName=${encodeURIComponent(USER_NAME)}`);
        return [taskId, json.data || null];
      } catch (error) {
        console.warn(`[random-feedback] Could not fetch task ${taskId}: ${error.message}`);
        return [taskId, null];
      }
    }),
  );
  return Object.fromEntries(entries);
}

async function getProject(projectId) {
  if (!projectId) return null;
  try {
    const json = await getJson(`${BASE_URL}/api/v1/projects/${projectId}?userName=${encodeURIComponent(USER_NAME)}`);
    return json.data || null;
  } catch {
    return null;
  }
}

async function getSubmissionsByTask(taskIds) {
  const json = await postJson(
    `${BASE_URL}/api/v1/assessment-submissions/batch?userName=${encodeURIComponent(USER_NAME)}`,
    { taskIds },
  );
  return json.data || [];
}

function selectSamples(taskEntry, random) {
  const submissions = (taskEntry.submissions || [])
    .filter((submission) => (submission.submission || "").trim())
    .filter(isAttachmentFree)
    .map((submission) => ({ ...submission, _scoreValue: scoreValue(submission) }));

  const scored = submissions.filter((submission) => submission._scoreValue !== null);
  const goodPool = scored.filter((submission) => submission._scoreValue >= 4);
  const badPool = scored.filter((submission) => submission._scoreValue <= 2.5);

  let good = shuffle(goodPool, random).slice(0, GOOD_PER_EXERCISE);
  let bad = shuffle(badPool, random).slice(0, BAD_PER_EXERCISE);

  if (good.length < GOOD_PER_EXERCISE) {
    const fallback = scored
      .filter((submission) => !good.some((item) => normalizeId(item) === normalizeId(submission)))
      .sort((a, b) => (b._scoreValue ?? -Infinity) - (a._scoreValue ?? -Infinity));
    good = [...good, ...fallback.slice(0, GOOD_PER_EXERCISE - good.length)];
  }

  if (bad.length < BAD_PER_EXERCISE) {
    const selected = new Set(good.map(normalizeId));
    const fallback = scored
      .filter((submission) => !selected.has(normalizeId(submission)))
      .sort((a, b) => (a._scoreValue ?? Infinity) - (b._scoreValue ?? Infinity));
    bad = [...bad, ...fallback.slice(0, BAD_PER_EXERCISE - bad.length)];
  }

  return [
    ...good.map((submission) => ({ submission, qualityBucket: "good" })),
    ...bad.map((submission) => ({ submission, qualityBucket: "bad" })),
  ];
}

function createModelClient(openai, model) {
  return {
    chat: {
      completions: {
        create: (params) => openai.chat.completions.create({ ...params, model }),
      },
    },
  };
}

async function extractAttachmentText(buffer, filename) {
  const ext = path.extname(filename).toLowerCase();
  if (buffer.length > MAX_ATTACHMENT_SIZE_BYTES) {
    throw new Error(`File too large (max ${MAX_ATTACHMENT_SIZE_BYTES / 1024 / 1024}MB)`);
  }
  if (ext === ".pdf") {
    const data = await pdfParse(buffer);
    return data.text || "";
  }
  if (ext === ".docx") {
    const result = await mammoth.extractRawText({ buffer });
    return result.value || "";
  }
  throw new Error(`Unsupported attachment type "${ext || "unknown"}"; only .docx and .pdf are allowed in this comparison`);
}

async function readLocalAttachmentContent(filename) {
  const localPath = path.join(process.cwd(), "uploads", "assessment", path.basename(filename));
  if (!fs.existsSync(localPath)) return null;
  return extractAttachmentText(fs.readFileSync(localPath), filename);
}

async function fetchAttachmentContentFromUrl(filename) {
  const cleaned = String(filename || "").split("/").pop();
  if (!cleaned) return "";
  const url = `${PUBLIC_FILE_BASE_URL}/${encodeURIComponent(cleaned)}`;
  const response = await fetch(url, {
    headers: {
      Accept: "*/*",
      ...(AUTH_COOKIE ? { Cookie: AUTH_COOKIE } : {}),
    },
  });
  if (!response.ok) throw new Error(`file fetch failed ${response.status} ${url}`);
  const buffer = Buffer.from(await response.arrayBuffer());
  return extractAttachmentText(buffer, cleaned);
}

async function buildAttachmentContent(submission) {
  if (!INCLUDE_ATTACHMENTS) return "";
  const attachmentNames = attachmentNamesForSubmission(submission);

  const chunks = [];
  for (const filename of attachmentNames.filter(Boolean)) {
    try {
      const localContent = await readLocalAttachmentContent(filename);
      chunks.push(localContent === null ? await fetchAttachmentContentFromUrl(filename) : localContent);
    } catch (error) {
      chunks.push(`[Could not read attachment ${filename}: ${error.message}]`);
    }
  }
  return chunks.join("\n\n").slice(0, 12000);
}

function buildFewShotPrompt(taskRows, currentSubmissionId) {
  return taskRows
    .filter((row) => normalizeId(row.submission) !== currentSubmissionId)
    .map((row) => latestFeedbackEntry(row.submission.feedbackHistory))
    .filter((entry) => entry?.feedback)
    .slice(0, 5)
    .map((entry, index) => {
      return [
        `Example ${index + 1}`,
        `Scores: task=${entry.taskQualityScore ?? ""}, reflection=${entry.reflectionScore ?? ""}, critical=${entry.criticalthinkingScore ?? ""}, concept=${entry.conceptMasteryScore ?? ""}`,
        `Feedback: ${entry.feedback || ""}`,
        `Feedforward: ${entry.feedforward || ""}`,
      ].join("\n");
    })
    .join("\n\n");
}

async function buildRequest(task, project, row, feedbackMode, taskRows) {
  const submission = row.submission;
  const latest = latestFeedbackEntry(submission.feedbackHistory);
  const submissionId = normalizeId(submission);
  return {
    feedbackMode,
    submission: submission.submission || "",
    submissionAnswer: latestAnswer(submission.submissionQuestionAnswers),
    feedbackReceivedAnswer: latestAnswer(submission.feedbackReceivedQuestionAnswers),
    previousSubmission: null,
    previousFeedback: latest?.feedback || null,
    submissionHistory: submission.feedbackHistory || [],
    evaluationCriteria: task?.evaluationCriteria || "",
    learningObjectives: project?.learningOutcome || "",
    persona: null,
    attachments: [],
    attachmentContent: await buildAttachmentContent(submission),
    conversationLog: submission.conversationLog || "",
    id: task?.id || task?._id || row.taskId,
    projectId: task?.projectId || null,
    taskTitle: task?.taskTitle || task?.keyword || task?.description || "",
    description: task?.description || "",
    taskOutcome: task?.outcome || "",
    taskInstruction: task?.instruction || "",
    keyword: task?.keyword || "",
    submissionDeadline: task?.submissionDeadline || "",
    enabledAIGuideline: false,
    submissionQuestion: task?.submissionQuestion || null,
    feedbackReceivedQuestion: task?.feedbackReceivedQuestion || null,
    fewShotPrompt: feedbackMode === "fewshot" ? buildFewShotPrompt(taskRows, submissionId) : "",
    isLearnFromHuman: feedbackMode === "fewshot",
    enableSkill: false,
    skillId: null,
    instruction: feedbackMode === "rule-based" ? RULE_BASED_INSTRUCTION : null,
    ragMode: "legacy",
    retrievedContext: "",
    ragSources: [],
  };
}

async function applyRagMode(ragService, request, ragMode) {
  const next = {
    ...request,
    ragMode,
    retrievedContext: "",
    ragSources: [],
  };
  if (ragMode === "legacy") {
    return {
      request: next,
      rag: {
        mode: "legacy",
        chunks: [],
        debug: { mode: "legacy" },
      },
    };
  }

  const result = await ragService.retrieveForFeedback(next, { mode: ragMode });
  next.retrievedContext = result.contextText || "";
  next.ragSources = result.chunks || [];
  return {
    request: next,
    rag: {
      mode: ragMode,
      chunks: result.chunks || [],
      debug: result.debug || null,
    },
  };
}

async function runAgent(agent, request) {
  const started = Date.now();
  const response = await agent.process(request);
  const processingTime = Date.now() - started;
  const data = response.success
    ? parseJson(response.response, {
        feedback: response.response || "",
        feedforward: "",
        concept: "",
        reflection: "",
        criticalThinking: "",
        taskQualityScore: null,
        reflectionScore: null,
        criticalthinkingScore: null,
        conceptMasteryScore: null,
      })
    : {};

  return {
    success: response.success,
    error: response.error || "",
    data,
    raw: response.response || "",
    usage: response.usage || response.usageInternal || null,
    processingTime,
  };
}

function usageValue(usage, key) {
  if (!usage) return "";
  if (key === "prompt") return usage.prompt_tokens || usage.promptTokens || 0;
  if (key === "completion") return usage.completion_tokens || usage.completionTokens || 0;
  if (key === "total") return usage.total_tokens || usage.totalTokens || 0;
  return "";
}

function scoreText(value) {
  return value === null || value === undefined ? "" : String(value);
}

function shortText(value, max = 480) {
  const text = String(value || "")
    .replace(/\s+/g, " ")
    .trim();
  if (!text) return "";
  return text.length > max ? `${text.slice(0, max - 3).trim()}...` : text;
}

function formatScores(data) {
  const scores = [
    ["task", data.taskQualityScore],
    ["reflection", data.reflectionScore],
    ["critical", data.criticalthinkingScore],
    ["concept", data.conceptMasteryScore],
  ]
    .filter(([, value]) => value !== null && value !== undefined && value !== "")
    .map(([label, value]) => `${label}: ${value}`);

  return scores.length > 0 ? scores.join(", ") : "";
}

function formatFeedbackCell(data, model) {
  const parts = [
    `Model: ${model}`,
    data.feedback ? `Feedback:\n${data.feedback}` : "",
    data.feedforward ? `Feedforward:\n${data.feedforward}` : "",
    formatScores(data) ? `Scores: ${formatScores(data)}` : "",
  ].filter(Boolean);

  return parts.join("\n\n");
}

function markdownEscape(value) {
  return String(value || "")
    .replace(/\\/g, "\\\\")
    .replace(/`/g, "\\`")
    .replace(/\|/g, "\\|")
    .trim();
}

function stableMemoryId(item, approach) {
  return crypto
    .createHash("sha1")
    .update([
      item.taskId,
      item.submissionId,
      item.feedbackMode,
      item.ragMode,
      approach,
      item[approach]?.raw || JSON.stringify(item[approach]?.data || {}),
    ].join("||"))
    .digest("hex")
    .slice(0, 16);
}

function formatScoreLine(data = {}) {
  const scores = [
    ["taskQualityScore", data.taskQualityScore],
    ["reflectionScore", data.reflectionScore],
    ["criticalthinkingScore", data.criticalthinkingScore],
    ["conceptMasteryScore", data.conceptMasteryScore],
  ]
    .filter(([, value]) => value !== null && value !== undefined && value !== "")
    .map(([key, value]) => `${key}=${value}`);
  return scores.length ? scores.join(", ") : "not available";
}

function buildMemoryEntry(item, approach) {
  const result = item[approach];
  if (!result?.success || !result?.data) return null;

  const data = result.data;
  const memoryId = stableMemoryId(item, approach);
  const ragSourceLines = (item.ragSources || [])
    .slice(0, 5)
    .map((source) => {
      const title = [source.documentTitle, source.sectionTitle].filter(Boolean).join(" - ") || source.id;
      const origin = source.sourcePath || source.sourceUrl || source.sourceType || "";
      return `- ${markdownEscape(title)}${origin ? ` (${markdownEscape(origin)})` : ""}`;
    });

  const reusableLessons = [
    data.feedback ? `Feedback focus: ${shortText(data.feedback, 360)}` : "",
    data.feedforward ? `Feedforward pattern: ${shortText(data.feedforward, 360)}` : "",
    data.concept ? `Concept calibration: ${shortText(data.concept, 260)}` : "",
    data.reflection ? `Reflection calibration: ${shortText(data.reflection, 260)}` : "",
    data.criticalThinking ? `Critical-thinking calibration: ${shortText(data.criticalThinking, 260)}` : "",
  ].filter(Boolean);

  const lines = [
    `<!-- memory-id: ${memoryId} -->`,
    `## Learned feedback case - ${markdownEscape(item.exerciseName || item.taskId)}`,
    "",
    "### Metadata",
    "",
    `- memory_id: ${memoryId}`,
    `- reviewed: false`,
    `- generated_at: ${new Date().toISOString()}`,
    `- task_id: ${markdownEscape(item.taskId)}`,
    `- submission_id: ${markdownEscape(item.submissionId)}`,
    `- feedback_mode: ${markdownEscape(item.feedbackMode)}`,
    `- rag_mode: ${markdownEscape(item.ragMode)}`,
    `- approach: ${markdownEscape(approach)}`,
    `- source_quality_bucket: ${markdownEscape(item.qualityBucket)}`,
    `- source_score_average: ${scoreText(item.sourceScoreAverage)}`,
    `- retrieved_chunk_count: ${item.retrievedChunkCount}`,
    "",
    "### Task signal",
    "",
    `- Task: ${markdownEscape(shortText(item.exerciseName, 220))}`,
    ...(item.taskOutcome ? [`- Outcome: ${markdownEscape(shortText(item.taskOutcome, 320))}`] : []),
    ...(item.taskInstruction ? [`- Instruction: ${markdownEscape(shortText(item.taskInstruction, 320))}`] : []),
    ...(item.taskEvaluationCriteria ? [`- Evaluation criteria: ${markdownEscape(shortText(item.taskEvaluationCriteria, 420))}`] : []),
    "",
    "### Score calibration",
    "",
    `- ${formatScoreLine(data)}`,
    "",
    "### Reusable lesson",
    "",
    ...reusableLessons.map((lesson) => `- ${markdownEscape(lesson)}`),
    reusableLessons.length ? "" : "- No reusable lesson extracted from this run.",
    "",
    "### Retrieved source memory",
    "",
    ...(ragSourceLines.length ? ragSourceLines : ["- No retrieved source was attached to this run."]),
  ];

  if (RAG_MEMORY_INCLUDE_RAW) {
    lines.push(
      "",
      "### Raw generated feedback",
      "",
      "```json",
      JSON.stringify(data, null, 2),
      "```",
    );
  }

  lines.push("");
  return { id: memoryId, markdown: lines.join("\n") };
}

function ensureMemoryFile(filepath) {
  if (fs.existsSync(filepath)) return;
  fs.mkdirSync(path.dirname(filepath), { recursive: true });
  const header = [
    "---",
    "id: generated-feedback-memory",
    "title: Generated Feedback Memory",
    "source_type: markdown_memory",
    "intended_use: feedback_guideline",
    "language: en",
    "tags: [feedback, generated-memory, rubric, calibration]",
    `version: ${new Date().toISOString().slice(0, 10)}`,
    "---",
    "",
    "# Generated Feedback Memory",
    "",
    "This file is generated when `RAG_LEARN_TO_MARKDOWN=true` is enabled for the comparison script.",
    "Entries are marked `reviewed: false` by default. Review and edit useful lessons before relying on them in production feedback generation.",
    "",
  ].join("\n");
  fs.writeFileSync(filepath, header, "utf8");
}

function readMemoryIds(filepath) {
  if (!fs.existsSync(filepath)) return new Set();
  const content = fs.readFileSync(filepath, "utf8");
  return new Set(
    Array.from(content.matchAll(/memory-id:\s*([a-f0-9]+)/g)).map((match) => match[1]),
  );
}

function splitMemoryBlocks(markdown) {
  return String(markdown || "")
    .split(/\n(?=<!-- memory-id: )/)
    .map((block) => block.trim())
    .filter((block) => /<!-- memory-id:\s*[a-f0-9]+ -->/.test(block));
}

function memoryIdFromBlock(block) {
  return block.match(/memory-id:\s*([a-f0-9]+)/)?.[1] || null;
}

function appendRagMemoryForItem(item) {
  if (!RAG_LEARN_TO_MARKDOWN) return { enabled: false, written: 0, skipped: 0 };

  ensureMemoryFile(RAG_MEMORY_PENDING_OUTPUT);
  const knownIds = new Set([
    ...readMemoryIds(RAG_MEMORY_OUTPUT),
    ...readMemoryIds(RAG_MEMORY_PENDING_OUTPUT),
  ]);
  const entries = [];
  let skipped = 0;

  if (Number.isFinite(RAG_MEMORY_MAX_ENTRIES) && pendingMemoryWritten >= RAG_MEMORY_MAX_ENTRIES) {
    return { enabled: true, written: 0, skipped: RAG_MEMORY_APPROACHES.length };
  }

  for (const approach of RAG_MEMORY_APPROACHES) {
    const entry = buildMemoryEntry(item, approach);
    if (!entry || knownIds.has(entry.id)) {
      skipped++;
      continue;
    }
    entries.push(entry.markdown);
    knownIds.add(entry.id);
    if (Number.isFinite(RAG_MEMORY_MAX_ENTRIES) && pendingMemoryWritten + entries.length >= RAG_MEMORY_MAX_ENTRIES) break;
  }

  if (entries.length) {
    fs.appendFileSync(RAG_MEMORY_PENDING_OUTPUT, `\n${entries.join("\n")}`, "utf8");
  }

  pendingMemoryWritten += entries.length;
  pendingMemorySkipped += skipped;

  return {
    enabled: true,
    output: RAG_MEMORY_PENDING_OUTPUT,
    written: entries.length,
    skipped,
  };
}

function finalizeRagMemory() {
  if (!RAG_LEARN_TO_MARKDOWN || memoryFinalized) return { enabled: RAG_LEARN_TO_MARKDOWN, written: 0, skipped: 0 };
  memoryFinalized = true;
  if (!fs.existsSync(RAG_MEMORY_PENDING_OUTPUT)) return { enabled: true, written: 0, skipped: 0 };

  ensureMemoryFile(RAG_MEMORY_OUTPUT);
  const finalIds = readMemoryIds(RAG_MEMORY_OUTPUT);
  const pendingContent = fs.readFileSync(RAG_MEMORY_PENDING_OUTPUT, "utf8");
  const pendingBlocks = splitMemoryBlocks(pendingContent);
  const entries = [];
  let skipped = 0;

  for (const block of pendingBlocks) {
    const id = memoryIdFromBlock(block);
    if (!id || finalIds.has(id)) {
      skipped++;
      continue;
    }
    finalIds.add(id);
    entries.push(block);
  }

  if (entries.length) {
    fs.appendFileSync(RAG_MEMORY_OUTPUT, `\n${entries.join("\n\n")}\n`, "utf8");
  }

  return {
    enabled: true,
    output: RAG_MEMORY_OUTPUT,
    pendingOutput: RAG_MEMORY_PENDING_OUTPUT,
    written: entries.length,
    skipped,
  };
}

function buildTable1(results) {
  const columns = [
    "mode",
    "ragMode",
    "retrievedChunkCount",
    "exerciseName",
    "qualityBucket",
    "sourceScoreAverage",
    "studentName",
    "attemptNumber",
    "submissionPreview",
    "originalApproachByGpt4oMini",
    "generatedByGpt54Mini",
    "generatedByNewPromptDesignGpt4oMini",
    "GPT5.4withnewfeedback",
    "originalError",
    "gpt54Error",
    "newPromptError",
    "gpt54NewFeedbackError",
  ];

  const lines = [columns.map(csvEscape).join(",")];
  for (const item of results) {
    const original = item.original.data || {};
    const gpt54 = item.gpt54.data || {};
    const newPrompt = item.newPrompt.data || {};
    const gpt54NewFeedback = item.gpt54NewFeedback.data || {};
    const row = {
      mode: item.feedbackMode,
      ragMode: item.ragMode,
      retrievedChunkCount: item.retrievedChunkCount,
      exerciseName: item.exerciseName,
      qualityBucket: item.qualityBucket,
      sourceScoreAverage: scoreText(item.sourceScoreAverage),
      studentName: item.studentName,
      attemptNumber: item.attemptNumber,
      submissionPreview: item.submission.slice(0, 500),
      originalApproachByGpt4oMini: formatFeedbackCell(original, ORIGINAL_MODEL),
      generatedByGpt54Mini: formatFeedbackCell(gpt54, GPT54_MODEL),
      generatedByNewPromptDesignGpt4oMini: formatFeedbackCell(newPrompt, NEW_PROMPT_MODEL),
      "GPT5.4withnewfeedback": formatFeedbackCell(gpt54NewFeedback, GPT54_MODEL),
      originalError: item.original.error,
      gpt54Error: item.gpt54.error,
      newPromptError: item.newPrompt.error,
      gpt54NewFeedbackError: item.gpt54NewFeedback.error,
    };
    lines.push(columns.map((column) => csvEscape(row[column])).join(","));
  }
  return lines.join("\n");
}

function buildTokenUsage(results) {
  const columns = [
    "taskId",
    "exerciseName",
    "mode",
    "ragMode",
    "approach",
    "model",
    "rows",
    "promptTokens",
    "completionTokens",
    "totalTokens",
    "processingTimeMs",
  ];
  const groups = new Map();
  function add(item, approach, model, result) {
    const key = [item.taskId, item.exerciseName, item.feedbackMode, item.ragMode, approach, model].join("||");
    if (!groups.has(key)) {
      groups.set(key, {
        taskId: item.taskId,
        exerciseName: item.exerciseName,
        mode: item.feedbackMode,
        ragMode: item.ragMode,
        approach,
        model,
        rows: 0,
        promptTokens: 0,
        completionTokens: 0,
        totalTokens: 0,
        processingTimeMs: 0,
      });
    }
    const row = groups.get(key);
    row.rows += 1;
    row.promptTokens += Number(usageValue(result.usage, "prompt") || 0);
    row.completionTokens += Number(usageValue(result.usage, "completion") || 0);
    row.totalTokens += Number(usageValue(result.usage, "total") || 0);
    row.processingTimeMs += Number(result.processingTime || 0);
  }

  for (const item of results) {
    add(item, "original approach", ORIGINAL_MODEL, item.original);
    add(item, "same original prompt with gpt-5.4-mini", GPT54_MODEL, item.gpt54);
    add(item, "new prompt design", NEW_PROMPT_MODEL, item.newPrompt);
    add(item, "new prompt design with gpt-5.4-mini", GPT54_MODEL, item.gpt54NewFeedback);
  }

  return [
    columns.map(csvEscape).join(","),
    ...Array.from(groups.values()).map((row) => columns.map((column) => csvEscape(row[column])).join(",")),
  ].join("\n");
}

function average(values) {
  const numeric = values.map(Number).filter((value) => Number.isFinite(value));
  if (numeric.length === 0) return "";
  return numeric.reduce((sum, value) => sum + value, 0) / numeric.length;
}

function buildAnalysis(results) {
  const approaches = [
    { key: "original", label: `Original + ${ORIGINAL_MODEL}` },
    { key: "gpt54", label: `Original + ${GPT54_MODEL}` },
    { key: "newPrompt", label: `Modified prompt + ${NEW_PROMPT_MODEL}` },
    { key: "gpt54NewFeedback", label: "GPT5.4withnewfeedback" },
  ];
  const baseColumns = ["studentName", "submissionId", "attemptNumber", "qualityBucket", "retrievedChunkCount", "InnSpillScore"];
  const approachFields = ["TaskScore", "FeedbackScore", "Total token", "Processing Time"];
  const columns = [...baseColumns, ...approaches.flatMap(() => approachFields)];
  const totalColumnCount = columns.length;

  const groupKeys = Array.from(
    new Set(results.map((item) => [item.taskId, item.exerciseName, item.feedbackMode, item.ragMode].join("||"))),
  );
  const lines = [];

  for (const groupKey of groupKeys) {
    const [taskId, exerciseName, feedbackMode, ragMode] = groupKey.split("||");
    const rows = results.filter(
      (item) =>
        item.taskId === taskId &&
        item.exerciseName === exerciseName &&
        item.feedbackMode === feedbackMode &&
        item.ragMode === ragMode,
    );

    const titleRow = Array(totalColumnCount).fill("");
    titleRow[0] = exerciseName || taskId;
    titleRow[6] = `Mode: ${feedbackMode}`;
    titleRow[8] = `RAG: ${ragMode}`;
    lines.push(titleRow.map(csvEscape).join(","));

    const approachRow = [...baseColumns];
    for (const approach of approaches) {
      approachRow.push(approach.label, "", "", "");
    }
    lines.push(approachRow.map(csvEscape).join(","));
    lines.push(columns.map(csvEscape).join(","));

    for (const item of rows) {
      const row = {
        studentName: item.studentName,
        submissionId: item.submissionId,
        attemptNumber: item.attemptNumber,
        qualityBucket: item.qualityBucket,
        retrievedChunkCount: item.retrievedChunkCount,
        InnSpillScore: scoreText(item.sourceScoreAverage),
      };
      for (const approach of approaches) {
        const result = item[approach.key] || {};
        row[`${approach.label} TaskScore`] = "";
        row[`${approach.label} FeedbackScore`] = "";
        row[`${approach.label} Total token`] = usageValue(result.usage, "total");
        row[`${approach.label} Processing Time`] = result.processingTime || "";
      }
      const dataRow = [
        ...baseColumns.map((column) => row[column]),
        ...approaches.flatMap((approach) => [
          row[`${approach.label} TaskScore`],
          row[`${approach.label} FeedbackScore`],
          row[`${approach.label} Total token`],
          row[`${approach.label} Processing Time`],
        ]),
      ];
      lines.push(dataRow.map(csvEscape).join(","));
    }

    const averageRow = {
      studentName: "Average",
      submissionId: "",
      attemptNumber: "",
      qualityBucket: "",
      retrievedChunkCount: average(rows.map((item) => item.retrievedChunkCount)),
      InnSpillScore: average(rows.map((item) => item.sourceScoreAverage)),
    };
    for (const approach of approaches) {
      averageRow[`${approach.label} TaskScore`] = "";
      averageRow[`${approach.label} FeedbackScore`] = "";
      averageRow[`${approach.label} Total token`] = average(rows.map((item) => usageValue(item[approach.key]?.usage, "total")));
      averageRow[`${approach.label} Processing Time`] = average(rows.map((item) => item[approach.key]?.processingTime));
    }
    const averageDataRow = [
      ...baseColumns.map((column) => averageRow[column]),
      ...approaches.flatMap((approach) => [
        averageRow[`${approach.label} TaskScore`],
        averageRow[`${approach.label} FeedbackScore`],
        averageRow[`${approach.label} Total token`],
        averageRow[`${approach.label} Processing Time`],
      ]),
    ];
    lines.push(averageDataRow.map(csvEscape).join(","));
    lines.push("");
  }

  return lines.join("\n");
}

async function main() {
  if (!process.env.OPENAI_API_KEY) throw new Error("OPENAI_API_KEY is not set");
  const unsupportedFeedbackModes = FEEDBACK_MODES.filter((mode) => !SUPPORTED_FEEDBACK_MODES.has(mode));
  if (unsupportedFeedbackModes.length > 0) {
    throw new Error(`Unsupported FEEDBACK_MODES: ${unsupportedFeedbackModes.join(", ")}. Supported modes: ${Array.from(SUPPORTED_FEEDBACK_MODES).join(", ")}`);
  }
  fs.mkdirSync(OUTPUT_DIR, { recursive: true });

  const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  const originalGpt4Agent = new OriginalFeedbackGenerationAgent(createModelClient(openai, ORIGINAL_MODEL));
  const originalGpt54Agent = new OriginalFeedbackGenerationAgent(createModelClient(openai, GPT54_MODEL));
  const newPromptGpt4Agent = new FeedbackGenerationAgent(createModelClient(openai, NEW_PROMPT_MODEL));
  const newPromptGpt54Agent = new FeedbackGenerationAgent(createModelClient(openai, GPT54_MODEL));
  const ragService = new RagService(openai);
  const random = makeSeededRandom(RANDOM_SEED);

  console.log(`[random-feedback] Fetching ${TASK_IDS.length} exercises from ${BASE_URL}`);
  console.log(`[random-feedback] Feedback modes: ${FEEDBACK_MODES.join(", ")}`);
  console.log(`[random-feedback] RAG modes: ${RAG_MODES.join(", ")}`);
  if (RAG_LEARN_TO_MARKDOWN) {
    console.log(`[random-feedback] RAG markdown learning enabled: ${RAG_MEMORY_OUTPUT}`);
    console.log(`[random-feedback] RAG markdown learning pending file: ${RAG_MEMORY_PENDING_OUTPUT}`);
    console.log(`[random-feedback] RAG markdown learning approaches: ${RAG_MEMORY_APPROACHES.join(", ")}`);
  }
  const [taskMap, taskEntries] = await Promise.all([getTaskMap(TASK_IDS), getSubmissionsByTask(TASK_IDS)]);

  const projectCache = new Map();
  const sampledRows = [];
  for (const taskEntry of taskEntries) {
    const taskId = taskEntry.taskId;
    const task = taskMap[taskId] || null;
    const unsupportedAttachments = unsupportedAttachmentNames({ ...taskEntry, task });
    if (unsupportedAttachments.length > 0) {
      console.warn(
        `[random-feedback] ${taskId}: skipped because it contains unsupported attachment types. Only .docx and .pdf are allowed. Files: ${unsupportedAttachments.join(", ")}`,
      );
      continue;
    }
    const samples = selectSamples(taskEntry, random);
    if (samples.length === 0) {
      console.warn(`[random-feedback] ${taskId}: no eligible submissions after filtering; trying the next task`);
      continue;
    }
    if (task?.projectId && !projectCache.has(task.projectId)) {
      projectCache.set(task.projectId, await getProject(task.projectId));
    }
    const project = task?.projectId ? projectCache.get(task.projectId) : null;
    for (const sample of samples) {
      sampledRows.push({
        taskId,
        task,
        project,
        submission: sample.submission,
        qualityBucket: sample.qualityBucket,
      });
    }
    console.log(`[random-feedback] ${taskId}: sampled ${samples.length} (${samples.filter((s) => s.qualityBucket === "good").length} good, ${samples.filter((s) => s.qualityBucket === "bad").length} bad)`);
  }

  console.log(`[random-feedback] Total sampled submissions: ${sampledRows.length}`);
  if (sampledRows.length === 0) {
    throw new Error("No eligible submissions were sampled. Add more TASK_IDS or check that candidate tasks only use .docx/.pdf attachments.");
  }
  const results = [];
  for (let i = 0; i < sampledRows.length; i++) {
    const row = sampledRows[i];
    const taskRows = sampledRows.filter((item) => item.taskId === row.taskId);
    for (let j = 0; j < FEEDBACK_MODES.length; j++) {
      const feedbackMode = FEEDBACK_MODES[j];
      const submissionId = normalizeId(row.submission);
      const baseRequest = await buildRequest(row.task, row.project, row, feedbackMode, taskRows);
      for (let k = 0; k < RAG_MODES.length; k++) {
        const ragMode = RAG_MODES[k];
        console.log(`[random-feedback] ${i + 1}/${sampledRows.length} mode ${j + 1}/${FEEDBACK_MODES.length} ${feedbackMode} rag ${k + 1}/${RAG_MODES.length} ${ragMode} ${row.taskId} ${submissionId}`);
        const { request, rag } = await applyRagMode(ragService, baseRequest, ragMode);

        const item = {
          taskId: row.taskId,
          exerciseName: row.task?.taskTitle || row.task?.keyword || row.task?.description || "",
          feedbackMode,
          ragMode,
          retrievedChunkCount: rag.chunks.length,
          ragDebug: rag.debug,
          ragSources: rag.chunks.map((chunk) => ({
            id: chunk.id,
            score: chunk.score,
            documentTitle: chunk.documentTitle,
            sectionTitle: chunk.sectionTitle,
            sourceUrl: chunk.sourceUrl,
            sourceType: chunk.sourceType,
            intendedUse: chunk.intendedUse,
            sourcePath: chunk.sourcePath,
          })),
          qualityBucket: row.qualityBucket,
          sourceScoreAverage: row.submission._scoreValue,
          submissionId,
          studentName: row.submission.studentName || (row.submission.studentNames || []).join(", "),
          attemptNumber: row.submission.attemptNumber || "",
          submission: row.submission.submission || "",
          taskOutcome: row.task?.outcome || "",
          taskInstruction: row.task?.instruction || "",
          taskEvaluationCriteria: row.task?.evaluationCriteria || "",
          original: await runAgent(originalGpt4Agent, request),
          gpt54: await runAgent(originalGpt54Agent, request),
          newPrompt: await runAgent(newPromptGpt4Agent, request),
          gpt54NewFeedback: await runAgent(newPromptGpt54Agent, request),
        };
        results.push(item);
        appendRagMemoryForItem(item);
        fs.writeFileSync(`${OUTPUT_PREFIX}-table1.csv`, buildTable1(results));
        fs.writeFileSync(`${OUTPUT_PREFIX}-token-usage.csv`, buildTokenUsage(results));
        fs.writeFileSync(`${OUTPUT_PREFIX}-analysis.csv`, buildAnalysis(results));
        fs.writeFileSync(`${OUTPUT_PREFIX}-rag-debug.json`, JSON.stringify(results.map((item) => ({
          taskId: item.taskId,
          exerciseName: item.exerciseName,
          feedbackMode: item.feedbackMode,
          ragMode: item.ragMode,
          submissionId: item.submissionId,
          retrievedChunkCount: item.retrievedChunkCount,
          ragDebug: item.ragDebug,
          ragSources: item.ragSources,
        })), null, 2));
      }
    }
  }

  const memoryResult = finalizeRagMemory();
  if (memoryResult.enabled) {
    console.log(`[random-feedback] Wrote ${memoryResult.written} markdown memory entries to ${memoryResult.output}`);
    console.log(`[random-feedback] Pending markdown memory entries written during run: ${pendingMemoryWritten}`);
    if (memoryResult.skipped || pendingMemorySkipped) {
      console.log(`[random-feedback] Skipped ${memoryResult.skipped + pendingMemorySkipped} markdown memory entries`);
    }
  }

  console.log(`[random-feedback] Wrote ${OUTPUT_PREFIX}-table1.csv`);
  console.log(`[random-feedback] Wrote ${OUTPUT_PREFIX}-token-usage.csv`);
  console.log(`[random-feedback] Wrote ${OUTPUT_PREFIX}-analysis.csv`);
  console.log(`[random-feedback] Wrote ${OUTPUT_PREFIX}-rag-debug.json`);
}

process.on("SIGINT", () => {
  const memoryResult = finalizeRagMemory();
  if (memoryResult.enabled) {
    console.error(`[random-feedback] Interrupted; flushed ${memoryResult.written} markdown memory entries to ${memoryResult.output || RAG_MEMORY_OUTPUT}`);
  }
  process.exit(130);
});

main().catch((error) => {
  const memoryResult = finalizeRagMemory();
  if (memoryResult.enabled) {
    console.error(`[random-feedback] Error path flushed ${memoryResult.written} markdown memory entries to ${memoryResult.output || RAG_MEMORY_OUTPUT}`);
  }
  console.error(`[random-feedback] ${error.stack || error.message}`);
  process.exit(1);
});
