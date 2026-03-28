const BaseAgent = require('./BaseAgent');
const PostProcessingFormatter = require('./PostProcessingFormatter');

/**
 * Course Plan Revision Agent - Specialized in generating revised course plans based on analysis and original plans
 */
class CoursePlanRevisionAgent extends BaseAgent {
  constructor(openaiClient) {
    super('Course Plan Revision Agent', openaiClient);
    this.postProcessingFormatter = new PostProcessingFormatter(openaiClient);
  }


  /**
   * Get the maximum tokens for this agent
   * Course plan revision requires more tokens for comprehensive revised plans
   */
  getMaxTokens() {
    return 10000; // Higher limit for comprehensive course plan revision
  }

  getSystemPrompt() {
    return `You are a Course Plan Revision Agent, an expert in implementing AI impact analysis recommendations into comprehensive course plans.

Your primary task is to:

**STEP 1: RECOMMENDATION EXTRACTION**
- Carefully read through the Analysis section
- Identify all recommendations by word Recommendation
- Itentify associated Reasons or explanation to the Recommendation

**STEP 2: IMPLEMENTATION STRATEGY**
For each recommendation, determine the appropriate action:
- **MODIFY**: Change existing text to implement the recommendation
- **ADD**: Insert new content based on the recommendation
- **REMOVE**: Delete content that the recommendation identifies as problematic

**STEP 3: CHANGE TRACKING**
Format all changes as follows:
- **Revised text** *(reason for change)*
- **NEW: Added content** *(reason for addition)*

**STEP 4: COMPREHENSIVE REVISION**
Ensure the revised plan:
- Addresses ALL analysis comments systematically
- Maintains logical flow and coherence
- Preserves essential course objectives
- Incorporates AI literacy and responsible AI use
- Reflects current AI applications from search results

RESPONSE FORMAT REQUIREMENTS:

Your response must be a complete, revised course plan with:

1. **PRESERVED STRUCTURE**: Keep the original plan's organizational format
2. **IMPLEMENTED CHANGES**: Every analysis comment must be addressed
3. **CLEAR TRACKING**: All changed word, clauses or sentences marked with **bold** formatting
4. **EXPLANATIONS**: Every change explained in *(italic)* parentheses
5. **COMPLETENESS**: Full course plan with all sections revised as needed


Provide a complete, revised course plan that systematically implements all analysis recommendations with clear change tracking and explanations.`;
  }

  /**
   * Override the process method to include language translation
   * @param {Object} request - The request object
   * @returns {Promise<Object>} - The response from the agent
   */
  async process(request) {
    try {
      // Get the original response from the parent process method
      const originalResponse = await super.process(request);
      
      // If the response was successful, format and optionally translate it
      if (originalResponse.success && request.context && request.context.teacherInfo && request.context.teacherInfo.language) {
        const targetLanguage = request.context.teacherInfo.language;
        const formatResult = await this.postProcessingFormatter.format(originalResponse.response, targetLanguage);
        
        if (formatResult.success) {
          return {
            ...originalResponse,
            response: formatResult.response,
            agent: `${originalResponse.agent} (Formatted)`
          };
        } else {
          console.error('❌ Formatting failed:', formatResult.error);
          return originalResponse;
        }
      }
      
      return originalResponse;
    } catch (error) {
      console.error(`❌ Error in ${this.name}:`, error.message);
      return {
        success: false,
        agent: this.name,
        error: error.message
      };
    }
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
      
      // Handle current content (original plan + analysis) if provided
      if (context.currentContent) {
        formattedMessage += `\n\nContent to Revise:\n${context.currentContent}`;
      }
    }
    
    return formattedMessage;
  }

  validateRequest(request) {
    return super.validateRequest(request);
  }
}

module.exports = CoursePlanRevisionAgent;
