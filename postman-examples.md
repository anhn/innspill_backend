# Postman Test Examples for AI4EDU Backend

## 🔐 **Authentication**

### **Login Endpoint**

Authenticate users against the ai4edu_user collection.

### **Request:**
- **Method:** `POST`
- **URL:** `http://localhost:3000/api/v1/auth/login`
- **Headers:** `Content-Type: application/json`

### **Request Body:**
```json
{
  "username": "ingrid",
  "password": "usn2025"
}
```

### **Success Response (200):**
```json
{
  "success": true,
  "user": {
    "username": "ingrid",
    "role": "teacher",
    "country": ""
  },
  "sessionId": "yJ3K7mN9pQ2rT5vX8zA1cD4fG6hJ9kL",
  "message": "Login successful"
}
```

### **Error Responses:**

**Missing Credentials (400):**
```json
{
  "success": false,
  "message": "Username and password are required"
}
```

**Invalid Credentials (401):**
```json
{
  "success": false,
  "message": "Invalid username or password"
}
```

**Server Error (500):**
```json
{
  "success": false,
  "message": "Internal server error",
  "error": "Error details..."
}
```

### **Test Users:**
- Username: `ingrid`, Password: `usn2025`
- Username: `ingeborg`, Password: `usn2025`
- Username: `annette`, Password: `usn2025`
- Username: `atila`, Password: `usn2025`

All test users are teachers. The `country` field is returned as an empty string since it's not stored in the database.

---

## Updated API Call Structure

The backend now supports the new frontend context structure with teacher information and language preferences.

## 🚀 **Course Plan Agent Test**

### **Request:**
- **Method:** `POST`
- **URL:** `http://localhost:3000/api/v1/chatbot/create-course-plan`
- **Headers:** `Content-Type: application/json`

### **Request Body (Required Structure):**
```json
{
  "message": "Create a comprehensive 12-week mathematics course for primary school students covering basic arithmetic, geometry, and problem-solving skills",
  "context": {
    "currentContent": "I'm working on a math curriculum for my 3rd grade class",
    "teacherInfo": {
      "educationLevel": "Primary",
      "subjectArea": "Math",
      "country": "Norway",
      "academicYear": "2023-2024",
      "organization": "University of Oslo",
      "language": "Norwegian"
    }
  }
}
```

**⚠️ Note: All fields in `teacherInfo` are now REQUIRED:**
- `educationLevel` (required)
- `subjectArea` (required)
- `country` (required)
- `academicYear` (required)
- `organization` (required)
- `language` (required)

### **Expected Response:**
```json
{
  "success": true,
  "agent": "Course Plan Agent",
  "response": "Her er din omfattende 12-ukers matematikk-kursplan for grunnskoleelever...",
  "usage": {
    "prompt_tokens": 200,
    "completion_tokens": 1000,
    "total_tokens": 1200
  }
}
```

## 🎯 **Lecture Plan Agent Test**

### **Request Body (Required Structure):**
```json
{
  "message": "Design a 45-minute lecture on fractions for 4th grade students",
  "context": {
    "currentContent": "I need to teach fractions next week",
    "teacherInfo": {
      "educationLevel": "Primary",
      "subjectArea": "Math",
      "country": "Norway",
      "academicYear": "2023-2024",
      "organization": "University of Oslo",
      "language": "Norwegian"
    }
  }
}
```

**⚠️ Note: All fields in `teacherInfo` are now REQUIRED**

## 📊 **Feedback Analysis Agent Test**

### **Request Body (Required Structure):**
```json
{
  "message": "Analyze this student feedback data and provide insights for improvement",
  "context": {
    "currentContent": "Student feedback from last semester's math course",
    "teacherInfo": {
      "educationLevel": "Primary",
      "subjectArea": "Math",
      "country": "Norway",
      "academicYear": "2023-2024",
      "organization": "University of Oslo",
      "language": "Norwegian"
    }
  }
}
```

**⚠️ Note: All fields in `teacherInfo` are now REQUIRED**

## 📊 **Course Plan Analysis Agent Test**

### **Request Body (Required Structure):**
```json
{
  "message": "Analyze this course plan and provide detailed feedback on AI impact and integration opportunities",
  "context": {
    "currentContent": "Course Plan Content: Introduction to Computer Science\nAcademic Content: Programming fundamentals, data structures, algorithms\nLearning Outcomes: Students will understand basic programming concepts\nLearning Activities: Hands-on coding exercises, group projects\nExamination: Written exam and practical coding test\nReading Materials: Introduction to Programming textbook",
    "teacherInfo": {
      "educationLevel": "University",
      "subjectArea": "Computer Science",
      "country": "Norway",
      "academicYear": "2023-2024",
      "organization": "University of Oslo",
      "language": "Norwegian"
    }
  }
}
```

**⚠️ Note: All fields in `teacherInfo` are now REQUIRED**

### **Expected Response Format:**
```json
{
  "success": true,
  "agent": "Course Plan Analysis Agent",
  "response": "# AI Impact Analysis\n\n## AI IMPACT SUMMARY\n\n**AI THREATS:** [Analysis of potential challenges and risks]\n\n**AI OPPORTUNITIES:** [Analysis of benefits and enhancement possibilities]\n\n**OVERALL ASSESSMENT:** [Brief conclusion on course readiness]\n\n## ENHANCED COURSE PLAN\n\n[Original course plan with **bold** AI comments added]\n\nExample:\nAcademic Content: Programming fundamentals **AI Comment: High AI impact - students may rely on AI coding assistants, need to emphasize understanding over code generation**\n\nLearning Activities: Hands-on coding exercises **AI Comment: AI can support debugging and code review, but may reduce problem-solving skills**",
  "usage": {
    "prompt_tokens": 200,
    "completion_tokens": 1200,
    "total_tokens": 1400
  }
}
```

## 🔄 **Course Plan Revision Agent Test**

### **Request Body (Required Structure):**
```json
{
  "message": "Generate a revised course plan based on the following analysis and original plan.",
  "context": {
    "currentContent": "Original Plan:\nIntroduction to Computer Science\nAcademic Content: Programming fundamentals, data structures, algorithms\nLearning Outcomes: Students will understand basic programming concepts\nLearning Activities: Hands-on coding exercises, group projects\nExamination: Written exam and practical coding test\nReading Materials: Introduction to Programming textbook\n\nAnalysis:\nAI THREATS: Students may become over-reliant on AI coding assistants\nAI OPPORTUNITIES: AI can enhance debugging and code review processes\nOVERALL ASSESSMENT: Course needs AI literacy integration",
    "searchAIApplications": "Introduction to Computer Science",
    "teacherInfo": {
      "educationLevel": "University",
      "subjectArea": "Computer Science",
      "country": "Norway",
      "academicYear": "2023-2024",
      "organization": "University of Oslo",
      "language": "Norwegian"
    }
  }
}
```

**⚠️ Note: All fields in `teacherInfo` are now REQUIRED**

### **Expected Response Format:**
```json
{
  "success": true,
  "agent": "Course Plan Revision Agent",
  "response": "# Revised Course Plan: Introduction to Computer Science\n\n## Academic Content\nProgramming fundamentals, data structures, algorithms\n**NEW:** AI literacy and responsible AI use in programming\n**ENHANCED:** Integration of current AI coding tools and their ethical use\n\n## Learning Outcomes\nStudents will understand basic programming concepts\n**ENHANCED:** Students will critically evaluate AI-generated code and understand when to use AI tools appropriately\n**NEW:** Students will demonstrate proficiency in using AI-assisted development tools responsibly\n\n## Learning Activities\nHand-on coding exercises, group projects\n**ENHANCED:** AI-assisted debugging sessions, critical evaluation of AI-generated solutions\n**NEW:** Collaborative projects combining human creativity with AI tool assistance\n\n## Examination\nWritten exam and practical coding test\n**REVISED:** Project-based assessment with AI tool evaluation component\n**NEW:** Portfolio assessment including AI-assisted and independent coding samples\n\n## Reading Materials\nIntroduction to Programming textbook\n**ADDED:** AI Ethics in Programming, Responsible AI Use Guidelines\n**ADDED:** Current AI Tools Documentation (based on latest search results)",
  "usage": {
    "prompt_tokens": 300,
    "completion_tokens": 1500,
    "total_tokens": 1800
  }
}
```

**🔍 Web Search Integration:**
The agent automatically searches for current AI applications using the `searchAIApplications` field (course name) and incorporates the findings into the revision process. The search query will be: "AI for [course name]" OR "AI applications in [subject area]".

### **Request Body (Required Structure):**
```json
{
  "message": "What are the best practices for teaching mathematics to primary school students?",
  "context": {
    "currentContent": "Looking for teaching strategies",
    "teacherInfo": {
      "educationLevel": "Primary",
      "subjectArea": "Math",
      "country": "Norway",
      "academicYear": "2023-2024",
      "organization": "University of Oslo",
      "language": "Norwegian"
    }
  }
}
```

**⚠️ Note: All fields in `teacherInfo` are now REQUIRED**

## 🌍 **Multi-Country Examples**

### **US Teacher Example (Required Structure):**
```json
{
  "message": "Create a 16-week computer science course for high school students",
  "context": {
    "teacherInfo": {
      "educationLevel": "High School",
      "subjectArea": "Computer Science",
      "country": "United States",
      "academicYear": "2023-2024",
      "organization": "Stanford University",
      "language": "English"
    }
  }
}
```

### **German Teacher Example (Required Structure):**
```json
{
  "message": "Design a physics course for university students",
  "context": {
    "teacherInfo": {
      "educationLevel": "University",
      "subjectArea": "Physics",
      "country": "Germany",
      "academicYear": "2023-2024",
      "organization": "Technical University of Munich",
      "language": "German"
    }
  }
}
```

**⚠️ Note: All fields in `teacherInfo` are now REQUIRED for all examples**

## 🔧 **Key Features:**

1. **Language Support:** All responses will be in the specified language
2. **Country-Specific Pedagogy:** Adapts to educational standards of the country
3. **Organization Context:** Considers the academic culture of the institution
4. **Education Level Awareness:** Uses appropriate terminology for the level
5. **Cultural Sensitivity:** Incorporates country-specific examples and references

## ⚠️ **IMPORTANT: New Required Structure**

**All API calls now REQUIRE the following structure:**

```json
{
  "message": "string (required)",
  "context": {
    "currentContent": "string (optional)",
    "teacherInfo": {
      "educationLevel": "string (REQUIRED)",
      "subjectArea": "string (REQUIRED)", 
      "country": "string (REQUIRED)",
      "academicYear": "string (REQUIRED)",
      "organization": "string (REQUIRED)",
      "language": "string (REQUIRED)"
    }
  }
}
```

## ❌ **Validation Errors:**

- **Missing context**: `"context" is required`
- **Missing teacherInfo**: `"teacherInfo" is required`
- **Missing educationLevel**: `"educationLevel" is required`
- **Missing subjectArea**: `"subjectArea" is required`
- **Missing country**: `"country" is required`
- **Missing academicYear**: `"academicYear" is required`
- **Missing organization**: `"organization" is required`
- **Missing language**: `"language" is required`

## 📝 **Notes:**

- The `currentContent` field provides context about what the teacher is currently working on
- The `teacherInfo` object contains all the contextual information needed for personalized responses
- **ALL fields in `teacherInfo` are REQUIRED** - no optional fields
- Responses will be culturally appropriate and pedagogically sound for the specific context
- Only the frontend context structure is supported - no legacy fields

## 📊 **Action Logs API**

### **GET /api/v1/logs/actions**
Get action logs with pagination and filtering

**Query Parameters:**
- `page` (optional): Page number (default: 1)
- `limit` (optional): Items per page (default: 50)
- `action` (optional): Filter by action type
- `coursePlanName` (optional): Filter by course plan name
- `startDate` (optional): Start date filter (ISO format)
- `endDate` (optional): End date filter (ISO format)
- `sortBy` (optional): Sort field (default: timestamp)
- `sortOrder` (optional): Sort order (default: desc)

**Example Request:**
```
GET http://localhost:3000/api/v1/logs/actions?page=1&limit=20&action=analyze-course-plan
```

### **GET /api/v1/logs/stats**
Get usage statistics

**Query Parameters:**
- `startDate` (optional): Start date filter (ISO format)
- `endDate` (optional): End date filter (ISO format)

**Example Request:**
```
GET http://localhost:3000/api/v1/logs/stats?startDate=2024-01-01T00:00:00Z
```

### **GET /api/v1/logs/recent**
Get recent actions (last 24 hours)

**Example Request:**
```
GET http://localhost:3000/api/v1/logs/recent
```

### **GET /api/v1/logs/course-plans**
Get logs for specific course plans

**Query Parameters:**
- `coursePlanName` (required): Course plan name to filter by
- `page` (optional): Page number (default: 1)
- `limit` (optional): Items per page (default: 20)

**Example Request:**
```
GET http://localhost:3000/api/v1/logs/course-plans?coursePlanName=Introduction to Computer Science
```

### **Expected Response Format:**
```json
{
  "success": true,
  "data": {
    "logs": [
      {
        "_id": "64f8a1b2c3d4e5f6a7b8c9d0",
        "userId": "user123",
        "sessionId": "session456",
        "ipAddress": "192.168.1.100",
        "timestamp": "2024-01-15T10:30:00Z",
        "action": "analyze-course-plan",
        "endpoint": "/api/v1/chatbot/analyze-a-course-plan",
        "method": "POST",
        "userInfo": {
          "educationLevel": "University",
          "subjectArea": "Computer Science",
          "country": "Norway",
          "organization": "University of Oslo",
          "language": "Norwegian"
        },
        "coursePlanName": "Introduction to Computer Science",
        "requestSize": 1500,
        "responseSize": 2000,
        "tokenUsage": {
          "promptTokens": 800,
          "completionTokens": 1200,
          "totalTokens": 2000
        },
        "processingTime": 3500,
        "success": true
      }
    ],
    "pagination": {
      "page": 1,
      "limit": 20,
      "total": 150,
      "pages": 8
    }
  }
}
```
