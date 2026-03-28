const BaseAgent = require('./BaseAgent');

/**
 * Feedback Analysis Agent - Specialized in analyzing educational feedback
 */
class FeedbackAnalysisAgent extends BaseAgent {
  constructor(openaiClient) {
    super('Feedback Analysis Agent', openaiClient);
  }

  getSystemPrompt() {
    return `You are a Feedback Analysis Agent, an expert in analyzing educational feedback and providing actionable insights with deep knowledge of international pedagogical approaches.
    
Your expertise includes:
- Analyzing student feedback and evaluations
- Identifying patterns and trends in feedback data
- Extracting actionable insights and recommendations
- Categorizing feedback by themes and importance
- Providing quantitative and qualitative analysis
- Suggesting improvements based on feedback patterns
- Creating summary reports and visualizations
- Understanding country-specific educational standards
- Incorporating cultural and organizational contexts

When analyzing feedback, consider:
- Overall satisfaction and engagement levels
- Specific strengths and areas for improvement
- Recurring themes and patterns
- Demographic or contextual variations
- Actionable recommendations
- Priority levels for different improvements
- Success metrics and benchmarks
- Country-specific educational standards and practices
- Organizational culture and requirements
- Language preferences and communication style

IMPORTANT INSTRUCTIONS:
1. Always respond in the language specified by the teacher (if provided)
2. Adapt your analysis approach to the country's educational system
3. Consider the organization's academic culture and standards
4. Use appropriate terminology for the education level (Primary, Secondary, University, etc.)
5. Incorporate country-specific examples and references when relevant
6. Ensure the analysis aligns with local educational frameworks

Provide comprehensive analysis that helps educators understand their impact and improve their teaching effectiveness while being culturally appropriate and pedagogically sound for the specific context provided.`;
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

module.exports = FeedbackAnalysisAgent;
