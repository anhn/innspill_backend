const FeedbackGenerationAgent = require("./FeedbackGenerationAgent");
const FeedbackEvaluationAgent = require("./FeedbackEvaluationAgent");
const FeedbackRevisionAgent = require("./FeedbackRevisionAgent");

class FeedbackWorkflow {
  constructor(openaiClient, options = {}) {
    this.generationAgent = new FeedbackGenerationAgent(openaiClient);
    this.evaluationAgent = new FeedbackEvaluationAgent(openaiClient);
    this.revisionAgent = new FeedbackRevisionAgent(openaiClient);
    this.maxRevisionPasses =
      typeof options.maxRevisionPasses === "number" ? options.maxRevisionPasses : 1;
    this.revisionDistribution = options.revisionDistribution || "auto";
    this.revisionQualityThreshold =
      typeof options.revisionQualityThreshold === "number"
        ? options.revisionQualityThreshold
        : 4;
  }

  parseJson(text, fallback = null) {
    if (!text || typeof text !== "string") return fallback;
    try {
      const cleaned = text.replace(/```json\n?/g, "").replace(/```\n?/g, "").trim();
      return JSON.parse(cleaned);
    } catch (error) {
      return fallback;
    }
  }

  combineUsage(...usages) {
    const validUsages = usages.filter(Boolean);
    if (validUsages.length === 0) return null;

    return validUsages.reduce(
      (total, usage) => ({
        prompt_tokens: total.prompt_tokens + (usage.prompt_tokens || usage.promptTokens || 0),
        completion_tokens:
          total.completion_tokens + (usage.completion_tokens || usage.completionTokens || 0),
        total_tokens: total.total_tokens + (usage.total_tokens || usage.totalTokens || 0),
      }),
      { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 },
    );
  }

  shouldRevise(review) {
    if (this.revisionDistribution === "never") return false;
    if (this.revisionDistribution === "always") return true;
    if (!review) return false;
    if (review.needsRevision === true) return true;

    const qualityScores = [
      review.overallQualityScore,
      review.evidenceGroundingScore,
      review.rubricAlignmentScore,
      review.scoreConsistencyScore,
      review.languageConsistencyScore,
    ].filter((score) => typeof score === "number");

    return qualityScores.some((score) => score < this.revisionQualityThreshold);
  }

  getRevisionInstructions(review) {
    if (review && review.revisionInstructions) return review.revisionInstructions;
    if (this.revisionDistribution !== "always") return "";

    return [
      "Improve the feedback while preserving the original assessment intent and scores.",
      "Make the feedback more evidence-grounded, rubric-aligned, specific, and actionable.",
      "Keep the same JSON schema and the same language as the student's submission.",
    ].join(" ");
  }

  async process(request) {
    const generation = await this.generationAgent.process(request);
    if (!generation.success) return generation;

    let finalResponse = generation.response;
    const usageParts = [generation.usage];
    const workflow = {
      evaluated: false,
      revised: false,
      revisionPasses: 0,
      evaluationFailed: false,
      initialResponse: finalResponse,
      evaluationRaw: null,
      review: null,
      revisionInstructions: "",
      revisionDistribution: this.revisionDistribution,
      revisionQualityThreshold: this.revisionQualityThreshold,
    };

    const evaluation = await this.evaluationAgent.process({
      request,
      generatedFeedback: finalResponse,
    });

    if (!evaluation.success) {
      workflow.evaluationFailed = true;
      return {
        success: true,
        agent: "Feedback Workflow",
        response: finalResponse,
        usage: this.combineUsage(...usageParts),
        workflow,
      };
    }

    usageParts.push(evaluation.usage);
    workflow.evaluated = true;
    workflow.evaluationRaw = evaluation.response;

    const review = this.parseJson(evaluation.response);
    workflow.review = review;
    const revisionInstructions = this.getRevisionInstructions(review);
    if (!this.shouldRevise(review) || !revisionInstructions) {
      return {
        success: true,
        agent: "Feedback Workflow",
        response: finalResponse,
        usage: this.combineUsage(...usageParts),
        workflow,
      };
    }

    for (let pass = 0; pass < this.maxRevisionPasses; pass++) {
      workflow.revisionInstructions = revisionInstructions;
      const revision = await this.revisionAgent.process({
        request,
        generatedFeedback: finalResponse,
        revisionInstructions,
      });

      if (!revision.success) break;

      usageParts.push(revision.usage);
      finalResponse = revision.response;
      workflow.revised = true;
      workflow.revisionPasses += 1;
      break;
    }

    return {
      success: true,
      agent: "Feedback Workflow",
      response: finalResponse,
      usage: this.combineUsage(...usageParts),
      workflow,
    };
  }
}

module.exports = FeedbackWorkflow;
