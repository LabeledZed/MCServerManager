import { useEffect, useRef } from 'react';
import { EditorState } from '@codemirror/state';
import { EditorView, keymap, lineNumbers, highlightActiveLine, highlightActiveLineGutter } from '@codemirror/view';
import { defaultKeymap, history, historyKeymap, indentWithTab } from '@codemirror/commands';
import { searchKeymap, highlightSelectionMatches } from '@codemirror/search';
import { bracketMatching, foldGutter, foldKeymap, HighlightStyle, syntaxHighlighting } from '@codemirror/language';
import { yaml } from '@codemirror/lang-yaml';
import { json } from '@codemirror/lang-json';
import { tags } from '@lezer/highlight';
import type { ConfigFormat } from '../../../shared/types';

interface RawCodeEditorProps {
  value: string;
  format: ConfigFormat;
  onChange: (next: string) => void;
  onSave?: () => void;
}

const mcsmTheme = EditorView.theme(
  {
    '&': {
      backgroundColor: '#161818',
      color: '#e5eff1',
    },
    '.cm-content': {
      caretColor: '#37abc8',
      padding: '10px 0',
    },
    '.cm-cursor, .cm-dropCursor': {
      borderLeftColor: '#37abc8',
      borderLeftWidth: '2px',
    },
    '&.cm-focused .cm-selectionBackground, .cm-selectionBackground, .cm-content ::selection': {
      backgroundColor: '#24708377',
    },
    '.cm-gutters': {
      backgroundColor: '#1f2120',
      color: '#7a8f94',
      borderRight: '1px solid #353b3a',
    },
    '.cm-activeLineGutter': {
      backgroundColor: '#2c2e2d',
      color: '#37abc8',
    },
    '.cm-activeLine': {
      backgroundColor: '#2c2e2d55',
    },
    '.cm-foldPlaceholder': {
      backgroundColor: '#247083',
      border: '1px solid #37abc8',
      color: '#ffffff',
    },
  },
  { dark: true },
);

const mcsmHighlight = HighlightStyle.define([
  { tag: tags.propertyName, color: '#37abc8', fontWeight: '500' },
  { tag: tags.string, color: '#9ee6b8' },
  { tag: tags.number, color: '#f7c873' },
  { tag: tags.bool, color: '#7dd3fc', fontWeight: '600' },
  { tag: tags.null, color: '#f87171', fontStyle: 'italic' },
  { tag: tags.comment, color: '#7f9398', fontStyle: 'italic' },
  { tag: tags.punctuation, color: '#9eb0b5' },
  { tag: tags.keyword, color: '#5cc4df' },
]);

export function RawCodeEditor({ value, format, onChange, onSave }: RawCodeEditorProps) {
  const hostRef = useRef<HTMLDivElement>(null);
  const viewRef = useRef<EditorView | null>(null);
  const onChangeRef = useRef(onChange);
  const onSaveRef = useRef(onSave);
  onChangeRef.current = onChange;
  onSaveRef.current = onSave;

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;

    const langExt = format === 'yaml' ? [yaml()] : format === 'json' ? [json()] : [];

    const state = EditorState.create({
      doc: value,
      extensions: [
        lineNumbers(),
        foldGutter(),
        highlightActiveLine(),
        highlightActiveLineGutter(),
        bracketMatching(),
        history(),
        highlightSelectionMatches(),
        mcsmTheme,
        syntaxHighlighting(mcsmHighlight),
        ...langExt,
        keymap.of([
          {
            key: 'Mod-s',
            run: () => {
              onSaveRef.current?.();
              return true;
            },
          },
          indentWithTab,
          ...defaultKeymap,
          ...historyKeymap,
          ...foldKeymap,
          ...searchKeymap,
        ]),
        EditorView.updateListener.of((update) => {
          if (update.docChanged) {
            onChangeRef.current(update.state.doc.toString());
          }
        }),
      ],
    });

    const view = new EditorView({ state, parent: host });
    viewRef.current = view;

    return () => {
      view.destroy();
      viewRef.current = null;
    };
    // Rebuild editor when format changes
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [format]);

  // Sync external document reloads without clobbering cursor while typing
  useEffect(() => {
    const view = viewRef.current;
    if (!view) return;
    const current = view.state.doc.toString();
    if (current !== value) {
      view.dispatch({
        changes: { from: 0, to: current.length, insert: value },
      });
    }
  }, [value]);

  return <div ref={hostRef} className="cm-wrapper" aria-label="Raw configuration code editor" />;
}
