#!/usr/bin/env node

require("dotenv").config();
const fs = require("fs");
const path = require("path");
const OpenAI = require("openai");
const FeedbackWorkflow = require("../src/agents/FeedbackWorkflow");

const DEFAULT_TASK_ID = "692f70c283e3e66ef577e9e3";
const DEFAULT_GROUP_IDS = [
  "695fa2dc12b3f3d3a93d7d22",
  "69677f26c31069d28beda528",
  "69677f8ec31069d28beda53b",
  "69678260c31069d28beda64a",
  "6967855b951308ea2d49a774",
  "696786e7951308ea2d49a79d",
  "69678ef2adf1c2f8cc847fd4",
  "6967ed0e79b754e0cf644b43",
  "6967ed6d79b754e0cf644b70",
  "6967ede379b754e0cf644b9d",
  "697085b8662748b1fb3cbe62",
  "69708636662748b1fb3cbe97",
  "69711e1f0436ccdd89542592",
  "69711f3a0436ccdd895426be",
  "697121cb0436ccdd8954290d",
  "699609a1880c79efd5a8907b",
];
const DEFAULT_FEEDBACK_MODES = ["general"];
const DEFAULT_RULE_BASED_INSTRUCTION =
  "Evaluate strictly against the provided task evaluation criteria. Ground feedback in concrete evidence from the submission, keep the same language as the student, and provide actionable feedforward.";

const BASE_URL = process.env.BASE_URL || "http://localhost:3000";
const TASK_ID = process.env.TASK_ID || DEFAULT_TASK_ID;
const AUTH_COOKIE = process.env.AUTH_COOKIE || "";
const GROUP_IDS = (
  process.env.GROUP_IDS !== undefined
    ? process.env.GROUP_IDS
    : TASK_ID === DEFAULT_TASK_ID
      ? DEFAULT_GROUP_IDS.join(",")
      : ""
)
  .split(",")
  .map((id) => id.trim())
  .filter(Boolean);
const MAX_GROUPS = Number.parseInt(process.env.MAX_GROUPS || "0", 10);
const FEEDBACK_MODES = (process.env.FEEDBACK_MODES || DEFAULT_FEEDBACK_MODES.join(","))
  .split(",")
  .map((mode) => mode.trim())
  .filter(Boolean);
const RULE_BASED_INSTRUCTION =
  process.env.RULE_BASED_INSTRUCTION || DEFAULT_RULE_BASED_INSTRUCTION;
const OUTPUT_DIR = process.env.OUTPUT_DIR || path.join(process.cwd(), "tmp");
const OUTPUT_FILE =
  process.env.OUTPUT_FILE ||
  path.join(OUTPUT_DIR, `feedback-group-comparison-${new Date().toISOString().replace(/[:.]/g, "-")}.csv`);

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
    const cleaned = text.replace(/```json\n?/g, "").replace(/```\n?/g, "").trim();
    return JSON.parse(cleaned);
  } catch (error) {
    return fallback;
  }
}

function latestAnswer(answers) {
  if (!Array.isArray(answers) || answers.length === 0) return null;
  return answers[answers.length - 1]?.answer || null;
}

function latestFeedback(history) {
  if (!Array.isArray(history) || history.length === 0) return null;
  return history[history.length - 1]?.feedback || null;
}

function latestFeedbackEntry(history) {
  if (!Array.isArray(history) || history.length === 0) return null;
  return history[history.length - 1] || null;
}

function score(value) {
  return value === null || value === undefined ? "" : String(value);
}

async function getJson(url) {
  const response = await fetch(url, { headers });
  const text = await response.text();
  const json = parseJson(text, null);
  if (!json) throw new Error(`Non-JSON response from ${url}: ${text.slice(0, 500)}`);
  if (!response.ok || json.success === false) {
    throw new Error(`Request failed ${response.status} ${url}: ${JSON.stringify(json).slice(0, 1000)}`);
  }
  return json;
}

async function getTask(taskId) {
  const json = await getJson(`${BASE_URL}/api/v1/assessment-tasks/${taskId}`);
  return json.data;
}

async function getProject(projectId) {
  if (!projectId) return null;
  const json = await getJson(`${BASE_URL}/api/v1/projects/${projectId}`);
  return json.data;
}

async function getGroups(taskId) {
  const json = await getJson(`${BASE_URL}/api/v1/assessment-submissions/task/${taskId}/grouped?viewType=group`);
  const groups = json.data || [];
  const wanted = new Set(GROUP_IDS);
  const filtered = GROUP_IDS.length > 0
    ? groups.filter((group) => wanted.has(group.groupId))
    : groups;
  return MAX_GROUPS > 0 ? filtered.slice(0, MAX_GROUPS) : filtered;
}

function buildFewShotPrompt(groups, currentGroupId) {
  const examples = groups
    .filter((group) => group.groupId !== currentGroupId)
    .map((group) => {
      const entry = latestFeedbackEntry(group.feedbackHistory);
      if (!entry || !entry.feedback) return null;
      return {
        groupName: group.groupName,
        feedback: entry.feedback,
        feedforward: entry.feedforward || "",
        taskQualityScore: entry.taskQualityScore,
        reflectionScore: entry.reflectionScore,
        criticalthinkingScore: entry.criticalthinkingScore,
        conceptMasteryScore: entry.conceptMasteryScore,
      };
    })
    .filter(Boolean)
    .slice(0, 5);

  if (examples.length === 0) return "";

  return examples
    .map((example, index) => {
      const scores = [
        `taskQualityScore=${score(example.taskQualityScore)}`,
        `reflectionScore=${score(example.reflectionScore)}`,
        `criticalthinkingScore=${score(example.criticalthinkingScore)}`,
        `conceptMasteryScore=${score(example.conceptMasteryScore)}`,
      ].join(", ");
      return [
        `Example ${index + 1} (${example.groupName})`,
        `Scores: ${scores}`,
        `Feedback: ${example.feedback}`,
        `Feedforward: ${example.feedforward}`,
      ].join("\n");
    })
    .join("\n\n");
}

function buildRequest(task, project, group, feedbackMode, fewShotPrompt) {
  return {
    feedbackMode,
    submission: group.submission || "",
    submissionAnswer: latestAnswer(group.submissionQuestionAnswers),
    feedbackReceivedAnswer: latestAnswer(group.feedbackReceivedQuestionAnswers),
    previousSubmission: null,
    previousFeedback: latestFeedback(group.feedbackHistory),
    submissionHistory: group.feedbackHistory || [],
    evaluationCriteria: task.evaluationCriteria || "",
    learningObjectives: project?.learningOutcome || "",
    persona: null,
    attachments: [],
    attachmentContent: "",
    conversationLog: group.conversationLog || "",
    id: task.id || task._id || TASK_ID,
    projectId: task.projectId || null,
    taskTitle: task.taskTitle || task.keyword || task.description || "",
    description: task.description || "",
    taskOutcome: task.outcome || "",
    taskInstruction: task.instruction || "",
    keyword: task.keyword || "",
    submissionDeadline: task.submissionDeadline || "",
    enabledAIGuideline: false,
    submissionQuestion: task.submissionQuestion || null,
    feedbackReceivedQuestion: task.feedbackReceivedQuestion || null,
    fewShotPrompt: feedbackMode === "fewshot" ? fewShotPrompt : "",
    isLearnFromHuman: feedbackMode === "fewshot",
    skillId: null,
    instruction: feedbackMode === "rule-based" ? RULE_BASED_INSTRUCTION : null,
  };
}

async function runAgent(agent, request) {
  const started = Date.now();
  const response = await agent.process(request);
  const processingTime = Date.now() - started;
  if (!response.success) {
    return {
      success: false,
      error: response.error || "Unknown agent error",
      data: {},
      raw: response.response || "",
      usage: response.usage || null,
      workflow: response.workflow || null,
      processingTime,
    };
  }

  return {
    success: true,
    error: "",
    data: parseJson(response.response, {
      feedback: response.response || "",
      feedforward: "",
      concept: "",
      reflection: "",
      criticalThinking: "",
      taskQualityScore: null,
      reflectionScore: null,
      criticalthinkingScore: null,
      conceptMasteryScore: null,
    }),
    raw: response.response || "",
    usage: response.usage || response.usageInternal || null,
    workflow: response.workflow || null,
    processingTime,
  };
}

function getDbOriginalFeedback(group) {
  const entry = latestFeedbackEntry(group.feedbackHistory);
  if (!entry) {
    return {
      success: false,
      error: "No feedbackHistory entry found in DB",
      data: {},
      raw: "",
      usage: null,
      workflow: null,
      processingTime: 0,
    };
  }

  return {
    success: true,
    error: "",
    data: {
      feedback: entry.feedback || "",
      feedforward: entry.feedforward || "",
      concept: entry.concept || "",
      reflection: entry.reflection || "",
      criticalThinking: entry.criticalThinking || "",
      taskQualityScore: entry.taskQualityScore,
      reflectionScore: entry.reflectionScore,
      criticalthinkingScore: entry.criticalthinkingScore,
      conceptMasteryScore: entry.conceptMasteryScore,
    },
    raw: JSON.stringify(entry),
    usage: null,
    workflow: null,
    processingTime: 0,
  };
}

function extractInitialFeedback(workflow) {
  const initial = parseJson(workflow?.initialResponse, null);
  if (initial && typeof initial === "object") return initial.feedback || "";
  return workflow?.initialResponse || "";
}

function usageValue(usage, key) {
  if (!usage) return "";
  if (key === "prompt") return usage.prompt_tokens || usage.promptTokens || 0;
  if (key === "completion") return usage.completion_tokens || usage.completionTokens || 0;
  if (key === "total") return usage.total_tokens || usage.totalTokens || 0;
  return "";
}

function buildCsv(results, task, project) {
  const columns = [
    "taskId",
    "feedbackMode",
    "exerciseName",
    "groupId",
    "groupName",
    "studentNames",
    "attemptNumber",
    "existingTaskQualityScore",
    "existingReflectionScore",
    "existingCriticalThinkingScore",
    "existingConceptMasteryScore",
    "originalTaskQualityScore",
    "newTaskQualityScore",
    "originalReflectionScore",
    "newReflectionScore",
    "originalCriticalThinkingScore",
    "newCriticalThinkingScore",
    "originalConceptMasteryScore",
    "newConceptMasteryScore",
    "originalFeedback",
    "newFinalFeedback",
    "originalFeedforward",
    "newFeedforward",
    "newWorkflowQuality",
    "newWorkflowIssues",
    "revisionInstructions",
    "newInitialFeedbackBeforeRevision",
    "workflowEvaluated",
    "workflowRevised",
    "workflowRevisionPasses",
    "workflowPromptTokens",
    "workflowCompletionTokens",
    "workflowTotalTokens",
    "workflowProcessingTimeMs",
    "originalConcept",
    "newConcept",
    "originalReflection",
    "newReflection",
    "originalCriticalThinking",
    "newCriticalThinking",
    "taskOutcome",
    "taskInstruction",
    "taskEvaluationCriteria",
    "projectLearningOutcome",
    "submissionPreview",
    "submission",
    "originalError",
    "newWorkflowError",
  ];

  const lines = [columns.map(csvEscape).join(",")];

  for (const result of results) {
    const original = result.original.data || {};
    const workflow = result.workflow.data || {};
    const review = result.workflow.workflow?.review || {};
    const row = {
      taskId: task.id || TASK_ID,
      feedbackMode: result.feedbackMode,
      exerciseName: task.taskTitle || task.keyword || task.description || "",
      groupId: result.group.groupId,
      groupName: result.group.groupName,
      studentNames: (result.group.studentNames || []).join(", "),
      attemptNumber: result.group.attemptNumber,
      existingTaskQualityScore: score(result.group.taskQualityScore),
      existingReflectionScore: score(result.group.reflectionScore),
      existingCriticalThinkingScore: score(result.group.criticalthinkingScore),
      existingConceptMasteryScore: score(result.group.conceptMasteryScore),
      originalTaskQualityScore: score(original.taskQualityScore),
      newTaskQualityScore: score(workflow.taskQualityScore),
      originalReflectionScore: score(original.reflectionScore),
      newReflectionScore: score(workflow.reflectionScore),
      originalCriticalThinkingScore: score(original.criticalthinkingScore),
      newCriticalThinkingScore: score(workflow.criticalthinkingScore),
      originalConceptMasteryScore: score(original.conceptMasteryScore),
      newConceptMasteryScore: score(workflow.conceptMasteryScore),
      originalFeedback: original.feedback || "",
      newFinalFeedback: workflow.feedback || "",
      originalFeedforward: original.feedforward || "",
      newFeedforward: workflow.feedforward || "",
      newWorkflowQuality: score(review.overallQualityScore),
      newWorkflowIssues: Array.isArray(review.issues) ? review.issues.join("\n") : "",
      revisionInstructions: result.workflow.workflow?.revisionInstructions || review.revisionInstructions || "",
      newInitialFeedbackBeforeRevision: extractInitialFeedback(result.workflow.workflow),
      workflowEvaluated: result.workflow.workflow?.evaluated || false,
      workflowRevised: result.workflow.workflow?.revised || false,
      workflowRevisionPasses: result.workflow.workflow?.revisionPasses || 0,
      workflowPromptTokens: usageValue(result.workflow.usage, "prompt"),
      workflowCompletionTokens: usageValue(result.workflow.usage, "completion"),
      workflowTotalTokens: usageValue(result.workflow.usage, "total"),
      workflowProcessingTimeMs: result.workflow.processingTime,
      originalConcept: original.concept || "",
      newConcept: workflow.concept || "",
      originalReflection: original.reflection || "",
      newReflection: workflow.reflection || "",
      originalCriticalThinking: original.criticalThinking || "",
      newCriticalThinking: workflow.criticalThinking || "",
      taskOutcome: task.outcome || "",
      taskInstruction: task.instruction || "",
      taskEvaluationCriteria: task.evaluationCriteria || "",
      projectLearningOutcome: project?.learningOutcome || "",
      submissionPreview: (result.group.submission || "").slice(0, 500),
      submission: result.group.submission || "",
      originalError: result.original.error || "",
      newWorkflowError: result.workflow.error || "",
    };

    lines.push(columns.map((column) => csvEscape(row[column])).join(","));
  }

  lines.push("");
  lines.push(csvEscape("Method explanation"));
  lines.push(csvEscape("This sheet compares the feedback already stored in the database with the new workflow generator on grouped submissions. The grouped submission text is used as the student work, while the task name, outcome, instruction, evaluation criteria, and project learning outcome are included as context for the new workflow."));
  lines.push(csvEscape("The new workflow first generates initial feedback, then an evaluator agent checks evidence grounding, rubric alignment, score consistency, language consistency, and overall quality. If the evaluator finds material weaknesses, it emits revisionInstructions. A revision agent then rewrites the initial feedback using those instructions, producing newFinalFeedback."));
  lines.push(csvEscape("revisionInstructions is therefore not the final feedback. It is a private control signal between evaluator and revision agent. In this table it is included as supporting evidence so you can see why the final workflow feedback changed from newInitialFeedbackBeforeRevision to newFinalFeedback."));

  return lines.join("\n");
}

async function main() {
  if (!process.env.OPENAI_API_KEY) {
    throw new Error("OPENAI_API_KEY is not set");
  }

  fs.mkdirSync(OUTPUT_DIR, { recursive: true });

  const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  const workflowAgent = new FeedbackWorkflow(openai);

  console.log(`[compare-group-feedback] Fetching task ${TASK_ID}`);
  const task = await getTask(TASK_ID);
  const project = await getProject(task.projectId);
  const groups = await getGroups(TASK_ID);
  console.log(`[compare-group-feedback] Found ${groups.length} matching groups`);
  console.log(`[compare-group-feedback] Feedback modes: ${FEEDBACK_MODES.join(", ")}`);

  const results = [];
  for (let i = 0; i < groups.length; i++) {
    const group = groups[i];
    for (let j = 0; j < FEEDBACK_MODES.length; j++) {
      const feedbackMode = FEEDBACK_MODES[j];
      console.log(
        `[compare-group-feedback] group ${i + 1}/${groups.length} mode ${j + 1}/${FEEDBACK_MODES.length} ${feedbackMode} ${group.groupName} ${group.groupId}`,
      );
      const request = buildRequest(task, project, group, feedbackMode, buildFewShotPrompt(groups, group.groupId));
      const result = {
        feedbackMode,
        group,
        original: getDbOriginalFeedback(group),
        workflow: await runAgent(workflowAgent, request),
      };
      results.push(result);
      fs.writeFileSync(OUTPUT_FILE, buildCsv(results, task, project));
    }
  }

  console.log(`[compare-group-feedback] Wrote ${OUTPUT_FILE}`);
}

main().catch((error) => {
  console.error(`[compare-group-feedback] ${error.stack || error.message}`);
  process.exit(1);
});
