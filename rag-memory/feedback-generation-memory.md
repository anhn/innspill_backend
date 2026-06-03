---
id: innspill-feedback-generation-memory
title: InnSpill Feedback Generation Memory
source_type: markdown_memory
intended_use: feedback_guideline
language: en
tags: [feedback, assessment, rubric, scoring, reflection, feedforward]
version: 2026-05
---

# Feedback generation principles

AI feedback in InnSpill should be formative, evidence-based, and aligned with the task rubric. The feedback should help students understand what is strong, what is weak, and what to do next. It should not merely praise or criticize the submission in general terms.

Good feedback must include concrete references to the student submission, the task description, the evaluation criteria, and the learning objectives when those are available. If the submission does not contain enough evidence for a claim, the feedback should say this carefully instead of inventing details.

Feedback should stay in the same language as the student submission unless the task or teacher explicitly requests another language. It should avoid unnecessary technical jargon unless the task domain requires it.

# Output structure memory

The feedback generator returns structured JSON. The important student-facing fields are:

- `feedback`: direct assessment of the submitted work.
- `feedforward`: concrete next steps for improvement.
- `concept`: assessment of concept understanding.
- `reflection`: assessment of student reflection and metacognition.
- `criticalThinking`: assessment of reasoning, justification, and critical judgment.

The score fields are:

- `taskQualityScore`
- `reflectionScore`
- `criticalthinkingScore`
- `conceptMasteryScore`

Scores should be consistent with the written feedback. A submission with major missing evidence should not receive high task quality. A reflection that only describes actions without analysis should receive a low reflection score. Concept mastery should be reduced when the student misuses central terminology or shows misunderstanding.

# Evidence grounding memory

When evaluating a submission, prefer direct evidence:

- what the student actually wrote,
- what files or attachments contain,
- what the task asks for,
- what the rubric emphasizes,
- what previous feedback or previous submissions show.

Do not infer unprovided implementation details, hidden intentions, or unsupported learning progress. If evidence is missing, name the gap and recommend how the student can make the work more verifiable.

# Feedforward memory

Feedforward should be actionable. Strong feedforward uses specific verbs and measurable next steps:

- revise the problem statement to include scope, constraints, and target users,
- add a comparison baseline,
- connect each design decision to one requirement,
- provide test evidence and explain what failed,
- cite sources for claims about technology, pedagogy, or methodology,
- add diagrams only when they clarify data flow, control flow, or responsibility.

Avoid generic advice such as "improve the report" or "add more detail" unless it is followed by concrete examples.

# Reflection memory

Reflection is not the same as a progress log. High-quality reflection explains what changed in the student's understanding, why a decision was made, what trade-offs were considered, and what should be improved next.

Low-quality reflection often lists completed actions without analysis. If the reflection answer is absent, empty, or unrelated, the reflection score should be low and the written feedback should state that the reflection evidence is missing.

# Critical thinking memory

Critical thinking should be judged by the quality of reasoning, not by confidence. Strong critical thinking includes comparison of alternatives, explicit assumptions, justification of choices, error analysis, and recognition of limitations.

Weak critical thinking includes unsupported assertions, one-sided claims, no baseline comparison, no discussion of risk, or conclusions that do not follow from the evidence.

# RAG usage memory

Retrieved RAG context should support the feedback, not replace assessment of the student's own submission. If retrieved context provides a general principle, connect it to concrete evidence from the submission. If retrieved context is irrelevant, do not force it into the feedback.

For AI-in-education tasks, retrieved context about academic integrity, AI transparency, assessment design, and responsible GenAI use should be used to check whether the student's work explains AI use, verifies outputs, and preserves human judgment.
