/**
 * InnSpill Backend API
 * Compatible with both local development and cPanel (Passenger) deployment
 * Supports dynamic base path configuration
 */

const path = require("path");
const http = require("http");
const express = require("express");
const cors = require("cors");
const helmet = require("helmet");
const morgan = require("morgan");
const rateLimit = require("express-rate-limit");
const session = require("express-session");
const MongoStore = require("connect-mongo");
const passport = require("passport");
const swaggerUi = require("swagger-ui-express");
require("dotenv").config();

// Import database configuration
const { connectDB } = require("./src/config/database");
const { createSwaggerSpec } = require("./src/config/swagger");

// Import routes
const chatbotRoutes = require("./src/routes/chatbot");
const authRoutes = require("./src/routes/auth");
const logsRoutes = require("./src/routes/logs");
const coursePlanDocsRoutes = require("./src/routes/coursePlanDocs");
const coursesRoutes = require("./src/routes/courses");
const exercisesRoutes = require("./src/routes/exercises");
const promptsRoutes = require("./src/routes/prompts");
const worksheetsRoutes = require("./src/routes/worksheets");
const projectsRoutes = require("./src/routes/projects");
const assessmentTasksRoutes = require("./src/routes/assessment-tasks");
const assessmentRolesRoutes = require("./src/routes/assessment-roles");
const assessmentQuizzesRoutes = require("./src/routes/assessment-quizzes");
const assessmentSubmissionsRoutes = require("./src/routes/assessment-submissions");
const assessmentUploadRoutes = require("./src/routes/assessment-upload");
const quizSubmissionsRoutes = require("./src/routes/quiz-submissions");
const studentsRoutes = require("./src/routes/students");
const notificationsRoutes = require("./src/routes/notifications");
const chatMessagesRoutes = require("./src/routes/chat-messages");
const userFeedbackRoutes = require("./src/routes/user-feedback");
const monitoringRoutes = require("./src/routes/monitoring");
const filesRoutes = require("./src/routes/files");
const loMappingsRoutes = require("./src/routes/lo-mappings");
const studentMetricsRoutes = require("./src/routes/student-metrics");
const aiLiteracyRoutes = require("./src/routes/ai-literacy");
const usersRoutes = require("./src/routes/users");
const studentGroupsRoutes = require("./src/routes/student-groups");
const planningPokerRoutes = require("./src/routes/planning-poker");
const swotAnalysisRoutes = require("./src/routes/swot-analysis");
const groupToolRoutes = require("./src/routes/group-tools");
const reStudioRoutes = require("./src/routes/re-studio");
const handinRoutes = require("./src/routes/handin");
const activityRoutes = require("./src/routes/activity");
const {
  enforceApiAuthentication,
} = require("./src/middleware/auth");
const mongoose = require("mongoose");
const { attachPlanningPokerWss } = require("./src/ws/planningPoker");

const app = express();
const isTestEnv = process.env.NODE_ENV === "test";

function validateSessionSecret() {
  if (isTestEnv) return;
  const secret = process.env.SESSION_SECRET;
  if (!secret || secret.length < 32) {
    console.error(
      "❌ SESSION_SECRET must be set and at least 32 characters long",
    );
    process.exit(1);
  }
}
validateSessionSecret();
const PORT = process.env.PORT || 3000;
const MAX_PORT_RETRIES = 10;

// ==========================
// Base Path Configuration
// ==========================
// For cPanel: set BASE_PATH=/microapi in .env or cPanel environment variables
// For local dev: leave empty or set BASE_PATH=
const BASE_PATH = process.env.BASE_PATH || "";

// Normalize base path: ensure it starts with / if not empty, and remove trailing /
let normalizedBasePath = BASE_PATH.trim();
if (normalizedBasePath) {
  // Remove trailing slash
  normalizedBasePath = normalizedBasePath.replace(/\/$/, ""); // Ensure it starts with /
  if (!normalizedBasePath.startsWith("/")) {
    normalizedBasePath = "/" + normalizedBasePath;
  }
}

const swaggerSpec = createSwaggerSpec(normalizedBasePath);

// ==========================
// Database Connection
// ==========================
// Initialize database connection immediately
let dbConnected = false;
connectDB()
  .then(() => {
    dbConnected = true;
  })
  .catch((error) => {
    console.error("❌ MongoDB connection error:", error.message);
    if (!isTestEnv) {
      process.exit(1);
    }
  });

// ==========================
// Global Middleware
// ==========================
if (process.env.TRUST_PROXY === "1" || process.env.TRUST_PROXY === "true") {
  app.set("trust proxy", 1);
} else if (process.env.TRUST_PROXY) {
  app.set("trust proxy", process.env.TRUST_PROXY);
}

// Security middleware
app.use(
  helmet({
    crossOriginResourcePolicy: { policy: "cross-origin" },
    crossOriginOpenerPolicy: false,
  })
);

// Logging middleware
app.use(morgan("combined"));

// CORS configuration
function buildAllowedOrigins() {
  const extra = (process.env.CORS_ORIGINS || "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  return [
    ...new Set(
      [process.env.CLIENT_URL, process.env.SERVER_URL, ...extra].filter(
        Boolean,
      ),
    ),
  ];
}

function isLocalhostOrigin(origin) {
  if (!origin) return false;
  try {
    const { hostname } = new URL(origin);
    return hostname === "localhost" || hostname === "127.0.0.1";
  } catch {
    return false;
  }
}

const corsOptions = {
  origin: (origin, callback) => {
    if (process.env.NODE_ENV !== "production") {
      return callback(null, true);
    }

    const allowedOrigins = buildAllowedOrigins();
    const allowLocalhost =
      process.env.ALLOW_LOCALHOST_CORS === "1" ||
      process.env.ALLOW_LOCALHOST_CORS === "true";

    if (!origin || allowedOrigins.includes(origin)) {
      return callback(null, true);
    }
    if (allowLocalhost && isLocalhostOrigin(origin)) {
      return callback(null, true);
    }

    console.warn(`⚠️ CORS blocked origin: ${origin}`);
    // Do not pass Error — that becomes HTTP 500 on OPTIONS preflight
    return callback(null, false);
  },
  credentials: true,
  methods: ["GET", "HEAD", "PUT", "PATCH", "POST", "DELETE", "OPTIONS"],
  allowedHeaders: [
    "Content-Type",
    "Authorization",
    "X-Requested-With",
    "Accept",
    "Origin",
    "Cache-Control",
    "Pragma",
  ],
};

app.use(cors(corsOptions));
app.options("*", cors(corsOptions));

// Body parsing middleware
app.use(express.json({ limit: "10mb" }));
app.use(express.urlencoded({ extended: true, limit: "10mb" }));

const sessionMaxAge = 24 * 60 * 60 * 1000;
const sessionCookie = {
  secure: process.env.NODE_ENV === "production",
  httpOnly: true,
  sameSite: "lax",
  maxAge: sessionMaxAge,
};

const sessionOptions = {
  secret: process.env.SESSION_SECRET,
  resave: false,
  saveUninitialized: false,
  cookie: sessionCookie,
};

if (process.env.MONGO_URI) {
  sessionOptions.store = MongoStore.create({
    mongoUrl: process.env.MONGO_URI,
    dbName: process.env.SESSION_DB_NAME || "ai4edu_database",
    collectionName: "sessions",
    ttl: Math.floor(sessionMaxAge / 1000),
  });
}

// Session configuration
app.use(session(sessionOptions));

// Passport configuration
app.use(passport.initialize());
app.use(passport.session());

// Rate limiting - applied to API routes with base path
const limiter = rateLimit({
  windowMs: parseInt(process.env.RATE_LIMIT_WINDOW_MS) || 15 * 60 * 1000, // 15 minutes
  max: parseInt(process.env.RATE_LIMIT_MAX_REQUESTS) || 100,
  // Count per logged-in user: on campus many students share one IP address.
  keyGenerator: (req) => (req.session?.userId ? `user:${req.session.userId}` : req.ip),
  message: {
    success: false,
    error: "Too many requests, please try again later.",
  },
});
app.use(`${normalizedBasePath}/api/`, limiter);

// Per-user budgets for AI calls and GitHub link checks (src/middleware/aiLimits.js).
const { limit: perUserLimit } = require("./src/middleware/aiLimits");
for (const route of ["chatbot", "chat-messages", "re-studio", "groups", "prompts", "worksheets", "assessment-quizzes", "lo-mappings"]) {
  app.use(`${normalizedBasePath}/api/v1/${route}`, perUserLimit("ai"));
}
app.use(new RegExp(`^${normalizedBasePath.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}/api/v1/assessment-submissions/(generate-feedback-batch|[0-9a-f]{24}/(generate-feedback|assess))$`), perUserLimit("ai"));
app.use(`${normalizedBasePath}/api/v1/handin`, perUserLimit("links"));

// ==========================
// Health Check Endpoints
// ==========================
// Health check endpoint (works with or without base path)
app.get(
  ["/health", `${normalizedBasePath}/health`].filter(Boolean),
  (req, res) => {
    const dbReady = mongoose.connection.readyState === 1;
    res.status(dbReady ? 200 : 503).json({
      success: dbReady,
      message: dbReady
        ? "InnSpill Backend API is running"
        : "InnSpill Backend API — database unavailable",
      db: dbReady ? "connected" : "disconnected",
      timestamp: new Date().toISOString(),
      environment: process.env.NODE_ENV || "development",
      basePath: normalizedBasePath || "none",
    });
  },
);

// ==========================
// API Documentation Endpoints
// ==========================
app.get(
  ["/api-docs.json", `${normalizedBasePath}/api-docs.json`].filter(Boolean),
  (req, res) => {
    res.status(200).json(swaggerSpec);
  },
);

app.use(
  ["/api-docs", `${normalizedBasePath}/api-docs`].filter(Boolean),
  swaggerUi.serve,
  swaggerUi.setup(swaggerSpec, {
    explorer: true,
    customSiteTitle: "InnSpill Backend API Docs",
  }),
);

// ==========================
// API Routes
// ==========================
app.use(`${normalizedBasePath}/api/v1`, enforceApiAuthentication);

// Static uploads (assessment files) — auth enforced at download layer in routes where needed
app.use(
  `${normalizedBasePath}/uploads`,
  express.static(path.join(__dirname, "uploads"), {
    fallthrough: true,
    setHeaders(res) {
      res.setHeader("X-Content-Type-Options", "nosniff");
      res.setHeader("Content-Disposition", "attachment");
    },
  }),
);

// Mount routes with base path
app.use(`${normalizedBasePath}/api/v1/chatbot`, chatbotRoutes);
app.use(`${normalizedBasePath}/api/v1/auth`, authRoutes);
app.use(`${normalizedBasePath}/api/v1/logs`, logsRoutes);
app.use(`${normalizedBasePath}/api/v1/course-plan-docs`, coursePlanDocsRoutes);
app.use(`${normalizedBasePath}/api/v1/courses`, coursesRoutes);
app.use(`${normalizedBasePath}/api/v1/exercises`, exercisesRoutes);
app.use(`${normalizedBasePath}/api/v1/prompts`, promptsRoutes);
app.use(`${normalizedBasePath}/api/v1/worksheets`, worksheetsRoutes);
app.use(`${normalizedBasePath}/api/v1/projects`, projectsRoutes);
app.use(`${normalizedBasePath}/api/v1/assessment-tasks`, assessmentTasksRoutes);
app.use(`${normalizedBasePath}/api/v1/assessment-roles`, assessmentRolesRoutes);
app.use(
  `${normalizedBasePath}/api/v1/assessment-quizzes`,
  assessmentQuizzesRoutes,
);
app.use(
  `${normalizedBasePath}/api/v1/assessment-submissions`,
  assessmentSubmissionsRoutes,
);
app.use(
  `${normalizedBasePath}/api/v1/assessment/upload`,
  assessmentUploadRoutes,
);
app.use(`${normalizedBasePath}/api/v1/quiz-submissions`, quizSubmissionsRoutes);
app.use(`${normalizedBasePath}/api/v1/students`, studentsRoutes);
app.use(`${normalizedBasePath}/api/v1/notifications`, notificationsRoutes);
app.use(`${normalizedBasePath}/api/v1/chat-messages`, chatMessagesRoutes);
app.use(`${normalizedBasePath}/api/v1/user-feedback`, userFeedbackRoutes);
app.use(`${normalizedBasePath}/api/v1/monitoring`, monitoringRoutes);
app.use(`${normalizedBasePath}/api/v1/files`, filesRoutes);
app.use(`${normalizedBasePath}/api/v1/lo-mappings`, loMappingsRoutes);
app.use(`${normalizedBasePath}/api/v1/student-metrics`, studentMetricsRoutes);
app.use(`${normalizedBasePath}/api/v1/ai-literacy`, aiLiteracyRoutes);
app.use(`${normalizedBasePath}/api/v1/users`, usersRoutes);
app.use(`${normalizedBasePath}/api/v1/student-groups`, studentGroupsRoutes);
app.use(`${normalizedBasePath}/api/v1/planning-poker`, planningPokerRoutes);
app.use(`${normalizedBasePath}/api/v1/swot-analysis`, swotAnalysisRoutes);
app.use(`${normalizedBasePath}/api/v1/groups`, groupToolRoutes);
app.use(`${normalizedBasePath}/api/v1/re-studio`, reStudioRoutes);
app.use(`${normalizedBasePath}/api/v1/handin`, handinRoutes);
app.use(`${normalizedBasePath}/api/v1/activity`, activityRoutes);

// ==========================
// Root Endpoint
// ==========================
// Root endpoint (works with or without base path)
app.get(
  ["/", normalizedBasePath || "/"].filter(
    (path, index, arr) => arr.indexOf(path) === index,
  ),
  (req, res) => {
    const bp = normalizedBasePath; // shorthand
    res.status(200).json({
      success: true,
      message: "InnSpill Backend API",
      version: "1.0.0",
      basePath: bp || "none",
      environment: process.env.NODE_ENV || "development",
      endpoints: {
        health: `${bp}/health`,
        docs: `${bp}/api-docs`,
        openapi: `${bp}/api-docs.json`,
        chatbot: `${bp}/api/v1/chatbot`,
        agents: `${bp}/api/v1/chatbot/agents`,
        auth: `${bp}/api/v1/auth`,
        facebook: `${bp}/api/v1/auth/facebook`,
        google: `${bp}/api/v1/auth/google`,
        logout: `${bp}/api/v1/auth/logout`,
        me: `${bp}/api/v1/auth/me`,
        "create-course-plan": `${bp}/api/v1/chatbot/create-course-plan`,
        "update-course-plan": `${bp}/api/v1/chatbot/update-course-plan`,
        "create-lecture-plan": `${bp}/api/v1/chatbot/create-lecture-plan`,
        "analyze-feedback": `${bp}/api/v1/chatbot/analyze-feedback`,
        "analyze-course-plan": `${bp}/api/v1/chatbot/analyze-a-course-plan`,
        "revise-course-plan": `${bp}/api/v1/chatbot/revise-a-course-plan`,
        "language-translator": `${bp}/api/v1/chatbot/language-translator`,
        "general-chat": `${bp}/api/v1/chatbot/asks`,
        "action-logs": `${bp}/api/v1/logs/actions`,
        "usage-stats": `${bp}/api/v1/logs/stats`,
        "recent-logs": `${bp}/api/v1/logs/recent`,
        "course-plan-logs": `${bp}/api/v1/logs/course-plans`,
        "save-course-plan-doc": `${bp}/api/v1/course-plan-docs`,
        "get-course-plan-docs": `${bp}/api/v1/course-plan-docs`,
        courses: `${bp}/api/v1/courses`,
        exercises: `${bp}/api/v1/exercises`,
        prompts: `${bp}/api/v1/prompts`,
        "revise-prompt": `${bp}/api/v1/prompts/revise`,
        worksheets: `${bp}/api/v1/worksheets`,
        "generate-learning-objectives": `${bp}/api/v1/worksheets/generate-learning-objectives`,
        "generate-format-description": `${bp}/api/v1/worksheets/generate-format-description`,
        "generate-examples": `${bp}/api/v1/worksheets/generate-examples`,
        "generate-worksheet": `${bp}/api/v1/worksheets/generate`,
        projects: `${bp}/api/v1/projects`,
        "assessment-tasks": `${bp}/api/v1/assessment-tasks`,
        "assessment-roles": `${bp}/api/v1/assessment-roles`,
        "assessment-quizzes": `${bp}/api/v1/assessment-quizzes`,
        "generate-quiz": `${bp}/api/v1/assessment-quizzes/generate`,
        "assessment-submissions": `${bp}/api/v1/assessment-submissions`,
        "generate-feedback": `${bp}/api/v1/assessment-submissions/:id/generate-feedback`,
        "assessment-upload": `${bp}/api/v1/assessment/upload`,
        students: `${bp}/api/v1/students`,
        "courses-by-student": `${bp}/api/v1/courses/student/:username`,
        "notifications-by-student": `${bp}/api/v1/notifications/student/:username`,
        "chat-messages-by-student-stakeholder": `${bp}/api/v1/chat-messages/student/:username/stakeholder/:stakeholderId`,
        "send-chat-message": `${bp}/api/v1/chat-messages`,
        "group-tools": `${bp}/api/v1/groups/:groupId`,
        "re-studio-reply": `${bp}/api/v1/re-studio/reply`,
      },
    });
  },
);

// ==========================
// 404 Handler
// ==========================
app.use("*", (req, res) => {
  res.status(404).json({
    success: false,
    error: "Endpoint not found",
    path: req.originalUrl,
    basePath: normalizedBasePath || "none",
    hint: normalizedBasePath
      ? `Try accessing endpoints with the ${normalizedBasePath} prefix`
      : "Check the root endpoint for available paths",
  });
});

// ==========================
// Global Error Handler
// ==========================
app.use((err, req, res, next) => {
  console.error("❌ Global error:", err.message);
  if (err.type === "entity.parse.failed") {
    return res.status(400).json({ success: false, error: "Invalid JSON body" });
  }
  if (err.type === "entity.too.large" || err.code === "LIMIT_FILE_SIZE") {
    return res.status(413).json({ success: false, error: "Payload too large" });
  }
  res.status(err.status || 500).json({
    success: false,
    error: "Internal server error",
  });
});

// ==========================
// Server Startup
// ==========================
function startServer(port, attempt = 0) {
  const server = http.createServer(app);
  attachPlanningPokerWss(server, normalizedBasePath);

  server.listen(port, () => {
    console.log(`🚀 InnSpill Backend API running on port ${port}`);
  });

  server.on("error", (err) => {
    if (err.code === "EADDRINUSE" && attempt < MAX_PORT_RETRIES) {
      const nextPort = Number(port) + 1;
      console.warn(
        `⚠️ Port ${port} is in use. Retrying on port ${nextPort}...`,
      );
      startServer(nextPort, attempt + 1);
      return;
    }

    console.error(`❌ Failed to start server on port ${port}:`, err.message);
    process.exit(1);
  });
}

if (
  !isTestEnv &&
  (process.env.NODE_ENV !== "production" || !process.env.PASSENGER_APP_ENV)
) {
  // Local development - start HTTP server (REST + planning poker WebSocket)
  startServer(PORT);
} else if (isTestEnv) {
  // Jest loads app without binding a port
} else {
  // Production with Passenger (cPanel) - export app
  console.log(`🚀 InnSpill Backend API loaded`);
}

module.exports = app;
