"use strict";

function stripInlineComment(line) {
  let inSingle = false;
  let inDouble = false;
  for (let i = 0; i < line.length; i += 1) {
    const ch = line[i];
    if (ch === "'" && !inDouble) {
      inSingle = !inSingle;
      continue;
    }
    if (ch === '"' && !inSingle) {
      inDouble = !inDouble;
      continue;
    }
    if (ch === "#" && !inSingle && !inDouble) {
      return line.slice(0, i).trimEnd();
    }
  }
  return line.trimEnd();
}

function countIndent(line) {
  let count = 0;
  for (const ch of line) {
    if (ch === " ") {
      count += 1;
      continue;
    }
    break;
  }
  return count;
}

function tokenize(rawYaml) {
  const lines = String(rawYaml || "").split(/\r?\n/);
  const tokens = [];
  for (let i = 0; i < lines.length; i += 1) {
    const rawLine = lines[i];
    const withoutComment = stripInlineComment(rawLine);
    if (!withoutComment.trim()) {
      continue;
    }
    tokens.push({
      line: i + 1,
      indent: countIndent(withoutComment),
      text: withoutComment.trim(),
    });
  }
  return tokens;
}

function unquote(value) {
  if (
    (value.startsWith('"') && value.endsWith('"')) ||
    (value.startsWith("'") && value.endsWith("'"))
  ) {
    return value.slice(1, -1);
  }
  return value;
}

function splitInlineArray(content) {
  const items = [];
  let current = "";
  let inSingle = false;
  let inDouble = false;
  for (let i = 0; i < content.length; i += 1) {
    const ch = content[i];
    if (ch === "'" && !inDouble) {
      inSingle = !inSingle;
      current += ch;
      continue;
    }
    if (ch === '"' && !inSingle) {
      inDouble = !inDouble;
      current += ch;
      continue;
    }
    if (ch === "," && !inSingle && !inDouble) {
      items.push(current.trim());
      current = "";
      continue;
    }
    current += ch;
  }
  if (current.trim()) {
    items.push(current.trim());
  }
  return items;
}

function parseScalar(rawValue) {
  const value = rawValue.trim();
  if (value === "null" || value === "~") {
    return null;
  }
  if (value === "true") {
    return true;
  }
  if (value === "false") {
    return false;
  }
  if (/^-?\d+$/.test(value)) {
    return Number.parseInt(value, 10);
  }
  if (/^-?\d+\.\d+$/.test(value)) {
    return Number.parseFloat(value);
  }
  if (value.startsWith("[") && value.endsWith("]")) {
    const content = value.slice(1, -1).trim();
    if (!content) {
      return [];
    }
    return splitInlineArray(content).map((item) => parseScalar(item));
  }
  return unquote(value);
}

function findColonOutsideQuotes(text) {
  let inSingle = false;
  let inDouble = false;
  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i];
    if (ch === "'" && !inDouble) {
      inSingle = !inSingle;
      continue;
    }
    if (ch === '"' && !inSingle) {
      inDouble = !inDouble;
      continue;
    }
    if (ch === ":" && !inSingle && !inDouble) {
      return i;
    }
  }
  return -1;
}

function parseObject(tokens, startIndex, indent) {
  const obj = {};
  let index = startIndex;

  while (index < tokens.length) {
    const token = tokens[index];
    if (token.indent < indent) {
      break;
    }
    if (token.indent > indent) {
      throw new Error(`Invalid indent at line ${token.line}`);
    }
    if (token.text.startsWith("- ")) {
      break;
    }

    const colon = findColonOutsideQuotes(token.text);
    if (colon <= 0) {
      throw new Error(`Invalid mapping line ${token.line}: ${token.text}`);
    }
    const key = token.text.slice(0, colon).trim();
    const remainder = token.text.slice(colon + 1).trim();
    index += 1;

    if (!remainder) {
      if (index < tokens.length && tokens[index].indent > indent) {
        const nestedIndent = tokens[index].indent;
        const [nestedValue, nextIndex] = parseNode(tokens, index, nestedIndent);
        obj[key] = nestedValue;
        index = nextIndex;
      } else {
        obj[key] = null;
      }
    } else {
      obj[key] = parseScalar(remainder);
    }
  }

  return [obj, index];
}

function parseArray(tokens, startIndex, indent) {
  const arr = [];
  let index = startIndex;

  while (index < tokens.length) {
    const token = tokens[index];
    if (token.indent < indent) {
      break;
    }
    if (token.indent !== indent) {
      throw new Error(`Invalid array indent at line ${token.line}`);
    }
    if (!token.text.startsWith("- ")) {
      break;
    }

    const itemText = token.text.slice(2).trim();
    index += 1;

    if (!itemText) {
      if (index < tokens.length && tokens[index].indent > indent) {
        const [nestedValue, nextIndex] = parseNode(tokens, index, tokens[index].indent);
        arr.push(nestedValue);
        index = nextIndex;
      } else {
        arr.push(null);
      }
      continue;
    }

    const inlineColon = findColonOutsideQuotes(itemText);
    if (inlineColon > 0) {
      const key = itemText.slice(0, inlineColon).trim();
      const remainder = itemText.slice(inlineColon + 1).trim();
      const itemObject = {};
      if (remainder) {
        itemObject[key] = parseScalar(remainder);
      } else if (index < tokens.length && tokens[index].indent > indent) {
        const [nestedValue, nextIndex] = parseNode(tokens, index, tokens[index].indent);
        itemObject[key] = nestedValue;
        index = nextIndex;
      } else {
        itemObject[key] = null;
      }

      if (index < tokens.length && tokens[index].indent > indent) {
        const [restObject, nextIndex] = parseObject(tokens, index, tokens[index].indent);
        Object.assign(itemObject, restObject);
        index = nextIndex;
      }

      arr.push(itemObject);
      continue;
    }

    arr.push(parseScalar(itemText));
  }

  return [arr, index];
}

function parseNode(tokens, startIndex, indent) {
  const token = tokens[startIndex];
  if (!token) {
    return [null, startIndex];
  }
  if (token.text.startsWith("- ")) {
    return parseArray(tokens, startIndex, indent);
  }
  return parseObject(tokens, startIndex, indent);
}

function parseSimpleYaml(rawYaml) {
  const tokens = tokenize(rawYaml);
  if (tokens.length === 0) {
    return {};
  }
  const [value, index] = parseNode(tokens, 0, tokens[0].indent);
  if (index !== tokens.length) {
    throw new Error("Unexpected trailing YAML tokens");
  }
  return value;
}

module.exports = {
  parseSimpleYaml,
};

