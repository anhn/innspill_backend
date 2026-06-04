/**
 * Base Agent class for the multi-agent system
 * All specialized agents inherit from this base class
 */
class BaseAgent {
  constructor(name, openaiClient) {
    this.name = name;
    this.openaiClient = openaiClient;
    const languageDirective = 'Response in the same language with the input text.';
    this.systemPrompt = `${this.getSystemPrompt().trim()}\n\n${languageDirective}`;
  }

  /**
   * Get the system prompt for this agent
   * Override this method in subclasses
   */
  getSystemPrompt() {
    return `You are ${this.name}, an AI assistant specialized in educational tasks.`;
  }

  /**
   * Get the maximum tokens for this agent
   * Override this method in subclasses for custom token limits
   */
  getMaxTokens() {
    return 8000; // Default token limit
  }

  /**
   * Process a request using OpenAI GPT-4o mini
   * @param {Object} request - The request object
   * @param {string} request.message - The user message
   * @param {Object} request.context - Additional context
   * @returns {Promise<Object>} - The response from the agent
   */
  async process(request) {
    try {
      // Internal token estimator (heuristic)
      const estimateTokens = (text) => {
        if (!text) return 0;
        const s = String(text);
        const words = s.trim().length ? s.trim().split(/\s+/).length : 0;
        const chars = s.length;
        return Math.max(Math.round(words * 0.75), Math.round(chars / 4));
      };

      const messages = [
        {
          role: "system",
          content: this.systemPrompt
        },
        {
          role: "user",
          content: this.formatUserMessage(request)
        }
      ];

      // Estimate prompt tokens from system + user messages
      const estimatedPromptTokens = estimateTokens(messages.map(m => m.content).join('\n'));
      
      const apiStartTime = Date.now();
      
      // Add timeout protection for individual API calls
      const response = await Promise.race([
        this.openaiClient.chat.completions.create({
          model: "gpt-5.4-mini",
          messages: messages,
          temperature: 0.7,
          max_completion_tokens: this.getMaxTokens()
        }),
        new Promise((_, reject) => 
          setTimeout(() => reject(new Error(`OpenAI API timeout after 120s in ${this.name}`)), 120000)
        )
      ]);
      
      const apiDuration = Date.now() - apiStartTime;
      const outputText = response.choices[0].message.content;
      const estimatedCompletionTokens = estimateTokens(outputText);

      return {
        success: true,
        agent: this.name,
        response: outputText,
        usage: response.usage,
        usageInternal: {
          promptTokens: estimatedPromptTokens,
          completionTokens: estimatedCompletionTokens,
          totalTokens: estimatedPromptTokens + estimatedCompletionTokens,
          method: 'heuristic(words*0.75 vs chars/4)'
        }
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

  /**
   * Format the user message for this specific agent
   * Override this method in subclasses for specialized formatting
   * @param {Object} request - The request object
   * @returns {string} - Formatted message
   */
  formatUserMessage(request) {
    return request.message;
  }

  /**
   * Validate the request for this agent
   * Override this method in subclasses for specific validation
   * @param {Object} request - The request object
   * @returns {boolean} - Whether the request is valid
   */
  validateRequest(request) {
    return request && request.message && typeof request.message === 'string';
  }
}

module.exports = BaseAgent;
