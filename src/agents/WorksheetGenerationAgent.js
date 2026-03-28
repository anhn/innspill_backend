const BaseAgent = require('./BaseAgent');

/**
 * Worksheet Generation Agent - Specialized in generating educational worksheets
 */
class WorksheetGenerationAgent extends BaseAgent {
  constructor(openaiClient, generationType) {
    super(`Worksheet ${generationType} Agent`, openaiClient);
    this.generationType = generationType; // 'learning-objectives', 'format-description', 'examples', 'worksheet'
  }

  getSystemPrompt() {
    const prompts = {
      'learning-objectives': `You are an expert educational content creator specializing in writing clear, measurable learning objectives.

Your task is to generate learning objectives based on the user's input text. Learning objectives should be:
- Clear and specific
- Measurable and achievable
- Aligned with educational standards
- Appropriate for the specified education level and subject area
- Written using action verbs (e.g., "Students will be able to...", "Learners will demonstrate...")

Response in the same language with the input text. Return the learning objectives as a well-formatted text block.`,

      'format-description': `You are an expert educational content creator specializing in designing worksheet formats and question types.

Your task is to generate a format description that specifies:
- Types of questions or tasks (multiple choice, short answer, essay, matching, etc.)
- Answer formats expected
- Structure and organization of the worksheet
- Assessment approach

The format description should be appropriate for:
- The specified education level and year/grade
- The subject area
- The learning objective
- The difficulty level

Response in the same language with the input text. Return a clear, detailed format description.`,

      'examples': `You are an expert educational content creator specializing in creating example questions and tasks.

Your task is to generate example questions or tasks that:
- Align with the learning objective
- Match the format description provided
- Are appropriate for the education level, year, and difficulty level
- Demonstrate the types of questions students will encounter
- Include clear instructions

Response in the same language with the input text. Return well-formatted example questions or tasks.`,

      'worksheet': `You are an expert educational content creator specializing in creating comprehensive educational worksheets.

Your task is to generate THREE separate documents:

1. **INSTRUCTION PAGE**: A clear, detailed instruction page that includes:
   - Overview of the worksheet
   - Learning objectives
   - Instructions for students on how to complete the worksheet
   - Time allocation (if applicable)
   - Materials needed (if applicable)
   - Grading criteria or expectations
   - Any special notes or guidelines

2. **WORKSHEET CONTENT**: The main worksheet with:
   - A clear title
   - Well-structured format
   - Appropriate questions/tasks based on the format description
   - Aligned with the learning objective
   - Appropriate for the education level, year, subject area, and difficulty level
   - May incorporate the provided examples if relevant
   - May include references if provided

3. **ANSWER SHEET**: A complete answer sheet that includes:
   - Answers to all questions in the worksheet
   - Explanations or solution steps where appropriate
   - Marking scheme or point allocation (if applicable)
   - Sample answers for open-ended questions

IMPORTANT: Your response MUST be in valid JSON format with three fields:
{
  "instructionPage": "Complete instruction page text",
  "worksheetContent": "Complete worksheet content with questions",
  "answerSheet": "Complete answer sheet with all answers"
}

All three documents should be professional, pedagogically sound, and ready for classroom use.

Response in the same language with the input text. Return ONLY the JSON object, no markdown, no explanations.`
    };

    return prompts[this.generationType] || prompts['worksheet'];
  }

  formatUserMessage(request) {
    const { generationType } = this;

    if (generationType === 'learning-objectives') {
      const { text, educationLevel, subjectArea } = request;
      let message = `Generate learning objectives based on the following text:\n\n"${text}"\n\n`;
      if (educationLevel) message += `Education Level: ${educationLevel}\n`;
      if (subjectArea) message += `Subject Area: ${subjectArea}\n`;
      return message;
    }

    if (generationType === 'format-description') {
      const { educationLevel, year, subjectArea, learningObjective, difficultyLevel } = request;
      return `Generate a format description for a worksheet with the following specifications:

Education Level: ${educationLevel}
Year/Grade: ${year}
Subject Area: ${subjectArea}
Learning Objective: ${learningObjective}
Difficulty Level: ${difficultyLevel}

Provide a detailed format description including question types, task formats, and answer formats.`;
    }

    if (generationType === 'examples') {
      const { educationLevel, year, subjectArea, learningObjective, difficultyLevel, formatDescription } = request;
      return `Generate example questions or tasks with the following specifications:

Education Level: ${educationLevel}
Year/Grade: ${year}
Subject Area: ${subjectArea}
Learning Objective: ${learningObjective}
Difficulty Level: ${difficultyLevel}
Format Description: ${formatDescription}

Provide example questions or tasks that match the format description.`;
    }

    if (generationType === 'worksheet') {
      const { educationLevel, year, subjectArea, learningObjective, difficultyLevel, formatDescription, examples, references, language } = request;
      let message = `Generate a complete worksheet with THREE separate documents (instruction page, worksheet content, and answer sheet) with the following specifications:

Education Level: ${educationLevel}
Year/Grade: ${year}
Subject Area: ${subjectArea}
Learning Objective: ${learningObjective}
Difficulty Level: ${difficultyLevel}
Format Description: ${formatDescription}
`;
      if (language) {
        message += `\nLanguage: ${language}\n`;
      }

      if (examples) message += `\nExamples to consider: ${examples}\n`;
      if (references) message += `\nReferences: ${references}\n`;

      message += `\nGenerate all three documents: instruction page, worksheet content with questions, and complete answer sheet. Return in JSON format as specified. If a language is specified, ensure ALL generated content is written entirely in that language.`;
      return message;
    }

    return request.text || JSON.stringify(request);
  }

  validateRequest(request) {
    if (this.generationType === 'learning-objectives') {
      return request && request.text && typeof request.text === 'string' && request.text.trim().length > 0;
    }

    if (this.generationType === 'format-description') {
      return request && 
             request.educationLevel && 
             request.year && 
             request.subjectArea && 
             request.learningObjective && 
             request.difficultyLevel;
    }

    if (this.generationType === 'examples') {
      return request && 
             request.educationLevel && 
             request.year && 
             request.subjectArea && 
             request.learningObjective && 
             request.difficultyLevel && 
             request.formatDescription;
    }

    if (this.generationType === 'worksheet') {
      return request && 
             request.educationLevel && 
             request.year && 
             request.subjectArea && 
             request.learningObjective && 
             request.difficultyLevel && 
             request.formatDescription;
    }

    return false;
  }
}

module.exports = WorksheetGenerationAgent;

