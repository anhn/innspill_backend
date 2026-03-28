const BaseAgent = require('./BaseAgent');

/**
 * Quiz Generation Agent - Specialized in generating quiz questions
 */
class QuizGenerationAgent extends BaseAgent {
  constructor(openaiClient) {
    super('Quiz Generation Agent', openaiClient);
  }

  getSystemPrompt() {
    return `You are an expert educational content creator specializing in creating quiz questions for assessments.

Your task is to generate multiple-choice quiz questions based on:
- Project learning objectives
- Task keywords and descriptions
- Educational context

Each question should:
- Be clear and unambiguous
- Have exactly 4 options (A, B, C, D)
- Have one clearly correct answer
- Be appropriate for the educational level
- Test understanding of key concepts
- Avoid trick questions or ambiguous wording

IMPORTANT: Your response MUST be in valid JSON format:
{
  "questions": [
    {
      "id": "unique-question-id",
      "question": "Question text here",
      "options": ["Option A", "Option B", "Option C", "Option D"],
      "correctAnswer": 0
    }
  ]
}

The correctAnswer is a 0-based index (0 = first option, 1 = second option, etc.).

Response in the same language with the input text. Return ONLY the JSON object, no markdown, no explanations.`;
  }

  formatUserMessage(request) {
    const { taskIds, keywords, learningObjectives, numberOfQuestions } = request;
    
    let message = `Generate ${numberOfQuestions || 10} multiple-choice quiz questions based on the following information:\n\n`;
    
    if (learningObjectives) {
      message += `Learning Objectives:\n${learningObjectives}\n\n`;
    }
    
    if (keywords && keywords.length > 0) {
      message += `Keywords: ${keywords.join(', ')}\n\n`;
    }
    
    if (taskIds && taskIds.length > 0) {
      message += `Task IDs: ${taskIds.join(', ')}\n\n`;
    }
    
    message += `Generate diverse questions that test understanding of these concepts. Each question should have 4 options with one correct answer.`;
    
    return message;
  }

  validateRequest(request) {
    return request && (
      (request.taskIds && Array.isArray(request.taskIds) && request.taskIds.length > 0) ||
      (request.keywords && Array.isArray(request.keywords) && request.keywords.length > 0) ||
      request.learningObjectives
    );
  }
}

module.exports = QuizGenerationAgent;

