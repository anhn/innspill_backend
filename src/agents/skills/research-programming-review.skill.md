# Skill Pack: Research & Programming Review

Use this pack when reviewing:

- Programming capstone projects, large course assignments, software engineering reports.
- Scientific papers, research proposals, and technical investigation reports.

## Review Priorities

1. Problem framing clarity

- Is the problem statement specific, relevant, and bounded?
- Are objectives and research questions explicit and testable?

1. Technical rigor

- Check correctness of algorithms, architecture, implementation decisions, and complexity trade-offs.
- Require concrete evidence (design diagrams, code excerpts, benchmarks, test results), not claims only.

1. Methodology quality (for research work)

- Evaluate method suitability, dataset quality, sampling, experiment design, reproducibility, and threats to validity.
- Distinguish correlation from causation and identify uncontrolled variables.

1. Evidence and evaluation

- Verify that conclusions follow from reported evidence.
- Prefer quantitative metrics with baselines/ablations when relevant.
- Penalize missing error analysis, weak comparisons, or cherry-picked examples.

1. Academic integrity and citation quality

- Check for citation support for key claims.
- Highlight uncited borrowed ideas, vague references, or inconsistent bibliography style.

1. Writing and argument structure

- Assess logical flow: background -> method -> results -> discussion -> conclusion.
- Flag vague terminology, unsupported assertions, and unclear scope boundaries.

## Domain-Specific Feedforward Style

- Give concrete next actions with measurable targets.
- Prefer directives such as:
  - "Add a baseline model and compare F1/accuracy/latency across at least 3 runs."
  - "Provide ablation for feature X and explain performance deltas with error analysis."
  - "Refactor module Y using dependency inversion and include unit/integration test coverage report."
  - "Rewrite research question into hypothesis form and align each experiment to one hypothesis."

## Scoring Calibration Hints

- High scores (4-5) require strong evidence quality, methodological soundness, and coherent argumentation.
- If implementation exists but evaluation is weak, cap taskQualityScore and criticalthinkingScore at 2-3.
- If reflection is descriptive only ("we did X"), cap reflectionScore at 1-2.
- If core concepts are used incorrectly (e.g., misuse of statistical tests, flawed complexity claims), cap conceptMasteryScore at 2.
