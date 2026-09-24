type TokenKind = "open" | "close" | "atom" | "comment";
type Token = { kind: TokenKind; value: string };

function tokenize(source: string): Token[] {
  const tokens: Token[] = [];
  let index = 0;
  while (index < source.length) {
    const character = source[index];
    if (/\s/.test(character)) {
      index += 1;
      continue;
    }
    if (source.startsWith(";;", index)) {
      const end = source.indexOf("\n", index);
      const stop = end < 0 ? source.length : end;
      tokens.push({ kind: "comment", value: source.slice(index, stop) });
      index = stop;
      continue;
    }
    if (source.startsWith("#|", index)) {
      const start = index;
      let nesting = 0;
      while (index < source.length) {
        if (source.startsWith("#|", index)) {
          nesting += 1;
          index += 2;
        } else if (source.startsWith("|#", index)) {
          nesting -= 1;
          index += 2;
          if (nesting === 0) break;
        } else {
          index += 1;
        }
      }
      tokens.push({ kind: "comment", value: source.slice(start, index) });
      continue;
    }
    if (character === "(") {
      tokens.push({ kind: "open", value: character });
      index += 1;
      continue;
    }
    if (character === ")") {
      tokens.push({ kind: "close", value: character });
      index += 1;
      continue;
    }
    const start = index;
    if (character === '"') {
      index += 1;
      while (index < source.length) {
        if (source[index] === "\\") {
          index += 2;
        } else if (source[index++] === '"') {
          break;
        }
      }
    } else {
      while (
        index < source.length &&
        !/\s/.test(source[index]) &&
        source[index] !== "(" &&
        source[index] !== ")" &&
        !source.startsWith(";;", index) &&
        !source.startsWith("#|", index)
      ) {
        index += 1;
      }
    }
    tokens.push({ kind: "atom", value: source.slice(start, index) });
  }
  return tokens;
}

/** Pretty-print KMonad's whitespace-insensitive S-expression syntax. */
export function formatKMonad(source: string): string {
  const lines: string[] = [];
  const stack: { hasHead: boolean }[] = [];
  let depth = 0;
  let line = "";
  const indent = (level: number) => "  ".repeat(Math.max(0, level));
  const flush = () => {
    if (line.trim()) lines.push(line.trimEnd());
    line = "";
  };

  for (const token of tokenize(source)) {
    if (token.kind === "comment") {
      flush();
      for (const commentLine of token.value.split("\n")) {
        if (commentLine.trim()) lines.push(indent(depth) + commentLine.trim());
      }
      continue;
    }
    if (token.kind === "open") {
      flush();
      line = `${indent(depth)}(`;
      stack.push({ hasHead: false });
      depth += 1;
      continue;
    }
    if (token.kind === "close") {
      flush();
      depth = Math.max(0, depth - 1);
      stack.pop();
      line = `${indent(depth)})`;
      flush();
      continue;
    }

    const currentList = stack[stack.length - 1];
    if (currentList && !currentList.hasHead && line.endsWith("(")) {
      line += token.value;
      currentList.hasHead = true;
      flush();
    } else {
      const next = line
        ? `${line} ${token.value}`
        : `${indent(depth)}${token.value}`;
      if (line && next.length > 96) flush();
      line = line ? `${line} ${token.value}` : `${indent(depth)}${token.value}`;
    }
  }
  flush();
  return lines.join("\n");
}
