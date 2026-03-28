const BaseAgent = require('./BaseAgent');

/**
 * Post-Processing Formatter Agent - Specialized in translating, revising, formatting, and structuring documents
 */
class PostProcessingFormatter extends BaseAgent {
  constructor(openaiClient) {
    super('Post-Processing Formatter Agent', openaiClient);
  }


  formatUserMessage(request) {
    const { message, context } = request;
    let formattedMessage = message;
    
    if (context && context.text) {
      formattedMessage += `\n\n--- DOCUMENT TO FORMAT ---\n${context.text}`;
    }
    
    return formattedMessage;
  }

  validateRequest(request) {
    return super.validateRequest(request);
  }

  /**
   * Format, revise, and optionally translate a document
   * @param {string} text - Text to format and process
   * @param {string} targetLanguage - Target language (optional, defaults to source language)
   * @returns {Promise<Object>} - Formatting result
   */
  async format(text, targetLanguage = null) {
    try {
      // Clean up multiple consecutive newlines (possibly with spaces between them)
      text = text.replace(/\n\s*\n+/g, '\n');
      
      // For now, just return the cleaned text without additional formatting
      // Future: Can add translation or additional formatting here
      
      return {
        success: true,
        response: text,
        formatted: false, // Indicates no additional formatting was applied
        translated: false
      };
    } catch (error) {
      console.error('❌ Error in PostProcessingFormatter:', error.message);
      return {
        success: false,
        error: error.message
      };
    }
  }

  /**
   * Alias for backward compatibility - translate method
   * @param {string} text - Text to translate and format
   * @param {string} targetLanguage - Target language
   * @returns {Promise<Object>} - Translation and formatting result
   */
  async translate(text, targetLanguage) {
    return this.format(text, targetLanguage);
  }
}

module.exports = PostProcessingFormatter;

