const BaseAgent = require('./BaseAgent');

/**
 * Prompt Revision Agent - Specialized in analyzing and revising user prompts
 */
class PromptRevisionAgent extends BaseAgent {
  constructor(openaiClient) {
    super('Prompt Revision Agent', openaiClient);
  }

  getSystemPrompt() {
    return `You are a Prompt Revision Agent, an expert in analyzing and improving prompts for educational AI tools.

Your task is to:
1. Analyze the given prompt for clarity, specificity, and effectiveness
2. Identify strengths and weaknesses in the prompt
3. Provide detailed analysis feedback
4. Generate a revised, improved version of the prompt

When analyzing prompts, consider:
- Clarity: Is the prompt clear and unambiguous?
- Specificity: Does it provide enough detail for the AI to generate a useful response?
- Context: Does it include necessary context (grade level, subject, duration, etc.)?
- Actionability: Will the AI be able to generate a concrete, actionable response?
- Completeness: Are all necessary components mentioned (objectives, activities, assessments, etc.)?

IMPORTANT: Your response MUST be valid JSON only, with no additional text before or after. Use this exact format:
{
  "analysis": "Detailed analysis of the prompt including strengths, weaknesses, and specific suggestions for improvement",
  "revisedPrompt": "The improved version of the prompt that addresses the identified issues"
}

Response in the same language with the input text. Return ONLY the JSON object, no markdown, no explanations.`;
  }

  formatUserMessage(request) {
    const { prompt } = request;
    return `Please analyze and revise the following prompt:\n\n"${prompt}"\n\nProvide your analysis and revised version in the JSON format specified.`;
  }

  async process(request) {
    try {
      const response = await super.process(request);
      
      if (!response.success) {
        return response;
      }

      // Try to parse JSON from the response
      let analysis = '';
      let revisedPrompt = '';

      try {
        const responseText = response.response.trim();
        
        // Remove markdown code blocks if present
        let jsonText = responseText.replace(/```(?:json)?\s*/g, '').replace(/```\s*/g, '').trim();
        
        // Try to find JSON object
        const jsonMatch = jsonText.match(/\{[\s\S]*\}/);
        
        if (jsonMatch) {
          const parsed = JSON.parse(jsonMatch[0]);
          analysis = parsed.analysis || '';
          revisedPrompt = parsed.revisedPrompt || '';
        } else {
          // Try parsing the whole response
          const parsed = JSON.parse(jsonText);
          analysis = parsed.analysis || '';
          revisedPrompt = parsed.revisedPrompt || '';
        }
        
        // Fallback: if parsing succeeded but fields are empty, use response text
        if (!analysis && !revisedPrompt) {
          analysis = responseText;
          revisedPrompt = responseText;
        }
      } catch (parseError) {
        console.warn('⚠️ Failed to parse JSON response, using fallback:', parseError.message);
        // If JSON parsing fails, split the response intelligently
        const responseText = response.response;
        const lines = responseText.split('\n');
        
        // Try to find analysis and revised sections
        let inAnalysis = false;
        let inRevised = false;
        
        for (const line of lines) {
          const lowerLine = line.toLowerCase();
          if (lowerLine.includes('analysis') && (lowerLine.includes(':') || lowerLine.includes('-'))) {
            inAnalysis = true;
            inRevised = false;
            const cleanLine = line.replace(/.*analysis:?\s*/i, '').trim();
            if (cleanLine) analysis += cleanLine + '\n';
          } else if ((lowerLine.includes('revised') || lowerLine.includes('improved')) && (lowerLine.includes(':') || lowerLine.includes('-'))) {
            inRevised = true;
            inAnalysis = false;
            const cleanLine = line.replace(/.*revised.*:?\s*/i, '').replace(/.*improved.*:?\s*/i, '').trim();
            if (cleanLine) revisedPrompt += cleanLine + '\n';
          } else if (inAnalysis) {
            analysis += line.trim() + '\n';
          } else if (inRevised) {
            revisedPrompt += line.trim() + '\n';
          }
        }
        
        // Final fallback: use the whole response for both
        if (!analysis.trim() && !revisedPrompt.trim()) {
          analysis = responseText;
          revisedPrompt = responseText;
        }
      }

      return {
        success: true,
        agent: this.name,
        response: {
          analysis: analysis.trim(),
          revisedPrompt: revisedPrompt.trim()
        },
        usage: response.usage,
        usageInternal: response.usageInternal
      };
    } catch (error) {
      console.error(`❌ Error in ${this.name}:`, error.message);
      return {
        success: false,
        agent: this.name,
        error: error.message
      };
    }
  }

  validateRequest(request) {
    return request && request.prompt && typeof request.prompt === 'string' && request.prompt.trim().length > 0;
  }
}

module.exports = PromptRevisionAgent;

