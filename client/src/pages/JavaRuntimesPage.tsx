import { useCallback, useEffect, useState } from 'react';
import { CheckCircle2, Coffee, Download, RefreshCw } from 'lucide-react';
import { api } from '../api/client';
import type { JavaDownloadStatus, JavaRuntimeInfo } from '../../../shared/types';

interface JavaRuntimesPageProps {
  javaDownloads: Record<number, JavaDownloadStatus>;
  onNotify: (tone: 'info' | 'success' | 'warn' | 'error', text: string) => void;
}

const TEMURIN_OFFERS = [
  { major: 25, label: 'Java 25', note: 'Minecraft 26.x+' },
  { major: 21, label: 'Java 21 (LTS)', note: 'Minecraft 1.20.5 – 1.21.x' },
  { major: 17, label: 'Java 17 (LTS)', note: 'Minecraft 1.18 – 1.20.4' },
  { major: 8, label: 'Java 8 (LTS)', note: 'Minecraft 1.7.10 – 1.16.5' },
];

export function JavaRuntimesPage({ javaDownloads, onNotify }: JavaRuntimesPageProps) {
  const [runtimes, setRuntimes] = useState<JavaRuntimeInfo[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await api.listJavaRuntimes();
      setRuntimes(res.runtimes);
    } catch (err) {
      onNotify('error', err instanceof Error ? err.message : 'Failed to scan Java runtimes');
    } finally {
      setLoading(false);
    }
  }, [onNotify]);

  useEffect(() => {
    void load();
  }, [load]);

  // Refresh list whenever a Temurin download finishes
  useEffect(() => {
    const anyDone = Object.values(javaDownloads).some((d) => d.stage === 'done');
    if (anyDone) void load();
  }, [javaDownloads, load]);

  const startDownload = async (major: number) => {
    try {
      await api.downloadJava(major);
      onNotify('info', `Started Adoptium Temurin Java ${major} download...`);
    } catch (err) {
      onNotify('error', err instanceof Error ? err.message : 'Failed to start Java download');
    }
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
      <section className="card">
        <div className="card-header">
          <div>
            <h2 className="card-title">
              <Coffee size={18} aria-hidden="true" />
              Java Runtimes
            </h2>
            <p style={{ margin: '0.2rem 0 0', fontSize: '0.88rem', color: 'var(--text-secondary)' }}>
              Download different Java runtime versions.
            </p>
          </div>
        </div>

        <div className="grid-2">
          {TEMURIN_OFFERS.map((offer) => {
            const installed = runtimes.find((r) => r.major === offer.major);
            const dl = javaDownloads[offer.major];
            const isWorking = dl && (dl.stage === 'downloading' || dl.stage === 'extracting');

            return (
              <div
                key={offer.major}
                style={{
                  border: '1px solid var(--border-subtle)',
                  borderRadius: 'var(--radius-md)',
                  background: 'var(--bg-surface-subtle)',
                  padding: '1rem',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: '0.6rem',
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '0.5rem' }}>
                  <strong style={{ fontFamily: 'var(--font-display)', fontSize: '1.12rem' }}>{offer.label}</strong>
                  {installed ? (
                    <span className="badge badge-online">
                      <CheckCircle2 size={13} aria-hidden="true" />
                      Installed ({installed.version})
                    </span>
                  ) : (
                    <span className="badge badge-neutral">Not Installed</span>
                  )}
                </div>

                <span style={{ fontSize: '0.86rem', color: 'var(--text-secondary)' }}>{offer.note}</span>

                {dl && dl.stage !== 'idle' && (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '0.3rem' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.8rem', color: dl.stage === 'error' ? 'var(--status-danger)' : 'var(--accent-bright)' }}>
                      <span>{dl.message}</span>
                      {isWorking && <span className="mono">{dl.percent}%</span>}
                    </div>
                    {isWorking && (
                      <div className="progress-track">
                        <div className="progress-fill" style={{ width: `${dl.percent}%` }} />
                      </div>
                    )}
                  </div>
                )}

                <div style={{ marginTop: 'auto', paddingTop: '0.25rem' }}>
                  <button
                    type="button"
                    className={`btn btn-sm ${installed ? '' : 'btn-primary'}`}
                    disabled={Boolean(isWorking)}
                    onClick={() => void startDownload(offer.major)}
                  >
                    <Download size={14} aria-hidden="true" />
                    {isWorking ? 'Installing...' : installed ? `Reinstall Temurin ${offer.major}` : `Install Temurin ${offer.major}`}
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      </section>

      <section className="card">
        <div className="card-header">
          <h3 className="card-title">Detected Java Installations ({runtimes.length})</h3>
          <button type="button" className="btn btn-sm" onClick={() => void load()}>
            <RefreshCw size={14} className={loading ? 'spin' : ''} aria-hidden="true" />
            Rescan
          </button>
        </div>

        <div tabIndex={0} role="region" aria-labelledby="java-table-cap" className="table-wrapper">
          <table className="data-table responsive-stack">
            <caption id="java-table-cap">Available Java binaries</caption>
            <thead>
              <tr>
                <th>Major</th>
                <th>Version</th>
                <th>Vendor</th>
                <th>Source</th>
                <th>Binary Path</th>
              </tr>
            </thead>
            <tbody>
              {runtimes.length === 0 ? (
                <tr>
                  <td colSpan={5} style={{ color: 'var(--text-muted)' }}>
                    No Java installations found.
                  </td>
                </tr>
              ) : (
                runtimes.map((r) => (
                  <tr key={r.id}>
                    <td data-label="Major">
                      <span className="badge badge-accent">Java {r.major}</span>
                    </td>
                    <td data-label="Version" className="mono">
                      {r.version}
                    </td>
                    <td data-label="Vendor">{r.vendor}</td>
                    <td data-label="Source">
                      <span className={`badge ${r.source === 'managed' ? 'badge-online' : 'badge-neutral'}`}>
                        {r.source === 'managed' ? 'Managed by MCServerManager' : 'System'}
                      </span>
                    </td>
                    <td data-label="Path" className="mono" style={{ fontSize: '0.78rem', color: 'var(--text-secondary)', wordBreak: 'break-all' }}>
                      {r.path}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
