// Minimal XML -> {tag, attrs, text, children} for tests (the browser uses DOMParser text/xml). Handles the
// attribute-only, element-per-line shape of the DSN Now feed; throws on mismatched tags.
export function xmlTree(src) {
  const root = { tag: "#root", attrs: {}, text: "", children: [] };
  const stack = [root];
  const re = /<(\/?)([A-Za-z_][\w.-]*)((?:\s+[\w:.-]+="[^"]*")*)\s*(\/?)>|([^<]+)|(<\?[^>]*\?>|<!--[\s\S]*?-->)/g;
  let m, pos = 0;
  while ((m = re.exec(src))) {
    if (m.index !== pos) throw new Error("xml: bad syntax at " + pos);
    pos = re.lastIndex;
    if (m[6]) continue;
    if (m[5] != null) { const t = m[5].trim(); if (t) stack[stack.length - 1].text += t; continue; }
    if (m[1]) { const top = stack.pop(); if (!top || top.tag !== m[2]) throw new Error("xml: mismatched </" + m[2] + ">"); continue; }
    const attrs = {}; for (const a of m[3].matchAll(/([\w:.-]+)="([^"]*)"/g)) attrs[a[1]] = a[2].replace(/&quot;/g, '"').replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&");
    const el = { tag: m[2], attrs, text: "", children: [] };
    stack[stack.length - 1].children.push(el);
    if (!m[4]) stack.push(el);
  }
  if (pos !== src.length || stack.length !== 1) throw new Error("xml: unterminated");
  if (root.children.length !== 1) throw new Error("xml: need exactly one root element");
  return root.children[0];
}
