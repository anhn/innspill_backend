# Assessment Quizzes API - Input/Output Templates

## Base URL
- Development: `http://localhost:3000/api/v1/assessment-quizzes`
- Production: `https://innspill.ai/microapi/api/v1/assessment-quizzes`

## Authentication
All endpoints use `isOptionalAuth` middleware (authentication is optional).

---

## 1. Generate Quiz (AI-Powered)

### `POST /assessment-quizzes/generate`

**Description:** Generates a quiz using AI based on project learning objectives and task keywords.

**Input (Request Body):**
```json
{
  "projectId": "string (required)",           // MongoDB ObjectId of the project
  "taskIds": ["string"],                      // Optional: Array of task IDs to extract keywords from
  "keywords": ["string"],                     // Optional: Array of keywords for quiz generation
  "learningObjectives": "string",             // Optional: Learning objectives text (uses project.learningOutcome if not provided)
  "numberOfQuestions": 10                     // Optional: Number of questions to generate (1-50, default: 10)
}
```

**Output (Success - 200):**
```json
{
  "success": true,
  "data": {
    "id": "string",                          // Quiz MongoDB ObjectId
    "projectId": "string",                   // Project MongoDB ObjectId
    "questions": [
      {
        "id": "string",                      // Question ID (auto-generated if not provided)
        "question": "string",                // Question text
        "options": ["string", "string", "string", "string"],  // Array of 4 options (minimum 2)
        "correctAnswer": 0                    // 0-based index of correct answer (0 = first option)
      }
    ],
    "history": [],                           // Empty array for new quiz
    "createdAt": "ISO 8601 datetime",
    "updatedAt": "ISO 8601 datetime"
  },
  "usage": {                                 // OpenAI API usage stats
    "prompt_tokens": 0,
    "completion_tokens": 0,
    "total_tokens": 0
  },
  "usageInternal": {                        // Internal token estimation
    "promptTokens": 0,
    "completionTokens": 0,
    "totalTokens": 0,
    "method": "heuristic(words*0.75 vs chars/4)"
  },
  "processingTime": 0                        // Processing time in milliseconds
}
```

**Output (Error - 400/404/500):**
```json
{
  "success": false,
  "message": "string",                       // Error message
  "error": "string"                          // Detailed error (only in non-production)
}
```

---

## 2. Create Quiz (Manual)

### `POST /assessment-quizzes`

**Description:** Creates a quiz manually with provided questions.

**Input (Request Body):**
```json
{
  "projectId": "string (required)",          // MongoDB ObjectId of the project
  "questions": [                             // Required: Array of questions (minimum 1)
    {
      "id": "string",                        // Optional: Question ID (auto-generated if not provided)
      "question": "string (required)",       // Question text
      "options": ["string", "string", ...],  // Required: Array of options (minimum 2)
      "correctAnswer": 0                      // Required: 0-based index of correct answer
    }
  ]
}
```

**Output (Success - 201):**
```json
{
  "success": true,
  "data": {
    "id": "string",
    "projectId": "string",
    "questions": [
      {
        "id": "string",
        "question": "string",
        "options": ["string"],
        "correctAnswer": 0
      }
    ],
    "history": [],
    "createdAt": "ISO 8601 datetime",
    "updatedAt": "ISO 8601 datetime"
  }
}
```

**Output (Error - 400/404/500):**
```json
{
  "success": false,
  "message": "string",
  "error": "string"
}
```

---

## 3. Get Quiz by ID

### `GET /assessment-quizzes/:id`

**Description:** Retrieves a quiz by its ID, including version history.

**Input (URL Parameters):**
- `id`: Quiz MongoDB ObjectId (required)

**Output (Success - 200):**
```json
{
  "success": true,
  "data": {
    "id": "string",
    "projectId": "string",
    "questions": [
      {
        "id": "string",
        "question": "string",
        "options": ["string"],
        "correctAnswer": 0
      }
    ],
    "history": [                             // Array of previous versions
      {
        "id": "string",                      // History item ID
        "questions": [                       // Previous version of questions
          {
            "id": "string",
            "question": "string",
            "options": ["string"],
            "correctAnswer": 0
          }
        ],
        "createdAt": "ISO 8601 datetime",
        "updatedBy": "string"                // Username who made the update
      }
    ],
    "createdAt": "ISO 8601 datetime",
    "updatedAt": "ISO 8601 datetime"
  }
}
```

**Output (Error - 400/404/500):**
```json
{
  "success": false,
  "message": "string",
  "error": "string"
}
```

---

## 4. Get Quizzes by Project

### `GET /assessment-quizzes/project/:projectId`

**Description:** Retrieves all quizzes for a specific project.

**Input (URL Parameters):**
- `projectId`: Project MongoDB ObjectId (required)

**Input (Query Parameters - Optional):**
- `userName`: string (optional, not used in query)

**Output (Success - 200):**
```json
{
  "success": true,
  "data": [                                  // Array of quizzes
    {
      "id": "string",
      "projectId": "string",
      "questions": [
        {
          "id": "string",
          "question": "string",
          "options": ["string"],
          "correctAnswer": 0
        }
      ],
      "history": [
        {
          "id": "string",
          "questions": [...],
          "createdAt": "ISO 8601 datetime",
          "updatedBy": "string"
        }
      ],
      "createdAt": "ISO 8601 datetime",
      "updatedAt": "ISO 8601 datetime"
    }
  ]
}
```

**Output (Error - 400/500):**
```json
{
  "success": false,
  "message": "string",
  "error": "string"
}
```

---

## 5. List All Quizzes

### `GET /assessment-quizzes`

**Description:** Lists all quizzes, optionally filtered by project.

**Input (Query Parameters - Optional):**
- `userName`: string (optional, not used in query)
- `projectId`: string (optional, MongoDB ObjectId to filter by project)

**Output (Success - 200):**
```json
{
  "success": true,
  "data": [                                  // Array of quizzes (same structure as Get by Project)
    {
      "id": "string",
      "projectId": "string",
      "questions": [...],
      "history": [...],
      "createdAt": "ISO 8601 datetime",
      "updatedAt": "ISO 8601 datetime"
    }
  ]
}
```

**Output (Error - 400/500):**
```json
{
  "success": false,
  "message": "string",
  "error": "string"
}
```

---

## 6. Update Quiz

### `PUT /assessment-quizzes/:id`

**Description:** Updates a quiz. The previous version is automatically saved to history.

**Input (URL Parameters):**
- `id`: Quiz MongoDB ObjectId (required)

**Input (Request Body):**
```json
{
  "questions": [                             // Required: Array of questions (minimum 1)
    {
      "id": "string",                        // Optional: Question ID (auto-generated if not provided)
      "question": "string (required)",       // Question text
      "options": ["string", "string", ...],  // Required: Array of options (minimum 2)
      "correctAnswer": 0                      // Required: 0-based index of correct answer
    }
  ],
  "updatedBy": "string (required)"           // Username of person making the update
}
```

**Output (Success - 200):**
```json
{
  "success": true,
  "data": {
    "id": "string",
    "projectId": "string",
    "questions": [
      {
        "id": "string",
        "question": "string",
        "options": ["string"],
        "correctAnswer": 0
      }
    ],
    "history": [                             // Includes the previous version that was just saved
      {
        "id": "string",
        "questions": [...],                  // Previous version of questions
        "createdAt": "ISO 8601 datetime",
        "updatedBy": "string"
      }
    ],
    "createdAt": "ISO 8601 datetime",
    "updatedAt": "ISO 8601 datetime"
  }
}
```

**Output (Error - 400/404/500):**
```json
{
  "success": false,
  "message": "string",
  "error": "string"
}
```

**Note:** When updating, the current questions are saved to the `history` array before updating, preserving version history.

---

## 7. Delete Quiz

### `DELETE /assessment-quizzes/:id`

**Description:** Deletes a quiz by ID.

**Input (URL Parameters):**
- `id`: Quiz MongoDB ObjectId (required)

**Output (Success - 200):**
```json
{
  "success": true,
  "message": "Quiz deleted successfully"
}
```

**Output (Error - 400/404/500):**
```json
{
  "success": false,
  "message": "string",
  "error": "string"
}
```

---

## 8. Get Quiz Leaderboard

### `GET /assessment-quizzes/:quizId/leaderboard`

**Description:** Retrieves the leaderboard for a quiz, sorted by score (descending).

**Input (URL Parameters):**
- `quizId`: Quiz MongoDB ObjectId (required)

**Input (Query Parameters - Optional):**
- `userName`: string (optional, not used in query)

**Output (Success - 200):**
```json
{
  "success": true,
  "data": [                                  // Array sorted by score (descending)
    {
      "studentId": "string",
      "studentName": "string",
      "score": 85,                            // Score (0-100)
      "totalQuestions": 10,                   // Total number of questions in quiz
      "correctAnswers": 8,                   // Number of correct answers
      "completedAt": "ISO 8601 datetime"
    }
  ]
}
```

**Output (Error - 400/404/500):**
```json
{
  "success": false,
  "message": "string",
  "error": "string"
}
```

---

## 9. Get Student Quiz Answers

### `GET /assessment-quizzes/:quizId/student/:studentId`

**Description:** Retrieves a specific student's quiz attempt with detailed answer information.

**Input (URL Parameters):**
- `quizId`: Quiz MongoDB ObjectId (required)
- `studentId`: string (required) - Student identifier

**Input (Query Parameters - Optional):**
- `userName`: string (optional, not used in query)

**Output (Success - 200):**
```json
{
  "success": true,
  "data": {
    "studentId": "string",
    "studentName": "string",
    "quizId": "string",
    "answers": [
      {
        "questionId": "string",
        "question": "string",
        "options": ["string"],
        "correctAnswer": 0,                  // 0-based index
        "studentAnswer": 1,                  // 0-based index of student's answer
        "isCorrect": false,                  // Whether student's answer is correct
        "comment": "string"                  // Optional: Student's comment on the answer
      }
    ],
    "score": 85,                             // Overall score (0-100)
    "completedAt": "ISO 8601 datetime"
  }
}
```

**Output (Error - 400/404/500):**
```json
{
  "success": false,
  "message": "string",
  "error": "string"
}
```

---

## Data Models

### Question Object
```typescript
{
  id: string;                    // Unique question identifier
  question: string;              // Question text
  options: string[];             // Array of answer options (minimum 2)
  correctAnswer: number;         // 0-based index of correct answer
}
```

### History Item Object
```typescript
{
  id: string;                    // Unique history item identifier
  questions: Question[];         // Array of questions from previous version
  createdAt: Date;               // When this version was created
  updatedBy: string;             // Username who made the update
}
```

### Quiz Object
```typescript
{
  id: string;                    // MongoDB ObjectId
  projectId: string;             // MongoDB ObjectId (references Project)
  questions: Question[];         // Current version of questions
  history: HistoryItem[];        // Array of previous versions
  createdAt: Date;               // Auto-generated timestamp
  updatedAt: Date;               // Auto-generated timestamp
}
```

---

## Common Error Responses

### 400 Bad Request
```json
{
  "success": false,
  "message": "Invalid request body",
  "error": "Validation error details"
}
```

### 404 Not Found
```json
{
  "success": false,
  "message": "Quiz not found"
}
```

### 500 Internal Server Error
```json
{
  "success": false,
  "message": "Failed to [operation]",
  "error": "Error details (only in non-production)"
}
```

---

## Notes

1. **Question IDs**: If not provided, question IDs are auto-generated using MongoDB ObjectId strings.

2. **Version History**: When updating a quiz, the previous version is automatically saved to the `history` array before applying updates.

3. **Correct Answer Index**: The `correctAnswer` field uses 0-based indexing:
   - `0` = first option
   - `1` = second option
   - `2` = third option
   - `3` = fourth option

4. **Options Array**: Each question must have at least 2 options, but typically has 4 options for multiple-choice questions.

5. **AI Generation**: The `/generate` endpoint uses OpenAI GPT-4o-mini to generate questions based on:
   - Project learning objectives
   - Task keywords (extracted from provided taskIds)
   - Additional keywords provided directly

6. **Authentication**: All endpoints use optional authentication (`isOptionalAuth`), meaning authentication is not strictly required but can be provided.

