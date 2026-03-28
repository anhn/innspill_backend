#!/usr/bin/env node
require('dotenv').config();
const { connectDB, mongoose } = require('../src/config/database');
const Course = require('../src/models/Course');

const courses = [
  {
    name: 'Advanced Software Engineering',
    code: 'TDT4242',
    academicYear: '2025-2026',
    university: 'NTNU',
    teacherId: 'angu@usn.no'
  },
  {
    name: 'Pratisk Projekt Arbeid',
    code: 'PRO1000',
    academicYear: '2025-2026',
    university: 'USN',
    teacherId: 'angu@usn.no'
  }
];

(async function seedCourses() {
  try {
    console.log('🔌 Connecting to MongoDB...');
    await connectDB();

    console.log('📝 Inserting courses...');
    const insertedCourses = [];
    
    for (const courseData of courses) {
      // Check if course already exists
      const existingCourse = await Course.findOne({
        code: courseData.code,
        academicYear: courseData.academicYear,
        university: courseData.university,
        teacherId: courseData.teacherId
      });

      if (existingCourse) {
        console.log(`⚠️  Course already exists: ${courseData.name} (${courseData.code}) - Skipping`);
        insertedCourses.push(existingCourse);
      } else {
        const course = new Course(courseData);
        await course.save();
        insertedCourses.push(course);
        console.log(`✅ Created course: ${course.name} (${course.code})`);
      }
    }

    console.log(`\n📊 Summary:`);
    console.log(`   - Total courses processed: ${courses.length}`);
    console.log(`   - Courses in database: ${insertedCourses.length}`);
    
    insertedCourses.forEach(course => {
      console.log(`   - ${course.name} (${course.code}) - ${course.university} - ${course.academicYear}`);
    });

    await mongoose.connection.close();
    console.log('\n💤 MongoDB connection closed');
    process.exit(0);
  } catch (err) {
    console.error('❌ Seed error:', err);
    try { 
      await mongoose.connection.close(); 
    } catch {}
    process.exit(1);
  }
})();

