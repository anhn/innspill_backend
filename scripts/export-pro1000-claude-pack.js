#!/usr/bin/env node
/**
 * PRO1000 student-group export for external analysis (e.g. Claude).
 *
 * Outputs under scripts/output/pro1000-claude-pack-<timestamp>/:
 *   README.md, 01-login-frequency.csv, 02-interaction-frequency.csv,
 *   03-task-answers.csv, 03-task-answers.md,
 *   04-stakeholder-chats.jsonl, 04-stakeholder-chats.md
 *
 * Usage:
 *   node scripts/export-pro1000-claude-pack.js
 *   node scripts/export-pro1000-claude-pack.js --course-code PRO1000 --group GN02
 *
 * Env: MONGO_URI (required), COURSE_CODE, ACADEMIC_YEAR (optional filters)
 */

require("dotenv").config({ override: true });
const fs = require("fs");
const path = require("path");
const { connectDB, mongoose } = require("../src/config/database");
const Course = require("../src/models/Course");
const Project = require("../src/models/Project");
const StudentGroup = require("../src/models/StudentGroup");
const Task = require("../src/models/Task");
const Role = require("../src/models/Role");
const Submission = require("../src/models/Submission");
const ChatSession = require("../src/models/ChatSession");
const ActionLog = require("../src/models/ActionLog");
const User = require("../src/models/User");

function parseArgs(argv) {
  const out = { courseCode: process.env.COURSE_CODE || "PRO1000", group: null };
  for (let i = 2; i < argv.length; i++) {
    if (argv[i] === "--course-code" && argv[i + 1]) {
      out.courseCode = argv[++i];
    } else if (argv[i] === "--group" && argv[i + 1]) {
      out.group = argv[++i];
    }
  }
  if (process.env.ACADEMIC_YEAR) {
    out.academicYear = process.env.ACADEMIC_YEAR;
  }
  return out;
}

function csvCell(value) {
  if (value == null) return "";
  const s = String(value).replace(/\r\n/g, "\n");
  if (/[",\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

function csvRow(cells) {
  return cells.map(csvCell).join(",") + "\n";
}

function clip(text, max = 12000) {
  if (!text) return "";
  const s = String(text);
  if (s.length <= max) return s;
  return `${s.slice(0, max)}\n\n[… truncated ${s.length - max} chars for export …]`;
}

/** Map any userId seen in logs to canonical group username */
async function buildIdentityMaps(studentUsernames) {
  const canonical = new Map();
  const lookupKeys = new Set(studentUsernames);

  const users = await User.find({
    $or: [
      { username: { $in: [...studentUsernames] } },
      { email: { $in: [...studentUsernames] } },
    ],
  })
    .select("username email _id")
    .lean();

  for (const u of users) {
    const un = u.username;
    lookupKeys.add(un);
    if (u.email) lookupKeys.add(u.email);
    lookupKeys.add(String(u._id));
    canonical.set(un, un);
    if (u.email) canonical.set(u.email.toLowerCase(), un);
    canonical.set(String(u._id), un);
  }

  for (const id of studentUsernames) {
    if (!canonical.has(id)) canonical.set(id, id);
  }

  return { canonical, lookupKeys: [...lookupKeys] };
}

function resolveUsername(raw, canonical) {
  if (!raw) return null;
  const key = String(raw);
  if (canonical.has(key)) return canonical.get(key);
  if (canonical.has(key.toLowerCase())) return canonical.get(key.toLowerCase());
  return null;
}

async function main() {
  const args = parseArgs(process.argv);
  const stamp = Date.now();
  const outDir = path.join(
    __dirname,
    "output",
    `pro1000-claude-pack-${stamp}`,
  );
  fs.mkdirSync(outDir, { recursive: true });

  console.log(`📂 Output directory: ${outDir}`);
  await connectDB();

  const courseQuery = { code: args.courseCode };
  if (args.academicYear) courseQuery.academicYear = args.academicYear;

  const courses = await Course.find(courseQuery).lean();
  if (!courses.length) {
    throw new Error(
      `No course found for code=${args.courseCode}${args.academicYear ? ` year=${args.academicYear}` : ""}`,
    );
  }

  const courseIds = courses.map((c) => c._id);
  const courseById = new Map(courses.map((c) => [String(c._id), c]));

  let groups = await StudentGroup.find({ courseId: { $in: courseIds } })
    .sort({ name: 1 })
    .lean();
  if (args.group) {
    const g = args.group.trim();
    groups = groups.filter(
      (gr) => gr.name === g || gr.name.includes(g),
    );
  }
  if (!groups.length) {
    throw new Error("No student groups matched filters.");
  }

  const allStudents = new Set();
  for (const g of groups) {
    for (const sid of g.studentIds || []) allStudents.add(sid);
  }
  const studentList = [...allStudents];
  const { canonical, lookupKeys } = await buildIdentityMaps(studentList);

  const projects = await Project.find({ courseId: { $in: courseIds } }).lean();
  const projectByCourse = new Map(
    projects.map((p) => [String(p.courseId), p]),
  );
  const projectIds = projects.map((p) => p._id);

  const tasks = await Task.find({ projectId: { $in: projectIds } })
    .select("projectId keyword taskTitle description")
    .lean();
  const taskById = new Map(tasks.map((t) => [String(t._id), t]));
  const taskIds = tasks.map((t) => t._id);

  const roles = await Role.find({ projectId: { $in: projectIds } }).lean();
  const roleById = new Map(roles.map((r) => [String(r._id), r]));

  // --- 01 Login frequency ---
  const loginLogs = await ActionLog.find({
    action: "login",
    userId: { $in: lookupKeys },
  })
    .select("userId timestamp")
    .lean();

  const loginByUser = new Map();
  for (const log of loginLogs) {
    const u = resolveUsername(log.userId, canonical);
    if (!u) continue;
    if (!loginByUser.has(u)) loginByUser.set(u, []);
    loginByUser.get(u).push(new Date(log.timestamp));
  }

  let loginCsv = csvRow([
    "groupName",
    "courseCode",
    "username",
    "loginCount",
    "firstLogin",
    "lastLogin",
    "activeWeeks",
  ]);
  for (const g of groups) {
    const course = courseById.get(String(g.courseId));
    for (const sid of g.studentIds || []) {
      const dates = loginByUser.get(sid) || [];
      dates.sort((a, b) => a - b);
      const weeks = new Set(
        dates.map((d) => {
          const x = new Date(d);
          x.setHours(0, 0, 0, 0);
          x.setDate(x.getDate() - x.getDay());
          return x.toISOString().slice(0, 10);
        }),
      );
      loginCsv += csvRow([
        g.name,
        course?.code || "",
        sid,
        dates.length,
        dates[0]?.toISOString() || "",
        dates[dates.length - 1]?.toISOString() || "",
        weeks.size,
      ]);
    }
  }
  fs.writeFileSync(path.join(outDir, "01-login-frequency.csv"), loginCsv, "utf8");

  // --- 02 Interaction frequency (all logged actions) ---
  const actionLogs = await ActionLog.find({ userId: { $in: lookupKeys } })
    .select("userId action timestamp")
    .lean();

  const interactionByUser = new Map();
  for (const log of actionLogs) {
    const u = resolveUsername(log.userId, canonical);
    if (!u) continue;
    if (!interactionByUser.has(u)) {
      interactionByUser.set(u, { total: 0, byAction: {} });
    }
    const bucket = interactionByUser.get(u);
    bucket.total += 1;
    bucket.byAction[log.action] = (bucket.byAction[log.action] || 0) + 1;
  }

  const actionTypes = [
    ...new Set(actionLogs.map((l) => l.action)),
  ].sort();

  let interactionCsv = csvRow([
    "groupName",
    "courseCode",
    "username",
    "totalActions",
    ...actionTypes,
  ]);
  for (const g of groups) {
    const course = courseById.get(String(g.courseId));
    for (const sid of g.studentIds || []) {
      const stats = interactionByUser.get(sid) || {
        total: 0,
        byAction: {},
      };
      interactionCsv += csvRow([
        g.name,
        course?.code || "",
        sid,
        stats.total,
        ...actionTypes.map((a) => stats.byAction[a] || 0),
      ]);
    }
  }
  fs.writeFileSync(
    path.join(outDir, "02-interaction-frequency.csv"),
    interactionCsv,
    "utf8",
  );

  // --- 03 Task answers ---
  const submissions = await Submission.find({
    taskId: { $in: taskIds },
    studentId: { $in: studentList },
  })
    .sort({ studentId: 1, taskId: 1, attemptNumber: 1, datetime: 1 })
    .lean();

  const groupForStudent = new Map();
  for (const g of groups) {
    for (const sid of g.studentIds || []) {
      if (!groupForStudent.has(sid)) groupForStudent.set(sid, g.name);
    }
  }

  let answersCsv = csvRow([
    "groupName",
    "username",
    "studentName",
    "taskKeyword",
    "taskTitle",
    "attemptNumber",
    "submittedAt",
    "submissionText",
    "reflectionAnswers",
    "feedbackReceivedAnswers",
    "latestFeedbackExcerpt",
    "attachments",
    "stakeholderRoleName",
  ]);

  const mdByGroup = new Map(groups.map((g) => [g.name, []]));

  for (const sub of submissions) {
    const task = taskById.get(String(sub.taskId));
    const groupName = groupForStudent.get(sub.studentId) || "";
    const role = sub.stakeholderId
      ? roleById.get(String(sub.stakeholderId))
      : null;
    const reflection = (sub.submissionQuestionAnswers || [])
      .map((q) => q.answer)
      .join(" | ");
    const feedbackAns = (sub.feedbackReceivedQuestionAnswers || [])
      .map((q) => q.answer)
      .join(" | ");
    const latestFb =
      sub.feedbackHistory?.length > 0
        ? sub.feedbackHistory[sub.feedbackHistory.length - 1].feedback
        : "";

    answersCsv += csvRow([
      groupName,
      sub.studentId,
      sub.studentName,
      task?.keyword || "",
      task?.taskTitle || "",
      sub.attemptNumber ?? 1,
      sub.datetime ? new Date(sub.datetime).toISOString() : "",
      clip(sub.submission, 8000),
      clip(reflection, 2000),
      clip(feedbackAns, 2000),
      clip(latestFb, 1500),
      (sub.attachments || []).join("; "),
      role?.name || "",
    ]);

    const block = [
      `### ${sub.studentId} — ${task?.keyword || sub.taskId} (attempt ${sub.attemptNumber ?? 1})`,
      task?.taskTitle ? `**Task:** ${task.taskTitle}` : "",
      sub.datetime
        ? `**Submitted:** ${new Date(sub.datetime).toISOString()}`
        : "",
      "",
      "**Submission:**",
      clip(sub.submission),
      "",
    ];
    if (reflection) {
      block.push("**Reflection / submission questions:**", reflection, "");
    }
    if (feedbackAns) {
      block.push("**After-feedback questions:**", feedbackAns, "");
    }
    if (latestFb) {
      block.push("**Latest AI/stakeholder feedback (excerpt):**", clip(latestFb), "");
    }
    if (sub.conversationLog) {
      block.push(
        "**In-app conversation log:**",
        clip(sub.conversationLog),
        "",
      );
    }
    if (groupName && mdByGroup.has(groupName)) {
      mdByGroup.get(groupName).push(block.join("\n"));
    }
  }

  const mdParts = [
    "# PRO1000 task submissions (by group)",
    "",
    `Generated: ${new Date().toISOString()}`,
    "",
  ];
  for (const g of groups) {
    const course = courseById.get(String(g.courseId));
    mdParts.push(`## Group: ${g.name}`, "");
    mdParts.push(
      `Course: ${course?.name || ""} (${course?.code || ""})`,
      "",
    );
    const chunks = mdByGroup.get(g.name) || [];
    mdParts.push(chunks.length ? chunks.join("\n\n") : "_No submissions found._", "");
  }

  fs.writeFileSync(path.join(outDir, "03-task-answers.csv"), answersCsv, "utf8");
  fs.writeFileSync(
    path.join(outDir, "03-task-answers.md"),
    mdParts.join("\n"),
    "utf8",
  );

  // --- 04 Stakeholder / AI chat sessions ---
  const chatSessions = await ChatSession.find({
    projectId: { $in: projectIds },
    $or: [
      { sender: { $in: studentList } },
      { participants: { $in: studentList } },
    ],
  })
    .sort({ startTime: 1 })
    .lean();

  const jsonlLines = [];
  const chatMd = [
    "# PRO1000 stakeholder / AI chat sessions\n",
    `Generated: ${new Date().toISOString()}\n`,
    "Each session is one conversation thread with a project stakeholder role.\n",
  ];

  for (const session of chatSessions) {
    const role = roleById.get(String(session.stakeholderId));
    const studentOwner =
      studentList.find((s) => s === session.sender) ||
      (session.participants || []).find((p) => studentList.includes(p)) ||
      session.sender;
    const groupName = groupForStudent.get(studentOwner) || "";

    const record = {
      groupName,
      studentUsername: studentOwner,
      sessionId: String(session._id),
      sessionTitle: session.title,
      stakeholderId: String(session.stakeholderId),
      stakeholderName: role?.name || "",
      stakeholderPersona: role?.persona || "",
      startTime: session.startTime,
      endTime: session.endTime,
      messageCount: (session.chatItems || []).length,
      chatItems: (session.chatItems || []).map((item) => ({
        sender: item.sender,
        message: item.message,
        timestamp: item.timestamp,
      })),
    };
    jsonlLines.push(JSON.stringify(record));

    chatMd.push(
      `\n---\n\n## Session: ${session.title}`,
      `- **Group:** ${groupName || "—"}`,
      `- **Student:** ${studentOwner}`,
      `- **Stakeholder:** ${role?.name || session.stakeholderId} (${role?.persona || "persona n/a"})`,
      `- **Started:** ${session.startTime ? new Date(session.startTime).toISOString() : "—"}`,
      `- **Messages:** ${(session.chatItems || []).length}\n`,
    );
    for (const item of session.chatItems || []) {
      const ts = item.timestamp
        ? new Date(item.timestamp).toISOString()
        : "";
      chatMd.push(
        `**${item.sender}** (${ts}):\n\n${clip(item.message, 6000)}\n`,
      );
    }
  }

  fs.writeFileSync(
    path.join(outDir, "04-stakeholder-chats.jsonl"),
    `${jsonlLines.join("\n")}\n`,
    "utf8",
  );
  fs.writeFileSync(
    path.join(outDir, "04-stakeholder-chats.md"),
    chatMd.join("\n"),
    "utf8",
  );

  const readme = `# PRO1000 export pack (for Claude / qualitative analysis)

Generated: ${new Date().toISOString()}
Course code: **${args.courseCode}**${args.group ? `\nGroup filter: **${args.group}**` : ""}

## Files

| File | Contents |
|------|----------|
| \`01-login-frequency.csv\` | Logins per group member (from action logs, \`login\` events) |
| \`02-interaction-frequency.csv\` | All logged API/product actions per user (columns = action types) |
| \`03-task-answers.csv\` | Structured task submissions, reflections, feedback excerpts |
| \`03-task-answers.md\` | Same submissions in readable markdown by group |
| \`04-stakeholder-chats.jsonl\` | One JSON object per line — full chat threads with stakeholders |
| \`04-stakeholder-chats.md\` | Human-readable chat transcripts |

## Suggested use with Claude

1. Upload **CSV** files for counts / tables.
2. Upload **\`03-task-answers.md\`** and/or **\`04-stakeholder-chats.md\`** for narrative analysis.
3. Or paste **JSONL** lines for structured multi-session analysis.

## Data notes

- **Login counts** depend on the frontend calling \`POST /api/v1/logs/track\` with action \`login\`.
- **Interaction counts** include AI generation, stakeholder chat, course-plan tools, etc.
- Submissions may include **truncated** long text (see \`[… truncated …]\` markers).
- Treat as **student data** — handle under your institution's privacy rules.

Groups exported: ${groups.map((g) => g.name).join(", ")}
Students: ${studentList.length}
Submissions: ${submissions.length}
Chat sessions: ${chatSessions.length}
`;

  fs.writeFileSync(path.join(outDir, "README.md"), readme, "utf8");

  console.log("✅ Export complete:");
  console.log(`   Groups: ${groups.length}, Students: ${studentList.length}`);
  console.log(`   Submissions: ${submissions.length}, Chat sessions: ${chatSessions.length}`);
  console.log(`   Login events (matched): ${loginLogs.length}, Action logs (matched): ${actionLogs.length}`);
  console.log(`📁 ${outDir}`);

  await mongoose.connection.close();
}

main().catch(async (err) => {
  console.error("❌ Export failed:", err.message);
  try {
    await mongoose.connection.close();
  } catch {}
  process.exit(1);
});
