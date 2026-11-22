import { useEffect, useMemo, useRef, useState } from 'react';
import { Download, FileSearch, Play, RotateCw, Search, Send, Square, Terminal, Trash2 } from 'lucide-react';
import { api } from '../api/client';
import { LogFileSearch } from '../components/LogFileSearch';
import { StatusBadge } from '../components/StatusBadge';
import { Switch } from '../components/Switch';
import { renderAnsi, stripAnsi } from '../utils/ansi';
import type { ConsoleLine, ServerRuntimeState, ServerSummary } from '../../../shared/types';

interface ConsolePageProps {
  server: ServerSummary;
  lines: ConsoleLine[];
  onClearLocal: () => void;
  onSendCommandWs: (command: string) => void;
  onRuntimeUpdate?: (serverId: string, runtime: ServerRuntimeState) => void;
  onNotify: (tone: 'info' | 'success' | 'warn' | 'error', text: string) => void;
}

const QUICK_COMMANDS = ['list', 'tps', 'save-all', 'time set day', 'weather clear', 'plugins', 'whitelist reload'];
const VELOCITY_QUICK_COMMANDS = ['velocity plugins', 'glist', 'velocity reload', 'end'];

export function ConsolePage({
  server,
  lines,
  onClearLocal,
  onSendCommandWs,
  onRuntimeUpdate,
  onNotify,
}: ConsolePageProps) {
  const [viewMode, setViewMode] = useState<'live' | 'logs'>('live');
  const [command, setCommand] = useState('');
  const [filter, setFilter] = useState('');
  const [filterRegex, setFilterRegex] = useState(false);
  const [filterCase, setFilterCase] = useState(false);
  const [autoScroll, setAutoScroll] = useState(true);
  const [history, setHistory] = useState<string[]>([]);
  const [historyIdx, setHistoryIdx] = useState<number>(-1);
  const outputRef = useRef<HTMLDivElement>(null);
  const formRef = useRef<HTMLFormElement>(null);

  const isRunning =
    server.runtime.status === 'online' ||
    server.runtime.status === 'starting' ||
    server.runtime.status === 'stopping';

  const { filterMatcher, filterError } = useMemo(() => {
    if (!filter.trim()) {
      return { filterMatcher: null as RegExp | null, filterError: null as string | null };
    }
    const pattern = filterRegex ? filter : filter.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const flags = filterCase ? '' : 'i';
    try {
      return { filterMatcher: new RegExp(pattern, flags), filterError: null };
    } catch (err) {
      return {
        filterMatcher: null,
        filterError: err instanceof Error ? err.message : 'Invalid regular expression',
      };
    }
  }, [filter, filterRegex, filterCase]);

  const visibleLines = useMemo(() => {
    if (!filterMatcher) return lines;
    return lines.filter((l) => filterMatcher.test(stripAnsi(l.text)));
  }, [lines, filterMatcher]);

  useEffect(() => {
    if (autoScroll && outputRef.current) {
      outputRef.current.scrollTop = outputRef.current.scrollHeight;
    }
  }, [visibleLines, autoScroll]);

  const submitCommand = async (rawCmd: string) => {
    const cmd = rawCmd.trim();
    if (!cmd) return;
    if (!isRunning) {
      onNotify('warn', 'Start the server before sending console commands.');
      return;
    }
    setHistory((prev) => [cmd, ...prev.filter((c) => c !== cmd)].slice(0, 50));
    setHistoryIdx(-1);
    setCommand('');
    try {
      onSendCommandWs(cmd);
    } catch {
      await api.sendCommand(server.id, cmd);
    }
  };

  const handleFormSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    void submitCommand(command);
  };

  /**
   * IME-safe Enter handling per modern-web-guidance (ime-safe-enter-submit):
   * Checks both event.isComposing and keyCode === 229 (Safari WebKit 165004 fallback)
   * before acting on Enter, plus handles Up/Down command history navigation.
   */
  const handleInputKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      if (e.nativeEvent.isComposing || e.keyCode === 229) {
        return;
      }
      formRef.current?.requestSubmit();
      return;
    }
    if (e.key === 'ArrowUp' && history.length > 0) {
      e.preventDefault();
      const nextIdx = Math.min(history.length - 1, historyIdx + 1);
      setHistoryIdx(nextIdx);
      setCommand(history[nextIdx]);
    } else if (e.key === 'ArrowDown') {
      e.preventDefault();
      if (historyIdx <= 0) {
        setHistoryIdx(-1);
        setCommand('');
      } else {
        const nextIdx = historyIdx - 1;
        setHistoryIdx(nextIdx);
        setCommand(history[nextIdx]);
      }
    }
  };

  const downloadLog = () => {
    const text = lines
      .map((l) => `[${new Date(l.ts).toLocaleTimeString()}] ${stripAnsi(l.text)}`)
      .join('\n');
    const blob = new Blob([text], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${server.name.replace(/\s+/g, '_')}-console.log`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const runPower = async (action: 'start' | 'stop' | 'restart') => {
    try {
      const res = await api.powerServer(server.id, action);
      if (res.runtime) onRuntimeUpdate?.(server.id, res.runtime);
    } catch (err) {
      onNotify('error', err instanceof Error ? err.message : 'Action failed');
    }
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.85rem' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '0.75rem', flexWrap: 'wrap' }}>
        <div className="mode-segmented" role="group" aria-label="Console view mode">
          <button
            type="button"
            className={viewMode === 'live' ? 'active' : ''}
            aria-pressed={viewMode === 'live'}
            onClick={() => setViewMode('live')}
          >
            <Terminal size={14} aria-hidden="true" />
            Live console
          </button>
          <button
            type="button"
            className={viewMode === 'logs' ? 'active' : ''}
            aria-pressed={viewMode === 'logs'}
            onClick={() => setViewMode('logs')}
          >
            <FileSearch size={14} aria-hidden="true" />
            Log files
          </button>
        </div>
      </div>

      {viewMode === 'logs' ? (
        <LogFileSearch server={server} onNotify={onNotify} />
      ) : (
        <div className="console-shell">
          <div className="console-toolbar">
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem', flexWrap: 'wrap' }}>
              <StatusBadge status={server.runtime.status} />
              {!isRunning ? (
                <button type="button" className="btn btn-success btn-sm" onClick={() => void runPower('start')}>
                  <Play size={14} aria-hidden="true" />
                  Start
                </button>
              ) : (
                <>
                  <button type="button" className="btn btn-secondary btn-sm" onClick={() => void runPower('restart')}>
                    <RotateCw size={14} aria-hidden="true" />
                    Restart
                  </button>
                  <button type="button" className="btn btn-danger btn-sm" onClick={() => void runPower('stop')}>
                    <Square size={14} aria-hidden="true" />
                    Stop
                  </button>
                </>
              )}
            </div>

            <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem', flexWrap: 'wrap' }}>
              <search style={{ display: 'flex', alignItems: 'center', gap: '0.35rem', flexWrap: 'wrap' }}>
                <div style={{ position: 'relative', width: '210px' }}>
                  <label htmlFor="console-filter" className="visually-hidden">
                    Filter console output
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
                    id="console-filter"
                    name="filter"
                    type="search"
                    className="input"
                    style={{ paddingInlineStart: '2rem', minHeight: '32px', fontSize: '0.84rem' }}
                    placeholder={filterRegex ? 'Filter regex...' : 'Filter logs...'}
                    value={filter}
                    aria-invalid={filterError ? true : undefined}
                    aria-describedby={filterError ? 'console-filter-error' : undefined}
                    autoCorrect="off"
                    autoCapitalize="none"
                    spellCheck={false}
                    onChange={(e) => setFilter(e.target.value)}
                  />
                </div>
                <button
                  type="button"
                  className={`btn btn-ghost btn-sm mono ${filterRegex ? 'active' : ''}`}
                  style={{ minInlineSize: '32px', paddingInline: '0.45rem' }}
                  aria-pressed={filterRegex}
                  aria-label="Regular expression"
                  title="Use regular expression (RegExp)"
                  onClick={() => setFilterRegex((v) => !v)}
                >
                  .*
                </button>
                <button
                  type="button"
                  className={`btn btn-ghost btn-sm mono ${filterCase ? 'active' : ''}`}
                  style={{ minInlineSize: '32px', paddingInline: '0.45rem' }}
                  aria-pressed={filterCase}
                  aria-label="Case sensitive"
                  title="Match case"
                  onClick={() => setFilterCase((v) => !v)}
                >
                  Aa
                </button>
                {filterError ? (
                  <span
                    id="console-filter-error"
                    role="alert"
                    style={{ color: 'var(--status-danger)', fontSize: '0.78rem', whiteSpace: 'nowrap' }}
                    title={filterError}
                  >
                    Invalid regex
                  </span>
                ) : filterMatcher ? (
                  <span className="field-hint mono" style={{ fontSize: '0.78rem', whiteSpace: 'nowrap' }}>
                    {visibleLines.length} / {lines.length}
                  </span>
                ) : null}
              </search>

              <Switch checked={autoScroll} onChange={setAutoScroll} label="Auto-scroll" />

              <button type="button" className="btn btn-ghost btn-sm" onClick={downloadLog} title="Download console buffer" aria-label="Download console buffer">
                <Download size={14} aria-hidden="true" />
              </button>
              <button type="button" className="btn btn-ghost btn-sm" onClick={onClearLocal} title="Clear console view" aria-label="Clear console view">
                <Trash2 size={14} aria-hidden="true" />
              </button>
            </div>
          </div>

          <div ref={outputRef} className="console-output scroller" role="log" aria-live="off" aria-label="Server console output">
            {visibleLines.length === 0 ? (
              <div style={{ color: 'var(--text-muted)', padding: '1rem 0' }}>
                {lines.length === 0
                  ? isRunning
                    ? 'Server is starting — waiting for console output...'
                    : 'Console is idle. Start the server to stream real-time Minecraft logs here.'
                  : 'No lines match your filter.'}
              </div>
            ) : (
              visibleLines.map((line) => (
                <div key={line.id} className={`console-line level-${line.level}`}>
                  <span className="console-ts">{new Date(line.ts).toLocaleTimeString()}</span>
                  <span>{renderAnsi(line.text, filterMatcher)}</span>
                </div>
              ))
            )}
          </div>

          <div className="console-quick-chips" aria-label="Quick commands">
            {(server.software === 'velocity' ? VELOCITY_QUICK_COMMANDS : QUICK_COMMANDS).map((cmd) => (
              <button
                key={cmd}
                type="button"
                className="chip-btn"
                disabled={!isRunning}
                onClick={() => void submitCommand(cmd)}
              >
                /{cmd}
              </button>
            ))}
          </div>

          <form ref={formRef} className="console-input-bar" onSubmit={handleFormSubmit}>
            <label htmlFor="console-cmd-input" className="visually-hidden">
              Send Minecraft server command
            </label>
            <span className="console-prompt-prefix" aria-hidden="true">
              &gt;
            </span>
            <input
              id="console-cmd-input"
              name="command"
              type="text"
              className="input mono"
              style={{ minHeight: '38px' }}
              placeholder={isRunning ? 'Type a command (e.g. op Steve, gamemode creative Steve, tps)...' : 'Server is offline'}
              value={command}
              disabled={!isRunning}
              autoCorrect="off"
              autoCapitalize="none"
              spellCheck={false}
              enterKeyHint="send"
              onChange={(e) => setCommand(e.target.value)}
              onKeyDown={handleInputKeyDown}
            />
            <button type="submit" className="btn btn-primary" disabled={!isRunning || !command.trim()}>
              <Send size={15} aria-hidden="true" />
              Send
            </button>
          </form>
        </div>
      )}
    </div>
  );
}
