/**
 * Review notes for a submission: margin comments anchored to quoted text,
 * replies on each comment, and the teacher's formatted feedback (HTML).
 */
const ALLOWED_TAGS = new Set([
  'p', 'br', 'b', 'strong', 'i', 'em', 'u', 's', 'mark', 'h2', 'h3', 'h4',
  'ul', 'ol', 'li', 'blockquote', 'code', 'pre',
]);
const MAX_HTML = 50000;

/** Keep only plain formatting tags, with no attributes. */
function sanitizeFeedbackHtml(raw) {
  if (typeof raw !== 'string') return '';
  let html = raw.slice(0, MAX_HTML * 2);
  html = html.replace(/<!--[\s\S]*?-->/g, '');
  html = html.replace(/<(script|style|iframe|object|embed|template|svg|math)\b[\s\S]*?<\/\1\s*>/gi, '');
  html = html.replace(/<\/?([a-zA-Z][a-zA-Z0-9]*)\b[^>]*>/g, (tag, name) => {
    const lower = name.toLowerCase();
    if (lower === 'div') return tag.startsWith('</') ? '</p>' : '<p>';
    if (!ALLOWED_TAGS.has(lower)) return '';
    if (lower === 'br') return '<br>';
    return tag.startsWith('</') ? `</${lower}>` : `<${lower}>`;
  });
  // Stray angle brackets left by broken tags.
  html = html.replace(/<(?!\/?(?:p|br|b|strong|i|em|u|s|mark|h2|h3|h4|ul|ol|li|blockquote|code|pre)>)/g, '&lt;');
  return html.slice(0, MAX_HTML);
}

/** Plain text of the formatted feedback, for the decision comment and older views. */
function feedbackHtmlToText(html) {
  return String(html || '')
    .replace(/<br>/g, '\n')
    .replace(/<li>/g, '- ')
    .replace(/<\/(p|li|h2|h3|h4|blockquote|pre)>/g, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function commentView(comment) {
  return {
    id: comment._id.toString(),
    quote: comment.quote,
    prefix: comment.prefix || '',
    suffix: comment.suffix || '',
    text: comment.text,
    author: comment.author,
    authorRole: comment.authorRole,
    resolved: Boolean(comment.resolved),
    createdAt: comment.createdAt,
    replies: (comment.replies || []).map((reply) => ({
      id: reply._id.toString(),
      text: reply.text,
      author: reply.author,
      authorRole: reply.authorRole,
      createdAt: reply.createdAt,
    })),
  };
}

function notesView(submission) {
  return {
    id: submission._id.toString(),
    comments: (submission.reviewComments || []).map(commentView),
    feedbackHtml: submission.feedbackHtml || '',
  };
}

module.exports = { sanitizeFeedbackHtml, feedbackHtmlToText, notesView, commentView, ALLOWED_TAGS };
