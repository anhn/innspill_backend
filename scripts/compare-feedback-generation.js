#!/usr/bin/env node

require("dotenv").config();
const fs = require("fs");
const path = require("path");

const DEFAULT_TASK_IDS = [
  "698b52a32f06a6488ab454b9",
  "698b52182f06a6488ab454b1",
  "698b503b2f06a6488ab45499",
  "698b4f062f06a6488ab4548a",
  "698b4d732f06a6488ab4544d",
  "69374f1f12ec38df0c7da11c",
  "69374cbd12ec38df0c7da116",
  "6937497212ec38df0c7da110",
  "693429e1a17377612702177a",
  "693425c7a173776127021777",
  "69342478a173776127021774",
  "693422c1a17377612702176e",
  "693004a96d16c54ae923e294",
  "693002a76d16c54ae923e291",
  "692fedbf111c5669dffb1c16",
  "692f76b383e3e66ef577ea09",
  "692f75d383e3e66ef577e9fe",
  "692f744d83e3e66ef577e9f4",
  "692f726883e3e66ef577e9eb",
  "692f70c283e3e66ef577e9e3",
];

const BASE_URL = process.env.BASE_URL || "http://localhost:3000";
const USER_NAME = process.env.USER_NAME || "teacher";
const AUTH_COOKIE = process.env.AUTH_COOKIE || "";
const MAX_SUBMISSIONS = Number.parseInt(process.env.MAX_SUBMISSIONS || "0", 10);
const OUTPUT_DIR = process.env.OUTPUT_DIR || path.join(process.cwd(), "tmp");
const OUTPUT_FILE =
  process.env.OUTPUT_FILE ||
  path.join(OUTPUT_DIR, `feedback-comparison-${new Date().toISOString().replace(/[:.]/g, "-")}.csv`);

const TASK_IDS = process.env.TASK_IDS
  ? process.env.TASK_IDS.split(",").map((id) => id.trim()).filter(Boolean)
  : DEFAULT_TASK_IDS;

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

function parseScore(value) {
  if (value === null || value === undefined) return "";
  return String(value);
}

function summarizeUsage(usage) {
  if (!usage) return "";
  return JSON.stringify(usage);
}

async function postJson(url, body) {
  const response = await fetch(url, {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  });
  const text = await response.text();
  let json = null;
  try {
    json = JSON.parse(text);
  } catch (error) {
    throw new Error(`Non-JSON response from ${url}: ${text.slice(0, 500)}`);
  }

  if (!response.ok || json.success === false) {
    throw new Error(`Request failed ${response.status} ${url}: ${JSON.stringify(json).slice(0, 1000)}`);
  }
  return json;
}

async function getSubmissions() {
  const url = `${BASE_URL}/api/v1/assessment-submissions/batch?userName=${encodeURIComponent(USER_NAME)}`;
  const json = await postJson(url, { taskIds: TASK_IDS });
  const taskMap = await getTaskMap(TASK_IDS);
  const rows = [];

  for (const taskEntry of json.data || []) {
    for (const submission of taskEntry.submissions || []) {
      rows.push({
        taskId: taskEntry.taskId,
        task: taskMap[taskEntry.taskId] || null,
        submission,
      });
    }
  }

  return MAX_SUBMISSIONS > 0 ? rows.slice(0, MAX_SUBMISSIONS) : rows;
}

async function getTaskMap(taskIds) {
  const entries = await Promise.all(
    taskIds.map(async (taskId) => {
      try {
        const url = `${BASE_URL}/api/v1/assessment-tasks/${taskId}?userName=${encodeURIComponent(USER_NAME)}`;
        const response = await fetch(url, { headers });
        const json = await response.json();
        if (!response.ok || json.success === false) return [taskId, null];
        return [taskId, json.data || null];
      } catch (error) {
        return [taskId, null];
      }
    }),
  );

  return Object.fromEntries(entries);
}

async function generateFeedback(submissionId, agentVersion) {
  const url = `${BASE_URL}/api/v1/assessment-submissions/${submissionId}/generate-feedback?userName=${encodeURIComponent(USER_NAME)}`;
  return postJson(url, {
    useAIGuideline: false,
    feedbackMode: "general",
    agentVersion,
    includeWorkflowDebug: agentVersion === "workflow",
  });
}

function buildCsvRows(results) {
  const columns = [
    "taskId",
    "exerciseName",
    "submissionId",
    "studentId",
    "studentName",
    "attemptNumber",
    "submission",
    "submissionPreview",
    "originalSuccess",
    "workflowSuccess",
    "originalTaskQualityScore",
    "workflowTaskQualityScore",
    "originalReflectionScore",
    "workflowReflectionScore",
    "originalCriticalThinkingScore",
    "workflowCriticalThinkingScore",
    "originalConceptMasteryScore",
    "workflowConceptMasteryScore",
    "workflowEvaluated",
    "workflowRevised",
    "workflowRevisionPasses",
    "workflowOverallQualityScore",
    "workflowEvidenceGroundingScore",
    "workflowRubricAlignmentScore",
    "workflowScoreConsistencyScore",
    "workflowLanguageConsistencyScore",
    "workflowIssues",
    "workflowRevisionInstructions",
    "originalFeedback",
    "workflowInitialFeedback",
    "workflowFinalFeedback",
    "originalFeedforward",
    "workflowFeedforward",
    "originalConcept",
    "workflowConcept",
    "originalReflection",
    "workflowReflection",
    "originalCriticalThinking",
    "workflowCriticalThinking",
    "originalUsage",
    "workflowUsage",
    "originalError",
    "workflowError",
  ];

  const lines = [columns.map(csvEscape).join(",")];

  for (const item of results) {
    const original = item.original?.data || {};
    const workflow = item.workflow?.data || {};
    const debug = item.workflow?.workflowDebug || {};
    const review = debug.review || {};

    const row = {
      taskId: item.taskId,
      exerciseName: item.task?.taskTitle || item.task?.keyword || item.task?.description || "",
      submissionId: item.submission.id,
      studentId: item.submission.studentId,
      studentName: item.submission.studentName,
      attemptNumber: item.submission.attemptNumber,
      submission: item.submission.submission || "",
      submissionPreview: (item.submission.submission || "").slice(0, 500),
      originalSuccess: item.originalSuccess,
      workflowSuccess: item.workflowSuccess,
      originalTaskQualityScore: parseScore(original.taskQualityScore),
      workflowTaskQualityScore: parseScore(workflow.taskQualityScore),
      originalReflectionScore: parseScore(original.reflectionScore),
      workflowReflectionScore: parseScore(workflow.reflectionScore),
      originalCriticalThinkingScore: parseScore(original.criticalthinkingScore),
      workflowCriticalThinkingScore: parseScore(workflow.criticalthinkingScore),
      originalConceptMasteryScore: parseScore(original.conceptMasteryScore),
      workflowConceptMasteryScore: parseScore(workflow.conceptMasteryScore),
      workflowEvaluated: debug.evaluated,
      workflowRevised: debug.revised,
      workflowRevisionPasses: debug.revisionPasses,
      workflowOverallQualityScore: parseScore(review.overallQualityScore),
      workflowEvidenceGroundingScore: parseScore(review.evidenceGroundingScore),
      workflowRubricAlignmentScore: parseScore(review.rubricAlignmentScore),
      workflowScoreConsistencyScore: parseScore(review.scoreConsistencyScore),
      workflowLanguageConsistencyScore: parseScore(review.languageConsistencyScore),
      workflowIssues: Array.isArray(review.issues) ? review.issues.join("\n") : "",
      workflowRevisionInstructions: debug.revisionInstructions || review.revisionInstructions || "",
      originalFeedback: original.feedback,
      workflowInitialFeedback: (() => {
        try {
          return JSON.parse(debug.initialResponse || "{}").feedback || "";
        } catch (error) {
          return debug.initialResponse || "";
        }
      })(),
      workflowFinalFeedback: workflow.feedback,
      originalFeedforward: original.feedforward,
      workflowFeedforward: workflow.feedforward,
      originalConcept: original.concept,
      workflowConcept: workflow.concept,
      originalReflection: original.reflection,
      workflowReflection: workflow.reflection,
      originalCriticalThinking: original.criticalThinking,
      workflowCriticalThinking: workflow.criticalThinking,
      originalUsage: summarizeUsage(item.original?.usage || item.original?.usageInternal),
      workflowUsage: summarizeUsage(item.workflow?.usage || item.workflow?.usageInternal),
      originalError: item.originalError,
      workflowError: item.workflowError,
    };

    lines.push(columns.map((column) => csvEscape(row[column])).join(","));
  }

  return lines.join("\n");
}

async function main() {
  fs.mkdirSync(OUTPUT_DIR, { recursive: true });

  console.log(`[compare-feedback] Fetching submissions for ${TASK_IDS.length} tasks from ${BASE_URL}`);
  const submissions = await getSubmissions();
  console.log(`[compare-feedback] Found ${submissions.length} submissions`);

  const results = [];
  for (let i = 0; i < submissions.length; i++) {
    const item = submissions[i];
    const submissionId = item.submission.id;
    console.log(`[compare-feedback] ${i + 1}/${submissions.length} ${submissionId}`);

    const result = {
      taskId: item.taskId,
      task: item.task,
      submission: item.submission,
      originalSuccess: false,
      workflowSuccess: false,
      original: null,
      workflow: null,
      originalError: "",
      workflowError: "",
    };

    try {
      result.original = await generateFeedback(submissionId, "original");
      result.originalSuccess = true;
    } catch (error) {
      result.originalError = error.message;
      console.error(`[compare-feedback] original failed for ${submissionId}: ${error.message}`);
    }

    try {
      result.workflow = await generateFeedback(submissionId, "workflow");
      result.workflowSuccess = true;
    } catch (error) {
      result.workflowError = error.message;
      console.error(`[compare-feedback] workflow failed for ${submissionId}: ${error.message}`);
    }

    results.push(result);
    fs.writeFileSync(OUTPUT_FILE, buildCsvRows(results));
  }

  console.log(`[compare-feedback] Wrote ${OUTPUT_FILE}`);
}

main().catch((error) => {
  console.error(`[compare-feedback] ${error.stack || error.message}`);
  process.exit(1);
});
