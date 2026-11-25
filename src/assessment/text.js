/**
 * Text helpers for the assessment: split a portal hand-in into its parts,
 * pull items (stories, tables, list rules) out of markdown, and find lines.
 */

/** The text of one portal part: from "## <label>" to the next part heading. */
function partText(text, label, labels) {
  const body = String(text || '');
  const start = body.indexOf(`\n## ${label}\n`) >= 0 ? body.indexOf(`\n## ${label}\n`) + 1 : body.startsWith(`## ${label}\n`) ? 0 : -1;
  if (start < 0) return '';
  let from = start + `## ${label}\n`.length;
  let end = body.length;
  for (const other of labels) {
    if (other === label) continue;
    const at = body.indexOf(`\n## ${other}\n`, from);
    if (at >= 0 && at < end) end = at;
  }
  const missing = body.indexOf('\n## Note on missing parts\n', from);
  if (missing >= 0 && missing < end) end = missing;
  let out = body.slice(from, end).replace(/^File: [^\n]*\n/, '').trim();
  // Links lines the portal writes for file parts (pinned URL and checks) are not the file's content.
  out = out.replace(/^- [^\n]*https:\/\/github\.com\/[^\n]*\n?/m, '').trim();
  return out;
}

/** Lines under a heading whose text matches `re`, until the next heading of the same or higher level. */
function sectionUnder(text, re) {
  const lines = String(text || '').split('\n');
  const out = [];
  let level = 0;
  for (const line of lines) {
    const h = line.match(/^(#{1,6})\s+(.*)$/);
    if (h) {
      if (level && h[1].length <= level) break;
      if (!level && re.test(h[2])) {
        level = h[1].length;
        out.push(line);
        continue;
      }
    }
    if (level) out.push(line);
  }
  return out.join('\n');
}

/** Numbered or bulleted list items, with their number when there is one. */
function listItems(text) {
  const items = [];
  for (const raw of String(text || '').split('\n')) {
    const m = raw.match(/^\s*(?:(\d+)[.)]|[-*+])\s+(.*\S)\s*$/);
    if (m) items.push({ n: m[1] ? Number(m[1]) : null, text: m[2], line: raw });
    else if (items.length && /^\s{2,}\S/.test(raw)) items[items.length - 1].text += ` ${raw.trim()}`;
  }
  return items;
}

/** Markdown tables as arrays of row objects keyed by header (lower case). */
function tables(text) {
  const lines = String(text || '').split('\n');
  const out = [];
  for (let i = 0; i < lines.length - 1; i++) {
    if (!/^\s*\|.*\|\s*$/.test(lines[i]) || !/^\s*\|[\s:|-]+\|\s*$/.test(lines[i + 1])) continue;
    const cells = (l) => l.trim().replace(/^\||\|$/g, '').split('|').map((c) => c.trim());
    const header = cells(lines[i]).map((h) => h.toLowerCase());
    const rows = [];
    let j = i + 2;
    for (; j < lines.length && /^\s*\|.*\|\s*$/.test(lines[j]); j++) {
      const c = cells(lines[j]);
      const row = { _line: lines[j].trim() };
      header.forEach((h, k) => { row[h || `col${k}`] = c[k] ?? ''; });
      rows.push(row);
    }
    out.push({ header, rows });
    i = j - 1;
  }
  return out;
}

/** Pick a column by any of several header names. */
const col = (row, names) => {
  for (const key of Object.keys(row)) if (names.some((n) => key === n || key.startsWith(n))) return row[key];
  return '';
};

const words = (t) => String(t || '').toLowerCase().match(/[a-zæøå0-9]+/g) || [];
function jaccard(a, b) {
  const A = new Set(words(a));
  const B = new Set(words(b));
  if (!A.size || !B.size) return 0;
  let n = 0;
  for (const x of A) if (B.has(x)) n++;
  return n / (A.size + B.size - n);
}

const cut = (t, n) => {
  const s = String(t || '').replace(/\s+/g, ' ').trim();
  return s.length > n ? `${s.slice(0, n - 1)}…` : s;
};

module.exports = { partText, sectionUnder, listItems, tables, col, words, jaccard, cut };
