/**
 * Re-indents JSON text without parsing it into JS values, so every number keeps the exact digits the
 * server sent. A JSON.parse round trip rounds integers past 2^53 (int64 ids, nanosecond timestamps)
 * and rewrites numbers such as `1.0`, which is wrong on a terminal someone copies values from.
 *
 * The output matches `JSON.stringify(value, null, indent)` for valid JSON: one member or element
 * per line, `"key": value`, and empty `{}` / `[]` kept on one line. Callers check the text is valid
 * JSON first; this only moves whitespace.
 */

const OPENERS: Record<string, string> = { '{': '}', '[': ']' };
const WHITESPACE = /\s/;

/** Index of the next non-whitespace character at or after `from`, or `text.length`. */
function nextSignificant(text: string, from: number): number {
  let index = from;
  while (index < text.length && WHITESPACE.test(text.charAt(index))) index += 1;
  return index;
}

/** Index just past the JSON string starting at `start` (an opening quote). */
function endOfString(text: string, start: number): number {
  let index = start + 1;
  while (index < text.length) {
    const char = text.charAt(index);
    if (char === '\\') {
      index += 2;
    } else if (char === '"') {
      return index + 1;
    } else {
      index += 1;
    }
  }
  return index;
}

/**
 * Indents valid JSON text by `indent` spaces per level, copying strings, numbers and literals
 * through untouched.
 *
 * @param text valid JSON
 * @param indent spaces per nesting level
 * @returns the same JSON, indented
 */
export function indentJsonText(text: string, indent = 2): string {
  const parts: string[] = [];
  let depth = 0;
  const newline = (): string => `\n${' '.repeat(depth * indent)}`;
  let index = nextSignificant(text, 0);
  while (index < text.length) {
    const char = text.charAt(index);
    const closer = OPENERS[char];
    if (char === '"') {
      const end = endOfString(text, index);
      parts.push(text.slice(index, end));
      index = end;
    } else if (closer !== undefined) {
      const next = nextSignificant(text, index + 1);
      if (text.charAt(next) === closer) {
        parts.push(char, closer);
        index = next + 1;
      } else {
        depth += 1;
        parts.push(char, newline());
        index += 1;
      }
    } else if (char === '}' || char === ']') {
      depth -= 1;
      parts.push(newline(), char);
      index += 1;
    } else if (char === ',') {
      parts.push(',', newline());
      index += 1;
    } else if (char === ':') {
      parts.push(': ');
      index += 1;
    } else if (WHITESPACE.test(char)) {
      index += 1;
    } else {
      // A number or literal: copy it to the next delimiter, digits untouched.
      let end = index;
      while (end < text.length && !/[\s,:\]}]/.test(text.charAt(end))) end += 1;
      parts.push(text.slice(index, end));
      index = end;
    }
  }
  return parts.join('');
}
