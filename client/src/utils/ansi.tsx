import type { CSSProperties, ReactNode } from 'react';
import { highlightMatches } from './highlight';

const ANSI_STANDARD: string[] = [
  '#4f5666', // 30 black (lifted slightly for dark console legibility)
  '#ef6b73', // 31 red
  '#69db7c', // 32 green
  '#ffd43b', // 33 yellow
  '#66a8ff', // 34 blue
  '#da77f2', // 35 magenta
  '#4dd0e1', // 36 cyan
  '#dce3e6', // 37 white
];

const ANSI_BRIGHT: string[] = [
  '#868e96', // 90 bright black (gray)
  '#ff8787', // 91 bright red
  '#8ce99a', // 92 bright green
  '#ffe066', // 93 bright yellow
  '#74c0fc', // 94 bright blue
  '#e599f7', // 95 bright magenta
  '#66d9e8', // 96 bright cyan
  '#ffffff', // 97 bright white
];

function ansi256ToHex(n: number): string | undefined {
  if (n < 0 || n > 255) return undefined;
  if (n < 8) return ANSI_STANDARD[n];
  if (n < 16) return ANSI_BRIGHT[n - 8];
  if (n >= 232) {
    const v = 8 + (n - 232) * 10;
    return `rgb(${v}, ${v}, ${v})`;
  }
  const idx = n - 16;
  const r = Math.floor(idx / 36);
  const g = Math.floor((idx % 36) / 6);
  const b = idx % 6;
  const levels = [0, 95, 135, 175, 215, 255];
  return `rgb(${levels[r]}, ${levels[g]}, ${levels[b]})`;
}

export function stripAnsi(s: string): string {
  return s.replace(/\x1b\[[0-9;?]*[ -/]*[@-~]/g, '');
}

interface AnsiState {
  color?: string;
  backgroundColor?: string;
  bold?: boolean;
  dim?: boolean;
  italic?: boolean;
  underline?: boolean;
  strikethrough?: boolean;
}

function stateToStyle(state: AnsiState): CSSProperties | undefined {
  const style: CSSProperties = {};
  let hasAny = false;
  if (state.color) {
    style.color = state.color;
    hasAny = true;
  }
  if (state.backgroundColor) {
    style.backgroundColor = state.backgroundColor;
    style.borderRadius = '2px';
    style.paddingInline = '2px';
    hasAny = true;
  }
  if (state.bold) {
    style.fontWeight = 700;
    hasAny = true;
  }
  if (state.dim) {
    style.opacity = 0.72;
    hasAny = true;
  }
  if (state.italic) {
    style.fontStyle = 'italic';
    hasAny = true;
  }
  if (state.underline || state.strikethrough) {
    style.textDecoration = [state.underline ? 'underline' : '', state.strikethrough ? 'line-through' : '']
      .filter(Boolean)
      .join(' ');
    hasAny = true;
  }
  return hasAny ? style : undefined;
}

/**
 * Renders ANSI SGR escape sequences (16-color, bright, 256-color, 24-bit TrueColor,
 * bold/dim/italic/underline/strikethrough) into styled React spans while preserving
 * search-filter match highlighting.
 */
export function renderAnsi(text: string, filterMatcher: RegExp | null): ReactNode {
  if (!text.includes('\x1b[')) {
    return highlightMatches(text, filterMatcher);
  }

  const regex = /\x1b\[([0-9;]*)m/g;
  const nodes: ReactNode[] = [];
  let state: AnsiState = {};
  let lastIndex = 0;
  let keyIdx = 0;
  let match: RegExpExecArray | null;

  while ((match = regex.exec(text)) !== null) {
    if (match.index > lastIndex) {
      const segment = text.slice(lastIndex, match.index);
      const style = stateToStyle(state);
      const content = highlightMatches(segment, filterMatcher);
      nodes.push(style ? <span key={keyIdx++} style={style}>{content}</span> : <span key={keyIdx++}>{content}</span>);
    }

    const rawCodes = match[1];
    const codes = rawCodes === '' ? [0] : rawCodes.split(';').map((c) => (c === '' ? 0 : parseInt(c, 10)));

    for (let i = 0; i < codes.length; i++) {
      const code = codes[i];
      if (Number.isNaN(code) || code === 0) {
        state = {};
      } else if (code === 1) {
        state = { ...state, bold: true };
      } else if (code === 2) {
        state = { ...state, dim: true };
      } else if (code === 3) {
        state = { ...state, italic: true };
      } else if (code === 4) {
        state = { ...state, underline: true };
      } else if (code === 9) {
        state = { ...state, strikethrough: true };
      } else if (code === 22) {
        state = { ...state, bold: false, dim: false };
      } else if (code === 23) {
        state = { ...state, italic: false };
      } else if (code === 24) {
        state = { ...state, underline: false };
      } else if (code === 29) {
        state = { ...state, strikethrough: false };
      } else if (code >= 30 && code <= 37) {
        state = { ...state, color: ANSI_STANDARD[code - 30] };
      } else if (code === 39) {
        state = { ...state, color: undefined };
      } else if (code >= 40 && code <= 47) {
        state = { ...state, backgroundColor: ANSI_STANDARD[code - 40] };
      } else if (code === 49) {
        state = { ...state, backgroundColor: undefined };
      } else if (code >= 90 && code <= 97) {
        state = { ...state, color: ANSI_BRIGHT[code - 90] };
      } else if (code >= 100 && code <= 107) {
        state = { ...state, backgroundColor: ANSI_BRIGHT[code - 100] };
      } else if (code === 38 || code === 48) {
        const isFg = code === 38;
        const mode = codes[i + 1];
        if (mode === 5 && i + 2 < codes.length) {
          const hex = ansi256ToHex(codes[i + 2]);
          if (hex) {
            state = isFg ? { ...state, color: hex } : { ...state, backgroundColor: hex };
          }
          i += 2;
        } else if (mode === 2 && i + 4 < codes.length) {
          const r = Math.min(255, Math.max(0, codes[i + 2] || 0));
          const g = Math.min(255, Math.max(0, codes[i + 3] || 0));
          const b = Math.min(255, Math.max(0, codes[i + 4] || 0));
          const rgb = `rgb(${r}, ${g}, ${b})`;
          state = isFg ? { ...state, color: rgb } : { ...state, backgroundColor: rgb };
          i += 4;
        }
      }
    }

    lastIndex = regex.lastIndex;
  }

  if (lastIndex < text.length) {
    const tail = stripAnsi(text.slice(lastIndex));
    if (tail) {
      const style = stateToStyle(state);
      const content = highlightMatches(tail, filterMatcher);
      nodes.push(style ? <span key={keyIdx++} style={style}>{content}</span> : <span key={keyIdx++}>{content}</span>);
    }
  }

  return nodes;
}
