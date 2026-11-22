import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ArrowLeft,
  Download,
  FileArchive,
  FileCode2,
  FilePlus2,
  Folder,
  FolderPlus,
  Pencil,
  RefreshCw,
  Trash2,
  Upload,
} from 'lucide-react';
import { api, formatBytes } from '../api/client';
import { VisualConfigEditor } from '../components/VisualConfigEditor';
import { ConfirmDialog, ModalDialog } from '../components/ModalDialog';
import type { FileEntry, ServerSummary } from '../../../shared/types';

interface FilesPageProps {
  server: ServerSummary;
  onNotify: (tone: 'info' | 'success' | 'warn' | 'error', text: string) => void;
}

export function FilesPage({ server, onNotify }: FilesPageProps) {
  const [cwd, setCwd] = useState('');
  const [entries, setEntries] = useState<FileEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [editingFile, setEditingFile] = useState<string | null>(null);
  const [newItemMode, setNewItemMode] = useState<'file' | 'folder' | null>(null);
  const [newItemName, setNewItemName] = useState('');
  const [renameTarget, setRenameTarget] = useState<FileEntry | null>(null);
  const [renameValue, setRenameValue] = useState('');
  const [deleteTarget, setDeleteTarget] = useState<FileEntry | null>(null);
  const uploadRef = useRef<HTMLInputElement>(null);

  const loadDir = useCallback(
    async (dirPath: string) => {
      setLoading(true);
      try {
        const res = await api.listFiles(server.id, dirPath);
        setCwd(res.path);
        setEntries(res.entries);
      } catch (err) {
        onNotify('error', err instanceof Error ? err.message : 'Failed to list directory');
      } finally {
        setLoading(false);
      }
    },
    [server.id, onNotify],
  );

  useEffect(() => {
    setEditingFile(null);
    void loadDir('');
  }, [server.id, loadDir]);

  const crumbs = cwd ? cwd.split('/') : [];

  const handleCreateItem = async (e: React.FormEvent) => {
    e.preventDefault();
    const clean = newItemName.trim().replace(/^\/+/, '');
    if (!clean || !newItemMode) return;
    const rel = cwd ? `${cwd}/${clean}` : clean;
    try {
      if (newItemMode === 'folder') {
        await api.mkdir(server.id, rel);
        onNotify('success', `Created folder ${clean}`);
      } else {
        await api.touchFile(server.id, rel, '');
        onNotify('success', `Created file ${clean}`);
      }
      setNewItemMode(null);
      setNewItemName('');
      await loadDir(cwd);
    } catch (err) {
      onNotify('error', err instanceof Error ? err.message : 'Create failed');
    }
  };

  const handleRename = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!renameTarget || !renameValue.trim()) return;
    const parent = renameTarget.relativePath.includes('/')
      ? renameTarget.relativePath.slice(0, renameTarget.relativePath.lastIndexOf('/'))
      : '';
    const nextRel = parent ? `${parent}/${renameValue.trim()}` : renameValue.trim();
    try {
      await api.renameFile(server.id, renameTarget.relativePath, nextRel);
      onNotify('success', `Renamed to ${renameValue.trim()}`);
      setRenameTarget(null);
      await loadDir(cwd);
    } catch (err) {
      onNotify('error', err instanceof Error ? err.message : 'Rename failed');
    }
  };

  const handleDelete = async () => {
    if (!deleteTarget) return;
    try {
      await api.deleteFile(server.id, deleteTarget.relativePath);
      onNotify('success', `Deleted ${deleteTarget.name}`);
      setDeleteTarget(null);
      await loadDir(cwd);
    } catch (err) {
      onNotify('error', err instanceof Error ? err.message : 'Delete failed');
    }
  };

  const handleUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files || files.length === 0) return;
    try {
      const res = await api.uploadFiles(server.id, cwd, files);
      onNotify('success', `Uploaded ${res.files.length} file(s)`);
      await loadDir(cwd);
    } catch (err) {
      onNotify('error', err instanceof Error ? err.message : 'Upload failed');
    } finally {
      e.target.value = '';
    }
  };

  if (editingFile) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: '0.85rem' }}>
        <div>
          <button type="button" className="btn btn-sm" onClick={() => setEditingFile(null)}>
            <ArrowLeft size={15} aria-hidden="true" />
            Back to /{cwd}
          </button>
        </div>
        <VisualConfigEditor serverId={server.id} relativePath={editingFile} onNotify={onNotify} />
      </div>
    );
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
      {/* Breadcrumbs & Actions */}
      <div
        className="card"
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: '0.75rem',
          flexWrap: 'wrap',
          padding: '0.8rem 1rem',
        }}
      >
        <nav aria-label="Directory path" style={{ display: 'flex', alignItems: 'center', gap: '0.3rem', flexWrap: 'wrap' }}>
          <button type="button" className="btn btn-ghost btn-sm mono" onClick={() => void loadDir('')}>
            /root
          </button>
          {crumbs.map((seg, i) => {
            const target = crumbs.slice(0, i + 1).join('/');
            return (
              <span key={target} style={{ display: 'inline-flex', alignItems: 'center', gap: '0.2rem' }}>
                <span style={{ color: 'var(--text-muted)' }}>/</span>
                <button type="button" className="btn btn-ghost btn-sm mono" onClick={() => void loadDir(target)}>
                  {seg}
                </button>
              </span>
            );
          })}
        </nav>

        <div style={{ display: 'flex', gap: '0.45rem', flexWrap: 'wrap' }}>
          <input ref={uploadRef} type="file" multiple className="visually-hidden" onChange={(e) => void handleUpload(e)} />
          <button type="button" className="btn btn-primary btn-sm" onClick={() => uploadRef.current?.click()}>
            <Upload size={14} aria-hidden="true" />
            Upload
          </button>
          <button
            type="button"
            className="btn btn-sm"
            onClick={() => {
              setNewItemMode('folder');
              setNewItemName('');
            }}
          >
            <FolderPlus size={14} aria-hidden="true" />
            New Folder
          </button>
          <button
            type="button"
            className="btn btn-sm"
            onClick={() => {
              setNewItemMode('file');
              setNewItemName('');
            }}
          >
            <FilePlus2 size={14} aria-hidden="true" />
            New File
          </button>
          <button type="button" className="btn btn-ghost btn-sm" onClick={() => void loadDir(cwd)}>
            <RefreshCw size={14} className={loading ? 'spin' : ''} aria-hidden="true" />
          </button>
        </div>
      </div>

      <div tabIndex={0} role="region" aria-labelledby="files-table-cap" className="table-wrapper">
        <table className="data-table responsive-stack">
          <caption id="files-table-cap">Server files in /{cwd || 'root'}</caption>
          <thead>
            <tr>
              <th>Name</th>
              <th>Type</th>
              <th>Size</th>
              <th>Modified</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            {cwd && (
              <tr>
                <td colSpan={5}>
                  <button
                    type="button"
                    className="btn btn-ghost btn-sm mono"
                    onClick={() => {
                      const up = cwd.includes('/') ? cwd.slice(0, cwd.lastIndexOf('/')) : '';
                      void loadDir(up);
                    }}
                  >
                    .. (Up one level)
                  </button>
                </td>
              </tr>
            )}
            {entries.length === 0 ? (
              <tr>
                <td colSpan={5} style={{ color: 'var(--text-muted)' }}>
                  Directory is empty.
                </td>
              </tr>
            ) : (
              entries.map((entry) => (
                <tr key={entry.relativePath}>
                  <td data-label="Name">
                    <button
                      type="button"
                      className="btn btn-ghost btn-sm"
                      style={{ paddingInline: '0.35rem', fontWeight: 600 }}
                      onClick={() => {
                        if (entry.isDirectory) {
                          void loadDir(entry.relativePath);
                        } else if (!entry.isBinary) {
                          setEditingFile(entry.relativePath);
                        } else {
                          onNotify('info', 'Binary files can be downloaded rather than opened in the text editor.');
                        }
                      }}
                    >
                      {entry.isDirectory ? (
                        <Folder size={16} style={{ color: 'var(--accent-bright)' }} aria-hidden="true" />
                      ) : entry.name.endsWith('.zip') ? (
                        <FileArchive size={16} style={{ color: 'var(--status-warn)' }} aria-hidden="true" />
                      ) : (
                        <FileCode2 size={16} style={{ color: 'var(--text-secondary)' }} aria-hidden="true" />
                      )}
                      <span className="mono">{entry.name}</span>
                    </button>
                  </td>
                  <td data-label="Type">
                    {entry.isDirectory ? (
                      <span className="badge badge-neutral">Folder</span>
                    ) : entry.isBinary ? (
                      <span className="badge badge-neutral">Binary</span>
                    ) : (
                      <span className="badge badge-accent">{entry.format.toUpperCase()}</span>
                    )}
                  </td>
                  <td data-label="Size" className="mono">
                    {entry.isDirectory ? '—' : formatBytes(entry.sizeBytes)}
                  </td>
                  <td data-label="Modified" style={{ color: 'var(--text-secondary)', fontSize: '0.84rem' }}>
                    {new Date(entry.modifiedAt).toLocaleString()}
                  </td>
                  <td data-label="Actions">
                    <div style={{ display: 'flex', gap: '0.35rem', flexWrap: 'wrap' }}>
                      {!entry.isDirectory && !entry.isBinary && (
                        <button
                          type="button"
                          className="btn btn-secondary btn-sm"
                          onClick={() => setEditingFile(entry.relativePath)}
                        >
                          Edit
                        </button>
                      )}
                      {!entry.isDirectory && entry.name.toLowerCase().endsWith('.zip') && (
                        <button
                          type="button"
                          className="btn btn-sm"
                          onClick={() =>
                            api.extractZip(server.id, entry.relativePath).then(() => {
                              onNotify('success', `Extracted ${entry.name}`);
                              void loadDir(cwd);
                            })
                          }
                        >
                          Extract
                        </button>
                      )}
                      {!entry.isDirectory && (
                        <a
                          className="btn btn-ghost btn-sm"
                          href={`/api/servers/${encodeURIComponent(server.id)}/files/download?path=${encodeURIComponent(entry.relativePath)}`}
                          download
                          aria-label={`Download ${entry.name}`}
                        >
                          <Download size={14} aria-hidden="true" />
                        </a>
                      )}
                      <button
                        type="button"
                        className="btn btn-ghost btn-sm"
                        aria-label={`Rename ${entry.name}`}
                        onClick={() => {
                          setRenameTarget(entry);
                          setRenameValue(entry.name);
                        }}
                      >
                        <Pencil size={14} aria-hidden="true" />
                      </button>
                      <button
                        type="button"
                        className="btn btn-ghost btn-sm"
                        aria-label={`Delete ${entry.name}`}
                        onClick={() => setDeleteTarget(entry)}
                      >
                        <Trash2 size={14} aria-hidden="true" />
                      </button>
                    </div>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      <ModalDialog
        open={Boolean(newItemMode)}
        onClose={() => setNewItemMode(null)}
        title={newItemMode === 'folder' ? 'Create New Folder' : 'Create New File'}
        footer={
          <>
            <button type="button" className="btn" onClick={() => setNewItemMode(null)}>
              Cancel
            </button>
            <button type="submit" form="new-fs-form" className="btn btn-primary">
              Create
            </button>
          </>
        }
      >
        <form id="new-fs-form" onSubmit={(e) => void handleCreateItem(e)} className="field">
          <label htmlFor="new-fs-name">{newItemMode === 'folder' ? 'Folder name' : 'File name'}</label>
          <input
            id="new-fs-name"
            type="text"
            className="input mono"
            required
            autoFocus
            autoCorrect="off"
            autoCapitalize="none"
            spellCheck={false}
            placeholder={newItemMode === 'folder' ? 'datapacks' : 'notes.yml'}
            value={newItemName}
            onChange={(e) => setNewItemName(e.target.value)}
          />
        </form>
      </ModalDialog>

      <ModalDialog
        open={Boolean(renameTarget)}
        onClose={() => setRenameTarget(null)}
        title={`Rename ${renameTarget?.name || ''}`}
        footer={
          <>
            <button type="button" className="btn" onClick={() => setRenameTarget(null)}>
              Cancel
            </button>
            <button type="submit" form="rename-fs-form" className="btn btn-primary">
              Rename
            </button>
          </>
        }
      >
        <form id="rename-fs-form" onSubmit={(e) => void handleRename(e)} className="field">
          <label htmlFor="rename-fs-input">New name</label>
          <input
            id="rename-fs-input"
            type="text"
            className="input mono"
            required
            autoFocus
            autoCorrect="off"
            autoCapitalize="none"
            spellCheck={false}
            value={renameValue}
            onChange={(e) => setRenameValue(e.target.value)}
          />
        </form>
      </ModalDialog>

      <ConfirmDialog
        open={Boolean(deleteTarget)}
        onClose={() => setDeleteTarget(null)}
        onConfirm={handleDelete}
        title={`Delete ${deleteTarget?.name || ''}?`}
        message={`This permanently removes "${deleteTarget?.relativePath}" from the server directory.`}
        confirmLabel="Delete"
      />
    </div>
  );
}
