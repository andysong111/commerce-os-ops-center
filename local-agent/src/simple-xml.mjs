const ENTITY_PATTERN = /&(#x?[0-9a-fA-F]+|amp|lt|gt|quot|apos);/g;

function decodeXmlEntities(value) {
  return value.replace(ENTITY_PATTERN, (_match, entity) => {
    if (entity === "amp") return "&";
    if (entity === "lt") return "<";
    if (entity === "gt") return ">";
    if (entity === "quot") return '"';
    if (entity === "apos") return "'";
    const hexadecimal = entity.startsWith("#x");
    const codePoint = Number.parseInt(entity.slice(hexadecimal ? 2 : 1), hexadecimal ? 16 : 10);
    return Number.isFinite(codePoint) ? String.fromCodePoint(codePoint) : "";
  });
}

function appendChild(target, name, value) {
  if (target[name] === undefined) target[name] = value;
  else if (Array.isArray(target[name])) target[name].push(value);
  else target[name] = [target[name], value];
}

function finalizeNode(node) {
  const record = {};
  for (const child of node.children) appendChild(record, child.name, child.value);
  const text = node.text.join("").trim();
  if (!node.children.length) return text;
  if (text) record["#text"] = text;
  return record;
}

function tagName(value) {
  return value.replace(/^<\/?/, "").replace(/\/?>$/, "").trim().split(/\s+/, 1)[0];
}

export function parseSimpleXml(value) {
  const source = String(value ?? "").replace(/^\uFEFF/, "").trim();
  if (!source) throw new Error("XML_EMPTY");
  const tokens = source.match(/<!\[CDATA\[[\s\S]*?\]\]>|<!--[\s\S]*?-->|<\?[\s\S]*?\?>|<!DOCTYPE[\s\S]*?>|<[^>]+>|[^<]+/g) ?? [];
  const root = { name: "$root", children: [], text: [] };
  const stack = [root];

  for (const token of tokens) {
    if (token.startsWith("<?") || token.startsWith("<!--") || token.startsWith("<!DOCTYPE")) continue;
    if (token.startsWith("<![CDATA[")) {
      stack.at(-1)?.text.push(token.slice(9, -3));
      continue;
    }
    if (token.startsWith("</")) {
      if (stack.length <= 1) throw new Error("XML_UNEXPECTED_CLOSE");
      const closing = tagName(token);
      const node = stack.pop();
      if (node.name !== closing) throw new Error(`XML_TAG_MISMATCH:${node.name}:${closing}`);
      stack.at(-1).children.push({ name: node.name, value: finalizeNode(node) });
      continue;
    }
    if (token.startsWith("<")) {
      if (token.startsWith("<!")) continue;
      const name = tagName(token);
      if (!name) throw new Error("XML_TAG_NAME_REQUIRED");
      if (token.endsWith("/>")) stack.at(-1).children.push({ name, value: "" });
      else stack.push({ name, children: [], text: [] });
      continue;
    }
    const decoded = decodeXmlEntities(token);
    if (decoded.trim()) stack.at(-1)?.text.push(decoded);
  }

  if (stack.length !== 1) throw new Error(`XML_UNCLOSED_TAG:${stack.at(-1)?.name ?? "unknown"}`);
  const result = finalizeNode(root);
  return result && typeof result === "object" && !Array.isArray(result) ? result : {};
}
