const BaseAgent = require('./BaseAgent');

/**
 * Stakeholder Chat Agent
 * - Responds strictly as the stakeholder persona
 * - Uses minimal, relevant, persona-consistent answers
 * - Avoids repeating conversation history
 * - Adapts language to student
 */
class StakeholderChatAgent extends BaseAgent {
  constructor(openaiClient, persona) {
    super('Stakeholder Chat Agent', openaiClient);
    this.persona = persona || '';
    const languageDirective = 'Response in the same language with the input text.';
    this.systemPrompt = `${this.getSystemPrompt().trim()}\n\n${languageDirective}`;  }

  /**
   * System prompt — strict, concise, and safe.
  
  getSystemPrompt() {
    return `
You are a Stakeholder Chat Agent. You reply STRICTLY as the stakeholder persona provided.

RULES:
1. ALWAYS reply in the same language as the student's message.
2. NEVER repeat or quote previous conversation messages.
3. NEVER reply on behalf of the student.
4. ONLY answer the student's latest message, using context for background.
5. Keep responses SHORT (2–5 sentences max), focused, and relevant.
6. Maintain the stakeholder's tone, expertise, and perspective at all times.
7. If the student's question is unclear, ask a brief clarifying question.
8. DO NOT generate long essays or generic lectures.

You may use the conversation history only as context, NEVER to restate or summarize it.

${this.persona ? `### Stakeholder Persona:\n${this.persona}\n` : ''}
`;
  } **/

getSystemPrompt() {
  return `
  You are a Stakeholder Chat Agent.

  You MUST respond strictly and exclusively according to the stakeholder persona defined in \`this.persona\`.
  Treat \`this.persona\` as the single source of truth for the stakeholder’s:
  – name and identity
  – role and responsibilities
  – domain knowledge and expertise
  – values, priorities, and concerns
  – personality, attitude, and communication style
  – limitations, constraints, and decision power
  – any stated background, experience, or memory

  BEHAVIOR RULES:
  1. ALWAYS reply in the same language as the student’s latest message.
  2. NEVER repeat, quote, or paraphrase earlier conversation messages.
  3. NEVER speak on behalf of the student or assume the student’s intentions.
  4. Respond ONLY to the student’s latest message, using prior conversation solely as background context.
  5. Keep replies SHORT and precise (2–5 sentences maximum).
  6. Maintain the stakeholder’s tone, perspective, and level of authority at all times.
  7. DO NOT produce generic explanations, lectures, or neutral assistant-style responses.

  If a response cannot be justified using the information in \`this.persona\`, you MUST NOT invent details.

  ${this.persona ? `### Stakeholder Persona\n${this.persona}\n` : ''}
  `;
}

  /**
   * Override process method to build messages array properly
   * FIX 1: Use proper message array format instead of concatenation
   */
  async process(request) {
    try {
      if (!this.validateRequest(request)) {
        return {
          success: false,
          agent: this.name,
          error: 'Invalid request'
        };
      }

      const { message, context } = request;

      // Print context values to console
      //if (context) {
      //  console.log('📋 Project Context:', context.projectContext);
      //  console.log('📋 Task Context:', context.taskContext);
      //  console.log('📋 Conversation History:', context.conversationHistory);
      //}

      // Build messages array properly
      const messages = [
        { role: "system", content: this.systemPrompt }
      ];

      // Add conversation history as separate messages
      if (context && context.conversationHistory) {
        const history = context.conversationHistory;
        
        if (Array.isArray(history)) {
          // History is array of message objects
          history.forEach(m => {
            if (m && typeof m === 'object' && m.message) {
              // Use role field if available, otherwise fall back to sender check
              const isStudentMessage = m.role === 'student' || 
                                      (m.sender && m.sender !== "stakeholder" && 
                                       !m.sender.toLowerCase().includes('stakeholder'));
              messages.push({
                role: isStudentMessage ? "user" : "assistant",
                content: m.message
              });
            }
          });
        }
      }

      // Add project/task context to system message if needed
      let systemContext = '';
      if (context) {
        if (context.projectContext) {
          systemContext += `\n\nProject Context: ${context.projectContext}`;
        }
        if (context.taskContext) {
          systemContext += `\n\nTask Context: ${context.taskContext}`;
        }
      }
      
      if (systemContext) {
        messages[0].content += systemContext;
      }

      // Add the NEW user message
      messages.push({
        role: "user",
        content: message
      });

      // Estimate tokens
      const estimateTokens = (text) => {
        if (!text) return 0;
        const s = String(text);
        const words = s.trim().length ? s.trim().split(/\s+/).length : 0;
        const chars = s.length;
        return Math.max(Math.round(words * 0.75), Math.round(chars / 4));
      };

      const estimatedPromptTokens = estimateTokens(messages.map(m => m.content).join('\n'));

      const apiStartTime = Date.now();
      //console.log('📋 Input for OpenAI:', messages);

      // Call OpenAI API
      const response = await Promise.race([
        this.openaiClient.chat.completions.create({
          model: "gpt-4o-mini",
          messages: messages,
          temperature: 0.7,
          max_tokens: this.getMaxTokens()
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
   * Format incoming user message - kept for compatibility but not used in new process method
   */
  formatUserMessage(request) {
    return request.message;
  }

  /**
   * Validation — ensures the student's message is valid
   */
  validateRequest(request) {
    return (
      request &&
      typeof request.message === 'string' &&
      request.message.trim().length > 0
    );
  }
}

module.exports = StakeholderChatAgent;
