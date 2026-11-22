import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Archive,
  CalendarClock,
  Coffee,
  FolderInput,
  FolderOpen,
  Gamepad2,
  Info,
  Layers,
  LayoutDashboard,
  LogOut,
  Menu,
  Network,
  Plus,
  Puzzle,
  Server,
  Settings,
  Shield,
  Sliders,
  Smartphone,
  Terminal,
  Users,
  X,
} from 'lucide-react';
import { api } from './api/client';
import { ToastRegion, type ToastMessage } from './components/ToastRegion';
import { StatusBadge } from './components/StatusBadge';
import { CreateServerModal } from './components/CreateServerModal';
import { ImportServerModal } from './components/ImportServerModal';
import { LoginView } from './components/LoginView';
import { DashboardPage } from './pages/DashboardPage';
import { ServerOverviewPage } from './pages/ServerOverviewPage';
import { ConsolePage } from './pages/ConsolePage';
import { ConfigsPage } from './pages/ConfigsPage';
import { GameControlPage } from './pages/GameControlPage';
import { RealmsPage } from './pages/RealmsPage';
import { VelocityProxyPage } from './pages/VelocityProxyPage';
import { GeyserPage } from './pages/GeyserPage';
import { PluginsModsPage } from './pages/PluginsModsPage';
import { PlayersPage } from './pages/PlayersPage';
import { FilesPage } from './pages/FilesPage';
import { WorldsBackupsPage } from './pages/WorldsBackupsPage';
import { SchedulesPage } from './pages/SchedulesPage';
import { ServerSettingsPage } from './pages/ServerSettingsPage';
import { JavaRuntimesPage } from './pages/JavaRuntimesPage';
import { AccessControlPage } from './pages/AccessControlPage';
import { AboutPage } from './pages/AboutPage';
import type {
  AuthSessionInfo,
  ConsoleLine,
  JavaDownloadStatus,
  ServerRuntimeState,
  ServerSummary,
  WsServerMessage,
} from '../../shared/types';

type TopRoute = 'dashboard' | 'server' | 'java' | 'access' | 'about';
type ServerTab =
  | 'overview'
  | 'console'
  | 'configs'
  | 'velocity'
  | 'game'
  | 'realms'
  | 'plugins'
  | 'geyser'
  | 'players'
  | 'files'
  | 'backups'
  | 'schedules'
  | 'settings';

export function App() {
  const [session, setSession] = useState<AuthSessionInfo | null>(null);
  const [servers, setServers] = useState<ServerSummary[]>([]);
  const [route, setRoute] = useState<TopRoute>('dashboard');
  const [selectedServerId, setSelectedServerId] = useState<string | null>(null);
  const [serverTab, setServerTab] = useState<ServerTab>('overview');
  const [deepConfigPath, setDeepConfigPath] = useState<string | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [toasts, setToasts] = useState<ToastMessage[]>([]);
  const [consoleLines, setConsoleLines] = useState<ConsoleLine[]>([]);
  const [javaDownloads, setJavaDownloads] = useState<Record<number, JavaDownloadStatus>>({});
  const [wsReady, setWsReady] = useState(false);

  const wsRef = useRef<WebSocket | null>(null);
  const selectedServerIdRef = useRef<string | null>(null);
  selectedServerIdRef.current = selectedServerId;

  const notify = useCallback((tone: ToastMessage['tone'], text: string) => {
    const id = `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    setToasts((prev) => [...prev.slice(-3), { id, tone, text }]);
  }, []);

  const dismissToast = useCallback((id: string) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  const refreshSession = useCallback(async () => {
    try {
      const s = await api.getSession();
      setSession(s);
    } catch {
      setSession({ authenticated: false, requireAuth: true, user: null });
    }
  }, []);

  const refreshServers = useCallback(async () => {
    try {
      const list = await api.listServers();
      setServers(list);
      if (selectedServerIdRef.current && !list.some((s) => s.id === selectedServerIdRef.current)) {
        setSelectedServerId(list[0]?.id ?? null);
      }
    } catch {
      // handled by auth guard if 401
    }
  }, []);

  useEffect(() => {
    void refreshSession();
  }, [refreshSession]);

  useEffect(() => {
    if (session?.authenticated) {
      void refreshServers();
    }
  }, [session?.authenticated, refreshServers]);

  // Real-time WebSocket connection for live server state, console logs, and Java download progress
  useEffect(() => {
    if (!session?.authenticated) return;

    let disposed = false;
    let reconnectTimer: number | null = null;
    let activeWs: WebSocket | null = null;

    const connect = () => {
      if (disposed) return;
      const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
      const ws = new WebSocket(`${proto}//${window.location.host}/ws`);
      activeWs = ws;
      wsRef.current = ws;

      ws.onopen = () => {
        if (disposed || wsRef.current !== ws) {
          ws.close();
          return;
        }
        setWsReady(true);
        void refreshServers();
        if (selectedServerIdRef.current) {
          ws.send(JSON.stringify({ type: 'console:subscribe', serverId: selectedServerIdRef.current }));
        }
      };

      ws.onmessage = (event) => {
        if (disposed || wsRef.current !== ws) return;
        try {
          const msg = JSON.parse(event.data) as WsServerMessage;
          if (msg.type === 'servers:all') {
            setServers((prev) =>
              prev.map((s) => (msg.states[s.id] ? { ...s, runtime: msg.states[s.id] } : s)),
            );
          } else if (msg.type === 'server:state') {
            setServers((prev) =>
              prev.map((s) => (s.id === msg.serverId ? { ...s, runtime: msg.runtime } : s)),
            );
            // If installation just completed, reload metadata (jarFile, build)
            if (msg.runtime.installProgress === null && msg.runtime.status === 'offline') {
              void refreshServers();
            }
          } else if (msg.type === 'console:history') {
            if (msg.serverId === selectedServerIdRef.current) {
              setConsoleLines(msg.lines);
            }
          } else if (msg.type === 'console:line') {
            if (msg.serverId === selectedServerIdRef.current) {
              setConsoleLines((prev) =>
                prev.some((l) => l.id === msg.line.id) ? prev : [...prev.slice(-1499), msg.line],
              );
            }
          } else if (msg.type === 'java:download') {
            setJavaDownloads((prev) => ({ ...prev, [msg.status.major]: msg.status }));
          }
        } catch {
          // ignore malformed messages
        }
      };

      ws.onclose = () => {
        // Only clear wsRef if this closing socket is still the active socket (prevents StrictMode race)
        if (wsRef.current === ws) {
          wsRef.current = null;
          setWsReady(false);
        }
        if (!disposed) {
          reconnectTimer = window.setTimeout(connect, 2000);
        }
      };
    };

    connect();
    return () => {
      disposed = true;
      if (reconnectTimer) window.clearTimeout(reconnectTimer);
      if (activeWs) {
        if (wsRef.current === activeWs) {
          wsRef.current = null;
          setWsReady(false);
        }
        activeWs.close();
      }
    };
  }, [session?.authenticated, refreshServers]);

  // Subscribe WebSocket to the currently selected server's console stream
  useEffect(() => {
    setConsoleLines([]);
    const ws = wsRef.current;
    if (ws && ws.readyState === WebSocket.OPEN) {
      if (selectedServerId) {
        ws.send(JSON.stringify({ type: 'console:subscribe', serverId: selectedServerId }));
      } else {
        ws.send(JSON.stringify({ type: 'console:unsubscribe' }));
      }
    } else if (selectedServerId && session?.authenticated) {
      api.getConsole(selectedServerId).then((r) => setConsoleLines(r.lines)).catch(() => {});
    }
  }, [selectedServerId, session?.authenticated, wsReady]);

  // Fallback HTTP poll for server runtime states whenever WebSocket is disconnected/reconnecting
  useEffect(() => {
    if (!session?.authenticated || wsReady) return;
    const timer = window.setInterval(() => {
      if (!document.hidden) {
        void refreshServers();
      }
    }, 2500);
    return () => window.clearInterval(timer);
  }, [session?.authenticated, wsReady, refreshServers]);

  // Re-sync console buffer whenever switching onto the Live Console tab + fallback HTTP poll if WS drops
  useEffect(() => {
    if (route !== 'server' || serverTab !== 'console' || !selectedServerId || !session?.authenticated) return;
    const ws = wsRef.current;
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ type: 'console:subscribe', serverId: selectedServerId }));
      return;
    }

    let cancelled = false;
    const pollConsole = () => {
      if (cancelled || document.hidden) return;
      api
        .getConsole(selectedServerId)
        .then((r) => {
          if (!cancelled) setConsoleLines(r.lines);
        })
        .catch(() => {});
    };
    pollConsole();
    const timer = window.setInterval(pollConsole, 1200);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [route, serverTab, selectedServerId, session?.authenticated, wsReady]);

  const activeServer = useMemo(
    () => servers.find((s) => s.id === selectedServerId) || null,
    [servers, selectedServerId],
  );

  const isVelocity = activeServer?.software === 'velocity';
  const supportsLiveBridge = activeServer !== null && activeServer.software !== 'vanilla';
  const supportsRealms =
    activeServer !== null && ['paper', 'purpur', 'leaf', 'spigot', 'folia', 'custom'].includes(activeServer.software);

  const serverNavItems = useMemo<Array<{ id: ServerTab; label: string; icon: typeof Server }>>(() => {
    const isModLoader =
      activeServer !== null && ['fabric', 'forge', 'neoforge'].includes(activeServer.software);
    return [
      { id: 'overview', label: isVelocity ? 'Proxy Overview' : 'Server Overview', icon: Server },
      { id: 'console', label: 'Live Console', icon: Terminal },
      ...(isVelocity ? [{ id: 'velocity' as ServerTab, label: 'Proxy & Network', icon: Network }] : []),
      { id: 'configs', label: 'Options & Configs', icon: Sliders },
      ...(!isVelocity && supportsLiveBridge
        ? [{ id: 'game' as ServerTab, label: 'Live Game Controls', icon: Gamepad2 }]
        : []),
      ...(supportsRealms ? [{ id: 'realms' as ServerTab, label: 'Realms & Worlds', icon: Layers }] : []),
      { id: 'plugins', label: isModLoader ? 'Mods & Configs' : 'Plugins & Configs', icon: Puzzle },
      { id: 'geyser', label: 'Bedrock (Geyser)', icon: Smartphone },
      ...(!isVelocity ? [{ id: 'players' as ServerTab, label: 'Players', icon: Users }] : []),
      { id: 'files', label: 'File Manager', icon: FolderOpen },
      { id: 'backups', label: isVelocity ? 'Backups' : 'Worlds & Backups', icon: Archive },
      { id: 'schedules', label: 'Task Scheduler', icon: CalendarClock },
      { id: 'settings', label: isVelocity ? 'Proxy Settings' : 'Server Settings', icon: Settings },
    ];
  }, [activeServer, isVelocity, supportsLiveBridge, supportsRealms]);

  // Reset tab to overview when switching to a server that doesn't support the current tab
  useEffect(() => {
    if (!activeServer) return;
    if (!serverNavItems.some((i) => i.id === serverTab)) {
      setServerTab('overview');
    }
  }, [activeServer, serverNavItems, serverTab]);

  const updateServerRuntime = useCallback((serverId: string, runtime: ServerRuntimeState) => {
    setServers((prev) => prev.map((s) => (s.id === serverId ? { ...s, runtime } : s)));
  }, []);

  const selectServer = (id: string, tab: string = 'overview') => {
    setSelectedServerId(id);
    setRoute('server');
    setServerTab(tab as ServerTab);
    setDeepConfigPath(null);
    setMobileMenuOpen(false);
  };

  const sendCommandWs = (command: string) => {
    if (!selectedServerId) return;
    const ws = wsRef.current;
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ type: 'console:command', serverId: selectedServerId, command }));
    } else {
      void api.sendCommand(selectedServerId, command);
    }
  };

  if (!session) {
    return (
      <div className="login-screen">
        <div style={{ color: 'var(--text-secondary)' }}>Loading MCServerManager...</div>
      </div>
    );
  }

  if (!session.authenticated) {
    return <LoginView onSuccess={(s) => setSession(s)} />;
  }

  const pageHeading =
    route === 'dashboard'
      ? 'Servers Dashboard'
      : route === 'java'
        ? 'Java Runtimes'
        : route === 'access'
          ? 'Users & Access Control'
          : route === 'about'
            ? 'About MCServerManager'
            : activeServer
              ? `${activeServer.name} — ${serverNavItems.find((i) => i.id === serverTab)?.label || 'Overview'}`
              : 'Servers Dashboard';

  return (
    <div className="app-shell">
      {/* Sidebar Navigation */}
      <aside className={`sidebar scroller ${mobileMenuOpen ? 'mobile-open' : ''}`} aria-label="Primary sidebar">
        <div className="brand-header">
          <img src="/icon.svg" alt="" className="brand-icon" width={36} height={36} aria-hidden="true" />
          <div style={{ flex: 1, minWidth: 0 }}>
            <div className="brand-title">MCServerManager</div>
            <div className="brand-subtitle">Admin Panel</div>
          </div>
          {mobileMenuOpen && (
            <button
              type="button"
              className="btn btn-ghost btn-sm"
              aria-label="Close navigation menu"
              onClick={() => setMobileMenuOpen(false)}
            >
              <X size={16} aria-hidden="true" />
            </button>
          )}
        </div>

        {/* Quick Server Switcher */}
        <div className="server-switcher-box">
          <label htmlFor="sidebar-server-select" className="sidebar-section-label" style={{ padding: 0, display: 'block', marginBottom: '0.35rem' }}>
            Active Server
          </label>
          <div style={{ display: 'flex', gap: '0.4rem' }}>
            <select
              id="sidebar-server-select"
              className="select"
              style={{ minHeight: '36px', padding: '0.3rem 0.55rem', fontSize: '0.88rem' }}
              value={selectedServerId || ''}
              onChange={(e) => {
                if (e.target.value) selectServer(e.target.value, serverTab);
              }}
            >
              <option value="">-- Select a server --</option>
              {servers.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name} ({s.software} {s.mcVersion})
                </option>
              ))}
            </select>
            <button
              type="button"
              className="btn btn-primary btn-sm"
              title="Create new server"
              aria-label="Create new server"
              onClick={() => setCreateOpen(true)}
            >
              <Plus size={15} aria-hidden="true" />
            </button>
          </div>
        </div>

        {/* Server Navigation */}
        {activeServer && (
          <nav className="sidebar-section" aria-label="Selected server sections">
            <div className="sidebar-section-label">Server Control</div>
            <ul className="nav-list">
              {serverNavItems.map((item) => {
                const Icon = item.icon;
                const active = route === 'server' && serverTab === item.id;
                return (
                  <li key={item.id}>
                    <button
                      type="button"
                      className="nav-item"
                      aria-current={active ? 'page' : undefined}
                      onClick={() => {
                        setRoute('server');
                        setServerTab(item.id);
                        setDeepConfigPath(null);
                        setMobileMenuOpen(false);
                      }}
                    >
                      <Icon size={17} aria-hidden="true" />
                      <span>{item.label}</span>
                    </button>
                  </li>
                );
              })}
            </ul>
          </nav>
        )}

        {/* Global Panel Navigation */}
        <nav className="sidebar-section" aria-label="Panel navigation">
          <div className="sidebar-section-label">Panel &amp; System</div>
          <ul className="nav-list">
            <li>
              <button
                type="button"
                className="nav-item"
                aria-current={route === 'dashboard' ? 'page' : undefined}
                onClick={() => {
                  setRoute('dashboard');
                  void refreshServers();
                  setMobileMenuOpen(false);
                }}
              >
                <LayoutDashboard size={17} aria-hidden="true" />
                <span>All Servers ({servers.length})</span>
              </button>
            </li>
            <li>
              <button
                type="button"
                className="nav-item"
                aria-current={route === 'java' ? 'page' : undefined}
                onClick={() => {
                  setRoute('java');
                  setMobileMenuOpen(false);
                }}
              >
                <Coffee size={17} aria-hidden="true" />
                <span>Java Runtimes</span>
              </button>
            </li>
            <li>
              <button
                type="button"
                className="nav-item"
                aria-current={route === 'access' ? 'page' : undefined}
                onClick={() => {
                  setRoute('access');
                  setMobileMenuOpen(false);
                }}
              >
                <Shield size={17} aria-hidden="true" />
                <span>Users &amp; Access</span>
              </button>
            </li>
            <li>
              <button
                type="button"
                className="nav-item"
                aria-current={route === 'about' ? 'page' : undefined}
                onClick={() => {
                  setRoute('about');
                  setMobileMenuOpen(false);
                }}
              >
                <Info size={17} aria-hidden="true" />
                <span>About</span>
              </button>
            </li>
          </ul>
        </nav>

        <div className="sidebar-footer">
          <div>
            <div style={{ fontWeight: 600, color: 'var(--text-primary)' }}>{session.user?.username}</div>
            <div style={{ fontSize: '0.74rem', color: 'var(--accent-bright)' }}>
              {session.requireAuth ? session.user?.role.toUpperCase() : 'LOCAL OWNER'}
            </div>
          </div>
          {session.requireAuth && (
            <button
              type="button"
              className="btn btn-ghost btn-sm"
              aria-label="Sign out"
              onClick={() => api.logout().then(() => void refreshSession())}
            >
              <LogOut size={15} aria-hidden="true" />
            </button>
          )}
        </div>
      </aside>

      {/* Main Content Shell */}
      <div className="main-area">
        <header className="topbar">
          <div className="topbar-left">
            <button
              type="button"
              className="btn btn-ghost btn-sm mobile-menu-btn"
              aria-label="Open navigation menu"
              onClick={() => setMobileMenuOpen((v) => !v)}
            >
              <Menu size={18} aria-hidden="true" />
            </button>
            <h1 className="topbar-title">{pageHeading}</h1>
          </div>

          <div className="topbar-right">
            {route === 'server' && activeServer && <StatusBadge status={activeServer.runtime.status} />}
            <button type="button" className="btn btn-sm" onClick={() => setImportOpen(true)}>
              <FolderInput size={15} aria-hidden="true" />
              Import
            </button>
            <button type="button" className="btn btn-primary btn-sm" onClick={() => setCreateOpen(true)}>
              <Plus size={15} aria-hidden="true" />
              New Server
            </button>
          </div>
        </header>

        <main className="page-content">
          {route === 'dashboard' && (
            <DashboardPage
              servers={servers}
              onSelectServer={selectServer}
              onOpenCreate={() => setCreateOpen(true)}
              onOpenImport={() => setImportOpen(true)}
              onOpenJavaPage={() => setRoute('java')}
              onRuntimeUpdate={updateServerRuntime}
              onNotify={notify}
            />
          )}

          {route === 'java' && <JavaRuntimesPage javaDownloads={javaDownloads} onNotify={notify} />}

          {route === 'access' && (
            <AccessControlPage onNotify={notify} onAuthSettingChanged={() => void refreshSession()} />
          )}

          {route === 'about' && <AboutPage />}

          {route === 'server' && activeServer && (
            <>
              {serverTab === 'overview' && (
                <ServerOverviewPage
                  server={activeServer}
                  onNavigateTab={(t) => setServerTab(t as ServerTab)}
                  onOpenJavaPage={() => setRoute('java')}
                  onRuntimeUpdate={updateServerRuntime}
                  onNotify={notify}
                />
              )}
              {serverTab === 'console' && (
                <ConsolePage
                  server={activeServer}
                  lines={consoleLines}
                  onClearLocal={() => setConsoleLines([])}
                  onSendCommandWs={sendCommandWs}
                  onRuntimeUpdate={updateServerRuntime}
                  onNotify={notify}
                />
              )}
              {serverTab === 'configs' && (
                <ConfigsPage
                  server={activeServer}
                  initialFilePath={deepConfigPath}
                  onServerUpdated={() => void refreshServers()}
                  onNotify={notify}
                />
              )}
              {serverTab === 'velocity' && (
                <VelocityProxyPage
                  server={activeServer}
                  onOpenConfigFile={(rel) => {
                    setDeepConfigPath(rel);
                    setServerTab('configs');
                  }}
                  onNavigateTab={(t) => setServerTab(t as ServerTab)}
                  onServerUpdated={() => void refreshServers()}
                  onNotify={notify}
                />
              )}
              {serverTab === 'game' && <GameControlPage server={activeServer} onNotify={notify} />}
              {serverTab === 'realms' && <RealmsPage server={activeServer} onNotify={notify} />}
              {serverTab === 'plugins' && <PluginsModsPage server={activeServer} onNotify={notify} />}
              {serverTab === 'geyser' && (
                <GeyserPage
                  server={activeServer}
                  onOpenConfigFile={(rel) => {
                    setDeepConfigPath(rel);
                    setServerTab('configs');
                  }}
                  onNotify={notify}
                />
              )}
              {serverTab === 'players' && <PlayersPage server={activeServer} onNotify={notify} />}
              {serverTab === 'files' && <FilesPage server={activeServer} onNotify={notify} />}
              {serverTab === 'backups' && (
                <WorldsBackupsPage
                  server={activeServer}
                  onOpenConfigFile={(rel) => {
                    setDeepConfigPath(rel);
                    setServerTab('configs');
                  }}
                  onNotify={notify}
                />
              )}
              {serverTab === 'schedules' && <SchedulesPage server={activeServer} onNotify={notify} />}
              {serverTab === 'settings' && (
                <ServerSettingsPage
                  server={activeServer}
                  onUpdated={(updated) => setServers((prev) => prev.map((s) => (s.id === updated.id ? updated : s)))}
                  onDeleted={(id) => {
                    setServers((prev) => prev.filter((s) => s.id !== id));
                    setSelectedServerId(null);
                    setRoute('dashboard');
                  }}
                  onNotify={notify}
                />
              )}
            </>
          )}
        </main>
      </div>

      <CreateServerModal
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        onCreated={(created) => {
          setServers((prev) => [...prev, created]);
          selectServer(created.id, 'overview');
        }}
        onNotify={notify}
      />

      <ImportServerModal
        open={importOpen}
        onClose={() => setImportOpen(false)}
        onImported={(imported) => {
          setServers((prev) => [...prev, imported]);
          selectServer(imported.id, 'overview');
        }}
        onNotify={notify}
      />

      <ToastRegion toasts={toasts} onDismiss={dismissToast} />
    </div>
  );
}
