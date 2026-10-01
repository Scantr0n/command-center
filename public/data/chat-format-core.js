/*
 * Pure markdown-lite formatter for the per-cluster AI chat's assistant
 * replies (public/index.html, appendMessage), with its own test suite
 * (chat-format-core.test.js). No DOM, no Node-only APIs, same shared-core
 * pattern as html-core.js/dashboard-core.js in this same directory.
 *
 * The chat modal used to render every assistant reply as plain escaped text
 * (textContent + white-space: pre-wrap). The model's system prompt never
 * tells it to avoid markdown, and a real completion routinely comes back
 * with **bold**, a `code` span, or a "- " list when summarizing a project's
 * status, so Jack was seeing literal asterisks/backticks/dashes in every
 * reply that used them instead of the formatting the model actually meant.
 * This renders that same real markdown as real HTML instead of inventing
 * any new behavior for the model to opt into.
 *
 * Deliberately a small, fixed subset (bold, emphasis, inline code, bullet
 * lists, numbered lists, paragraph/line breaks), not a general markdown
 * parser: this only ever needs to handle one model's own replies to one
 * concise-status system prompt, not arbitrary third-party markdown.
 *
 * Safe by construction, not by sanitizing after the fact: the raw text is
 * HTML-escaped up front via HtmlCore's own escapeHtml, and every
 * transformation below only wraps already-escaped text in a fixed, known
 * tag. Nothing in the input can ever introduce a real tag/attribute of its
 * own, the same guarantee highlightMatch already relies on in html-core.js.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory(require('./html-core.js'));
  } else {
    root.ChatFormatCore = factory(root.HtmlCore);
  }
})(typeof self !== 'undefined' ? self : this, function (HtmlCore) {
  const { escapeHtml } = HtmlCore;

  // Inline code first, placeholder-swapped out before bold/emphasis run, so
  // `*ngrok*` is never read as emphasis markup - a real code span's own
  // literal asterisks/underscores must survive untouched.
  function applyInline(line) {
    const codeSpans = [];
    let withPlaceholders = line.replace(/`([^`]+)`/g, (_, code) => {
      codeSpans.push(code);
      return `\u0000${codeSpans.length - 1}\u0000`;
    });
    withPlaceholders = withPlaceholders
      .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
      .replace(/__([^_]+)__/g, '<strong>$1</strong>')
      .replace(/\*([^*]+)\*/g, '<em>$1</em>')
      .replace(/(?<![A-Za-z0-9])_([^_]+)_(?![A-Za-z0-9])/g, '<em>$1</em>');
    return withPlaceholders.replace(/\u0000(\d+)\u0000/g, (_, i) => `<code>${codeSpans[+i]}</code>`);
  }

  const BULLET_RE = /^[-*]\s+(.*)$/;
  const NUMBERED_RE = /^\d+\.\s+(.*)$/;

  // Groups escaped.split('\n') into real block-level HTML: a run of bullet
  // lines becomes one <ul>, a run of numbered lines one <ol>, a blank line
  // ends the current paragraph, and any other run of non-blank lines joins
  // into one <p> with <br> between them (a real model reply's own internal
  // line breaks within one thought, not a new paragraph).
  function formatChatReply(raw) {
    const escaped = escapeHtml(raw);
    if (!escaped.trim()) return '';
    const lines = escaped.split('\n');
    const html = [];
    let list = null; // { tag, items: [] }
    let para = [];

    function flushList() {
      if (list) {
        html.push(`<${list.tag}>${list.items.map(i => `<li>${applyInline(i)}</li>`).join('')}</${list.tag}>`);
        list = null;
      }
    }
    function flushPara() {
      if (para.length) {
        html.push(`<p>${para.map(applyInline).join('<br>')}</p>`);
        para = [];
      }
    }

    lines.forEach(line => {
      const bullet = BULLET_RE.exec(line);
      const numbered = NUMBERED_RE.exec(line);
      if (bullet) {
        flushPara();
        if (!list || list.tag !== 'ul') { flushList(); list = { tag: 'ul', items: [] }; }
        list.items.push(bullet[1]);
      } else if (numbered) {
        flushPara();
        if (!list || list.tag !== 'ol') { flushList(); list = { tag: 'ol', items: [] }; }
        list.items.push(numbered[1]);
      } else if (!line.trim()) {
        flushList();
        flushPara();
      } else {
        flushList();
        para.push(line);
      }
    });
    flushList();
    flushPara();
    return html.join('');
  }

  return { formatChatReply };
});
