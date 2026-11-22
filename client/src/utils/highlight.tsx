import type { ReactNode } from 'react';

export function highlightMatches(text: string, re: RegExp | null): ReactNode {
  if (!re) return text;

  const flags = re.flags.includes('g') ? re.flags : `${re.flags}g`;
  const globalRe = new RegExp(re.source, flags);
  const parts: ReactNode[] = [];
  let lastIndex = 0;
  let key = 0;

  let match: RegExpExecArray | null;
  while ((match = globalRe.exec(text)) !== null) {
    if (match[0].length === 0) {
      if (globalRe.lastIndex >= text.length) break;
      globalRe.lastIndex++;
      continue;
    }

    if (match.index > lastIndex) {
      parts.push(text.slice(lastIndex, match.index));
    }
    parts.push(
      <mark key={key++} className="log-hit">
        {match[0]}
      </mark>,
    );
    lastIndex = match.index + match[0].length;
  }

  if (parts.length === 0) return text;
  if (lastIndex < text.length) {
    parts.push(text.slice(lastIndex));
  }
  return parts;
}
