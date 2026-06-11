# Bài Thuyết Trình Đồ Án Tốt Nghiệp
## Cải tiến hệ thống AI Feedback trong InnSpill với Context Engineering, Skill Pack, Revision Distribution, RAG Hybrid/Agentic và Markdown Memory

---

> **Tóm tắt nội dung trình bày (1 phút mở đầu)**
> InnSpill là nền tảng giáo dục project-based learning. Đồ án tập trung cải tiến **module sinh phản hồi (AI feedback)**: thiết kế lại prompt theo **context engineering nhiều lớp**, hỗ trợ chuyển **model mới (gpt-5.4-mini)**, thêm **skill pack** để tuỳ biến tiêu chí đánh giá theo domain, xây dựng **workflow 3 bước** (generation → evaluation → revision) với **3 chế độ revision distribution** (`auto`, `always`, `never`), tích hợp **RAG lai (hybrid)** và **RAG agentic** (có planner + grader), đồng thời bổ sung **Markdown memory** cho tri thức có thể chỉnh sửa và tự học từ harness kiểm thử.

---

## Mục lục trình bày

1. [Sự cần thiết của đề tài](#1-sự-cần-thiết-của-đề-tài)
2. [Mục tiêu nghiên cứu](#2-mục-tiêu-nghiên-cứu)
3. [Nội dung nghiên cứu](#3-nội-dung-nghiên-cứu)
4. [Môi trường phát triển](#4-môi-trường-phát-triển)
5. [Công cụ phát triển](#5-công-cụ-phát-triển)
6. [Kết quả](#6-kết-quả)
7. [Hạn chế và hướng phát triển](#7-hạn-chế-và-hướng-phát-triển)

---

## 1. Sự cần thiết của đề tài

### 1.1. Bối cảnh
- InnSpill là hệ thống hỗ trợ **project-based learning**: sinh viên làm task lớn, nộp bài kèm file đính kèm, câu trả lời reflection, nhiều lượt nộp lại.
- Giảng viên cần **phản hồi có cấu trúc, nhất quán, bám rubric**, có thể tham chiếu previous submission/feedback để chấm lại lượt nộp mới.
- Việc chấm thủ công tốn thời gian; AI sinh feedback giúp giảng viên tiết kiệm thời gian nhưng cần **kiểm soát chất lượng**.

### 1.2. Hạn chế của hệ thống feedback cũ
- **Prompt "tường"** khó debug, không phân lớp, dễ drift khỏi yêu cầu bài tập.
- **Không truy xuất policy / rubric / pedagogical framework** từ kho tri thức chung, dẫn đến phản hồi thiếu cơ sở.
- **Chỉ dùng 1 model** (gpt-4o-mini), không có cơ chế chọn model theo use-case.
- **Không có bước tự đánh giá**: feedback đầu ra có thể chứa claim suông, feedforward chung chung, score lệch với nhận xét.
- **Không có skill theo domain**: giảng viên dạy lập trình và dạy nghiên cứu khoa học dùng chung 1 bộ tiêu chí.
- **Không có tri thức có thể chỉnh sửa nhanh**: mỗi lần muốn thay đổi guideline phải sửa code.

### 1.3. Yêu cầu đặt ra
- Tách bạch **routing / task / evidence / style** trong prompt để dễ điều chỉnh.
- Thêm lựa chọn **model** và **cơ chế revision** theo use-case.
- Tích hợp **RAG** nhưng **không phá baseline** (giữ `legacy` để rollback).
- Có **tri thức dạng văn bản** để giảng viên tự sửa guideline.

> **Slide gợi ý**: Vẽ bảng "Hệ thống cũ vs yêu cầu mới" 2 cột để dẫn dắt.

---

## 2. Mục tiêu nghiên cứu

### 2.1. Mục tiêu tổng quát
Cải tiến quy trình sinh phản hồi trong InnSpill theo hướng **context engineering, skill-based prompting, workflow đánh giá/sửa phản hồi, Retrieval-Augmented Generation** và **tri thức có thể chỉnh sửa**, đồng thời **giữ khả năng so sánh** với hệ thống cũ.

### 2.2. Mục tiêu cụ thể
1. Thiết kế lại `FeedbackGenerationAgent` với **prompt theo lớp** (7 lớp: routing, task, evaluation, persona, evidence, supplementary, language).
2. Bổ sung **lựa chọn model** (mặc định `gpt-5.4-mini`, vẫn hỗ trợ `gpt-4o-mini` để so sánh), truyền `options.model` xuống toàn bộ agent trong workflow.
3. Xây dựng cơ chế **skill pack** nạp từ file Markdown (`agents/skills/*.skill.md`), mặc định `research-programming-review`, có validate chống path traversal.
4. Thiết kế `FeedbackWorkflow` 3 bước: **generation → evaluation → optional revision**; quyết định revision bằng **3 chế độ distribution** (`auto`, `always`, `never`).
5. Tích hợp **RAG** vào feedback với 3 chế độ: `legacy` (baseline), `hybrid` (vector + lexical + metadata), `agentic` (thêm planner + grader).
6. Xây dựng **Markdown memory** (`rag-memory/feedback-generation-memory.md`) vừa là guideline vừa là nguồn RAG, có cơ chế tự học từ harness.
7. Phát triển **harness kiểm thử** chạy nhiều cấu hình (model, ragMode, revisionDistribution, skill) và xuất CSV/JSON debug.

> **Slide gợi ý**: Liệt kê 7 mục tiêu, mỗi mục tiêu 1 dòng + icon/biểu tượng.

---

## 3. Nội dung nghiên cứu

### 3.1. Khảo sát hệ thống
- Backend: **Node.js + Express + MongoDB Atlas + Mongoose**.
- Multi-agent: `CoursePlanAgent`, `LecturePlanAgent`, `FeedbackAnalysisAgent`, `GeneralChatAgent`, `QuizGenerationAgent`, `WorksheetGenerationAgent`...
- Feedback cũ: `OriginalFeedbackGenerationAgent` (baseline 1 model call).
- Frontend: React/Next.js, giao diện teacher cho course, project, task, submission, feedback panel.

### 3.2. Phạm vi cải tiến

#### 3.2.1. Context Engineering (7 lớp prompt)
*(Xem drawio: `01-context-engineering.drawio`)*

| Lớp | Tag | Mục đích |
|-----|-----|---------|
| 1. Routing | `<mode>` + `<feedback_mode>` | Báo cho LLM chọn hành vi phù hợp ngay từ đầu |
| 2. Task context | `<task_context>` | Đang đánh giá cái gì |
| 3. Evaluation reference | `<learning_objectives>` + `<evaluation_criteria>` | Tiêu chí LLM phải bám theo |
| 4. Persona | `<persona>` | Góc nhìn stakeholder |
| 5. Student work | `<submission>`, `<previous_submission>`, `<previous_feedback>`, `<reflection_answers>`, `<submission_history>` | Bằng chứng |
| 6. Supplementary | `<attachment_content>`, `<retrieved_context>`, `<conversation_log>`, `<few_shot_examples>`, `<custom_instruction>`, `<skill_pack>` | Context phụ |
| 7. Language directive | `<language_directive>` (đặt cuối) | Ép LLM viết đúng ngôn ngữ submission (recency bias) |

#### 3.2.2. Model mới
- `BaseAgent` nhận `options.model`, fallback `process.env.FEEDBACK_MODEL`, mặc định `gpt-5.4-mini`.
- `FeedbackWorkflow` truyền `model` xuống `FeedbackGenerationAgent`, `FeedbackEvaluationAgent`, `FeedbackRevisionAgent`.
- Có thể cấu hình 2 model độc lập: `FEEDBACK_MODEL`, `RAG_PLANNER_MODEL`, `RAG_GRADER_MODEL`.

#### 3.2.3. Skill Pack
- File: `src/agents/FeedbackGenerationAgent.js` → `loadSkillPack(skillId)`.
- Validate: regex `^[a-z0-9-]+$`, chống path traversal, kiểm tra tồn tại.
- Mặc định: `research-programming-review.skill.md` (đánh giá capstone lập trình + bài báo khoa học).
- Được inject vào prompt dưới tag `<skill_pack>`.

#### 3.2.4. Revision Distribution (3 chế độ)
*(Xem drawio: `03-revision-distribution.drawio`)*

| Chế độ | Điều kiện revise | Số model call |
|--------|-----------------|---------------|
| `never` | Không bao giờ | 1 |
| `auto` (mặc định) | `needsRevision === true` HOẶC bất kỳ score nào < 4 | 2-3 |
| `always` | Luôn luôn | 3 |

- Threshold mặc định 4, có thể cấu hình qua `revisionQualityThreshold`.
- `getRevisionInstructions()`: lấy từ evaluator; nếu `always` mà không có, dùng 3 dòng mặc định.

#### 3.2.5. RAG Hybrid
*(Xem drawio: `04-rag-hybrid.drawio`)*

- Công thức: `score = 0.6 * vector + 0.28 * lexical + boost` (boost tối đa 0.25).
- `inferFilters()` tự suy filter từ keyword (assessment / policy / learning outcome).
- Top-k mặc định 6-8 chunks, có markdown memory boost (mặc định 2 chunks).

#### 3.2.6. RAG Agentic
*(Xem drawio: `05-rag-agentic.drawio`)*

- 5 bước: **Planner** (gpt-5.4-mini sinh 1-3 query + filter) → **Hybrid retrieval** cho từng query → **Merge** theo id (giữ max score) → **Grader** (gpt-5.4-mini chấm relevanceScore, lọc `< 3`) → **Format** và inject.
- Cả 3 chế độ (`legacy`/`hybrid`/`agentic`) dùng chung `retrieveForFeedback()` với flag `mode`.

#### 3.2.7. Markdown Memory
*(Xem drawio: `07-memory-md.drawio`)*

- File: `rag-memory/feedback-generation-memory.md` (chứa 6 mục: principles, output structure, evidence, feedforward, reflection, critical thinking, RAG usage).
- Load runtime: quét `*.md` trong `rag-memory/`, file bắt đầu `_` bị ignore, signature-based cache.
- Tự học: bật `RAG_LEARN_TO_MARKDOWN=true` khi chạy `compare:feedback:random-exercises`.

### 3.3. Workflow tổng thể
*(Xem drawio: `00-tong-quan-he-thong.drawio`)*

```text
Frontend
  → Route: assessment-submissions.js
    (nhận ragMode, revisionDistribution, enableFeedbackSkill, skillId, model)
  → FeedbackWorkflow
       ├─ FeedbackGenerationAgent (+ RAG + Skill)
       ├─ FeedbackEvaluationAgent
       └─ FeedbackRevisionAgent (tuỳ revisionDistribution)
  → MongoDB lưu feedbackHistory
  → Trả JSON cho Frontend
```

### 3.4. Harness đánh giá
- `scripts/compare-feedback-generation.js` — so sánh 1 cấu hình.
- `scripts/compare-group-feedback-generation.js` — so sánh theo nhóm.
- `scripts/compare-random-exercise-feedback.js` — chạy random, có thể bật auto-learn memory.

---

## 4. Môi trường phát triển

| Thành phần | Chi tiết |
|------------|---------|
| Hệ điều hành | macOS (development), Linux (deploy) |
| Node.js | ≥ 16.x (khuyến nghị 18.x trở lên) |
| Database | MongoDB Atlas (cloud) hoặc MongoDB self-host |
| Web framework | Express 4.18 |
| ODM | Mongoose 8.0 |
| AI SDK | OpenAI Node SDK 4.20 |
| Embedding | text-embedding-3-large (qua OpenAI API) |
| Auth | Passport (Google + Facebook OAuth), express-session |
| Logging | Morgan + custom ActionLogger |
| Validation | Joi 17.11 |
| File upload | Multer (pdf, docx, txt) |
| PDF/DOCX | pdf-parse, mammoth |
| WebSocket | ws |
| Test | Jest + Supertest |
| Dev tool | Nodemon |

---

## 5. Công cụ phát triển

| Công cụ | Mục đích |
|---------|---------|
| VS Code | Code editor |
| Draw.io (diagrams.net) | Vẽ biểu đồ kiến trúc, sequence, class |
| Postman | Test API endpoint |
| MongoDB Compass | Trực quan hoá database |
| Git + GitHub | Version control, PR review |
| npm | Quản lý package |
| Jest | Unit / integration test |
| OpenAI Playground | Thử nghiệm prompt gpt-5.4-mini |
| Swagger UI | Auto-generated API docs (tích hợp trong backend) |
| Helmet + CORS + Rate-limit | Bảo mật HTTP |

### 5.1. Thư viện/framework tự viết
- `BaseAgent` (mở rộng với `options.model`).
- `FeedbackGenerationAgent` (context engineering).
- `FeedbackEvaluationAgent` (QC độc lập).
- `FeedbackRevisionAgent` (sửa có kiểm soát).
- `FeedbackWorkflow` (3 bước + revision distribution).
- `RagService` (legacy/hybrid/agentic).
- `ActionLogger` (token usage, latency tracking).
- `loadSkillPack()` (Markdown skill loader).
- Hệ thống Markdown memory runtime loader.

---

## 6. Kết quả

### 6.1. Về mặt kỹ thuật
- Hệ thống triển khai đầy đủ 7 mục tiêu đề ra, **không phá vỡ baseline** (vẫn chạy `original`/`legacy`).
- Hỗ trợ **2 model** song song (`gpt-5.4-mini` mặc định, `gpt-4o-mini` so sánh), cấu hình qua `FEEDBACK_MODEL`.
- **3 chế độ revision distribution** chạy ổn định, log đầy đủ `workflow.revised / revisionPasses / evaluationFailed / review` để debug.
- **Hybrid RAG** trả về trung bình ~6 chunks/request với score kết hợp 3 tín hiệu (vector, lexical, metadata).
- **Agentic RAG** smoke test thành công với 1 submission mẫu (4 graded chunks), cho thấy planner + grader hoạt động đúng.
- **Skill pack** load thành công `research-programming-review`, có validate bảo mật.
- **Markdown memory** load runtime không cần rebuild embedding; signature-based cache tránh reload không cần thiết.

### 6.2. Về mặt cấu trúc hệ thống
*(Xem drawio: `00-tong-quan-he-thong.drawio`)*

Hệ thống InnSpill sau cải tiến có **6 khối do nhóm trực tiếp xây dựng** (khoanh vùng đỏ):

1. **Context Engineering**: 7 lớp prompt trong `FeedbackGenerationAgent.buildContext()`.
2. **Model mới**: `gpt-5.4-mini` mặc định qua `BaseAgent.options.model` + env var.
3. **Skill Pack**: `loadSkillPack()` + `research-programming-review.skill.md`.
4. **Workflow + Revision Distribution**: `FeedbackWorkflow` với 3 mode `auto/always/never`.
5. **RAG**: `RagService` với `hybrid` + `agentic` (legacy là baseline giữ nguyên).
6. **Markdown Memory**: `rag-memory/feedback-generation-memory.md` + auto-learn.

### 6.3. Về mặt khả năng mở rộng
- Thêm domain đánh giá mới = thêm 1 file `*.skill.md` (không sửa code agent).
- Thêm nguồn tri thức RAG = thêm file `*.md` vào `rag-memory/` (không rebuild embedding).
- Thêm chế độ revision = mở rộng enum `revisionDistribution` (auto/always/never + tuỳ biến).
- Thay backend vector store = chỉ đổi `RagService` (interface giữ nguyên).

### 6.4. Về mặt nghiên cứu
- Xây dựng được **nền tảng thử nghiệm có kiểm soát**: harness chạy nhiều cấu hình, xuất debug JSON/CSV.
- Có thể **so sánh cùng submission** giữa `original` vs `workflow`, giữa `legacy/hybrid/agentic`, giữa `gpt-4o-mini` vs `gpt-5.4-mini`, giữa bật/tắt skill, bật/tắt memory.
- Kết quả phục vụ **đánh giá định tính** ban đầu; cần human review để kết luận chất lượng cuối cùng.

### 6.5. Bộ drawio kèm theo
- `00-tong-quan-he-thong.drawio` — kiến trúc tổng quan, khoanh vùng phần nhóm làm.
- `01-context-engineering.drawio` — 7 lớp prompt.
- `02-feedback-workflow.drawio` — pipeline generation → evaluation → revision.
- `03-revision-distribution.drawio` — 3 chế độ `auto/always/never`.
- `04-rag-hybrid.drawio` — chi tiết hybrid scoring.
- `05-rag-agentic.drawio` — pipeline agentic + so sánh 3 mode.
- `06-skill-pack.drawio` — cơ chế load skill từ file MD.
- `07-memory-md.drawio` — Markdown memory + auto-learn.

---

## 7. Hạn chế và hướng phát triển

### 7.1. Hạn chế

1. **Chưa có đánh giá quy mô lớn**: smoke test mới chỉ vài submission, chưa có human review hoặc rubric định lượng.
2. **Auto-learn memory còn thô**: lessons sinh ra từ harness phụ thuộc prompt so sánh, có thể chứa noise.
3. **RAG store cục bộ**: chưa migrate sang MongoDB Atlas Vector Search / Qdrant, scale giới hạn.
4. **Tiếng Việt chưa tối ưu**: hiện ngôn ngữ detect theo keyword (Naive) — submission Na Uy / Anh tốt, tiếng Việt phụ thuộc LLM.
5. **Token cost tăng theo revision distribution**: `always` gấp 3 lần `never`, cần chiến lược giá tuỳ use case.
6. **Chưa có UI cho revision distribution** trên frontend (mặc định `auto` chạy ngầm).
7. **Chưa có test A/B với sinh viên thật** để đo tác động lên chất lượng học tập.
8. **Skill pack chỉ có 1 file mặc định** (`research-programming-review`), chưa xây dựng marketplace.

### 7.2. Hướng phát triển

**Ngắn hạn (1-2 tháng)**
- Hoàn thiện UI cho 3 chế độ `revisionDistribution` + lựa chọn skill.
- Bổ sung ≥ 3 skill mặc định (`general-feedback`, `code-review`, `data-science-project`).
- Cải thiện auto-learn: lọc trùng, đánh trọng số, có minh chứng nguồn.
- Bộ test A/B với ≥ 30 submission thật, có rubric chấm.

**Trung hạn (3-6 tháng)**
- Migrate RAG store sang **MongoDB Atlas Vector Search** (giữ contract cũ).
- Bổ sung **reranker** (cross-encoder) trước khi inject context.
- Hỗ trợ **multi-language memory**: tách file MD theo `language` tag.
- Thêm **persona library** (giảng viên, mentor, peer-reviewer) do giáo viên tự cấu hình.

**Dài hạn (6+ tháng)**
- Xây dựng **feedback memory riêng cho từng học sinh/khoá học** (longitudinal memory).
- Kết hợp **graph RAG** khi knowledge base có quan hệ rõ (chương trình → rubric → policy).
- **Fine-tune model riêng** trên tập feedback đã được giáo viên chuẩn hoá.
- Đánh giá **tác động giáo dục** thực sự qua nghiên cứu dài hạn (student outcome, retention).

---

## Phụ lục — File tham chiếu

### Code
- `src/agents/BaseAgent.js` — base cho mọi agent, có `options.model`.
- `src/agents/FeedbackGenerationAgent.js` — **context engineering**.
- `src/agents/FeedbackEvaluationAgent.js` — QC đánh giá.
- `src/agents/FeedbackRevisionAgent.js` — sửa phản hồi.
- `src/agents/FeedbackWorkflow.js` — **revision distribution 3 chế độ**.
- `src/agents/skills/research-programming-review.skill.md` — **skill pack mặc định**.
- `src/services/RagService.js` — **hybrid + agentic RAG**.
- `src/routes/assessment-submissions.js` — route nhận `ragMode`, `revisionDistribution`, `enableFeedbackSkill`.

### Tài liệu
- `rag-memory/feedback-generation-memory.md` — **Markdown memory**.
- `rag-memory/_README.md` — hướng dẫn dùng memory.
- `docs/agentic-rag-implementation-notes.md` — phân tích kỹ thuật agentic RAG.
- `docs/hybrid_and_agentic_analysis.md` — phân tích hybrid vs agentic (đã có sẵn).
- `docs/tom_tat_do_an.md` — tóm tắt đồ án đầy đủ (đã có sẵn).

### Bản vẽ drawio
- `docs/ppt-bao-ve/00-tong-quan-he-thong.drawio`
- `docs/ppt-bao-ve/01-context-engineering.drawio`
- `docs/ppt-bao-ve/02-feedback-workflow.drawio`
- `docs/ppt-bao-ve/03-revision-distribution.drawio`
- `docs/ppt-bao-ve/04-rag-hybrid.drawio`
- `docs/ppt-bao-ve/05-rag-agentic.drawio`
- `docs/ppt-bao-ve/06-skill-pack.drawio`
- `docs/ppt-bao-ve/07-memory-md.drawio`

---

## Gợi ý trình tự trình bày slide (mỗi phần ~3-5 phút)

| Slide | Nội dung | Thời gian | Drawio minh hoạ |
|-------|----------|-----------|-----------------|
| 1 | Tiêu đề + tóm tắt | 1 phút | — |
| 2-3 | Sự cần thiết | 3 phút | (bảng so sánh cũ-mới) |
| 4 | Mục tiêu | 2 phút | (list 7 mục tiêu) |
| 5-9 | Nội dung NC | 8 phút | 01, 02, 03, 04, 05, 06, 07 |
| 10 | Môi trường PT | 1 phút | (bảng) |
| 11 | Công cụ PT | 1 phút | (bảng) |
| 12-13 | Kết quả + drawio tổng quan | 5 phút | 00 |
| 14 | Hạn chế & hướng PT | 3 phút | (bảng 3-6 tháng) |
| 15 | Q&A | — | — |

---

> **Mẹo trình bày**:
> - Khi nhắc đến "phần nhóm làm", trỏ vào khung đỏ trong `00-tong-quan-he-thong.drawio`.
> - Khi demo, mở sẵn `src/agents/FeedbackGenerationAgent.js` ở dòng `buildContext()` để dẫn chứng.
> - Khi câu hỏi về RAG, mở `src/services/RagService.js` hàm `retrieveForFeedback()`.
> - Khi câu hỏi về skill/memory, mở `rag-memory/feedback-generation-memory.md` và `src/agents/skills/research-programming-review.skill.md`.
