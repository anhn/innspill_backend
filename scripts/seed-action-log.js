#!/usr/bin/env node
require('dotenv').config();
const { connectDB, mongoose } = require('../src/config/database');
const ActionLog = require('../src/models/ActionLog');

(async function seed() {
  try {
    console.log('🔌 Connecting to MongoDB...');
    await connectDB();

    const sample = new ActionLog({
      userId: 'seed-user-001',
      sessionId: 'seed-session-001',
      ipAddress: '127.0.0.1',
      userAgent: 'Seed Script',
      action: 'general-chat',
      endpoint: '/api/v1/chatbot/asks',
      method: 'POST',
      userInfo: {
        educationLevel: 'University',
        subjectArea: 'Computer Science',
        country: 'Norway',
        academicYear: '2024-2025',
        organization: 'Seed University',
        language: 'English'
      },
      coursePlanName: 'Seed Course Plan',
      requestSize: 512,
      responseSize: 1024,
      tokenUsage: { promptTokens: 123, completionTokens: 456, totalTokens: 579 },
      processingTime: 987,
      success: true
    });

    const saved = await sample.save();
    console.log('✅ Saved action_log document:', saved._id.toString());

    const recent = await ActionLog.find({ _id: saved._id }).lean();
    console.log('📄 Retrieved document:', recent[0]);

    console.log('📈 Total documents in action_log:', await ActionLog.countDocuments());
    await mongoose.connection.close();
    console.log('💤 MongoDB connection closed');
    process.exit(0);
  } catch (err) {
    console.error('❌ Seed error:', err);
    try { await mongoose.connection.close(); } catch {}
    process.exit(1);
  }
})();
