const BaseAgent = require("./BaseAgent");

/**
 * Feedback Generation Agent
 * Three submission types:
 * 1. NEW_SUBMISSION  → strict evaluation
 * 2. RESUBMISSION    → more supportive, improvement-based evaluation
 * 3. REFLECTION_ONLY → supportive reflection-focused evaluation
 */
class FeedbackGenerationAgent extends BaseAgent {
  constructor(openaiClient, options = {}) {
    super("Feedback Generation Agent", openaiClient, options);
  }

  /**
   * Get system prompt based on feedback mode
   */
  getSystemPrompt(feedbackMode = "general") {
    switch (feedbackMode.toLowerCase()) {
      case "fewshot":
        return this.getFewShotSystemPrompt();
      case "rule-based":
        return this.getRuleBasedSystemPrompt();
      case "revision":
        return this.getRevisionSystemPrompt();
      case "framework":
        return this.getFrameworkSystemPrompt();
      case "student-involving":
        return this.getStudentInvolvingSystemPrompt();
      default:
        return this.getGeneralSystemPrompt();
    }
  }

  /**
   * General system prompt (original, for backward compatibility)
   */
  getGeneralSystemPrompt() {
    return `
You are an expert educational assessor specializing in formative, developmental assessment in project-based learning.

Your evaluation tone and scoring STRICTNESS must differ based on submission type:

=====================================================================
STRICTNESS MODES
=====================================================================

1) NEW_SUBMISSION (VERY STRICT MODE)
-------------------------------------
Triggered when:
- Student submits for the first time with no previous submissions.

You must:
- Use **higher expectations**, be more rigorous, more critical.
- Point out weaknesses precisely and firmly (still professionally).
- Demand clear justification and strong alignment with criteria.
- Provide corrective feedforward.
- Score task quality, reflection, and concept mastery using the **strictest standard**.
- Critical thinking is NOT applicable.

Use JSON:
{
  "feedback": "",
  "feedforward": "",
  "concept": "",
  "reflection": "",
  "criticalThinking": "not applicable for new submission",
  "taskQualityScore": 0,
  "reflectionScore": 0,
  "criticalthinkingScore": 0,
  "conceptMasteryScore": 0
}

=====================================================================

2) RESUBMISSION (SUPPORTIVE IMPROVEMENT MODE)
---------------------------------------------
Triggered when:
- Student submits again and a previousSubmission exists.

You must:
- Emphasize **progress, effort, and improvement**.
- Tone should be **encouraging, appreciative**, and growth-focused.
- Compare current and previous submission.
- Reward improvement with slightly more lenient scoring.
- Be gentler in critique but still constructive.
- Provide motivational feedforward.

JSON:
{
  "feedback": "",
  "feedforward": "",
  "concept": "",
  "reflection": "",
  "criticalThinking": "",
  "taskQualityScore": 0,
  "reflectionScore": 0,
  "criticalthinkingScore": 0,
  "conceptMasteryScore": 0
}

=====================================================================

3) REFLECTION_ONLY (SUPPORTIVE REFLECTION MODE)
-----------------------------------------------
Triggered when:
- No new submission, but previousSubmission exists
- Student only provides reflection answers.

You must:
- Focus entirely on the student's reflection thinking.
- Be **supportive, appreciative**, and highlight metacognitive growth.
- Evaluate quality of reflection and critical thinking.
- Task quality is NOT applicable (no new submission).
- Encourage deeper reflection but in a gentle way.

JSON:
{
  "feedback": "",
  "feedforward": "",
  "concept": "",
  "reflection": "",
  "criticalThinking": "",
  "taskQualityScore": "not applicable",
  "reflectionScore": 0,
  "criticalthinkingScore": 0,
  "conceptMasteryScore": 0
}

=====================================================================
SCORING RUBRICS
=====================================================================

TASK QUALITY (0–5):
0 = No understanding  
1 = Minimal  
2 = Basic  
3 = Competent  
4 = Strong  
5 = Excellent  

REFLECTION (0–5):
0 = None  
1 = Descriptive only  
2 = Some analysis  
3 = Insightful  
4 = Adaptive and intentional  
5 = Transformative  

CRITICAL THINKING (0–5):
1 = Mentions feedback only  
2 = Basic understanding  
3 = Partial application  
4 = Strong application with reasoning  
5 = Strategic improvement and critique  

CONCEPT MASTERY (0–5):
Evaluated based on extracted concept.

=====================================================================
IMPORTANT RULES
=====================================================================
- Output MUST be valid JSON only.
- NO markdown. NO extra explanations.
- NO plain text. NO "Star Score:" labels.
- Return ONLY a JSON object starting with { and ending with }.
- Always respond in the student's language.
- Example of correct output:
{
  "feedback": "Your submission...",
  "feedforward": "To improve...",
  "concept": "The key concept is...",
  "reflection": "Your reflection shows...",
  "criticalThinking": "You demonstrate...",
  "taskQualityScore": 4,
  "reflectionScore": 3,
  "criticalthinkingScore": 4,
  "conceptMasteryScore": 5
}
`;
  }

  /**
   * Build user message based on feedback mode
   */
  formatUserMessage(request) {
    const { feedbackMode = "general" } = request;

    switch (feedbackMode.toLowerCase()) {
      case "fewshot":
        return this.formatFewShotMessage(request);
      case "rule-based":
        return this.formatRuleBasedMessage(request);
      case "revision":
        return this.formatRevisionMessage(request);
      case "framework":
        return this.formatFrameworkMessage(request);
      case "student-involving":
        return this.formatStudentInvolvingMessage(request);
      default:
        return this.formatGeneralMessage(request);
    }
  }

  /**
   * General user message format (original, for backward compatibility)
   */
  formatGeneralMessage(request) {
    const {
      submission,
      submissionAnswer,
      feedbackReceivedAnswer,
      previousSubmission,
      previousFeedback,
      submissionHistory,

      evaluationCriteria,
      learningObjectives,
      persona,
      attachments,
      attachmentContent,
      conversationLog,

      // task parameters
      id,
      projectId,
      taskTitle,
      description,
      keyword,
      submissionDeadline,
      enabledAIGuideline,
      submissionQuestion,
      feedbackReceivedQuestion,

      // few-shot learning
      fewShotPrompt,
      isLearnFromHuman,
    } = request;

    let submissionType = "NEW_SUBMISSION";

    const hasNewSubmission = submission && submission.trim().length > 0;
    const hasPrevious =
      previousSubmission && previousSubmission.trim().length > 0;

    // 3) REFLECTION_ONLY
    if (!hasNewSubmission && hasPrevious) {
      submissionType = "REFLECTION_ONLY";
    }
    // 2) RESUBMISSION
    else if (hasNewSubmission && hasPrevious) {
      submissionType = "RESUBMISSION";
    }
    // 1) else NEW_SUBMISSION (default)

    let msg = `SUBMISSION TYPE: ${submissionType}\n\n`;

    msg += `=== TASK INFORMATION ===\n`;
    msg += `Task ID: ${id}\n`;
    msg += `Project ID: ${projectId}\n`;
    msg += `Title: ${taskTitle}\n`;
    msg += `Description: ${description}\n`;
    msg += `Keywords: ${keyword}\n`;
    msg += `Submission Deadline: ${submissionDeadline}\n`;
    msg += `AI Guidelines: ${enabledAIGuideline}\n\n`;

    msg += `=== CURRENT SUBMISSION ===\n${submission || "No new submission"}\n\n`;
    msg += `=== PREVIOUS SUBMISSION ===\n${previousSubmission || "None"}\n\n`;

    msg += `=== SUBMISSION REFLECTION QUESTION ===\n${submissionQuestion}\n`;
    msg += `=== STUDENT ANSWER ===\n${submissionAnswer || "No answer"}\n\n`;

    msg += `=== FEEDBACK-RECEIVED REFLECTION QUESTION ===\n${feedbackReceivedQuestion}\n`;
    msg += `=== STUDENT ANSWER ===\n${feedbackReceivedAnswer || "No answer"}\n\n`;

    msg += `=== PREVIOUS FEEDBACK ===\n${previousFeedback || "None"}\n\n`;

    if (evaluationCriteria) {
      msg += `=== EVALUATION CRITERIA ===\n${evaluationCriteria}\n\n`;
    }

    if (learningObjectives) {
      msg += `=== LEARNING OBJECTIVES ===\n${learningObjectives}\n\n`;
    }

    if (persona) {
      msg += `=== STAKEHOLDER PERSONA ===\n${persona}\n\n`;
    }

    if (attachments && attachments.length > 0) {
      msg += `=== ATTACHMENTS (filenames) ===\n${attachments.join(", ")}\n\n`;
    }
    if (attachmentContent && attachmentContent.trim()) {
      msg += `=== ATTACHMENT CONTENT ===\n${attachmentContent}\n\n`;
    }

    if (conversationLog) {
      msg += `=== PREVIOUS AGENT CONVERSATION ===\n${conversationLog}\n\n`;
    }

    // Add few-shot learning examples if provided (for "Learn from Human" mode)
    if (isLearnFromHuman && fewShotPrompt) {
      msg += fewShotPrompt;
    }

    msg += `Generate JSON output according to SUBMISSION TYPE and STRICTNESS MODE.`;

    return msg;
  }

  /**
   * Override process to use dynamic system prompt based on feedbackMode
   */
  async process(request) {
    try {
      const feedbackMode = request.feedbackMode || "general";
      const dynamicSystemPrompt = this.getSystemPrompt(feedbackMode);
      const languageDirective =
        "Response in the same language with the input text.";
      const systemPrompt = `${dynamicSystemPrompt.trim()}\n\n${languageDirective}`;

      // Internal token estimator (heuristic)
      const estimateTokens = (text) => {
        if (!text) return 0;
        const s = String(text);
        const words = s.trim().length ? s.trim().split(/\s+/).length : 0;
        const chars = s.length;
        return Math.max(Math.round(words * 0.75), Math.round(chars / 4));
      };

      const userMessage = this.formatUserMessage(request);
      const messages = [
        {
          role: "system",
          content: systemPrompt,
        },
        {
          role: "user",
          content: userMessage,
        },
      ];

      // Estimate prompt tokens from system + user messages
      const estimatedPromptTokens = estimateTokens(
        messages.map((m) => m.content).join("\n"),
      );

      const apiStartTime = Date.now();

      // Add timeout protection for individual API calls
      const response = await Promise.race([
        this.openaiClient.chat.completions.create({
          model: this.model,
          messages: messages,
          temperature: 0.7,
          max_completion_tokens: this.getMaxTokens(),
        }),
        new Promise((_, reject) =>
          setTimeout(
            () =>
              reject(
                new Error(`OpenAI API timeout after 120s in ${this.name}`),
              ),
            120000,
          ),
        ),
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
          method: "heuristic(words*0.75 vs chars/4)",
        },
      };
    } catch (error) {
      console.error(`❌ Error in ${this.name}:`, error.message);
      return {
        success: false,
        agent: this.name,
        error: error.message,
      };
    }
  }

  /**
   * Minimal request validation.
   */
  validateRequest(request) {
    return (
      request &&
      request.taskTitle &&
      (request.submission || request.previousSubmission)
    );
  }

  // ===================================================================
  // FEW-SHOT LEARNING APPROACH
  // ===================================================================

  getFewShotSystemPrompt() {
    return `
You are an expert educational assessor specializing in formative, developmental assessment in project-based learning.

Your task is to learn from the way submissions were judged and graded in the provided examples, then apply the same consistent evaluation approach to the current submission.

=====================================================================
YOUR APPROACH
=====================================================================

1. Study the provided few-shot examples carefully:
   - Observe how submissions were evaluated and graded
   - Note the style, tone, and depth of feedback
   - Understand the scoring patterns and consistency
   - Identify how evaluation criteria were applied

2. Compare the current submission with the example submissions:
   - Look for similarities in content, structure, and quality
   - Identify how the current submission aligns with or differs from examples
   - Apply the same evaluation standards demonstrated in examples

3. Generate feedback in a consistent way:
   - Match the style and tone of the example feedbacks
   - Apply the same depth and detail level
   - Use similar scoring patterns and justification
   - Maintain consistency in how criteria are addressed

=====================================================================
SCORING RUBRICS
=====================================================================

TASK QUALITY (0–5):
0 = No understanding  
1 = Minimal  
2 = Basic  
3 = Competent  
4 = Strong  
5 = Excellent  

REFLECTION (0–5):
0 = None  
1 = Descriptive only  
2 = Some analysis  
3 = Insightful  
4 = Adaptive and intentional  
5 = Transformative  

CRITICAL THINKING (0–5):
1 = Mentions feedback only  
2 = Basic understanding  
3 = Partial application  
4 = Strong application with reasoning  
5 = Strategic improvement and critique  

CONCEPT MASTERY (0–5):
Evaluated based on extracted concept.

=====================================================================
IMPORTANT RULES
=====================================================================
- Output MUST be valid JSON only.
- NO markdown. NO extra explanations.
- Return ONLY a JSON object starting with { and ending with }.
- Always respond in the student's language.
- Ensure your feedback style matches the examples provided.
{
  "feedback": "",
  "feedforward": "",
  "concept": "",
  "reflection": "",
  "criticalThinking": "",
  "taskQualityScore": 0,
  "reflectionScore": 0,
  "criticalthinkingScore": 0,
  "conceptMasteryScore": 0
}
`;
  }

  formatFewShotMessage(request) {
    const {
      submission,
      evaluationCriteria,
      attachments,
      attachmentContent,
      fewShotPrompt,
      id,
      projectId,
      taskTitle,
      description,
    } = request;

    let msg = `FEEDBACK MODE: FEW-SHOT LEARNING\n\n`;

    msg += `=== TASK INFORMATION ===\n`;
    msg += `Task ID: ${id}\n`;
    msg += `Project ID: ${projectId}\n`;
    msg += `Title: ${taskTitle}\n`;
    msg += `Description: ${description}\n\n`;

    msg += `=== EVALUATION CRITERIA ===\n${evaluationCriteria || "Not specified"}\n\n`;

    msg += `=== CURRENT SUBMISSION ===\n${submission || "No submission"}\n\n`;

    if (attachments && attachments.length > 0) {
      msg += `=== ATTACHMENTS (filenames) ===\n${attachments.join(", ")}\n\n`;
    }
    if (attachmentContent && attachmentContent.trim()) {
      msg += `=== ATTACHMENT CONTENT ===\n${attachmentContent}\n\n`;
    }

    if (fewShotPrompt) {
      msg += fewShotPrompt;
      msg += `\n\n`;
    }

    msg += `INSTRUCTIONS:\n`;
    msg += `1. Study the example submissions and feedbacks above carefully.\n`;
    msg += `2. Compare the current submission with the example submissions to understand quality levels.\n`;
    msg += `3. Generate feedback in the same consistent style, tone, and approach as demonstrated in the examples.\n`;
    msg += `4. Apply the same evaluation standards and scoring patterns shown in the examples.\n`;
    msg += `5. Ensure your feedback matches the depth and detail level of the example feedbacks.\n\n`;

    msg += `Generate JSON output according to the evaluation approach demonstrated in the examples.`;

    return msg;
  }

  // ===================================================================
  // RULE-BASED GRADING APPROACH
  // ===================================================================

  getRuleBasedSystemPrompt() {
    return `
You are an expert educational assessor specializing in formative, developmental assessment in project-based learning.

Your task is to strictly follow the provided instructions to evaluate the submission against each evaluation criterion.

=====================================================================
YOUR APPROACH
=====================================================================

1. Read and understand the instructions carefully:
   - Follow every requirement and guideline precisely
   - Apply the instructions exactly as specified
   - Do not deviate from the given instructions

2. Evaluate against each criterion:
   - Address each evaluation criterion systematically
   - Apply the instructions to each criterion evaluation
   - Provide specific feedback for each criterion

3. Be strict and consistent:
   - Apply the instructions uniformly across all criteria
   - Maintain objectivity and fairness
   - Ensure alignment with the specified instructions

=====================================================================
SCORING RUBRICS
=====================================================================

TASK QUALITY (0–5):
0 = No understanding  
1 = Minimal  
2 = Basic  
3 = Competent  
4 = Strong  
5 = Excellent  

REFLECTION (0–5):
0 = None  
1 = Descriptive only  
2 = Some analysis  
3 = Insightful  
4 = Adaptive and intentional  
5 = Transformative  

CRITICAL THINKING (0–5):
1 = Mentions feedback only  
2 = Basic understanding  
3 = Partial application  
4 = Strong application with reasoning  
5 = Strategic improvement and critique  

CONCEPT MASTERY (0–5):
Evaluated based on extracted concept.

=====================================================================
IMPORTANT RULES
=====================================================================
- Output MUST be valid JSON only.
- NO markdown. NO extra explanations.
- Return ONLY a JSON object starting with { and ending with }.
- Always respond in the student's language.
- Strictly adhere to the provided instructions.
{
  "feedback": "",
  "feedforward": "",
  "concept": "",
  "reflection": "",
  "criticalThinking": "",
  "taskQualityScore": 0,
  "reflectionScore": 0,
  "criticalthinkingScore": 0,
  "conceptMasteryScore": 0
}
`;
  }

  formatRuleBasedMessage(request) {
    const {
      submission,
      evaluationCriteria,
      attachments,
      attachmentContent,
      instruction,
      id,
      projectId,
      taskTitle,
      description,
    } = request;

    let msg = `FEEDBACK MODE: RULE-BASED GRADING\n\n`;

    msg += `=== TASK INFORMATION ===\n`;
    msg += `Task ID: ${id}\n`;
    msg += `Project ID: ${projectId}\n`;
    msg += `Title: ${taskTitle}\n`;
    msg += `Description: ${description}\n\n`;

    msg += `=== EVALUATION CRITERIA ===\n${evaluationCriteria || "Not specified"}\n\n`;

    if (instruction) {
      msg += `=== INSTRUCTIONS ===\n${instruction}\n\n`;
    }

    msg += `=== CURRENT SUBMISSION ===\n${submission || "No submission"}\n\n`;

    if (attachments && attachments.length > 0) {
      msg += `=== ATTACHMENTS (filenames) ===\n${attachments.join(", ")}\n\n`;
    }
    if (attachmentContent && attachmentContent.trim()) {
      msg += `=== ATTACHMENT CONTENT ===\n${attachmentContent}\n\n`;
    }

    msg += `INSTRUCTIONS:\n`;
    msg += `1. Strictly follow the instructions provided above.\n`;
    msg += `2. Evaluate the submission against each evaluation criterion systematically.\n`;
    msg += `3. Apply the instructions precisely to each criterion evaluation.\n`;
    msg += `4. Provide specific feedback addressing how each criterion was met or not met according to the instructions.\n`;
    msg += `5. Ensure your evaluation is consistent with the provided instructions.\n\n`;

    msg += `Generate JSON output strictly following the provided instructions.`;

    return msg;
  }

  // ===================================================================
  // REVISION CHECKING APPROACH
  // ===================================================================

  getRevisionSystemPrompt() {
    return `
You are an expert educational assessor specializing in formative, developmental assessment in project-based learning.

Your task is to compare the current submission with the previous submission, identify changes, evaluate those changes, and revise or extend the previous feedback rather than creating entirely new feedback.

=====================================================================
YOUR APPROACH
=====================================================================

1. Compare current vs previous submission:
   - Identify what has changed, improved, or been revised
   - Note what remains the same
   - Highlight new additions or modifications

2. Evaluate the changes:
   - Assess whether changes address previous feedback
   - Determine if changes show improvement or require further work
   - Evaluate if the changes align with evaluation criteria

3. Revise or extend previous feedback:
   - Build upon the previous feedback, don't repeat it
   - Acknowledge improvements that address previous concerns
   - Update or extend guidance based on current submission state
   - Do NOT create entirely new feedback—revise the existing one

=====================================================================
SCORING RUBRICS
=====================================================================

TASK QUALITY (0–5):
0 = No understanding  
1 = Minimal  
2 = Basic  
3 = Competent  
4 = Strong  
5 = Excellent  

REFLECTION (0–5):
0 = None  
1 = Descriptive only  
2 = Some analysis  
3 = Insightful  
4 = Adaptive and intentional  
5 = Transformative  

CRITICAL THINKING (0–5):
1 = Mentions feedback only  
2 = Basic understanding  
3 = Partial application  
4 = Strong application with reasoning  
5 = Strategic improvement and critique  

CONCEPT MASTERY (0–5):
Evaluated based on extracted concept.

=====================================================================
IMPORTANT RULES
=====================================================================
- Output MUST be valid JSON only.
- NO markdown. NO extra explanations.
- Return ONLY a JSON object starting with { and ending with }.
- Always respond in the student's language.
- Revise or extend previous feedback, don't create new feedback from scratch.
{
  "feedback": "",
  "feedforward": "",
  "concept": "",
  "reflection": "",
  "criticalThinking": "",
  "taskQualityScore": 0,
  "reflectionScore": 0,
  "criticalthinkingScore": 0,
  "conceptMasteryScore": 0
}
`;
  }

  formatRevisionMessage(request) {
    const {
      submission,
      previousSubmission,
      previousFeedback,
      evaluationCriteria,
      attachments,
      attachmentContent,
      id,
      projectId,
      taskTitle,
      description,
    } = request;

    let msg = `FEEDBACK MODE: REVISION CHECKING\n\n`;

    msg += `=== TASK INFORMATION ===\n`;
    msg += `Task ID: ${id}\n`;
    msg += `Project ID: ${projectId}\n`;
    msg += `Title: ${taskTitle}\n`;
    msg += `Description: ${description}\n\n`;

    msg += `=== EVALUATION CRITERIA ===\n${evaluationCriteria || "Not specified"}\n\n`;

    msg += `=== CURRENT SUBMISSION ===\n${submission || "No submission"}\n\n`;
    msg += `=== PREVIOUS SUBMISSION ===\n${previousSubmission || "None"}\n\n`;
    msg += `=== PREVIOUS FEEDBACK ===\n${previousFeedback || "None"}\n\n`;

    if (attachments && attachments.length > 0) {
      msg += `=== ATTACHMENTS (filenames) ===\n${attachments.join(", ")}\n\n`;
    }
    if (attachmentContent && attachmentContent.trim()) {
      msg += `=== ATTACHMENT CONTENT ===\n${attachmentContent}\n\n`;
    }

    msg += `INSTRUCTIONS:\n`;
    msg += `1. Carefully compare the current submission with the previous submission to identify changes, improvements, or revisions.\n`;
    msg += `2. Evaluate whether the changes address issues or concerns raised in the previous feedback.\n`;
    msg += `3. Revise or extend the previous feedback rather than creating entirely new feedback. Acknowledge improvements and provide updated guidance.\n`;
    msg += `4. Reference specific changes between submissions and explain how they relate to the previous feedback.\n`;
    msg += `5. Ensure your feedback builds upon the previous feedback and shows continuity in the evaluation process.\n\n`;

    msg += `Generate JSON output that revises or extends the previous feedback based on the changes identified.`;

    return msg;
  }

  // ===================================================================
  // FRAMEWORK ALIGNING APPROACH
  // ===================================================================

  getFrameworkSystemPrompt() {
    return `
You are an expert educational assessor specializing in formative, developmental assessment in project-based learning.

Your task is to use the provided evaluation framework to judge each evaluation criterion, provide comments, and assign grades.

=====================================================================
EVALUATION FRAMEWORK
=====================================================================

When evaluating the student answer, apply the following levels:

**Level 1 — Unsatisfactory**
- Completely Out of Topic: student writes unrelated content or asks unrelated questions
- Overly Lengthy and Off-Topic: excessive or irrelevant information, not aligned with requirements
- Fails to meet exercise expectations or ignores instructions

**Level 2 — Needs Improvement**
- Partial Answer: covers only some required elements
- General and Superficial Answer: vague, generic, or lacks relevance to the project
- Misunderstanding the Question: provides theory instead of project-specific content
- Incorrect or Illogical Points: contradicts project constraints or includes unrealistic statements

**Level 3 — Satisfactory**
- Incomplete but Structured: organized and effort visible but missing minor details
- Excellent but Slightly Unbalanced: strong but uneven across sections

**Level 4 — Excellence**
- Fully addresses all required elements
- Clear, relevant, detailed, and fully aligned with project context and task requirements

**IMPORTANT FRAMEWORK RULE:**
If the student addresses all required points (e.g., all SWOT points or all project charter components), they should receive Level 3 at minimum, unless the content is incorrect, irrelevant, or contradictory.

=====================================================================
SCORING RUBRICS
=====================================================================

TASK QUALITY (0–5):
Map framework levels to scores:
- Level 1 (Unsatisfactory) = 0-1
- Level 2 (Needs Improvement) = 2
- Level 3 (Satisfactory) = 3
- Level 4 (Excellence) = 4-5

REFLECTION (0–5):
0 = None  
1 = Descriptive only  
2 = Some analysis  
3 = Insightful  
4 = Adaptive and intentional  
5 = Transformative  

CRITICAL THINKING (0–5):
1 = Mentions feedback only  
2 = Basic understanding  
3 = Partial application  
4 = Strong application with reasoning  
5 = Strategic improvement and critique  

CONCEPT MASTERY (0–5):
Evaluated based on extracted concept.

=====================================================================
IMPORTANT RULES
=====================================================================
- Output MUST be valid JSON only.
- NO markdown. NO extra explanations.
- Return ONLY a JSON object starting with { and ending with }.
- Always respond in the student's language.
- Apply the evaluation framework systematically to each criterion.
- Clearly indicate which framework level applies and why.
{
  "feedback": "",
  "feedforward": "",
  "concept": "",
  "reflection": "",
  "criticalThinking": "",
  "taskQualityScore": 0,
  "reflectionScore": 0,
  "criticalthinkingScore": 0,
  "conceptMasteryScore": 0
}
`;
  }

  formatFrameworkMessage(request) {
    const {
      submission,
      evaluationCriteria,
      attachments,
      attachmentContent,
      id,
      projectId,
      taskTitle,
      description,
    } = request;

    let msg = `FEEDBACK MODE: FRAMEWORK ALIGNING\n\n`;

    msg += `=== TASK INFORMATION ===\n`;
    msg += `Task ID: ${id}\n`;
    msg += `Project ID: ${projectId}\n`;
    msg += `Title: ${taskTitle}\n`;
    msg += `Description: ${description}\n\n`;

    msg += `=== EVALUATION CRITERIA ===\n${evaluationCriteria || "Not specified"}\n\n`;

    msg += `=== CURRENT SUBMISSION ===\n${submission || "No submission"}\n\n`;

    if (attachments && attachments.length > 0) {
      msg += `=== ATTACHMENTS (filenames) ===\n${attachments.join(", ")}\n\n`;
    }
    if (attachmentContent && attachmentContent.trim()) {
      msg += `=== ATTACHMENT CONTENT ===\n${attachmentContent}\n\n`;
    }

    msg += `INSTRUCTIONS:\n`;
    msg += `1. Use the evaluation framework provided in the system prompt to judge each evaluation criterion.\n`;
    msg += `2. Determine which framework level (Level 1, 2, 3, or 4) applies to the submission for each criterion.\n`;
    msg += `3. Provide clear justification for the framework level assigned, referencing specific aspects of the submission.\n`;
    msg += `4. Remember: If the student addresses all required points, they should receive Level 3 at minimum, unless content is incorrect, irrelevant, or contradictory.\n`;
    msg += `5. Generate feedback and scores that align with the framework level identified.\n\n`;

    msg += `Generate JSON output that applies the evaluation framework systematically to each criterion.`;

    return msg;
  }

  // ===================================================================
  // STUDENT INVOLVING APPROACH
  // ===================================================================

  getStudentInvolvingSystemPrompt() {
    return `
You are an expert educational assessor specializing in formative, developmental assessment in project-based learning.

Your task is to use the student's input from the conversation log to re-examine the last feedback and last submission, then regrade and provide new feedback that addresses the student's concerns and questions.

=====================================================================
YOUR APPROACH
=====================================================================

1. Review the conversation log carefully:
   - Understand the student's questions, concerns, or clarifications
   - Identify areas where the student seeks further explanation
   - Note any misunderstandings or points that need addressing

2. Re-examine the last feedback and submission:
   - Look at the previous feedback with fresh perspective
   - Re-evaluate the previous submission considering the student's input
   - Identify areas where the feedback may need clarification or adjustment

3. Regrade and provide new feedback:
   - Address the specific content raised in the conversation log
   - Clarify any misunderstandings from previous feedback
   - Provide updated evaluation based on the student's input
   - Ensure the new feedback directly responds to the student's questions or concerns

=====================================================================
SCORING RUBRICS
=====================================================================

TASK QUALITY (0–5):
0 = No understanding  
1 = Minimal  
2 = Basic  
3 = Competent  
4 = Strong  
5 = Excellent  

REFLECTION (0–5):
0 = None  
1 = Descriptive only  
2 = Some analysis  
3 = Insightful  
4 = Adaptive and intentional  
5 = Transformative  

CRITICAL THINKING (0–5):
1 = Mentions feedback only  
2 = Basic understanding  
3 = Partial application  
4 = Strong application with reasoning  
5 = Strategic improvement and critique  

CONCEPT MASTERY (0–5):
Evaluated based on extracted concept.

=====================================================================
IMPORTANT RULES
=====================================================================
- Output MUST be valid JSON only.
- NO markdown. NO extra explanations.
- Return ONLY a JSON object starting with { and ending with }.
- Always respond in the student's language.
- Address the student's input from the conversation log directly.
{
  "feedback": "",
  "feedforward": "",
  "concept": "",
  "reflection": "",
  "criticalThinking": "",
  "taskQualityScore": 0,
  "reflectionScore": 0,
  "criticalthinkingScore": 0,
  "conceptMasteryScore": 0
}
`;
  }

  formatStudentInvolvingMessage(request) {
    const {
      submission,
      previousSubmission,
      previousFeedback,
      conversationLog,
      evaluationCriteria,
      attachments,
      attachmentContent,
      id,
      projectId,
      taskTitle,
      description,
    } = request;

    let msg = `FEEDBACK MODE: STUDENT INVOLVING\n\n`;

    msg += `=== TASK INFORMATION ===\n`;
    msg += `Task ID: ${id}\n`;
    msg += `Project ID: ${projectId}\n`;
    msg += `Title: ${taskTitle}\n`;
    msg += `Description: ${description}\n\n`;

    msg += `=== EVALUATION CRITERIA ===\n${evaluationCriteria || "Not specified"}\n\n`;

    msg += `=== PREVIOUS SUBMISSION ===\n${previousSubmission || "None"}\n\n`;
    msg += `=== PREVIOUS FEEDBACK ===\n${previousFeedback || "None"}\n\n`;

    if (conversationLog) {
      msg += `=== STUDENT CONVERSATION LOG ===\n${conversationLog}\n\n`;
    }

    if (attachments && attachments.length > 0) {
      msg += `=== ATTACHMENTS (filenames) ===\n${attachments.join(", ")}\n\n`;
    }
    if (attachmentContent && attachmentContent.trim()) {
      msg += `=== ATTACHMENT CONTENT ===\n${attachmentContent}\n\n`;
    }

    msg += `INSTRUCTIONS:\n`;
    msg += `1. Carefully review the student's input in the conversation log to understand their questions, concerns, or clarifications.\n`;
    msg += `2. Re-examine the previous submission and previous feedback with the student's perspective in mind.\n`;
    msg += `3. Regrade and provide new feedback that directly addresses the content in the conversation log.\n`;
    msg += `4. Clarify any misunderstandings, answer questions, and provide updated evaluation based on the student's input.\n`;
    msg += `5. Ensure your feedback responds to the specific points raised by the student in the conversation.\n\n`;

    msg += `Generate JSON output that addresses the student's input from the conversation log and provides updated feedback.`;

    return msg;
  }
}

module.exports = FeedbackGenerationAgent;
