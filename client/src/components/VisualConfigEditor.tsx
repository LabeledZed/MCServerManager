import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertTriangle,
  ChevronsDownUp,
  ChevronsUpDown,
  Code2,
  FileText,
  Plus,
  RefreshCw,
  Save,
  Search,
  Sparkles,
  Trash2,
} from 'lucide-react';
import { api, formatBytes } from '../api/client';
import { Switch } from './Switch';
import { RawCodeEditor } from './RawCodeEditor';
import type { ConfigTreeNode, ConfigValueKind, ParsedConfigDocument } from '../../../shared/types';

interface VisualConfigEditorProps {
  serverId: string;
  relativePath: string;
  onSaved?: (doc: ParsedConfigDocument) => void;
  onNotify: (tone: 'info' | 'success' | 'warn' | 'error', text: string) => void;
  /** Group flat server.properties keys into Aternos-style category cards */
  groupByCategory?: boolean;
}

const MC_COLOR_MAP: Record<string, string> = {
  '0': '#000000',
  '1': '#3b5bdb',
  '2': '#2b8a3e',
  '3': '#15aabf',
  '4': '#c92a2a',
  '5': '#9c36b5',
  '6': '#f59f00',
  '7': '#adb5bd',
  '8': '#6c757d',
  '9': '#748ffc',
  a: '#69db7c',
  b: '#66d9e8',
  c: '#ff8787',
  d: '#f783ac',
  e: '#ffe066',
  f: '#ffffff',
};

function renderMinecraftFormattedPreview(input: string) {
  const normalized = input.replace(/\\u00[Aa]7/g, '§').replace(/&([0-9a-fk-orA-FK-OR])/g, '§$1');
  const segments: Array<{ text: string; color?: string; bold?: boolean; italic?: boolean; underline?: boolean; strike?: boolean }> = [];
  let curColor: string | undefined;
  let bold = false;
  let italic = false;
  let underline = false;
  let strike = false;
  let buf = '';

  for (let i = 0; i < normalized.length; i++) {
    if (normalized[i] === '§' && i + 1 < normalized.length) {
      if (buf) {
        segments.push({ text: buf, color: curColor, bold, italic, underline, strike });
        buf = '';
      }
      const code = normalized[i + 1].toLowerCase();
      i++;
      if (MC_COLOR_MAP[code]) {
        curColor = MC_COLOR_MAP[code];
        bold = false;
        italic = false;
        underline = false;
        strike = false;
      } else if (code === 'l') bold = true;
      else if (code === 'o') italic = true;
      else if (code === 'n') underline = true;
      else if (code === 'm') strike = true;
      else if (code === 'r') {
        curColor = undefined;
        bold = false;
        italic = false;
        underline = false;
        strike = false;
      }
    } else {
      buf += normalized[i];
    }
  }
  if (buf) segments.push({ text: buf, color: curColor, bold, italic, underline, strike });

  return (
    <div className="motd-preview" aria-label="Minecraft formatted preview">
      {segments.map((s, idx) => (
        <span
          key={idx}
          style={{
            color: s.color || '#e5eff1',
            fontWeight: s.bold ? 700 : 400,
            fontStyle: s.italic ? 'italic' : 'normal',
            textDecoration: [s.underline ? 'underline' : '', s.strike ? 'line-through' : ''].filter(Boolean).join(' ') || undefined,
          }}
        >
          {s.text}
        </span>
      ))}
    </div>
  );
}

function hasMinecraftFormatting(text: string): boolean {
  return /(§|\\u00[Aa]7|&)[0-9a-fk-orA-FK-OR]/.test(text);
}

function humanizeKey(key: string): string {
  return key
    .replace(/[-_]+/g, ' ')
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

function nodeMatchesSearch(node: ConfigTreeNode, query: string): boolean {
  if (!query) return true;
  const q = query.toLowerCase();
  if (node.key.toLowerCase().includes(q)) return true;
  if (node.meta?.label?.toLowerCase().includes(q)) return true;
  if (node.meta?.description?.toLowerCase().includes(q)) return true;
  if (node.comment?.toLowerCase().includes(q)) return true;
  if (node.inlineComment?.toLowerCase().includes(q)) return true;
  if (node.value !== undefined && node.value !== null && String(node.value).toLowerCase().includes(q)) return true;
  if (node.children) {
    return node.children.some((c) => nodeMatchesSearch(c, q));
  }
  return false;
}

function updateNodeAtPath(
  nodes: ConfigTreeNode[],
  targetPath: (string | number)[],
  updater: (node: ConfigTreeNode) => ConfigTreeNode | null,
): ConfigTreeNode[] {
  if (targetPath.length === 0) return nodes;
  const [head, ...rest] = targetPath;
  const out: ConfigTreeNode[] = [];
  for (const node of nodes) {
    const match = node.path[node.path.length - 1] === head || node.key === String(head);
    if (!match) {
      out.push(node);
      continue;
    }
    if (rest.length === 0) {
      const updated = updater(node);
      if (updated !== null) out.push(updated);
    } else {
      out.push({
        ...node,
        children: updateNodeAtPath(node.children || [], rest, updater),
      });
    }
  }
  return out;
}

function defaultNodeForKind(key: string, parentPath: (string | number)[], kind: ConfigValueKind): ConfigTreeNode {
  const path = [...parentPath, key];
  if (kind === 'boolean') return { key, path, kind: 'boolean', value: false };
  if (kind === 'number') return { key, path, kind: 'number', value: 0 };
  if (kind === 'array') return { key, path, kind: 'array', children: [] };
  if (kind === 'object') return { key, path, kind: 'object', children: [] };
  if (kind === 'null') return { key, path, kind: 'null', value: null };
  return { key, path, kind: 'string', value: '' };
}

function AddPropertyInline({
  onAdd,
}: {
  onAdd: (key: string, kind: ConfigValueKind) => void;
}) {
  const [open, setOpen] = useState(false);
  const [key, setKey] = useState('');
  const [kind, setKind] = useState<ConfigValueKind>('string');

  if (!open) {
    return (
      <button type="button" className="btn btn-ghost btn-sm" onClick={() => setOpen(true)}>
        <Plus size={14} aria-hidden="true" />
        Add key
      </button>
    );
  }

  const submit = () => {
    const k = key.trim();
    if (!k) return;
    onAdd(k, kind);
    setKey('');
    setOpen(false);
  };

  return (
    <div style={{ display: 'flex', gap: '0.45rem', alignItems: 'center', flexWrap: 'wrap', padding: '0.4rem 0' }}>
      <input
        type="text"
        className="input"
        style={{ maxWidth: '210px', minHeight: '34px', padding: '0.3rem 0.6rem' }}
        placeholder="new-key-name"
        value={key}
        autoCorrect="off"
        autoCapitalize="none"
        spellCheck={false}
        onChange={(e) => setKey(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && !e.nativeEvent.isComposing && e.keyCode !== 229) {
            e.preventDefault();
            submit();
          }
        }}
      />
      <select
        className="select"
        style={{ maxWidth: '140px', minHeight: '34px', padding: '0.3rem 0.6rem' }}
        aria-label="New key value type"
        value={kind}
        onChange={(e) => setKind(e.target.value as ConfigValueKind)}
      >
        <option value="string">Text</option>
        <option value="number">Number</option>
        <option value="boolean">Toggle (Bool)</option>
        <option value="array">List (Array)</option>
        <option value="object">Section (Object)</option>
      </select>
      <button type="button" className="btn btn-primary btn-sm" onClick={submit}>
        Add
      </button>
      <button type="button" className="btn btn-ghost btn-sm" onClick={() => setOpen(false)}>
        Cancel
      </button>
    </div>
  );
}

export function VisualConfigEditor({
  serverId,
  relativePath,
  onSaved,
  onNotify,
  groupByCategory = false,
}: VisualConfigEditorProps) {
  const [doc, setDoc] = useState<ParsedConfigDocument | null>(null);
  const [tree, setTree] = useState<ConfigTreeNode[]>([]);
  const [rawText, setRawText] = useState('');
  const [mode, setMode] = useState<'visual' | 'raw'>('visual');
  const [dirty, setDirty] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [expandVersion, setExpandVersion] = useState<{ open: boolean; seq: number }>({ open: true, seq: 0 });
  const containerRef = useRef<HTMLDivElement>(null);

  const loadFile = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const loaded = await api.readConfigFile(serverId, relativePath);
      setDoc(loaded);
      setRawText(loaded.raw);
      setTree(loaded.tree || []);
      setMode(loaded.supportsVisual ? 'visual' : 'raw');
      setDirty(false);
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : String(err));
      setDoc(null);
    } finally {
      setLoading(false);
    }
  }, [serverId, relativePath]);

  useEffect(() => {
    void loadFile();
  }, [loadFile]);

  const handleSave = useCallback(async () => {
    if (!doc || saving) return;
    setSaving(true);
    try {
      const updated =
        mode === 'visual' && doc.supportsVisual
          ? await api.saveConfigTree(serverId, relativePath, tree)
          : await api.saveConfigRaw(serverId, relativePath, rawText);
      setDoc(updated);
      setRawText(updated.raw);
      setTree(updated.tree || []);
      setDirty(false);
      onSaved?.(updated);
      onNotify('success', `Saved ${updated.fileName}`);
    } catch (err) {
      onNotify('error', err instanceof Error ? err.message : 'Failed to save configuration');
    } finally {
      setSaving(false);
    }
  }, [doc, saving, mode, serverId, relativePath, tree, rawText, onSaved, onNotify]);

  // Ctrl+S / Cmd+S shortcut in visual mode
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') {
        if (dirty) {
          e.preventDefault();
          void handleSave();
        }
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [dirty, handleSave]);

  const toggleAllDetails = (open: boolean) => {
    setExpandVersion((prev) => ({ open, seq: prev.seq + 1 }));
    const root = containerRef.current;
    if (!root) return;
    root.querySelectorAll('details.cfg-section').forEach((el) => {
      (el as HTMLDetailsElement).open = open;
    });
  };

  const mutateTree = (fn: (prev: ConfigTreeNode[]) => ConfigTreeNode[]) => {
    setTree((prev) => fn(prev));
    setDirty(true);
  };

  const renderNode = (node: ConfigTreeNode, depth = 0): React.ReactNode => {
    if (search.trim() && !nodeMatchesSearch(node, search.trim())) return null;

    const pathKey = node.path.join('.');
    const description = node.meta?.description || node.comment || node.inlineComment;
    const displayLabel = node.meta?.label || humanizeKey(node.key);

    // Nested Object Section -> native <details> accordion
    if (node.kind === 'object') {
      const kids = node.children || [];
      const defaultOpen = Boolean(search.trim()) || depth < 1 || expandVersion.open;
      return (
        <details key={`${pathKey}-${expandVersion.seq}`} className="cfg-section" open={defaultOpen}>
          <summary>
            <span>{displayLabel}</span>
            <span className="cfg-key-raw">{node.key}</span>
            <span className="badge badge-neutral" style={{ marginInlineStart: 'auto' }}>
              {kids.length} {kids.length === 1 ? 'key' : 'keys'}
            </span>
          </summary>
          <div className="cfg-section-body">
            {description && <div className="cfg-comment">{description}</div>}
            {kids.length === 0 ? (
              <div className="field-hint">Empty section</div>
            ) : (
              kids.map((child) => renderNode(child, depth + 1))
            )}
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: '0.2rem' }}>
              <AddPropertyInline
                onAdd={(newKey, kind) => {
                  mutateTree((prev) =>
                    updateNodeAtPath(prev, node.path, (target) => ({
                      ...target,
                      children: [
                        ...(target.children || []),
                        defaultNodeForKind(newKey, target.path, kind),
                      ],
                    })),
                  );
                }}
              />
              <button
                type="button"
                className="btn btn-ghost btn-sm"
                title={`Remove section ${node.key}`}
                aria-label={`Remove section ${node.key}`}
                onClick={() => mutateTree((prev) => updateNodeAtPath(prev, node.path, () => null))}
              >
                <Trash2 size={14} aria-hidden="true" />
              </button>
            </div>
          </div>
        </details>
      );
    }

    // Array / List
    if (node.kind === 'array') {
      const items = node.children || [];
      const hasComplexChildren = items.some((i) => i.kind === 'object' || i.kind === 'array');
      return (
        <div key={pathKey} className="cfg-array-box">
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '0.5rem', flexWrap: 'wrap' }}>
            <div className="cfg-key-col">
              <div className="cfg-key-title">
                <span>{displayLabel}</span>
                <span className="cfg-key-raw">{node.key}</span>
                <span className="badge badge-accent">{items.length} items</span>
              </div>
              {description && <div className="cfg-comment">{description}</div>}
            </div>
            <div style={{ display: 'flex', gap: '0.35rem' }}>
              <button
                type="button"
                className="btn btn-sm"
                onClick={() => {
                  mutateTree((prev) =>
                    updateNodeAtPath(prev, node.path, (target) => {
                      const nextIdx = (target.children || []).length;
                      const newChild: ConfigTreeNode = hasComplexChildren
                        ? { key: String(nextIdx), path: [...target.path, nextIdx], kind: 'object', children: [] }
                        : { key: String(nextIdx), path: [...target.path, nextIdx], kind: 'string', value: '' };
                      return { ...target, children: [...(target.children || []), newChild] };
                    }),
                  );
                }}
              >
                <Plus size={14} aria-hidden="true" />
                Add item
              </button>
              <button
                type="button"
                className="btn btn-ghost btn-sm"
                aria-label={`Delete list ${node.key}`}
                onClick={() => mutateTree((prev) => updateNodeAtPath(prev, node.path, () => null))}
              >
                <Trash2 size={14} aria-hidden="true" />
              </button>
            </div>
          </div>

          {items.length === 0 ? (
            <div className="field-hint">No items in list.</div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.4rem', marginTop: '0.25rem' }}>
              {items.map((item, idx) =>
                item.kind === 'object' || item.kind === 'array' ? (
                  renderNode(item, depth + 1)
                ) : (
                  <div key={`${pathKey}.${idx}`} className="cfg-array-item">
                    <span className="mono" style={{ fontSize: '0.78rem', color: 'var(--text-muted)', minWidth: '24px' }}>
                      #{idx + 1}
                    </span>
                    <input
                      type={item.kind === 'number' ? 'number' : 'text'}
                      className="input"
                      style={{ minHeight: '34px', padding: '0.3rem 0.65rem' }}
                      aria-label={`${displayLabel} item ${idx + 1}`}
                      value={item.value === null || item.value === undefined ? '' : String(item.value)}
                      onChange={(e) => {
                        const rawVal = e.target.value;
                        const nextVal = item.kind === 'number' ? (rawVal === '' ? 0 : Number(rawVal)) : rawVal;
                        mutateTree((prev) =>
                          updateNodeAtPath(prev, item.path, (t) => ({ ...t, value: nextVal })),
                        );
                      }}
                    />
                    <button
                      type="button"
                      className="btn btn-ghost btn-sm"
                      aria-label={`Remove item ${idx + 1}`}
                      onClick={() => {
                        mutateTree((prev) =>
                          updateNodeAtPath(prev, node.path, (target) => ({
                            ...target,
                            children: (target.children || [])
                              .filter((_, i) => i !== idx)
                              .map((c, newIdx) => ({ ...c, key: String(newIdx), path: [...target.path, newIdx] })),
                          })),
                        );
                      }}
                    >
                      <Trash2 size={14} aria-hidden="true" />
                    </button>
                  </div>
                ),
              )}
            </div>
          )}
        </div>
      );
    }

    // Scalar Row (Boolean / Number / Enum / String / Null)
    const inputId = `cfg-${pathKey.replace(/[^a-zA-Z0-9_-]/g, '_')}`;
    const strVal = node.value === null || node.value === undefined ? '' : String(node.value);
    const isMultiline = node.kind === 'string' && (strVal.includes('\n') || strVal.length > 95);

    return (
      <div key={pathKey} className="cfg-row">
        <div className="cfg-key-col">
          <label htmlFor={inputId} className="cfg-key-title">
            <span>{displayLabel}</span>
            <span className="cfg-key-raw">{node.key}</span>
          </label>
          {description && <div className="cfg-comment">{description}</div>}
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.4rem' }}>
          {node.kind === 'boolean' ? (
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.65rem', minHeight: '38px' }}>
              <Switch
                id={inputId}
                checked={Boolean(node.value)}
                label={node.value ? 'Enabled (true)' : 'Disabled (false)'}
                onChange={(checked) =>
                  mutateTree((prev) => updateNodeAtPath(prev, node.path, (t) => ({ ...t, value: checked })))
                }
              />
            </div>
          ) : node.meta?.options ? (
            <select
              id={inputId}
              className="select"
              value={strVal}
              onChange={(e) =>
                mutateTree((prev) => updateNodeAtPath(prev, node.path, (t) => ({ ...t, value: e.target.value })))
              }
            >
              {!node.meta.options.includes(strVal) && strVal && <option value={strVal}>{strVal}</option>}
              {node.meta.options.map((opt) => (
                <option key={opt} value={opt}>
                  {opt}
                </option>
              ))}
            </select>
          ) : node.kind === 'number' ? (
            <input
              id={inputId}
              type="number"
              step="any"
              min={node.meta?.min}
              max={node.meta?.max}
              className="input mono"
              value={node.value === null || node.value === undefined ? '' : String(node.value)}
              onChange={(e) => {
                const n = e.target.value === '' ? 0 : Number(e.target.value);
                mutateTree((prev) =>
                  updateNodeAtPath(prev, node.path, (t) => ({ ...t, value: Number.isNaN(n) ? 0 : n })),
                );
              }}
            />
          ) : node.kind === 'null' ? (
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.55rem', minHeight: '38px' }}>
              <span className="badge badge-neutral mono">null</span>
              <button
                type="button"
                className="btn btn-sm"
                onClick={() =>
                  mutateTree((prev) =>
                    updateNodeAtPath(prev, node.path, (t) => ({ ...t, kind: 'string', value: '' })),
                  )
                }
              >
                Set value
              </button>
            </div>
          ) : isMultiline ? (
            <textarea
              id={inputId}
              className="textarea"
              value={strVal}
              onChange={(e) =>
                mutateTree((prev) => updateNodeAtPath(prev, node.path, (t) => ({ ...t, value: e.target.value })))
              }
            />
          ) : (
            <input
              id={inputId}
              type="text"
              className="input"
              value={strVal}
              onChange={(e) =>
                mutateTree((prev) => updateNodeAtPath(prev, node.path, (t) => ({ ...t, value: e.target.value })))
              }
            />
          )}

          {node.kind === 'string' && (node.key === 'motd' || hasMinecraftFormatting(strVal)) && (
            renderMinecraftFormattedPreview(strVal)
          )}
        </div>

        <button
          type="button"
          className="btn btn-ghost btn-sm"
          title={`Delete ${node.key}`}
          aria-label={`Delete ${node.key}`}
          onClick={() => mutateTree((prev) => updateNodeAtPath(prev, node.path, () => null))}
        >
          <Trash2 size={14} aria-hidden="true" />
        </button>
      </div>
    );
  };

  // Optional category grouping (ideal for server.properties!)
  const groupedCategories = useMemo(() => {
    if (!groupByCategory) return null;
    const order = ['General', 'Gameplay', 'World', 'Performance', 'Security', 'Network', 'Resource Pack', 'Other'];
    const map = new Map<string, ConfigTreeNode[]>();
    for (const node of tree) {
      const cat = node.meta?.category || 'Other';
      const arr = map.get(cat) || [];
      arr.push(node);
      map.set(cat, arr);
    }
    return order.filter((c) => map.has(c)).map((c) => ({ category: c, nodes: map.get(c)! }));
  }, [groupByCategory, tree]);

  if (loading) {
    return (
      <div className="config-editor-panel" style={{ padding: '2rem', textAlign: 'center', color: 'var(--text-secondary)' }}>
        Loading <span className="mono">{relativePath}</span>...
      </div>
    );
  }

  if (loadError || !doc) {
    return (
      <div className="config-editor-panel" style={{ padding: '1.5rem' }}>
        <div className="banner banner-danger">
          <AlertTriangle size={18} aria-hidden="true" />
          <div>
            <strong>Unable to open {relativePath}</strong>
            <div style={{ marginTop: '0.25rem', color: 'var(--text-secondary)' }}>{loadError || 'File not found'}</div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="config-editor-panel" ref={containerRef}>
      <div className="config-editor-toolbar">
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem', flexWrap: 'wrap', minWidth: 0 }}>
          <FileText size={18} style={{ color: 'var(--accent-bright)', flexShrink: 0 }} aria-hidden="true" />
          <span className="mono" style={{ fontWeight: 600, fontSize: '0.92rem', wordBreak: 'break-all' }}>
            {doc.relativePath}
          </span>
          <span className="badge badge-accent">{doc.format.toUpperCase()}</span>
          <span className="badge badge-neutral">{formatBytes(doc.sizeBytes)}</span>
          {dirty && <span className="badge badge-warn">Unsaved</span>}
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: '0.55rem', flexWrap: 'wrap' }}>
          <div className="mode-segmented" role="group" aria-label="Editor mode">
            <button
              type="button"
              className={mode === 'visual' ? 'active' : ''}
              disabled={!doc.supportsVisual}
              title={doc.supportsVisual ? 'Beautified Visual Editor' : 'Raw editing only for this file'}
              onClick={() => setMode('visual')}
            >
              <Sparkles size={14} aria-hidden="true" />
              Visual
            </button>
            <button
              type="button"
              className={mode === 'raw' ? 'active' : ''}
              onClick={() => setMode('raw')}
            >
              <Code2 size={14} aria-hidden="true" />
              Raw Code
            </button>
          </div>

          <button type="button" className="btn btn-sm" onClick={() => void loadFile()} title="Reload from disk">
            <RefreshCw size={14} aria-hidden="true" />
            Reload
          </button>

          <button
            type="button"
            className="btn btn-primary btn-sm"
            disabled={!dirty || saving}
            onClick={() => void handleSave()}
          >
            <Save size={14} aria-hidden="true" />
            {saving ? 'Saving...' : 'Save Changes'}
          </button>
        </div>
      </div>

      <div className="config-editor-body">
        {doc.parseError && (
          <div className="banner banner-warn">
            <AlertTriangle size={18} aria-hidden="true" style={{ flexShrink: 0 }} />
            <div>
              <strong>Switched to Raw Code Editor</strong> — Syntax issue prevented visual parsing:
              <div className="mono" style={{ fontSize: '0.82rem', marginTop: '0.2rem' }}>{doc.parseError}</div>
            </div>
          </div>
        )}

        {!doc.supportsVisual && !doc.parseError && (
          <div className="banner">
            <Code2 size={18} aria-hidden="true" style={{ flexShrink: 0, color: 'var(--accent-bright)' }} />
            <div>
              Opened <code>{doc.fileName}</code> in Raw Code Editor.
            </div>
          </div>
        )}

        {mode === 'visual' && doc.supportsVisual ? (
          <>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '0.65rem', flexWrap: 'wrap' }}>
              <search style={{ flex: '1 1 240px', maxWidth: '420px', position: 'relative' }}>
                <label htmlFor={`cfg-search-${relativePath}`} className="visually-hidden">
                  Filter settings in {doc.fileName}
                </label>
                <Search
                  size={15}
                  aria-hidden="true"
                  style={{
                    position: 'absolute',
                    insetInlineStart: '0.7rem',
                    top: '50%',
                    transform: 'translateY(-50%)',
                    color: 'var(--text-muted)',
                    pointerEvents: 'none',
                  }}
                />
                <input
                  id={`cfg-search-${relativePath}`}
                  type="search"
                  className="input"
                  style={{ paddingInlineStart: '2.1rem', minHeight: '36px' }}
                  placeholder="Filter keys, descriptions, or values..."
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                />
              </search>

              <div style={{ display: 'flex', gap: '0.45rem', flexWrap: 'wrap', alignItems: 'center' }}>
                <button type="button" className="btn btn-sm" onClick={() => toggleAllDetails(true)}>
                  <ChevronsUpDown size={14} aria-hidden="true" />
                  Expand All
                </button>
                <button type="button" className="btn btn-sm" onClick={() => toggleAllDetails(false)}>
                  <ChevronsDownUp size={14} aria-hidden="true" />
                  Collapse All
                </button>
              </div>
            </div>

            {tree.length === 0 ? (
              <div className="empty-state" style={{ padding: '1.6rem' }}>
                <p style={{ margin: 0, color: 'var(--text-secondary)' }}>This configuration file is currently empty.</p>
                <AddPropertyInline
                  onAdd={(newKey, kind) =>
                    mutateTree((prev) => [...prev, defaultNodeForKind(newKey, [], kind)])
                  }
                />
              </div>
            ) : groupedCategories ? (
              groupedCategories.map(({ category, nodes }) => {
                const visible = search.trim() ? nodes.filter((n) => nodeMatchesSearch(n, search.trim())) : nodes;
                if (visible.length === 0) return null;
                return (
                  <details key={`${category}-${expandVersion.seq}`} className="cfg-section" open>
                    <summary>
                      <span>{category}</span>
                      <span className="badge badge-neutral" style={{ marginInlineStart: 'auto' }}>
                        {visible.length}
                      </span>
                    </summary>
                    <div className="cfg-section-body">{visible.map((node) => renderNode(node, 1))}</div>
                  </details>
                );
              })
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.55rem' }}>
                {tree.map((node) => renderNode(node, 0))}
              </div>
            )}

            <div style={{ paddingTop: '0.35rem', borderTop: '1px solid var(--border-subtle)', display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '0.5rem' }}>
              <AddPropertyInline
                onAdd={(newKey, kind) =>
                  mutateTree((prev) => [...prev, defaultNodeForKind(newKey, [], kind)])
                }
              />
              {doc.format === 'yaml' && (
                <span className="field-hint">YAML comments are preserved on save.</span>
              )}
            </div>
          </>
        ) : (
          <RawCodeEditor
            value={rawText}
            format={doc.format}
            onChange={(next) => {
              setRawText(next);
              setDirty(true);
            }}
            onSave={() => void handleSave()}
          />
        )}
      </div>
    </div>
  );
}
