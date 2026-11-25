const { sanitizeFeedbackHtml, feedbackHtmlToText } = require('../src/utils/reviewNotes');

describe('review notes feedback HTML', () => {
  test('keeps formatting tags and drops attributes', () => {
    expect(sanitizeFeedbackHtml('<p class="x" style="color:red"><b onclick="a()">Good</b> work</p>'))
      .toBe('<p><b>Good</b> work</p>');
  });

  test('removes scripts, links and images', () => {
    const out = sanitizeFeedbackHtml('<p>a<script>alert(1)</script><img src=x onerror=alert(1)><a href="javascript:x">b</a></p>');
    expect(out).toBe('<p>ab</p>');
  });

  test('turns divs from contentEditable into paragraphs', () => {
    expect(sanitizeFeedbackHtml('<div>one</div><div>two<br></div>')).toBe('<p>one</p><p>two<br></p>');
  });

  test('escapes stray angle brackets', () => {
    expect(sanitizeFeedbackHtml('<p>a < b</p>')).toBe('<p>a &lt; b</p>');
  });

  test('gives plain text for the decision comment', () => {
    expect(feedbackHtmlToText('<p><b>Approved.</b> Fine.</p><ul><li>One</li><li>Two &amp; three</li></ul>'))
      .toBe('Approved. Fine.\n- One\n- Two & three');
  });
});
