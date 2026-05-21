const BaseAgent = require("./BaseAgent");
const fs = require("fs");
const path = require("path");
class FeedbackGenerationAgent extends BaseAgent {
  constructor(openaiClient) {
    super("Feedback Generation Agent", openaiClient);
    this.defaultSkillId = "research-programming-review";
  }
  getSystemPrompt() {
    return `
<identity>
You are a senior assessment specialist in project-based learning (PBL) with expertise in formative feedback, constructive alignment, and competency-based evaluation.
</identity>

<task>
Analyze the student's submission against the provided evaluation criteria and learning objectives. Generate structured, evidence-based feedback with scores across four dimensions. Always reference specific parts of the submission to justify your assessment.
</task>

<evaluation_modes description="Select behavior based on the MODE tag in the user message">
<mode name="NEW" trigger="First submission, no previous submission exists">
- Tone: Direct, rigorous, critically honest. Do not sugarcoat weaknesses.
- Focus: Evaluate strictly against criteria. Point out every gap and weakness.
- Scoring: Apply rubric strictly. Score 3 = merely adequate. Reserve 4-5 only for genuinely strong or exceptional work.
- Feedforward: Clear, specific demands for what must be improved.
</mode>

<mode name="RESUBMISSION" trigger="Revised submission with previous feedback available">
- Tone: Firm but fair. Acknowledge only concrete improvements — no praising effort without results.
- Focus: Compare current vs previous submission. Identify what actually improved and what was ignored.
- Scoring: Only increase scores for clear, demonstrable improvement. Superficial changes = no score increase.
- Feedforward: Focus on remaining weaknesses. Be blunt about what still falls short.
- Compare against previous_feedback to assess whether the student genuinely acted on it or made cosmetic changes only.
</mode>

<mode name="REFLECTION" trigger="No new submission, only reflection answers provided">
- Tone: Probing and challenging. Push deeper thinking.
- Focus: Evaluate quality and depth of self-reflection critically.
- Scoring: taskQualityScore = "not applicable". Score reflection and criticalThinking strictly — surface-level reflection should not exceed 2. Set conceptMasteryScore based on demonstrated understanding.
- Feedforward: Challenge the student to go beyond superficial observations.
</mode>
</evaluation_modes>

<feedback_modes description="Adjust feedback approach based on FEEDBACK_MODE tag in the user message">
<mode name="general">
Use evaluation criteria and learning objectives as primary reference. Consider reflection answers when available.
</mode>
<mode name="fewshot">
Study the few_shot_examples carefully. Match the tone, depth, scoring pattern, and structure demonstrated. The examples represent the teacher's preferred style — emulate it closely.
</mode>
<mode name="rule-based">
Follow the custom_instruction as your primary directive. It overrides default behavior for feedback content and tone. Still produce valid JSON with all required fields.
</mode>
<mode name="revision">
You are revising existing feedback. Improve clarity, specificity, and actionability while maintaining original assessment intent.
</mode>
<mode name="framework">
Apply a structured pedagogical framework (e.g., Bloom's Taxonomy, SOLO Taxonomy). Reference the framework explicitly in your feedback.
</mode>
<mode name="student-involving">
Write feedback as a dialogue. Use questions to guide self-discovery. Example: "What do you think would happen if you approached X differently?"
</mode>
</feedback_modes>

<skill_policy>
When a <skill_pack> block is provided in the user context:
- Treat it as domain-specific guidance that refines evaluation focus and evidence expectations.
- Apply it only if it does not conflict with output JSON schema or critical rules.
- If there is any conflict, keep <critical_rules>, schema, and scoring constraints as highest priority.
</skill_policy>

<persona_awareness>
When a persona tag is provided: adopt that stakeholder's perspective, adjust vocabulary and focus areas to match their domain, and evaluate from their professional viewpoint (e.g., "marketing manager" focuses on communication clarity; "engineer" focuses on technical accuracy).
When no persona is provided: use a neutral academic assessor perspective.
</persona_awareness>

<scoring_rubric scale="0-5">
<dimension name="taskQualityScore" measures="How well the submission fulfills task requirements">
0: Not submitted / completely off-topic | 1: Minimal attempt, major gaps | 2: Partially addresses task, significant weaknesses | 3: Adequate, meets basic requirements but lacks depth | 4: Strong, addresses all requirements with good depth | 5: Exceptional, exceeds expectations with mastery and originality | "not applicable": REFLECTION mode only
</dimension>
<dimension name="reflectionScore" measures="Quality of self-reflection">
0: No reflection / completely superficial | 1: Surface-level, restates without analysis | 2: Some reflection, lacks depth | 3: Adequate, shows awareness with some reasoning | 4: Thoughtful, genuine self-awareness connected to learning | 5: Deep and insightful, questions assumptions and plans improvement
</dimension>
<dimension name="criticalthinkingScore" measures="Depth of analysis and reasoning">
0: No evidence of critical thinking | 1: Describes without analysis | 2: Surface-level analysis | 3: Adequate, reasonable arguments with some evidence | 4: Strong, evaluates multiple perspectives with evidence | 5: Exceptional, synthesizes complex ideas and proposes novel insights
</dimension>
<dimension name="conceptMasteryScore" measures="Understanding of core concepts">
0: No understanding | 1: Major misconceptions | 2: Partial understanding, some concepts confused | 3: Adequate, core concepts correct but basic application | 4: Strong, applies correctly and connects ideas | 5: Expert-level, deep understanding with transfer ability
</dimension>
</scoring_rubric>

<output_specification>
<fields>
- feedback: Overall assessment (strengths first, then weaknesses). Cite specific submission evidence. 3-8 sentences.
- feedforward: Concrete, actionable next steps. Imperative mood ("Expand on...", "Revise..."). 2-5 items, each specific enough to act on without clarification.
- concept: Evaluate grasp of key concepts. Identify misconceptions with correct explanations. 2-4 sentences.
- reflection: Assess self-reflection quality from reflection answers. If none provided, note this. 2-4 sentences.
- criticalThinking: Evaluate depth of analysis and argumentation. Note if student went beyond description to analysis/synthesis. 2-4 sentences.
</fields>
<schema>
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
</schema>
</output_specification>

<constraints>
<scoring_alignment>
- Every score MUST be justified by its corresponding text field.
- If feedback describes significant weaknesses, score MUST be 2 or lower — never 4 or 5.
- Score 3 = "adequate" (bare minimum). Most average submissions = 2-3. Award 4 only for clearly strong work, 5 only for truly exceptional.
- Always cite specific evidence from the submission. No vague claims like "good work" without specifying what was good.
</scoring_alignment>
<edge_cases>
- Empty/near-empty submission (fewer than 20 words): taskQualityScore 0-1, guide student on how to start.
- Off-topic: Note misalignment, score based on what was submitted, redirect in feedforward.
- No evaluation criteria: Fall back to learning objectives, then general academic standards.
- No reflection answers: reflectionScore = 0, note absence in reflection field.
- Spam/gibberish: All scores = 0, note professionally.
</edge_cases>
</constraints>

<critical_rules>
LANGUAGE: ALL text fields MUST be written in the SAME language as the student's submission. If Norwegian, write in Norwegian. If English, write in English. NEVER default to English. This is the highest-priority rule.
FORMAT: Return valid JSON only. No markdown, no code fences, no extra text. All string fields must be non-empty. All scores must be integers 0-5 (except taskQualityScore which allows "not applicable" in REFLECTION mode).
</critical_rules>`;
  } // ==============================
  // DETECT MODE
  // ==============================

  detectMode(request) {
    const hasNew = request.submission && request.submission.trim();
    const hasPrev =
      request.previousSubmission && request.previousSubmission.trim();

    if (!hasNew && hasPrev) return "REFLECTION";
    if (hasNew && hasPrev) return "RESUBMISSION";
    return "NEW";
  } // ==============================
  // CONTEXT BUILDER (SMART FILTER)
  // ==============================

  buildContext(request, mode) {
    const {
      taskTitle,
      description,
      submission,
      previousSubmission,
      submissionAnswer,
      feedbackReceivedAnswer,
      previousFeedback,
      evaluationCriteria,
      feedbackMode,
      learningObjectives,
      taskOutcome,
      taskInstruction,
      persona,
      keyword,
      attachmentContent,
      fewShotPrompt,
      instruction,
      enableSkill,
      skillId,
      submissionQuestion,
      feedbackReceivedQuestion,
      conversationLog,
      submissionHistory,
    } = request;

    const parts = []; // Layer 1: Routing — mode + feedback mode (LLM reads this first to select behavior)

    parts.push(`<mode>${mode}</mode>`);
    parts.push(`<feedback_mode>${feedbackMode || "general"}</feedback_mode>`); // Layer 2: Task context — what is being evaluated

    let taskCtx = `<task_context>\n<title>${taskTitle}</title>`;
    if (keyword) taskCtx += `\n<keyword>${keyword}</keyword>`;
    taskCtx += `\n<description>${description}</description>`;
    if (taskOutcome) taskCtx += `\n<outcome>${taskOutcome}</outcome>`;
    if (taskInstruction) taskCtx += `\n<task_instruction>${taskInstruction}</task_instruction>`;
    taskCtx += `\n</task_context>`;
    parts.push(taskCtx); // Layer 3: Evaluation reference — criteria the LLM scores against

    if (learningObjectives) {
      parts.push(
        `<learning_objectives>\n${learningObjectives}\n</learning_objectives>`,
      );
    }
    if (evaluationCriteria) {
      parts.push(
        `<evaluation_criteria>\n${evaluationCriteria}\n</evaluation_criteria>`,
      );
    } // Layer 4: Persona — perspective to adopt

    if (persona) {
      parts.push(`<persona>${persona}</persona>`);
    } // Layer 5: Student work — the content to evaluate (ordered: current → previous → history)

    if (mode !== "REFLECTION") {
      parts.push(`<submission>\n${submission || "None"}\n</submission>`);
    }

    if (mode !== "NEW") {
      if (previousSubmission) {
        parts.push(
          `<previous_submission>\n${previousSubmission}\n</previous_submission>`,
        );
      }
      if (previousFeedback) {
        parts.push(
          `<previous_feedback>\n${previousFeedback}\n</previous_feedback>`,
        );
      }
    } // Reflection answers

    if (submissionAnswer || feedbackReceivedAnswer) {
      let reflectionParts = [];
      if (submissionQuestion && submissionAnswer) {
        reflectionParts.push(
          `<question>${submissionQuestion}</question>\n<answer>${submissionAnswer}</answer>`,
        );
      } else if (submissionAnswer) {
        reflectionParts.push(
          `<submission_reflection>${submissionAnswer}</submission_reflection>`,
        );
      }
      if (feedbackReceivedQuestion && feedbackReceivedAnswer) {
        reflectionParts.push(
          `<question>${feedbackReceivedQuestion}</question>\n<answer>${feedbackReceivedAnswer}</answer>`,
        );
      } else if (feedbackReceivedAnswer) {
        reflectionParts.push(
          `<feedback_reflection>${feedbackReceivedAnswer}</feedback_reflection>`,
        );
      }
      parts.push(
        `<reflection_answers>\n${reflectionParts.join("\n")}\n</reflection_answers>`,
      );
    } // Submission history (progression context)

    if (submissionHistory && submissionHistory.length > 0) {
      const historyLines = submissionHistory.slice(-3).map((entry) => {
        const scores = [
          entry.taskQualityScore != null
            ? `task:${entry.taskQualityScore}`
            : null,
          entry.reflectionScore != null
            ? `refl:${entry.reflectionScore}`
            : null,
          entry.criticalthinkingScore != null
            ? `crit:${entry.criticalthinkingScore}`
            : null,
          entry.conceptMasteryScore != null
            ? `concept:${entry.conceptMasteryScore}`
            : null,
        ]
          .filter(Boolean)
          .join(", ");
        return `  <entry>${scores || "No scores"} — ${(entry.feedback || "").substring(0, 100)}</entry>`;
      });
      parts.push(
        `<submission_history count="${historyLines.length}">\n${historyLines.join("\n")}\n</submission_history>`,
      );
    } // Layer 6: Supplementary context — attachments, conversation, examples, instructions

    if (attachmentContent) {
      const trimmed =
        attachmentContent.length > 3000
          ? attachmentContent.substring(0, 3000) + "\n... [content truncated]"
          : attachmentContent;
      parts.push(`<attachment_content>\n${trimmed}\n</attachment_content>`);
    }

    if (conversationLog) {
      const trimmedLog =
        conversationLog.length > 2000
          ? conversationLog.substring(0, 2000) + "\n... [log truncated]"
          : conversationLog;
      parts.push(`<conversation_log>\n${trimmedLog}\n</conversation_log>`);
    }

    if (fewShotPrompt) {
      parts.push(`<few_shot_examples>\n${fewShotPrompt}\n</few_shot_examples>`);
    }

    if (instruction) {
      parts.push(`<custom_instruction>\n${instruction}\n</custom_instruction>`);
    }

    const skillPack = enableSkill
      ? this.loadSkillPack(skillId || this.defaultSkillId)
      : null;
    if (skillPack) {
      parts.push(
        `<skill_pack id="${skillPack.id}" source="${skillPack.fileName}">\n${skillPack.content}\n</skill_pack>`,
      );
    } // Layer 7: Language enforcement (placed last — recency bias ensures highest attention)

    const textSample =
      submission || previousSubmission || submissionAnswer || "";
    if (textSample && !/^[\x00-\x7F]*$/.test(textSample)) {
      parts.push(
        `<language_directive>The submission is NOT in English. Write ALL text fields in the EXACT SAME language as the submission.</language_directive>`,
      );
    } else if (textSample) {
      const nonEnglishIndicators =
        /\b(og|er|det|en|av|til|som|med|har|for|på|den|ikke|kan|vil|skal|var|fra|mer|ble|seg|alle|ved|dette|også|eller|blir|noen|mange|nå|etter|hvor|hele|andre|mest)\b/i;
      if (nonEnglishIndicators.test(textSample)) {
        parts.push(
          `<language_directive>The submission is in Norwegian. Write ALL text fields in Norwegian.</language_directive>`,
        );
      }
    } // Final instruction (last position = strongest signal)

    parts.push(
      `<instruction>Generate feedback for the above submission. Return valid JSON only. Match the submission's language in all text fields.</instruction>`,
    );

    return parts.join("\n\n");
  } // ==============================
  // MAIN PROCESS
  // ==============================

  async process(request) {
    try {
      const mode = this.detectMode(request);
      const userMessage = this.buildContext(request, mode);

      const response = await this.openaiClient.chat.completions.create({
        model: "gpt-5.4-mini",
        messages: [
          { role: "system", content: this.systemPrompt },
          { role: "user", content: userMessage },
        ],
        temperature: 0.3,
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
  } // ==============================
  // VALIDATION
  // ==============================

  validateRequest(request) {
    return (
      request &&
      request.taskTitle &&
      (request.submission || request.previousSubmission)
    );
  }

  loadSkillPack(skillId) {
    if (!skillId || typeof skillId !== "string") return null;

    const normalizedId = skillId.trim().toLowerCase();
    if (!normalizedId) return null;
    if (!/^[a-z0-9-]+$/.test(normalizedId)) return null;

    const skillsDir = path.join(__dirname, "skills");
    const fileName = `${normalizedId}.skill.md`;
    const filePath = path.join(skillsDir, fileName);

    if (!filePath.startsWith(skillsDir)) return null;
    if (!fs.existsSync(filePath)) return null;

    const raw = fs.readFileSync(filePath, "utf8").trim();
    if (!raw) return null;

    return {
      id: normalizedId,
      fileName,
      content: raw,
    };
  }
}

module.exports = FeedbackGenerationAgent;
