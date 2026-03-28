#!/usr/bin/env node
require('dotenv').config();
const { connectDB, mongoose } = require('../src/config/database');
const User = require('../src/models/User');

const users = [
  {
    username: 'ingrid',
    password: 'usn2025',
    date_created: new Date(),
    type: 'teacher',
    remark: 'testing'
  },
  {
    username: 'ingeborg',
    password: 'usn2025',
    date_created: new Date(),
    type: 'teacher',
    remark: 'testing'
  },
  {
    username: 'annette',
    password: 'usn2025',
    date_created: new Date(),
    type: 'teacher',
    remark: 'testing'
  },
  {
    username: 'atila',
    password: 'usn2025',
    date_created: new Date(),
    type: 'teacher',
    remark: 'testing'
  }
];

(async function seedUsers() {
  try {
    console.log('🔌 Connecting to MongoDB...');
    await connectDB();

    console.log('🗑️  Clearing existing test users...');
    await User.deleteMany({ remark: 'testing' });

    console.log('📝 Inserting new users...');
    const insertedUsers = await User.insertMany(users);
    
    console.log(`✅ Successfully inserted ${insertedUsers.length} users:`);
    insertedUsers.forEach(user => {
      console.log(`   - ${user.username} (${user.type}) - Created: ${user.date_created.toISOString()}`);
    });

    const totalUsers = await User.countDocuments();
    console.log(`📊 Total users in ai4edu_user collection: ${totalUsers}`);

    await mongoose.connection.close();
    console.log('💤 MongoDB connection closed');
    process.exit(0);
  } catch (err) {
    console.error('❌ Seed error:', err);
    try { 
      await mongoose.connection.close(); 
    } catch {}
    process.exit(1);
  }
})();

