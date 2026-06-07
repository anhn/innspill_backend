# Phân tích Hybrid RAG và Agentic RAG trong hệ thống InnSpill

## 1. Mục đích của tài liệu

Tài liệu này phân tích hai chế độ RAG chính trong hệ thống sinh phản hồi của InnSpill:

- `hybrid`: truy xuất ngữ cảnh bằng cách kết hợp tìm kiếm vector, tìm kiếm từ khóa và tăng điểm theo metadata.
- `agentic`: mở rộng hybrid RAG bằng các bước lập kế hoạch truy xuất và đánh giá lại ngữ cảnh bằng mô hình ngôn ngữ.

Phạm vi tài liệu không tập trung vào `legacy`, vì `legacy` chỉ đóng vai trò baseline không dùng retrieved context. Trọng tâm là giải thích vì sao hybrid hoạt động, agentic khác hybrid như thế nào, các thành phần kỹ thuật liên quan, cách prompt được xây dựng, và cách đánh giá hai chế độ này.

## 2. Vị trí của RAG trong pipeline sinh phản hồi

Trong InnSpill, RAG không thay thế toàn bộ quy trình sinh feedback. Nó chỉ bổ sung một lớp ngữ cảnh tham khảo trước khi feedback agent tạo phản hồi cuối cùng.

Pipeline tổng quát:

```text
Assessment submission
  -> thu thập task, rubric, criteria, attachments, persona, history
  -> chọn ragMode
  -> truy xuất ngữ cảnh nếu ragMode là hybrid hoặc agentic
  -> gắn retrieved context vào prompt
  -> FeedbackGenerationAgent sinh feedback JSON
  -> FeedbackEvaluationAgent đánh giá chất lượng
  -> FeedbackRevisionAgent sửa nếu cần
  -> trả feedback cho frontend/API
```

Các file backend chính:

```text
src/services/RagService.js
src/routes/assessment-submissions.js
src/agents/FeedbackGenerationAgent.js
src/agents/FeedbackWorkflow.js
src/agents/FeedbackEvaluationAgent.js
src/agents/FeedbackRevisionAgent.js
```

Trong đó, `RagService.js` là nơi xử lý logic retrieval. Route `assessment-submissions.js` nhận tham số `ragMode`, gọi `RagService`, rồi gắn kết quả vào `request.retrievedContext`. `FeedbackGenerationAgent.js` đưa context này vào prompt bằng tag riêng.

## 3. Nguồn dữ liệu của RAG

Hệ thống hiện dùng kho RAG cục bộ gồm các tài liệu đã chuẩn hóa và embedding đã tính sẵn.

Nguồn raw:

```text
src/models/RagDocument.json
src/models/RagDocument2.json
src/models/RagDocument3.json
```

Nguồn đã chuẩn hóa:

```text
src/models/RagDocument.normalized.jsonl
```

Embedding:

```text
src/models/RagDocument.embeddings.json
```

Markdown memory:

```text
rag-memory/feedback-generation-memory.md
```

Quy trình chuẩn bị dữ liệu:

```text
Raw documents
  -> scripts/normalize-rag.js
  -> RagDocument.normalized.jsonl
  -> scripts/build-embeddings.js
  -> RagDocument.embeddings.json
```

Mỗi chunk thường có:

- `id`: định danh chunk.
- `title` hoặc `section_title`: tên tài liệu/phần.
- `chunk_text`: nội dung chính.
- `metadata`: ngôn ngữ, mục đích sử dụng, tổ chức, quốc gia, loại tài liệu, v.v.
- `embedding`: vector biểu diễn ngữ nghĩa của chunk.

Markdown memory được load thêm ở runtime. Các file `.md` trong `rag-memory/` được chia theo heading và đưa vào store. File bắt đầu bằng `_` sẽ bị bỏ qua, ví dụ `_README.md`.

## 4. Hybrid RAG là gì?

Hybrid RAG là cơ chế truy xuất kết hợp nhiều tín hiệu thay vì chỉ dùng một kiểu search. Trong hệ thống này, hybrid RAG kết hợp ba thành phần:

```text
Hybrid score = vector similarity + lexical overlap + metadata boost
```

Công thức điểm chính trong implementation:

```text
score = 0.6 * vectorScore + 0.28 * lexicalScore + boost
```

Ý nghĩa:

- `vectorScore`: đo độ gần nghĩa giữa query và chunk bằng embedding.
- `lexicalScore`: đo mức độ trùng từ khóa giữa query và chunk.
- `boost`: cộng điểm nếu metadata của chunk phù hợp với request.

Hybrid RAG phù hợp với hệ thống feedback giáo dục vì feedback cần cả hiểu nghĩa rộng lẫn bám sát từ khóa/rubric cụ thể.

## 5. Vì sao cần hybrid thay vì chỉ vector search?

Nếu chỉ dùng vector search, hệ thống có thể tìm được tài liệu gần nghĩa, nhưng đôi khi bỏ lỡ các keyword quan trọng. Ví dụ một bài tập yêu cầu feedback về `Python`, `reflection`, `rubric`, hoặc `Norwegian higher education policy`. Những từ khóa cụ thể này có thể quan trọng hơn độ gần nghĩa tổng quát.

Nếu chỉ dùng keyword search, hệ thống lại dễ bỏ lỡ tài liệu diễn đạt khác từ nhưng cùng ý nghĩa. Ví dụ:

```text
Query: student feedback for programming assignment
Document: formative assessment in coding education
```

Hai câu không trùng nhiều từ, nhưng liên quan về mặt ngữ nghĩa.

Hybrid giải quyết bằng cách kết hợp:

| Thành phần | Điểm mạnh | Điểm yếu được bù bởi |
| --- | --- | --- |
| Vector similarity | Hiểu nghĩa, tìm được nội dung liên quan dù khác từ | Lexical matching giữ keyword cụ thể |
| Lexical overlap | Bắt keyword, thuật ngữ, tên công nghệ, tiêu chí rubric | Vector giúp khi diễn đạt khác |
| Metadata boost | Ưu tiên đúng ngữ cảnh/ngôn ngữ/tổ chức/mục đích | Vector và lexical xử lý nội dung chính |

Do đó, hybrid không chỉ là “vector search cộng keyword search”, mà là một cơ chế ranking nhiều tín hiệu. Nó giúp tăng khả năng lấy đúng tài liệu trong bối cảnh giáo dục, nơi cùng một chủ đề có thể được diễn đạt theo nhiều cách khác nhau.

## 6. Query trong Hybrid RAG được tạo như thế nào?

Trước khi retrieve, hệ thống tạo một query mặc định từ request feedback. Query này thường tổng hợp các thông tin như:

- nội dung task;
- tiêu chí đánh giá;
- learning objectives;
- submission hoặc mô tả bài nộp;
- reflection nếu có;
- ngôn ngữ và bối cảnh bài tập.

Về mặt logic:

```text
Feedback request
  -> buildDefaultQuery(request)
  -> query text
  -> embed query
  -> so sánh với document embeddings
  -> tính lexical overlap
  -> cộng metadata boost
  -> sort theo score
  -> lấy top chunks
```

Query mặc định có vai trò tạo một biểu diễn cô đọng của bài toán feedback. Thay vì đưa toàn bộ submission dài vào retrieval, hệ thống dùng phần thông tin quan trọng để tìm tài liệu hướng dẫn phù hợp.

## 7. Metadata boost trong Hybrid RAG

Metadata boost giúp hệ thống ưu tiên tài liệu phù hợp với bối cảnh hơn. Ví dụ, nếu task hoặc submission cho thấy ngôn ngữ là tiếng Việt, hệ thống có thể ưu tiên tài liệu tiếng Việt. Nếu task liên quan đến programming hoặc assessment, hệ thống ưu tiên chunk có metadata tương ứng.

Các filter/metadata có thể được suy ra từ request:

```text
language
country
organization
intendedUse
assessment type
subject/domain
```

Ví dụ:

```text
Task: đánh giá bài nộp lập trình Python
Detected context:
  language: vi
  intendedUse: programming feedback
  assessment type: formative feedback

Retrieved document A:
  semantically relevant nhưng metadata không rõ

Retrieved document B:
  semantically relevant + metadata programming assessment

=> document B được boost điểm cao hơn
```

Metadata boost đặc biệt quan trọng trong hệ thống giáo dục vì cùng một nội dung “feedback” có thể thuộc nhiều bối cảnh khác nhau: feedback cho bài lập trình, feedback cho reflection, feedback cho group work, feedback theo rubric, hoặc feedback theo chính sách AI trong giáo dục.

## 8. Kết quả của Hybrid RAG được đưa vào prompt như thế nào?

Sau khi retrieve, các chunk được format thành retrieved context. Trong prompt của `FeedbackGenerationAgent`, context được đưa vào tag riêng:

```xml
<retrieved_context mode="hybrid">
Source 1: [Document title — Section title]
Retrieval score: ...
Reason: ...
Chunk text...

Source 2: ...
</retrieved_context>
```

Việc dùng tag riêng có ba lợi ích:

1. Model biết đây là tài liệu tham khảo, không phải bài nộp của sinh viên.
2. Dễ debug vì frontend/API có thể trả `ragSources` hoặc `ragDebug`.
3. Có thể so sánh cùng một submission với `legacy`, `hybrid`, và `agentic` mà không đổi phần còn lại của prompt.

Trong hệ thống hiện tại, retrieved context bị giới hạn kích thước bằng biến:

```text
RAG_MAX_CONTEXT_CHARS hoặc mặc định khoảng 5000 ký tự
```

Giới hạn này giúp tránh prompt quá dài và giảm nguy cơ retrieved context lấn át rubric/submission.

## 9. Ưu điểm của Hybrid RAG

Hybrid RAG có các ưu điểm chính:

1. **Ổn định và dễ kiểm soát**

   Hybrid chủ yếu là thuật toán ranking deterministic. Với cùng input và cùng store, kết quả thường ổn định hơn agentic mode.

2. **Chi phí thấp hơn agentic**

   Hybrid chỉ cần embedding query và tính điểm retrieval. Nó không cần thêm model call cho planner và grader.

3. **Tốc độ tốt hơn agentic**

   Vì không có bước lập kế hoạch và chấm chunk bằng LLM, hybrid phù hợp làm chế độ mặc định khi cần sinh feedback hàng loạt.

4. **Dễ debug**

   Có thể xem score, source id, chunk text, metadata và lý do retrieval.

5. **Cân bằng giữa semantic và exact matching**

   Vector giúp hiểu nghĩa, lexical giúp giữ keyword, metadata giúp đúng bối cảnh.

## 10. Hạn chế của Hybrid RAG

Hybrid RAG cũng có hạn chế:

1. **Query mặc định có thể chưa tối ưu**

   Nếu query tổng hợp chưa nêu đúng khía cạnh quan trọng, retrieval có thể lấy chunk chưa tốt.

2. **Không tự biết cần truy xuất nhiều góc nhìn**

   Một bài feedback có thể cần tài liệu về rubric alignment, reflection, programming pedagogy và AI policy. Một query duy nhất có thể không phủ hết.

3. **Không có bước đánh giá ngữ cảnh sâu bằng LLM**

   Chunk có score cao chưa chắc hữu ích nhất cho feedback cuối cùng. Hybrid ranking là gần đúng, không phải phán đoán sư phạm đầy đủ.

4. **Phụ thuộc vào chất lượng metadata và embedding store**

   Metadata sai hoặc thiếu sẽ làm boost kém hiệu quả. Embedding cũ hoặc thiếu chunk sẽ làm retrieval yếu.

Vì vậy, hybrid nên được xem là chế độ RAG cân bằng: đủ tốt, rẻ, nhanh, dễ kiểm soát, nhưng chưa phải cách tối ưu nhất cho mọi bài phức tạp.

## 11. Agentic RAG là gì?

Agentic RAG là phiên bản mở rộng của hybrid RAG, trong đó retrieval không chỉ là một bước tính điểm đơn giản. Hệ thống dùng mô hình ngôn ngữ để tham gia vào quá trình truy xuất.

Trong InnSpill, agentic RAG gồm hai vai trò chính:

```text
Retrieval planner
Context grader
```

Pipeline:

```text
Feedback request
  -> Retrieval Planner
  -> planned queries + possible filters
  -> Hybrid retrieval cho từng query
  -> merge và deduplicate candidate chunks
  -> Context Grader
  -> chọn/rank lại chunks hữu ích
  -> format retrieved context
  -> inject vào FeedbackGenerationAgent prompt
```

Điểm quan trọng: agentic RAG trong hệ thống này không để LLM tự do hành động không kiểm soát. Planner và grader bị giới hạn nhiệm vụ. Planner chỉ tạo query/filter; grader chỉ đánh giá relevance của chunk. Feedback cuối cùng vẫn do `FeedbackGenerationAgent` sinh theo schema cố định.

## 12. Retrieval Planner trong Agentic RAG

Planner nhận feedback request và lập kế hoạch truy xuất. Thay vì dùng một query mặc định, planner có thể tạo nhiều query theo nhiều khía cạnh.

Ví dụ với bài nộp lập trình có reflection và rubric, planner có thể tạo:

```text
Query 1: rubric aligned feedback for programming assignment
Query 2: formative feedback for student code quality and improvement
Query 3: reflection-based feedback and self-regulated learning
Query 4: evidence-grounded feedback for assessment criteria
```

Mỗi query sau đó được đưa qua hybrid retrieval.

Lợi ích:

- tăng độ phủ của retrieval;
- giảm phụ thuộc vào một query mặc định;
- giúp tìm tài liệu cho nhiều khía cạnh khác nhau của feedback;
- phù hợp với task phức tạp có nhiều criteria.

Model planner được chọn theo thứ tự:

```text
options.model
request.feedbackModel
RAG_PLANNER_MODEL
gpt-5.4-mini
```

## 13. Multi-query Hybrid Retrieval trong Agentic RAG

Sau khi planner tạo nhiều query, hệ thống chạy hybrid retrieval cho từng query:

```text
planned query A -> hybrid retrieval -> chunks A
planned query B -> hybrid retrieval -> chunks B
planned query C -> hybrid retrieval -> chunks C
```

Sau đó merge kết quả:

```text
chunks A + chunks B + chunks C
  -> deduplicate by id/source
  -> candidate chunks
```

Bước này giúp agentic RAG kế thừa toàn bộ sức mạnh của hybrid RAG. Agentic không thay thế hybrid, mà dùng hybrid làm retrieval engine bên dưới.

Có thể hiểu:

```text
Hybrid RAG = retrieval engine
Agentic RAG = planner + retrieval engine + grader
```

## 14. Context Grader trong Agentic RAG

Sau khi có candidate chunks, context grader dùng LLM để đánh giá chunk nào thật sự phù hợp với request feedback.

Grader có thể xem xét:

- chunk có liên quan đến task/rubric không;
- chunk có giúp sinh feedback cụ thể hơn không;
- chunk có phù hợp với ngôn ngữ/bối cảnh không;
- chunk có quá chung chung không;
- chunk có nguy cơ làm feedback lệch khỏi bài nộp không.

Model grader được chọn theo thứ tự:

```text
options.model
request.feedbackModel
RAG_GRADER_MODEL
gpt-5.4-mini
```

Kết quả cuối cùng là một danh sách chunk đã được lọc và/hoặc rank lại. Những chunk này mới được đưa vào prompt sinh feedback.

## 15. Vì sao Agentic RAG có thể tốt hơn Hybrid RAG?

Agentic RAG có thể tốt hơn hybrid trong các tình huống sau:

1. **Task có nhiều chiều đánh giá**

   Ví dụ bài nộp vừa cần đánh giá code, vừa cần đánh giá reflection, vừa cần bám rubric. Một query hybrid duy nhất có thể không phủ hết.

2. **Kho tài liệu lớn hoặc đa dạng**

   Khi có nhiều loại tài liệu, planner giúp truy xuất theo từng khía cạnh thay vì hy vọng một query duy nhất tìm đúng mọi thứ.

3. **Cần lọc context kỹ hơn**

   Hybrid score cao chưa chắc chunk hữu ích. Grader có thể loại chunk chung chung hoặc lệch ngữ cảnh.

4. **Cần tăng inspectability trong nghiên cứu**

   Agentic mode có thể trả debug gồm planned queries, candidate chunks, graded chunks. Điều này hữu ích khi phân tích vì sao feedback thay đổi.

5. **Cần chất lượng cao hơn cho case quan trọng**

   Với high-stakes feedback hoặc các bài phức tạp, chi phí tăng thêm có thể chấp nhận được.

## 16. Hạn chế của Agentic RAG

Agentic RAG không nên được xem là luôn tốt hơn hybrid. Nó có một số chi phí và rủi ro:

1. **Tốn token và tiền hơn**

   Agentic cần thêm model calls cho planner và grader.

2. **Chậm hơn**

   Ngoài retrieval, hệ thống phải chờ LLM lập kế hoạch và chấm chunk.

3. **Có thêm nguồn bất định**

   Planner có thể tạo query khác nhau. Grader có thể đánh giá khác nhau giữa các lần chạy tùy model/config.

4. **Có thể over-filter**

   Grader có thể loại bỏ chunk thực ra hữu ích nếu prompt hoặc tiêu chí grading chưa tốt.

5. **Khó debug hơn hybrid thuần**

   Hybrid có score rõ ràng. Agentic thêm reasoning layer, cần log/debug kỹ hơn để giải thích quyết định.

Vì vậy, agentic phù hợp làm chế độ nâng cao hoặc nghiên cứu, không nhất thiết là default cho mọi request.

## 17. So sánh Hybrid RAG và Agentic RAG

| Tiêu chí | Hybrid RAG | Agentic RAG |
| --- | --- | --- |
| Query | Một query mặc định từ request | Nhiều query do planner tạo |
| Retrieval engine | Vector + lexical + metadata | Dùng lại hybrid retrieval |
| LLM trong retrieval | Không hoặc rất ít | Có planner và grader |
| Context filtering | Dựa trên score | Score + LLM relevance grading |
| Cost | Thấp hơn | Cao hơn |
| Latency | Nhanh hơn | Chậm hơn |
| Tính ổn định | Cao hơn | Có thể biến động hơn |
| Độ phủ khía cạnh | Trung bình/tốt | Tốt hơn với task phức tạp |
| Debug | Dễ xem score/source | Cần xem thêm planned queries và grading |
| Use case phù hợp | Default RAG, batch feedback | High-quality mode, research, task phức tạp |

Tóm tắt:

```text
Hybrid = lựa chọn cân bằng cho production/batch.
Agentic = lựa chọn nâng cao khi cần truy xuất thông minh và lọc context kỹ hơn.
```

## 18. Prompt integration cho cả Hybrid và Agentic

Cả hybrid và agentic đều đưa kết quả vào cùng một vị trí trong prompt. Sự khác biệt nằm ở cách retrieved context được tạo ra, không phải ở cách feedback agent sinh output.

Prompt structure rút gọn:

```text
System prompt
  -> vai trò feedback agent
  -> nguyên tắc feedback
  -> yêu cầu JSON schema

User/context prompt
  -> assessment task
  -> rubric/criteria
  -> student submission
  -> attachments/history/persona nếu có
  -> retrieved_context nếu ragMode != legacy
  -> few-shot/custom instructions nếu có
  -> final output instruction
```

Ví dụ retrieved context:

```xml
<retrieved_context mode="agentic">
Source 1: [Teaching Activity Reflection — 2025]
Reason: Relevant to reflection-based formative feedback.
Chunk text...

Source 2: [Assessment Approach Applied Sciences — 2025]
Reason: Relevant to rubric-aligned evaluation.
Chunk text...
</retrieved_context>
```

Điểm thiết kế tốt là feedback output contract không đổi. Dù dùng `legacy`, `hybrid`, hay `agentic`, frontend vẫn nhận cùng JSON schema feedback.

## 19. Vai trò của RAG đối với chất lượng feedback

RAG có thể cải thiện feedback ở các điểm sau:

1. **Grounding**

   Feedback có thêm cơ sở từ tài liệu hướng dẫn, chính sách, rubric-like knowledge hoặc pedagogical principles.

2. **Consistency**

   Các feedback khác nhau có thể bám cùng một bộ tài liệu chuẩn, giảm sự dao động phong cách/nội dung.

3. **Specificity**

   Nếu retrieved context đúng, model có thêm khung để đưa ra nhận xét cụ thể và có cấu trúc hơn.

4. **Pedagogical alignment**

   Feedback không chỉ nói đúng/sai, mà có thể hướng đến formative feedback, feedforward, reflection, self-regulated learning.

5. **Inspectability**

   Có thể xem những nguồn nào đã được retrieve, giúp giáo viên hoặc nhà nghiên cứu kiểm tra vì sao feedback được tạo như vậy.

Tuy nhiên, RAG không tự đảm bảo feedback tốt. Nếu retrieved context sai, chung chung, hoặc không liên quan, feedback có thể bị nhiễu. Vì vậy cần debug sources và evaluation.

## 20. Đánh giá Hybrid và Agentic RAG

Đánh giá nên tách thành hai tầng:

```text
Retrieval evaluation
Feedback quality evaluation
```

### 20.1 Retrieval evaluation

Mục tiêu: kiểm tra hệ thống lấy đúng context không.

Metrics đề xuất:

| Metric | Ý nghĩa |
| --- | --- |
| Retrieved chunk count | Mỗi mode lấy bao nhiêu chunk |
| Source diversity | Có lấy từ nhiều nguồn hữu ích không |
| Context relevance | Chunk có liên quan tới task/rubric không |
| Redundancy | Các chunk có bị trùng ý quá nhiều không |
| Metadata match | Chunk có đúng ngôn ngữ/bối cảnh không |
| Planner quality | Với agentic, planned queries có hợp lý không |
| Grader quality | Với agentic, grader giữ/loại chunk có hợp lý không |

Ví dụ câu hỏi đánh giá retrieval:

```text
- Chunk được retrieve có hỗ trợ trực tiếp cho feedback không?
- Có chunk nào điểm cao nhưng không liên quan không?
- Agentic có loại bỏ được chunk yếu mà hybrid lấy vào không?
- Agentic có tìm được nguồn mới hữu ích mà hybrid bỏ lỡ không?
```

### 20.2 Feedback quality evaluation

Mục tiêu: kiểm tra feedback cuối cùng có tốt hơn không.

Metrics đề xuất:

| Metric | Ý nghĩa |
| --- | --- |
| Evidence grounding | Feedback có dựa vào bài nộp và rubric không |
| Rubric alignment | Feedback có bám tiêu chí đánh giá không |
| Actionability | Sinh viên có biết cần cải thiện gì không |
| Specificity | Feedback có cụ thể hay chung chung |
| Score consistency | Điểm số có khớp với nhận xét không |
| Language consistency | Ngôn ngữ feedback có phù hợp không |
| Hallucination rate | Có bịa thông tin ngoài bài nộp không |
| Human preference | Giáo viên thích output nào hơn |
| Cost/latency | Chất lượng tăng có đáng với chi phí không |

### 20.3 Thiết kế so sánh đề xuất

Nên giữ nguyên mọi biến khác, chỉ thay `ragMode`:

```text
Same submission
Same task
Same rubric
Same feedback mode
Same feedback model
Different ragMode
```

Ma trận so sánh:

```text
A: legacy + workflow
B: hybrid + workflow
C: agentic + workflow
```

Hoặc nếu muốn so sánh cả agent cũ/mới:

```text
A: legacy + original
B: legacy + workflow
C: hybrid + workflow
D: agentic + workflow
```

Các output cần lưu:

```text
feedback JSON
retrieved sources
rag debug
token usage
latency
workflow evaluation scores
revision flags
human evaluation labels
```

## 21. Cách viết phần phương pháp trong báo cáo

Có thể mô tả Hybrid RAG như sau:

> Chế độ Hybrid RAG sử dụng một cơ chế truy xuất kết hợp nhằm lựa chọn các đoạn tài liệu liên quan đến bài nộp, tiêu chí đánh giá và ngữ cảnh học tập. Thay vì chỉ dựa vào tìm kiếm vector, hệ thống tính điểm mỗi chunk bằng ba tín hiệu: độ tương đồng ngữ nghĩa giữa query và embedding của tài liệu, mức độ trùng khớp từ khóa giữa query và nội dung chunk, và điểm tăng cường dựa trên metadata như ngôn ngữ, mục đích sử dụng hoặc loại tài liệu. Cách tiếp cận này giúp hệ thống vừa tìm được tài liệu gần nghĩa, vừa giữ được các thuật ngữ cụ thể trong rubric hoặc bài tập.

Có thể mô tả Agentic RAG như sau:

> Chế độ Agentic RAG mở rộng Hybrid RAG bằng hai bước có sự tham gia của mô hình ngôn ngữ. Đầu tiên, một retrieval planner phân tích yêu cầu feedback và tạo ra nhiều truy vấn truy xuất theo các khía cạnh khác nhau của bài nộp, ví dụ rubric alignment, reflection, programming feedback hoặc formative assessment. Sau đó, hệ thống chạy hybrid retrieval cho từng truy vấn và hợp nhất các chunk ứng viên. Cuối cùng, một context grader đánh giá mức độ liên quan của từng chunk trước khi đưa ngữ cảnh vào prompt sinh feedback. Thiết kế này cho phép hệ thống truy xuất có định hướng hơn và lọc bỏ các đoạn tài liệu ít hữu ích, đổi lại chi phí và độ trễ cao hơn.

## 22. Cách viết phần kết quả/nhận xét trong báo cáo

Nếu chỉ có smoke test, nên viết thận trọng:

> Kết quả thử nghiệm ban đầu cho thấy cả hai chế độ Hybrid RAG và Agentic RAG đều hoạt động được trong pipeline hiện tại và có thể trả về retrieved context cho feedback generation. Tuy nhiên, kết quả này mới xác nhận tính khả thi kỹ thuật, chưa đủ để kết luận rằng chất lượng feedback được cải thiện. Để khẳng định hiệu quả, cần đánh giá đầu ra feedback bằng rubric độc lập hoặc đánh giá của giáo viên/người chấm.

Nếu hybrid lấy nhiều chunk hơn agentic, có thể giải thích:

> Hybrid RAG thường trả về nhiều chunk hơn vì nó dựa trực tiếp vào ranking score. Agentic RAG có thể trả về ít chunk hơn do có thêm bước context grading, trong đó các chunk ứng viên được lọc lại theo mức độ hữu ích với yêu cầu feedback cụ thể. Vì vậy, số lượng chunk thấp hơn không nhất thiết là kém hơn; cần xem relevance và ảnh hưởng đến feedback cuối cùng.

Nếu agentic tốn hơn, có thể viết:

> Agentic RAG có chi phí cao hơn Hybrid RAG vì cần thêm ít nhất hai loại model call: planning và grading. Do đó, Agentic RAG phù hợp hơn cho các bài đánh giá phức tạp, high-stakes hoặc nghiên cứu so sánh, trong khi Hybrid RAG phù hợp làm chế độ mặc định cho sinh feedback hàng loạt.

## 23. Khuyến nghị sử dụng trong hệ thống

Khuyến nghị thực tế:

```text
Hybrid RAG:
  dùng làm chế độ RAG mặc định
  phù hợp với feedback hàng loạt
  cân bằng giữa chất lượng, tốc độ và chi phí

Agentic RAG:
  dùng cho bài phức tạp hoặc cần chất lượng cao hơn
  dùng khi cần debug/research kỹ về retrieval
  không nên bật mặc định cho mọi batch lớn nếu chưa kiểm soát token budget
```

Chiến lược triển khai hợp lý:

1. Giữ `legacy` làm baseline và rollback.
2. Dùng `hybrid` làm default experimental/production RAG mode.
3. Dùng `agentic` cho selected tasks hoặc evaluation runs.
4. Luôn bật `includeRagDebug` trong các thí nghiệm để phân tích nguồn.
5. Đánh giá bằng cả retrieval metrics và feedback quality metrics.

## 24. Kết luận

Hybrid RAG và Agentic RAG trong InnSpill là hai cấp độ khác nhau của cùng một mục tiêu: cung cấp ngữ cảnh ngoài cho feedback generation để phản hồi có cơ sở hơn, nhất quán hơn và dễ kiểm chứng hơn.

Hybrid RAG là lựa chọn cân bằng. Nó kết hợp vector similarity, lexical overlap và metadata boost để tìm các tài liệu liên quan một cách nhanh, rẻ và tương đối ổn định. Đây là chế độ phù hợp nhất để dùng mặc định khi cần sinh feedback nhiều.

Agentic RAG là lựa chọn nâng cao. Nó không thay thế hybrid mà dùng hybrid làm engine bên dưới, sau đó thêm planner để tạo nhiều truy vấn tốt hơn và grader để lọc context kỹ hơn. Agentic có tiềm năng cải thiện chất lượng ngữ cảnh trong các bài phức tạp, nhưng đổi lại chi phí, latency và độ phức tạp debug cao hơn.

Trong báo cáo khoa học hoặc đồ án, nên trình bày rõ rằng Hybrid RAG và Agentic RAG không trực tiếp “đảm bảo” feedback tốt hơn. Chúng tạo điều kiện để feedback được grounding tốt hơn. Hiệu quả thực sự cần được chứng minh bằng đánh giá retrieval và đánh giá chất lượng feedback cuối cùng.
