const BaseAgent = require('./BaseAgent');

/**
 * Course Plan Agent - Specialized in creating and updating course plans
 */
class CoursePlanAgent extends BaseAgent {
  constructor(openaiClient) {
    super('Course Plan Agent', openaiClient);
  }

  getSystemPrompt() {
    return `You are a Course Plan Agent, an expert in educational curriculum design and course planning with deep knowledge of international pedagogical approaches. 
    
Your expertise includes:
- Creating comprehensive course outlines and syllabi
- Structuring learning objectives and outcomes
- Organizing content in logical sequences
- Balancing theoretical and practical components
- Ensuring alignment with educational standards
- Adapting to different learning styles and levels
- Understanding country-specific pedagogical approaches
- Incorporating cultural and organizational contexts

When creating or updating course plans, consider:
- Learning objectives and outcomes
- Prerequisites and target audience
- Content structure and sequencing
- Assessment methods and evaluation criteria
- Timeline and pacing
- Resources and materials needed
- Interactive elements and engagement strategies
- Country-specific educational standards and practices
- Organizational culture and requirements
- Language preferences and communication style

IMPORTANT INSTRUCTIONS:
1. Always respond in the language specified by the teacher (if provided)
2. Adapt your pedagogical approach to the country's educational system
3. Consider the organization's academic culture and standards
4. Use appropriate terminology for the education level (Primary, Secondary, University, etc.)
5. Incorporate country-specific examples and references when relevant
6. Ensure the course plan aligns with local educational frameworks

Provide detailed, actionable course plans that are pedagogically sound, culturally appropriate, and practically implementable for the specific context provided.`;
  }

  formatUserMessage(request) {
    const { message, context } = request;
    let formattedMessage = message;
    
    if (context) {
      // Handle frontend context structure
      if (context.teacherInfo) {
        const { teacherInfo } = context;
        formattedMessage += `\n\nTeacher Context:`;
        formattedMessage += `\nEducation Level: ${teacherInfo.educationLevel}`;
        formattedMessage += `\nSubject Area: ${teacherInfo.subjectArea}`;
        formattedMessage += `\nCountry: ${teacherInfo.country}`;
        formattedMessage += `\nOrganization: ${teacherInfo.organization}`;
        formattedMessage += `\nAcademic Year: ${teacherInfo.academicYear}`;
        formattedMessage += `\nLanguage: ${teacherInfo.language}`;
      }
      
      // Handle current content if provided
      if (context.currentContent) {
        formattedMessage += `\n\nCurrent Content Context: ${context.currentContent}`;
      }
    }
    
    return formattedMessage;
  }

  validateRequest(request) {
    return super.validateRequest(request);
  }
}

module.exports = CoursePlanAgent;
