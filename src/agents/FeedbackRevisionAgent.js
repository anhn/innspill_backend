const BaseAgent = require("./BaseAgent");

class FeedbackRevisionAgent extends BaseAgent {
  constructor(openaiClient) {
    super("Feedback Revision Agent", openaiClient);
  }

  getSystemPrompt() {
    return `
<identity>
You are a senior educational feedback editor.
</identity>

<task>
Revise AI-generated educational feedback using internal revision instructions from a quality evaluator.
</task>

<critical_rules>
- Keep the exact existing feedback JSON schema.
- Do not add revisionInstructions, quality scores, issues, metadata, markdown, or any extra fields.
- Preserve the assessment intent unless the revision instructions identify a clear inconsistency.
- All student-facing text fields must be written in the same language as the student's submission.
- Return valid JSON only.
</critical_rules>

<output_schema>
{
  "feedback": "string",
  "feedforward": "string",
  "concept": "string",
  "reflection": "string",
  "criticalThinking": "string",
  "taskQualityScore": "integer 0-5 or 'not applicable'",
  "reflectionScore": "integer 0-5",
  "criticalthinkingScore": "integer 0-5",
  "conceptMasteryScore": "integer 0-5"
}
</output_schema>`;
  }

  getMaxTokens() {
    return 8000;
  }

  buildContext(request, generatedFeedback, revisionInstructions) {
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
    parts.push(`<revision_instructions>\n${revisionInstructions}\n</revision_instructions>`);
    parts.push(
      "<instruction>Revise the generated feedback according to the revision instructions. Return only the final feedback JSON with the existing schema.</instruction>",
    );

    return parts.join("\n\n");
  }

  async process({ request, generatedFeedback, revisionInstructions }) {
    try {
      const response = await this.openaiClient.chat.completions.create({
        model: "gpt-5.4-mini",
        messages: [
          { role: "system", content: this.systemPrompt },
          {
            role: "user",
            content: this.buildContext(request, generatedFeedback, revisionInstructions),
          },
        ],
        temperature: 0.2,
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

module.exports = FeedbackRevisionAgent;
