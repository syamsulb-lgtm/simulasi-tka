// Tiny renderer for the subset of markdown used in the question bank:
// paragraphs (single newlines kept as <br>), pipe tables, **bold**, *italic*.
// All input is HTML-escaped first, so the result is safe to output unescaped.

function escapeHtml(s) {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function inline(s) {
  return escapeHtml(s)
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/(^|[^*])\*([^*\s][^*]*?)\*(?!\*)/g, '$1<em>$2</em>');
}

function tableRow(line, tag) {
  const cells = line.trim().replace(/^\|/, '').replace(/\|$/, '').split('|');
  return `<tr>${cells.map((c) => `<${tag}>${inline(c.trim())}</${tag}>`).join('')}</tr>`;
}

export function renderMd(text) {
  if (!text) return '';
  const blocks = String(text).split(/\n{2,}/);
  return blocks
    .map((block) => {
      const lines = block.split('\n').filter((l) => l.trim() !== '');
      if (lines.length === 0) return '';
      if (lines.every((l) => /^\s*\|/.test(l))) {
        const rows = lines.filter((l) => !/^\s*\|[\s:|-]+\|\s*$/.test(l));
        const [head, ...body] = rows;
        return `<div class="md-table"><table><thead>${tableRow(head, 'th')}</thead><tbody>${body.map((r) => tableRow(r, 'td')).join('')}</tbody></table></div>`;
      }
      return `<p>${lines.map(inline).join('<br>')}</p>`;
    })
    .join('');
}
