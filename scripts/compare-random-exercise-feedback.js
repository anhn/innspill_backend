#!/usr/bin/env node

require("dotenv").config();
const fs = require("fs");
const path = require("path");
const OpenAI = require("openai");
const OriginalFeedbackGenerationAgent = require("../src/agents/OriginalFeedbackGenerationAgent");
const FeedbackGenerationAgent = require("../src/agents/FeedbackGenerationAgent");

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
const FEEDBACK_MODES = (process.env.FEEDBACK_MODES || "general,fewshot,rule-based,revision,framework,student-involving")
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
const RULE_BASED_INSTRUCTION =
  process.env.RULE_BASED_INSTRUCTION ||
  "Evaluate strictly against the provided task evaluation criteria. Ground feedback in concrete evidence from the submission, keep the same language as the student, and provide actionable feedforward.";

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

async function fetchAttachmentContentFromUrl(filename) {
  const cleaned = String(filename || "").split("/").pop();
  if (!cleaned) return "";
  const url = `${PUBLIC_FILE_BASE_URL}/${encodeURIComponent(cleaned)}`;
  const response = await fetch(url, { headers: { Accept: "*/*" } });
  if (!response.ok) throw new Error(`file fetch failed ${response.status} ${url}`);
  return response.text();
}

async function buildAttachmentContent(submission) {
  if (!INCLUDE_ATTACHMENTS) return "";
  const attachmentNames = [
    ...(Array.isArray(submission.attachments) ? submission.attachments : []),
    ...(Array.isArray(submission.files) ? submission.files : []),
    ...(Array.isArray(submission.fileAttachments) ? submission.fileAttachments : []),
  ].map((item) => (typeof item === "string" ? item : item.fileId || item.filename || item.fileName || item.name));

  const chunks = [];
  for (const filename of attachmentNames.filter(Boolean)) {
    try {
      const localPath = path.join(process.cwd(), "uploads", "assessment", path.basename(filename));
      if (fs.existsSync(localPath)) {
        chunks.push(fs.readFileSync(localPath, "utf8"));
      } else {
        chunks.push(await fetchAttachmentContentFromUrl(filename));
      }
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

function buildTable1(results) {
  const columns = [
    "mode",
    "exerciseName",
    "qualityBucket",
    "sourceScoreAverage",
    "studentName",
    "attemptNumber",
    "submissionPreview",
    "originalApproachByGpt4oMini",
    "generatedByGpt54Mini",
    "generatedByNewPromptDesignGpt4oMini",
    "originalError",
    "gpt54Error",
    "newPromptError",
  ];

  const lines = [columns.map(csvEscape).join(",")];
  for (const item of results) {
    const original = item.original.data || {};
    const gpt54 = item.gpt54.data || {};
    const newPrompt = item.newPrompt.data || {};
    const row = {
      mode: item.feedbackMode,
      exerciseName: item.exerciseName,
      qualityBucket: item.qualityBucket,
      sourceScoreAverage: scoreText(item.sourceScoreAverage),
      studentName: item.studentName,
      attemptNumber: item.attemptNumber,
      submissionPreview: item.submission.slice(0, 500),
      originalApproachByGpt4oMini: formatFeedbackCell(original, ORIGINAL_MODEL),
      generatedByGpt54Mini: formatFeedbackCell(gpt54, GPT54_MODEL),
      generatedByNewPromptDesignGpt4oMini: formatFeedbackCell(newPrompt, NEW_PROMPT_MODEL),
      originalError: item.original.error,
      gpt54Error: item.gpt54.error,
      newPromptError: item.newPrompt.error,
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
    const key = [item.taskId, item.exerciseName, item.feedbackMode, approach, model].join("||");
    if (!groups.has(key)) {
      groups.set(key, {
        taskId: item.taskId,
        exerciseName: item.exerciseName,
        mode: item.feedbackMode,
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
  }

  return [
    columns.map(csvEscape).join(","),
    ...Array.from(groups.values()).map((row) => columns.map((column) => csvEscape(row[column])).join(",")),
  ].join("\n");
}

async function main() {
  if (!process.env.OPENAI_API_KEY) throw new Error("OPENAI_API_KEY is not set");
  fs.mkdirSync(OUTPUT_DIR, { recursive: true });

  const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  const originalGpt4Agent = new OriginalFeedbackGenerationAgent(createModelClient(openai, ORIGINAL_MODEL));
  const originalGpt54Agent = new OriginalFeedbackGenerationAgent(createModelClient(openai, GPT54_MODEL));
  const newPromptGpt4Agent = new FeedbackGenerationAgent(createModelClient(openai, NEW_PROMPT_MODEL));
  const random = makeSeededRandom(RANDOM_SEED);

  console.log(`[random-feedback] Fetching ${TASK_IDS.length} exercises from ${BASE_URL}`);
  const [taskMap, taskEntries] = await Promise.all([getTaskMap(TASK_IDS), getSubmissionsByTask(TASK_IDS)]);

  const projectCache = new Map();
  const sampledRows = [];
  for (const taskEntry of taskEntries) {
    const taskId = taskEntry.taskId;
    const samples = selectSamples(taskEntry, random);
    const task = taskMap[taskId] || null;
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
  const results = [];
  for (let i = 0; i < sampledRows.length; i++) {
    const row = sampledRows[i];
    const taskRows = sampledRows.filter((item) => item.taskId === row.taskId);
    for (let j = 0; j < FEEDBACK_MODES.length; j++) {
      const feedbackMode = FEEDBACK_MODES[j];
      const submissionId = normalizeId(row.submission);
      console.log(`[random-feedback] ${i + 1}/${sampledRows.length} mode ${j + 1}/${FEEDBACK_MODES.length} ${feedbackMode} ${row.taskId} ${submissionId}`);
      const request = await buildRequest(row.task, row.project, row, feedbackMode, taskRows);

      const item = {
        taskId: row.taskId,
        exerciseName: row.task?.taskTitle || row.task?.keyword || row.task?.description || "",
        feedbackMode,
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
      };
      results.push(item);
      fs.writeFileSync(`${OUTPUT_PREFIX}-table1.csv`, buildTable1(results));
      fs.writeFileSync(`${OUTPUT_PREFIX}-token-usage.csv`, buildTokenUsage(results));
    }
  }

  console.log(`[random-feedback] Wrote ${OUTPUT_PREFIX}-table1.csv`);
  console.log(`[random-feedback] Wrote ${OUTPUT_PREFIX}-token-usage.csv`);
}

main().catch((error) => {
  console.error(`[random-feedback] ${error.stack || error.message}`);
  process.exit(1);
});
