# RAG Markdown Memory

This directory contains editable Markdown memory for the feedback RAG system.

Runtime behavior:

- Files ending in `.md` are loaded by `src/services/RagService.js`.
- Files beginning with `_` are ignored. Use them for documentation.
- Markdown files are split by headings and added to the RAG store together with `RagDocument.normalized.jsonl` and `RagDocument.embeddings.json`.
- New Markdown chunks work immediately with lexical and metadata retrieval.
- If you later run `node scripts/normalize-rag.js` and `node scripts/build-embeddings.js`, the static JSONL/embedding store can also be rebuilt, but this runtime memory does not require that step.
- When `RAG_LEARN_TO_MARKDOWN=true` is enabled for `scripts/compare-random-exercise-feedback.js`, generated reusable lessons are appended to `rag-memory/generated-feedback-memory.md` after the run finishes. Those generated entries are available to RAG on the next run.

Recommended front matter:

```md
---
id: stable-memory-id
title: Human Readable Title
source_type: markdown_memory
intended_use: feedback_guideline
language: en
tags: [feedback, rubric, assessment]
version: 2026-05
---
```

Useful `intended_use` values:

- `feedback_guideline`
- `assessment_design`
- `teaching_design`
- `institutional_policy_rag`
- `student_ai_use_policy_rag`
- `course_specific_feedback`
- `rubric_calibration`

Generate memory from compare runs:

```bash
RAG_LEARN_TO_MARKDOWN=true \
RAG_MEMORY_OUTPUT=rag-memory/generated-feedback-memory.md \
npm run compare:feedback:random-exercises
```

Optional controls:

- `RAG_MEMORY_APPROACHES=gpt54NewFeedback` chooses which generated feedback variant is learned.
- `RAG_MEMORY_APPROACHES=original,gpt54,newPrompt,gpt54NewFeedback` learns from all variants.
- `RAG_MEMORY_MAX_ENTRIES=100` limits appended entries per run.
- `RAG_MEMORY_INCLUDE_RAW=true` also stores raw generated feedback JSON.
