const BaseAgent = require("./BaseAgent");

class FeedbackEvaluationAgent extends BaseAgent {
  constructor(openaiClient, options = {}) {
    super("Feedback Evaluation Agent", openaiClient, options);
  }

  getSystemPrompt() {
    return `
<identity>
You are a strict quality-control evaluator for AI-generated educational feedback.
</identity>

<task>
Evaluate whether generated feedback is accurate, evidence-based, aligned with the rubric, internally consistent, and written in the same language as the student submission.
</task>

<evaluation_criteria>
- Evidence grounding: feedback must cite or refer to specific evidence from the submission. It must not invent facts.
- Rubric alignment: comments and scores must follow the provided evaluation criteria, learning objectives, mode, feedback mode, persona, and skill pack.
- Score consistency: numerical scores must match the severity of the written feedback. Significant weaknesses must not receive high scores.
- Actionability: feedforward must contain concrete next actions, not vague advice.
- Coverage: concept, reflection, and critical thinking fields must each address their intended dimension.
- Language: all student-facing feedback fields must use the same language as the student's submission.
- JSON schema: the generated feedback must contain only the expected feedback fields and valid scores.
</evaluation_criteria>

<output_schema>
Return valid JSON only:
{
  "needsRevision": "boolean",
  "overallQualityScore": "integer 0-5",
  "evidenceGroundingScore": "integer 0-5",
  "rubricAlignmentScore": "integer 0-5",
  "scoreConsistencyScore": "integer 0-5",
  "languageConsistencyScore": "integer 0-5",
  "issues": ["string"],
  "revisionInstructions": "string"
}
</output_schema>

<decision_rules>
- Set needsRevision=true if any score is below 4.
- Set needsRevision=true if feedback includes unsupported claims, vague feedforward, language mismatch, invalid/missing fields, or scores inconsistent with written critique.
- revisionInstructions must be concrete instructions for a revision agent, not feedback to the student.
- If no revision is needed, set revisionInstructions to an empty string and issues to an empty array.
</decision_rules>`;
  }

  getMaxTokens() {
    return 2000;
  }

  buildContext(request, generatedFeedback) {
    const {
      taskTitle,
      description,
      submission,
      previousSubmission,
      previousFeedback,
      evaluationCriteria,
      learningObjectives,
      taskOutcome,
      taskInstruction,
      persona,
      feedbackMode,
      submissionAnswer,
      feedbackReceivedAnswer,
      keyword,
      attachmentContent,
      conversationLog,
    } = request;

    const parts = [];
    parts.push(`<feedback_mode>${feedbackMode || "general"}</feedback_mode>`);

    let taskContext = `<task_context>\n<title>${taskTitle || ""}</title>`;
    if (keyword) taskContext += `\n<keyword>${keyword}</keyword>`;
    if (description) taskContext += `\n<description>${description}</description>`;
    if (taskOutcome) taskContext += `\n<outcome>${taskOutcome}</outcome>`;
    if (taskInstruction) taskContext += `\n<task_instruction>${taskInstruction}</task_instruction>`;
    taskContext += "\n</task_context>";
    parts.push(taskContext);

    if (learningObjectives) {
      parts.push(`<learning_objectives>\n${learningObjectives}\n</learning_objectives>`);
    }
    if (evaluationCriteria) {
      parts.push(`<evaluation_criteria>\n${evaluationCriteria}\n</evaluation_criteria>`);
    }
    if (persona) {
      parts.push(`<persona>${persona}</persona>`);
    }
    if (submission) {
      parts.push(`<submission>\n${submission}\n</submission>`);
    }
    if (previousSubmission) {
      parts.push(`<previous_submission>\n${previousSubmission}\n</previous_submission>`);
    }
    if (previousFeedback) {
      parts.push(`<previous_feedback>\n${previousFeedback}\n</previous_feedback>`);
    }
    if (submissionAnswer || feedbackReceivedAnswer) {
      parts.push(
        `<reflection_answers>\n${submissionAnswer || ""}\n${feedbackReceivedAnswer || ""}\n</reflection_answers>`,
      );
    }
    if (attachmentContent) {
      const trimmed =
        attachmentContent.length > 3000
          ? attachmentContent.substring(0, 3000) + "\n... [content truncated]"
          : attachmentContent;
      parts.push(`<attachment_content>\n${trimmed}\n</attachment_content>`);
    }
    if (conversationLog) {
      const trimmed =
        conversationLog.length > 2000
          ? conversationLog.substring(0, 2000) + "\n... [log truncated]"
          : conversationLog;
      parts.push(`<conversation_log>\n${trimmed}\n</conversation_log>`);
    }

    parts.push(`<generated_feedback_json>\n${generatedFeedback}\n</generated_feedback_json>`);
    parts.push(
      "<instruction>Evaluate the generated feedback. Return valid JSON only. Do not rewrite the feedback here; only provide quality scores, issues, and revisionInstructions.</instruction>",
    );

    return parts.join("\n\n");
  }

  async process({ request, generatedFeedback }) {
    try {
      const response = await this.openaiClient.chat.completions.create({
        model: this.model,
        messages: [
          { role: "system", content: this.systemPrompt },
          { role: "user", content: this.buildContext(request, generatedFeedback) },
        ],
        temperature: 0.1,
        max_completion_tokens: this.getMaxTokens(),
        response_format: { type: "json_object" },
      });

      return {
        success: true,
        agent: this.name,
        response: response.choices[0].message.content,
        usage: response.usage,
      };
    } catch (error) {
      return {
        success: false,
        agent: this.name,
        error: error.message,
      };
    }
  }
}

module.exports = FeedbackEvaluationAgent;
