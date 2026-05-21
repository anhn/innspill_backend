const mongoose = require("mongoose");

/**
 * Action Log Schema - Tracks all user actions and API usage
 */
const actionLogSchema = new mongoose.Schema(
  {
    userId: {
      type: String,
      required: false, // Optional for anonymous users
      index: true,
    },
    sessionId: {
      type: String,
      required: true,
      index: true,
    },
    ipAddress: {
      type: String,
      required: true,
      index: true,
    },
    userAgent: {
      type: String,
      required: false,
    },
    timestamp: {
      type: Date,
      default: Date.now,
      index: true,
    },
    action: {
      type: String,
      required: true,
      enum: [
        "analyze-course-plan",
        "revise-course-plan",
        "create-course-plan",
        "update-course-plan",
        "create-lecture-plan",
        "analyze-feedback",
        "general-chat",
        "language-translate",
        "revise-prompt",
        "generate-learning-objectives",
        "generate-format-description",
        "generate-examples",
        "generate-worksheet",
        "generate-feedback",
        "generate-feedback-batch",
        "generate-quiz",
        "stakeholder-chat",
        "lo-auto-map",
        "login",
        "logout",
      ],
      index: true,
    },
    endpoint: {
      type: String,
      required: true,
    },
    method: {
      type: String,
      required: true,
      enum: ["GET", "POST", "PUT", "DELETE"],
    },
    userInfo: {
      educationLevel: String,
      subjectArea: String,
      country: String,
      academicYear: String,
      organization: String,
      language: String,
    },
    coursePlanName: {
      type: String,
      required: false,
      index: true,
    },
    requestSize: {
      type: Number,
      required: false, // Size of request in characters
    },
    responseSize: {
      type: Number,
      required: false, // Size of response in characters
    },
    // Store internal (estimated) token usage as a plain object
    tokenUsageInternal: {
      type: mongoose.Schema.Types.Mixed,
      required: false,
    },
    processingTime: {
      type: Number,
      required: false, // Processing time in milliseconds
    },
    success: {
      type: Boolean,
      required: true,
      default: true,
    },
    errorMessage: {
      type: String,
      required: false,
    },
    metadata: {
      type: mongoose.Schema.Types.Mixed,
      required: false, // Additional data for future extensions
    },
  },
  {
    timestamps: true,
  },
);

// Indexes for better query performance
actionLogSchema.index({ userId: 1, timestamp: -1 });
actionLogSchema.index({ action: 1, timestamp: -1 });
actionLogSchema.index({ coursePlanName: 1, timestamp: -1 });
actionLogSchema.index({ timestamp: -1 });

// Bind this model to the 'ai4edu_database' database and 'action_log' collection
const actionLogDb = mongoose.connection.useDb("ai4edu_database");
const ActionLog = actionLogDb.model("ActionLog", actionLogSchema, "action_log");

module.exports = ActionLog;
