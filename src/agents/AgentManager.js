const CoursePlanAgent = require('./CoursePlanAgent');
const LecturePlanAgent = require('./LecturePlanAgent');
const FeedbackAnalysisAgent = require('./FeedbackAnalysisAgent');
const GeneralChatAgent = require('./GeneralChatAgent');
const CoursePlanAnalysisAgent = require('./CoursePlanAnalysisAgent');
const CoursePlanRevisionAgent = require('./CoursePlanRevisionAgent');
const PostProcessingFormatter = require('./PostProcessingFormatter');

/**
 * Agent Manager - Manages the multi-agent system and routes requests to appropriate agents
 */
class AgentManager {
  constructor(openaiClient) {
    this.openaiClient = openaiClient;
    this.agents = this.initializeAgents();
  }

  /**
   * Initialize all available agents
   */
  initializeAgents() {
    return {
      'create-course-plan': new CoursePlanAgent(this.openaiClient),
      'update-course-plan': new CoursePlanAgent(this.openaiClient),
      'create-lecture-plan': new LecturePlanAgent(this.openaiClient),
      'analyze-feedback': new FeedbackAnalysisAgent(this.openaiClient),
      'analyze-course-plan': new CoursePlanAnalysisAgent(this.openaiClient),
      'revise-course-plan': new CoursePlanRevisionAgent(this.openaiClient),
      'post-processing-formatter': new PostProcessingFormatter(this.openaiClient),
      'general': new GeneralChatAgent(this.openaiClient)
    };
  }

  /**
   * Route a request to the appropriate agent
   * @param {string} agentType - The type of agent to handle the request
   * @param {Object} request - The request object
   * @returns {Promise<Object>} - The response from the agent
   */
  async routeRequest(agentType, request) {
    try {
      // Get the appropriate agent
      const agent = this.agents[agentType] || this.agents['general'];
      
      // Validate the request
      if (!agent.validateRequest(request)) {
        return {
          success: false,
          error: 'Invalid request format',
          agent: agent.name
        };
      }

      // Process the request through the agent
      const response = await agent.process(request);
      
      return response;
    } catch (error) {
      console.error('Error in AgentManager:', error);
      return {
        success: false,
        error: 'Internal server error in agent processing',
        agent: 'AgentManager'
      };
    }
  }

  /**
   * Get information about available agents
   * @returns {Object} - Information about all agents
   */
  getAgentInfo() {
    return Object.keys(this.agents).map(agentType => ({
      type: agentType,
      name: this.agents[agentType].name,
      description: this.getAgentDescription(agentType)
    }));
  }

  /**
   * Get description for a specific agent type
   * @param {string} agentType - The agent type
   * @returns {string} - Description of the agent
   */
  getAgentDescription(agentType) {
    const descriptions = {
      'create-course-plan': 'Creates comprehensive course plans and curricula',
      'update-course-plan': 'Updates and modifies existing course plans',
      'create-lecture-plan': 'Creates detailed lecture plans and session structures',
      'analyze-feedback': 'Analyzes educational feedback and provides insights',
      'analyze-course-plan': 'Analyzes course plans for AI impact and provides detailed feedback',
      'revise-course-plan': 'Generates revised course plans based on analysis and original plans',
      'post-processing-formatter': 'Formats, revises, and translates educational documents for consistent, well-structured, and professionally formatted output',
      'general': 'Handles general educational queries and conversations'
    };
    
    return descriptions[agentType] || 'General purpose educational assistant';
  }

  /**
   * Check if an agent type is supported
   * @param {string} agentType - The agent type to check
   * @returns {boolean} - Whether the agent type is supported
   */
  isAgentSupported(agentType) {
    return agentType in this.agents;
  }
}

module.exports = AgentManager;
