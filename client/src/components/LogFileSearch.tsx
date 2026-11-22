import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AlertTriangle, FileText, RefreshCw, Search } from 'lucide-react';
import { api, formatBytes } from '../api/client';
import { highlightMatches } from '../utils/highlight';
import type { LogFileInfo, LogSearchMatch, LogSearchResponse, ServerSummary } from '../../../shared/types';

interface LogFileSearchProps {
  server: ServerSummary;
  onNotify: (tone: 'info' | 'success' | 'warn' | 'error', text: string) => void;
}

export function LogFileSearch({ server, onNotify }: LogFileSearchProps) {
  const [files, setFiles] = useState<LogFileInfo[]>([]);
  const [loadingFiles, setLoadingFiles] = useState(true);
  const [selectedFile, setSelectedFile] = useState('');
  const [query, setQuery] = useState('');
  const [useRegex, setUseRegex] = useState(false);
  const [caseSensitive, setCaseSensitive] = useState(false);
  const [searching, setSearching] = useState(false);
  const [result, setResult] = useState<LogSearchResponse | null>(null);
  const [appliedMatcher, setAppliedMatcher] = useState<RegExp | null>(null);
  const [searchError, setSearchError] = useState<string | null>(null);
  const queryInputRef = useRef<HTMLInputElement>(null);

  const loadFiles = useCallback(async () => {
    setLoadingFiles(true);
    try {
      const res = await api.listLogFiles(server.id);
      setFiles(res.files);
      setSelectedFile((prev) => (prev && res.files.some((f) => f.name === prev) ? prev : ''));
    } catch (err) {
      onNotify('error', err instanceof Error ? err.message : 'Failed to list log files');
    } finally {
      setLoadingFiles(false);
    }
  }, [server.id, onNotify]);

  useEffect(() => {
    setResult(null);
    setAppliedMatcher(null);
    setSearchError(null);
    setSelectedFile('');
    void loadFiles();
  }, [loadFiles]);

  const handleSearch = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!query.trim()) {
      setSearchError('Enter a search string or regular expression.');
      queryInputRef.current?.focus();
      return;
    }

    setSearching(true);
    setSearchError(null);
    try {
      const res = await api.searchLogs(server.id, {
        query,
        regex: useRegex,
        caseSensitive,
        files: selectedFile ? [selectedFile] : undefined,
      });
      const pattern = useRegex ? query : query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      setAppliedMatcher(new RegExp(pattern, caseSensitive ? '' : 'i'));
      setResult(res);
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Log search failed';
      setSearchError(msg);
      onNotify('error', msg);
      queryInputRef.current?.focus();
    } finally {
      setSearching(false);
    }
  };

  const groupedMatches = useMemo(() => {
    if (!result) return [];
    const groups: Array<{ file: string; items: LogSearchMatch[] }> = [];
    const byFile = new Map<string, LogSearchMatch[]>();
    for (const match of result.matches) {
      let list = byFile.get(match.file);
      if (!list) {
        list = [];
        byFile.set(match.file, list);
        groups.push({ file: match.file, items: list });
      }
      list.push(match);
    }
    return groups;
  }, [result]);

  return (
    <div className="console-shell">
      <div className="console-toolbar" style={{ alignItems: 'flex-start' }}>
        <search style={{ flex: '1 1 auto' }}>
          <form
            aria-label="Search server log files"
            onSubmit={(e) => void handleSearch(e)}
            style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', flexWrap: 'wrap' }}
          >
            <div style={{ position: 'relative', flex: '1 1 240px', minWidth: '200px' }}>
              <label htmlFor="log-search-query" className="visually-hidden">
                Search log files
              </label>
              <Search
                size={14}
                aria-hidden="true"
                style={{
                  position: 'absolute',
                  insetInlineStart: '0.65rem',
                  top: '50%',
                  transform: 'translateY(-50%)',
                  color: 'var(--text-muted)',
                  pointerEvents: 'none',
                }}
              />
              <input
                ref={queryInputRef}
                id="log-search-query"
                name="query"
                type="search"
                className="input"
                style={{ paddingInlineStart: '2rem', minHeight: '32px', fontSize: '0.86rem' }}
                placeholder={useRegex ? 'Regex pattern (e.g. \\[WARN\\]|Exception)...' : 'Search log text...'}
                value={query}
                aria-invalid={searchError ? true : undefined}
                aria-describedby={searchError ? 'log-search-error' : undefined}
                autoCorrect="off"
                autoCapitalize="none"
                spellCheck={false}
                enterKeyHint="search"
                onChange={(e) => {
                  setQuery(e.target.value);
                  if (searchError) setSearchError(null);
                }}
              />
            </div>

            <div style={{ display: 'inline-flex', alignItems: 'center', gap: '0.25rem' }}>
              <button
                type="button"
                className={`btn btn-ghost btn-sm mono ${useRegex ? 'active' : ''}`}
                style={{ minInlineSize: '32px', paddingInline: '0.45rem' }}
                aria-pressed={useRegex}
                aria-label="Regular expression"
                title="Use regular expression (RegExp)"
                onClick={() => setUseRegex((v) => !v)}
              >
                .*
              </button>
              <button
                type="button"
                className={`btn btn-ghost btn-sm mono ${caseSensitive ? 'active' : ''}`}
                style={{ minInlineSize: '32px', paddingInline: '0.45rem' }}
                aria-pressed={caseSensitive}
                aria-label="Case sensitive"
                title="Match case"
                onClick={() => setCaseSensitive((v) => !v)}
              >
                Aa
              </button>
            </div>

            <div style={{ display: 'inline-flex', alignItems: 'center', gap: '0.35rem' }}>
              <label htmlFor="log-search-file" className="visually-hidden">
                Log file scope
              </label>
              <select
                id="log-search-file"
                name="file"
                className="select mono"
                style={{ width: 'auto', minWidth: '210px', maxWidth: '340px', minHeight: '32px', padding: '0.22rem 0.55rem', fontSize: '0.82rem' }}
                value={selectedFile}
                disabled={loadingFiles || files.length === 0}
                onChange={(e) => setSelectedFile(e.target.value)}
              >
                <option value="">All log files ({files.length})</option>
                {files.map((f) => (
                  <option key={f.name} value={f.name}>
                    {f.name} ({formatBytes(f.sizeBytes)}, {new Date(f.modifiedAt).toLocaleDateString()})
                  </option>
                ))}
              </select>

              <button
                type="button"
                className="btn btn-ghost btn-sm"
                disabled={loadingFiles}
                aria-label="Refresh log file list"
                title="Refresh log file list"
                onClick={() => void loadFiles()}
              >
                <RefreshCw size={14} className={loadingFiles ? 'spin' : ''} aria-hidden="true" />
              </button>
            </div>

            <button
              type="submit"
              className="btn btn-primary btn-sm"
              disabled={searching || (!loadingFiles && files.length === 0)}
            >
              <Search size={14} aria-hidden="true" />
              {searching ? 'Searching...' : 'Search'}
            </button>
          </form>

          {searchError && (
            <div
              id="log-search-error"
              role="alert"
              style={{ marginTop: '0.4rem', color: 'var(--status-danger)', fontSize: '0.82rem' }}
            >
              {searchError}
            </div>
          )}
        </search>
      </div>

      {result && (
        <div
          aria-live="polite"
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: '0.6rem',
            flexWrap: 'wrap',
            padding: '0.45rem 0.9rem',
            background: 'var(--bg-surface-subtle)',
            borderBottom: '1px solid var(--border-subtle)',
            fontSize: '0.82rem',
            color: 'var(--text-secondary)',
          }}
        >
          <span>
            <strong style={{ color: 'var(--text-primary)' }}>{result.totalMatches}</strong>{' '}
            {result.totalMatches === 1 ? 'match' : 'matches'} in{' '}
            <strong style={{ color: 'var(--text-primary)' }}>{result.filesSearched}</strong>{' '}
            {result.filesSearched === 1 ? 'file' : 'files'}
          </span>
          {result.truncated && (
            <span className="badge badge-warn">
              <AlertTriangle size={12} aria-hidden="true" />
              Truncated — showing first {result.matches.length} matches
            </span>
          )}
        </div>
      )}

      <div className="console-output scroller" role="region" aria-label="Log search results">
        {loadingFiles && files.length === 0 ? (
          <div style={{ color: 'var(--text-muted)', padding: '1rem 0' }}>Loading log files...</div>
        ) : files.length === 0 ? (
          <div style={{ color: 'var(--text-muted)', padding: '1rem 0' }}>
            No log files found in <code>logs/</code> yet. Start the server to generate <code>latest.log</code>.
          </div>
        ) : searching ? (
          <div style={{ color: 'var(--text-muted)', padding: '1rem 0' }}>Searching log files...</div>
        ) : !result ? (
          <div style={{ color: 'var(--text-muted)', padding: '1rem 0' }}>
            Enter a string or regular expression above and click Search to scan <code>latest.log</code> and archived{' '}
            <code>.log.gz</code> files.
          </div>
        ) : result.matches.length === 0 ? (
          <div style={{ color: 'var(--text-muted)', padding: '1rem 0' }}>
            No lines matched your search across {result.filesSearched}{' '}
            {result.filesSearched === 1 ? 'file' : 'files'}.
          </div>
        ) : (
          groupedMatches.map((group) => (
            <div key={group.file} className="log-file-group">
              <div className="log-file-group-header">
                <span style={{ display: 'inline-flex', alignItems: 'center', gap: '0.4rem' }}>
                  <FileText size={13} aria-hidden="true" />
                  {group.file}
                </span>
                <span className="field-hint mono" style={{ fontSize: '0.75rem' }}>
                  {group.items.length} {group.items.length === 1 ? 'match' : 'matches'}
                </span>
              </div>
              {group.items.map((m) => (
                <div key={`${m.file}:${m.lineNumber}`} className="console-line level-info">
                  <span className="console-ts">L{m.lineNumber}</span>
                  <span>{highlightMatches(m.text, appliedMatcher)}</span>
                </div>
              ))}
            </div>
          ))
        )}
      </div>
    </div>
  );
}
