#!/usr/bin/env node

/**
 * Startup script for AI4EDU Backend API
 * Checks environment variables and starts the server
 */

const fs = require('fs');
const path = require('path');

// Check if .env file exists
const envPath = path.join(__dirname, '..', '.env');
if (!fs.existsSync(envPath)) {
  console.error('❌ .env file not found!');
  console.log('📝 Please create a .env file in the project root with your environment variables');
  console.log('📋 You can copy from env.example and add your values:');
  console.log('   cp env.example .env');
  console.log('🔑 Make sure to add all required variables (OPENAI_API_KEY, SESSION_SECRET, etc.)');
  console.log('');
  console.log('💡 If you already have a .env file, make sure it\'s in the project root directory');
  process.exit(1);
}

// Check for required environment variables
require('dotenv').config();

const requiredEnvVars = [
  'OPENAI_API_KEY',
  'SESSION_SECRET',
  'FACEBOOK_APP_ID',
  'FACEBOOK_APP_SECRET',
  'GOOGLE_CLIENT_ID',
  'GOOGLE_CLIENT_SECRET',
  'CLIENT_URL',
  'SERVER_URL',
  'MONGO_URI'
];
const missingVars = requiredEnvVars.filter(varName => !process.env[varName]);

if (missingVars.length > 0) {
  console.error('❌ Missing required environment variables:');
  missingVars.forEach(varName => {
    console.error(`   - ${varName}`);
  });
  console.log('📝 Please add these variables to your .env file');
  process.exit(1);
}

console.log('✅ Environment variables validated');
console.log('🚀 Starting AI4EDU Backend API...');

// Start the application
require('../app');
