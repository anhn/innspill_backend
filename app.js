/**
 * InnSpill Backend API
 * Compatible with both local development and cPanel (Passenger) deployment
 * Supports dynamic base path configuration
 */

const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const morgan = require('morgan');
const rateLimit = require('express-rate-limit');
const session = require('express-session');
const passport = require('passport');
require('dotenv').config();

// Import database configuration
const { connectDB } = require('./src/config/database');

// Import routes
const chatbotRoutes = require('./src/routes/chatbot');
const authRoutes = require('./src/routes/auth');
const logsRoutes = require('./src/routes/logs');
const coursePlanDocsRoutes = require('./src/routes/coursePlanDocs');
const coursesRoutes = require('./src/routes/courses');
const exercisesRoutes = require('./src/routes/exercises');
const promptsRoutes = require('./src/routes/prompts');
const worksheetsRoutes = require('./src/routes/worksheets');
const projectsRoutes = require('./src/routes/projects');
const assessmentTasksRoutes = require('./src/routes/assessment-tasks');
const assessmentRolesRoutes = require('./src/routes/assessment-roles');
const assessmentQuizzesRoutes = require('./src/routes/assessment-quizzes');
const assessmentSubmissionsRoutes = require('./src/routes/assessment-submissions');
const assessmentUploadRoutes = require('./src/routes/assessment-upload');
const quizSubmissionsRoutes = require('./src/routes/quiz-submissions');
const studentsRoutes = require('./src/routes/students');
const notificationsRoutes = require('./src/routes/notifications');
const chatMessagesRoutes = require('./src/routes/chat-messages');
const userFeedbackRoutes = require('./src/routes/user-feedback');
const monitoringRoutes = require('./src/routes/monitoring');
const filesRoutes = require('./src/routes/files');
const loMappingsRoutes = require('./src/routes/lo-mappings');
const studentMetricsRoutes = require('./src/routes/student-metrics');
const aiLiteracyRoutes = require('./src/routes/ai-literacy');
const usersRoutes = require('./src/routes/users');
const studentGroupsRoutes = require('./src/routes/student-groups');
const planningPokerRoutes = require('./src/routes/planning-poker');
const swotAnalysisRoutes = require('./src/routes/swot-analysis');

const app = express();
const PORT = process.env.PORT || 3000;

// ==========================
// Base Path Configuration
// ==========================
// For cPanel: set BASE_PATH=/microapi in .env or cPanel environment variables
// For local dev: leave empty or set BASE_PATH=
const BASE_PATH = process.env.BASE_PATH || '';

// Normalize base path: ensure it starts with / if not empty, and remove trailing /
let normalizedBasePath = BASE_PATH.trim();
if (normalizedBasePath) {
  // Remove trailing slash
  normalizedBasePath = normalizedBasePath.replace(/\/$/, '');
  // Ensure it starts with /
  if (!normalizedBasePath.startsWith('/')) {
    normalizedBasePath = '/' + normalizedBasePath;
  }
}

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
    console.error('❌ MongoDB connection error:', error.message);
    process.exit(1);
  });

// ==========================
// Global Middleware
// ==========================
// Trust proxy - Required for cPanel/reverse proxy deployments
// This allows rate limiting and session management to work correctly behind a proxy
app.set('trust proxy', 1);

// Security middleware
app.use(helmet());

// Logging middleware
app.use(morgan('combined'));

// CORS configuration
app.use(cors({
  origin: process.env.NODE_ENV === 'production' 
    ? [process.env.CLIENT_URL] 
    : [process.env.CLIENT_URL, process.env.SERVER_URL],
  credentials: true
}));

// Body parsing middleware
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// Session configuration
app.use(session({
  secret: process.env.SESSION_SECRET || 'defaultsecret',
  resave: false,
  saveUninitialized: false,
  cookie: {
    secure: process.env.NODE_ENV === 'production',
    httpOnly: true,
    maxAge: 24 * 60 * 60 * 1000 // 24 hours
  }
}));

// Passport configuration
app.use(passport.initialize());
app.use(passport.session());

// Rate limiting - applied to API routes with base path
const limiter = rateLimit({
  windowMs: parseInt(process.env.RATE_LIMIT_WINDOW_MS) || 15 * 60 * 1000, // 15 minutes
  max: parseInt(process.env.RATE_LIMIT_MAX_REQUESTS) || 100,
  message: {
    success: false,
    error: 'Too many requests from this IP, please try again later.'
  }
});
app.use(`${normalizedBasePath}/api/`, limiter);

// ==========================
// Health Check Endpoints
// ==========================
// Health check endpoint (works with or without base path)
app.get(['/health', `${normalizedBasePath}/health`].filter(Boolean), (req, res) => {
  res.status(200).json({
    success: true,
    message: 'InnSpill Backend API is running',
    timestamp: new Date().toISOString(),
    environment: process.env.NODE_ENV || 'development',
    basePath: normalizedBasePath || 'none'
  });
});

// ==========================
// API Routes
// ==========================
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
app.use(`${normalizedBasePath}/api/v1/assessment-quizzes`, assessmentQuizzesRoutes);
app.use(`${normalizedBasePath}/api/v1/assessment-submissions`, assessmentSubmissionsRoutes);
app.use(`${normalizedBasePath}/api/v1/assessment/upload`, assessmentUploadRoutes);
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

// ==========================
// Root Endpoint
// ==========================
// Root endpoint (works with or without base path)
app.get(['/', normalizedBasePath || '/'].filter((path, index, arr) => arr.indexOf(path) === index), (req, res) => {
  const bp = normalizedBasePath; // shorthand
  res.status(200).json({
    success: true,
    message: 'InnSpill Backend API',
    version: '1.0.0',
    basePath: bp || 'none',
    environment: process.env.NODE_ENV || 'development',
    endpoints: {
      health: `${bp}/health`,
      chatbot: `${bp}/api/v1/chatbot`,
      agents: `${bp}/api/v1/chatbot/agents`,
      auth: `${bp}/api/v1/auth`,
      facebook: `${bp}/api/v1/auth/facebook`,
      google: `${bp}/api/v1/auth/google`,
      logout: `${bp}/api/v1/auth/logout`,
      me: `${bp}/api/v1/auth/me`,
      'create-course-plan': `${bp}/api/v1/chatbot/create-course-plan`,
      'update-course-plan': `${bp}/api/v1/chatbot/update-course-plan`,
      'create-lecture-plan': `${bp}/api/v1/chatbot/create-lecture-plan`,
      'analyze-feedback': `${bp}/api/v1/chatbot/analyze-feedback`,
      'analyze-course-plan': `${bp}/api/v1/chatbot/analyze-a-course-plan`,
      'revise-course-plan': `${bp}/api/v1/chatbot/revise-a-course-plan`,
      'language-translator': `${bp}/api/v1/chatbot/language-translator`,
      'general-chat': `${bp}/api/v1/chatbot/asks`,
      'action-logs': `${bp}/api/v1/logs/actions`,
      'usage-stats': `${bp}/api/v1/logs/stats`,
      'recent-logs': `${bp}/api/v1/logs/recent`,
      'course-plan-logs': `${bp}/api/v1/logs/course-plans`,
      'save-course-plan-doc': `${bp}/api/v1/course-plan-docs`,
      'get-course-plan-docs': `${bp}/api/v1/course-plan-docs`,
      'courses': `${bp}/api/v1/courses`,
      'exercises': `${bp}/api/v1/exercises`,
      'prompts': `${bp}/api/v1/prompts`,
      'revise-prompt': `${bp}/api/v1/prompts/revise`,
      'worksheets': `${bp}/api/v1/worksheets`,
      'generate-learning-objectives': `${bp}/api/v1/worksheets/generate-learning-objectives`,
      'generate-format-description': `${bp}/api/v1/worksheets/generate-format-description`,
      'generate-examples': `${bp}/api/v1/worksheets/generate-examples`,
      'generate-worksheet': `${bp}/api/v1/worksheets/generate`,
      'projects': `${bp}/api/v1/projects`,
      'assessment-tasks': `${bp}/api/v1/assessment-tasks`,
      'assessment-roles': `${bp}/api/v1/assessment-roles`,
      'assessment-quizzes': `${bp}/api/v1/assessment-quizzes`,
      'generate-quiz': `${bp}/api/v1/assessment-quizzes/generate`,
      'assessment-submissions': `${bp}/api/v1/assessment-submissions`,
      'generate-feedback': `${bp}/api/v1/assessment-submissions/:id/generate-feedback`,
      'assessment-upload': `${bp}/api/v1/assessment/upload`,
      'students': `${bp}/api/v1/students`,
      'courses-by-student': `${bp}/api/v1/courses/student/:username`,
      'notifications-by-student': `${bp}/api/v1/notifications/student/:username`,
      'chat-messages-by-student-stakeholder': `${bp}/api/v1/chat-messages/student/:username/stakeholder/:stakeholderId`,
      'send-chat-message': `${bp}/api/v1/chat-messages`
    }
  });
});

// ==========================
// 404 Handler
// ==========================
app.use('*', (req, res) => {
  res.status(404).json({
    success: false,
    error: 'Endpoint not found',
    path: req.originalUrl,
    basePath: normalizedBasePath || 'none',
    hint: normalizedBasePath 
      ? `Try accessing endpoints with the ${normalizedBasePath} prefix` 
      : 'Check the root endpoint for available paths'
  });
});

// ==========================
// Global Error Handler
// ==========================
app.use((err, req, res, next) => {
  console.error('❌ Global error:', err.message);
  
  res.status(err.status || 500).json({
    success: false,
    error: process.env.NODE_ENV === 'production' 
      ? 'Internal server error' 
      : err.message,
    ...(process.env.NODE_ENV !== 'production' && { stack: err.stack })
  });
});

// ==========================
// Server Startup
// ==========================
if (process.env.NODE_ENV !== 'production' || !process.env.PASSENGER_APP_ENV) {
  // Local development - start Express server
  app.listen(PORT, () => {
    console.log(`🚀 InnSpill Backend API running on port ${PORT}`);
  });
} else {
  // Production with Passenger (cPanel) - export app
  console.log(`🚀 InnSpill Backend API loaded`);
}

module.exports = app;