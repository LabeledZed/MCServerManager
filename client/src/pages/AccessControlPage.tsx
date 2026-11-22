import { useCallback, useEffect, useState } from 'react';
import { Lock, Pencil, Plus, Save, ShieldCheck, Trash2, Users } from 'lucide-react';
import { api } from '../api/client';
import { Switch } from '../components/Switch';
import { ModalDialog } from '../components/ModalDialog';
import type { PanelSettings, Permission, UserAccount, UserRole } from '../../../shared/types';

interface AccessControlPageProps {
  onNotify: (tone: 'info' | 'success' | 'warn' | 'error', text: string) => void;
  onAuthSettingChanged: () => void;
}

const ALL_PERMISSIONS: Array<{ id: Permission; label: string }> = [
  { id: 'console', label: 'Console' },
  { id: 'power', label: 'Start / Stop' },
  { id: 'configs', label: 'Configs' },
  { id: 'plugins', label: 'Plugins / Mods' },
  { id: 'files', label: 'File Manager' },
  { id: 'players', label: 'Players' },
  { id: 'backups', label: 'Worlds & Backups' },
  { id: 'schedules', label: 'Schedules' },
  { id: 'settings', label: 'Server Settings' },
  { id: 'users', label: 'User Access' },
];

const ROLE_PRESETS: Record<Exclude<UserRole, 'owner'>, Permission[]> = {
  admin: ['console', 'power', 'configs', 'plugins', 'files', 'players', 'backups', 'schedules', 'settings', 'users'],
  operator: ['console', 'power', 'configs', 'plugins', 'players', 'backups'],
  viewer: ['console'],
};

export function AccessControlPage({ onNotify, onAuthSettingChanged }: AccessControlPageProps) {
  const [settings, setSettings] = useState<PanelSettings | null>(null);
  const [users, setUsers] = useState<UserAccount[]>([]);

  // Create user modal state
  const [createOpen, setCreateOpen] = useState(false);
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [role, setRole] = useState<UserRole>('operator');
  const [permissions, setPermissions] = useState<Permission[]>([...ROLE_PRESETS.operator]);

  // Edit user / owner modal state
  const [editingUser, setEditingUser] = useState<UserAccount | null>(null);
  const [editUsername, setEditUsername] = useState('');
  const [editPassword, setEditPassword] = useState('');
  const [editRole, setEditRole] = useState<UserRole>('operator');
  const [editPermissions, setEditPermissions] = useState<Permission[]>([]);
  const [savingEdit, setSavingEdit] = useState(false);

  const load = useCallback(async () => {
    try {
      const [s, u] = await Promise.all([api.getPanelSettings(), api.listUsers()]);
      setSettings(s);
      setUsers(u);
    } catch (err) {
      onNotify('error', err instanceof Error ? err.message : 'Failed to load access control settings');
    }
  }, [onNotify]);

  useEffect(() => {
    void load();
  }, [load]);

  const toggleRequireAuth = async (reqAuth: boolean) => {
    try {
      const updated = await api.updatePanelSettings({ requireAuth: reqAuth });
      setSettings(updated);
      onNotify(
        'success',
        reqAuth
          ? 'Login protection enabled (update the owner username & password below if still using defaults!)'
          : 'Switched to Local Quick Access mode (auto-signed in as owner)',
      );
      onAuthSettingChanged();
    } catch (err) {
      onNotify('error', err instanceof Error ? err.message : 'Update failed');
    }
  };

  const updateRetention = async (retention: number) => {
    try {
      const updated = await api.updatePanelSettings({ defaultBackupRetention: retention });
      setSettings(updated);
      onNotify('success', `Backup retention set to ${retention} snapshots per server`);
    } catch (err) {
      onNotify('error', err instanceof Error ? err.message : 'Update failed');
    }
  };

  const handleCreateUser = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      await api.createUser({ username, password, role, permissions });
      onNotify('success', `Created user "${username}"`);
      setCreateOpen(false);
      setUsername('');
      setPassword('');
      setRole('operator');
      setPermissions([...ROLE_PRESETS.operator]);
      await load();
    } catch (err) {
      onNotify('error', err instanceof Error ? err.message : 'Failed to create user');
    }
  };

  const openEditUser = (u: UserAccount) => {
    setEditingUser(u);
    setEditUsername(u.username);
    setEditPassword('');
    setEditRole(u.role);
    setEditPermissions([...u.permissions]);
  };

  const handleSaveEditUser = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingUser) return;
    setSavingEdit(true);
    try {
      const payload: {
        username?: string;
        password?: string;
        role?: UserRole;
        permissions?: Permission[];
      } = {};
      if (editUsername.trim() && editUsername.trim() !== editingUser.username) {
        payload.username = editUsername.trim();
      }
      if (editPassword.length > 0) {
        payload.password = editPassword;
      }
      if (editingUser.role !== 'owner') {
        payload.role = editRole;
        payload.permissions = editPermissions;
      }
      await api.updateUser(editingUser.id, payload);
      onNotify(
        'success',
        editingUser.role === 'owner'
          ? 'Updated owner account credentials'
          : `Updated account & permissions for "${editUsername.trim() || editingUser.username}"`,
      );
      setEditingUser(null);
      setEditPassword('');
      await load();
      onAuthSettingChanged();
    } catch (err) {
      onNotify('error', err instanceof Error ? err.message : 'Failed to update user');
    } finally {
      setSavingEdit(false);
    }
  };

  const togglePerm = (p: Permission) => {
    setPermissions((prev) => (prev.includes(p) ? prev.filter((x) => x !== p) : [...prev, p]));
  };

  const toggleEditPerm = (p: Permission) => {
    setEditPermissions((prev) => (prev.includes(p) ? prev.filter((x) => x !== p) : [...prev, p]));
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
      <section className="card" style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
        <h2 className="card-title">
          <Lock size={18} aria-hidden="true" />
          Panel Access &amp; Global Settings
        </h2>

        {settings && (
          <div className="grid-2" style={{ alignItems: 'center' }}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.35rem' }}>
              <Switch
                checked={settings.requireAuth}
                onChange={(val) => void toggleRequireAuth(val)}
                label="Require login"
              />
              <span className="field-hint">
                Default owner credentials when first enabled: <code>admin</code> / <code>admin</code>. Click{' '}
                <strong>Edit</strong> on the owner account below to change them.
              </span>
            </div>

            <div className="field">
              <label htmlFor="bk-retention">Max Backups Kept Per Server</label>
              <div style={{ display: 'flex', gap: '0.5rem' }}>
                <input
                  id="bk-retention"
                  type="number"
                  min={1}
                  max={100}
                  className="input mono"
                  style={{ maxWidth: '140px' }}
                  value={settings.defaultBackupRetention}
                  onChange={(e) => setSettings({ ...settings, defaultBackupRetention: Number(e.target.value) })}
                />
                <button
                  type="button"
                  className="btn btn-secondary btn-sm"
                  onClick={() => void updateRetention(settings.defaultBackupRetention)}
                >
                  Save
                </button>
              </div>
            </div>
          </div>
        )}
      </section>

      <section className="card">
        <div className="card-header">
          <h3 className="card-title">
            <Users size={18} aria-hidden="true" />
            Users &amp; Role Permissions ({users.length})
          </h3>
          <button type="button" className="btn btn-primary btn-sm" onClick={() => setCreateOpen(true)}>
            <Plus size={15} aria-hidden="true" />
            Add User
          </button>
        </div>

        <div tabIndex={0} role="region" aria-labelledby="users-cap" className="table-wrapper">
          <table className="data-table responsive-stack">
            <caption id="users-cap">Panel user accounts and permissions</caption>
            <thead>
              <tr>
                <th>Username</th>
                <th>Role</th>
                <th>Permissions</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {users.map((u) => (
                <tr key={u.id}>
                  <td data-label="Username">
                    <strong>{u.username}</strong>
                  </td>
                  <td data-label="Role">
                    <span className="badge badge-accent">
                      <ShieldCheck size={13} aria-hidden="true" />
                      {u.role.toUpperCase()}
                    </span>
                  </td>
                  <td data-label="Permissions">
                    <div style={{ display: 'flex', gap: '0.3rem', flexWrap: 'wrap' }}>
                      {u.permissions.map((p) => (
                        <span key={p} className="badge badge-neutral" style={{ fontSize: '0.72rem' }}>
                          {p}
                        </span>
                      ))}
                    </div>
                  </td>
                  <td data-label="Actions">
                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.35rem', flexWrap: 'wrap' }}>
                      <button
                        type="button"
                        className="btn btn-secondary btn-sm"
                        onClick={() => openEditUser(u)}
                      >
                        <Pencil size={13} aria-hidden="true" />
                        {u.role === 'owner' ? 'Edit Owner' : 'Edit'}
                      </button>
                      {u.role !== 'owner' && (
                        <button
                          type="button"
                          className="btn btn-ghost btn-sm"
                          aria-label={`Delete user ${u.username}`}
                          onClick={() =>
                            api.deleteUser(u.id).then(() => {
                              onNotify('info', `Deleted user ${u.username}`);
                              void load();
                            })
                          }
                        >
                          <Trash2 size={14} aria-hidden="true" />
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      {/* Add User Modal */}
      <ModalDialog
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        title="Add Panel User"
        footer={
          <>
            <button type="button" className="btn" onClick={() => setCreateOpen(false)}>
              Cancel
            </button>
            <button type="submit" form="create-user-form" className="btn btn-primary">
              Create Account
            </button>
          </>
        }
      >
        <form id="create-user-form" onSubmit={(e) => void handleCreateUser(e)} style={{ display: 'flex', flexDirection: 'column', gap: '0.9rem' }}>
          <div className="grid-2">
            <div className="field">
              <label htmlFor="nu-user">Username</label>
              <input
                id="nu-user"
                type="text"
                className="input"
                required
                minLength={2}
                autoFocus
                autoCorrect="off"
                autoCapitalize="none"
                spellCheck={false}
                value={username}
                onChange={(e) => setUsername(e.target.value)}
              />
            </div>
            <div className="field">
              <label htmlFor="nu-pass">Password</label>
              <input
                id="nu-pass"
                type="password"
                className="input"
                required
                minLength={4}
                autoComplete="new-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
            </div>
          </div>

          <div className="field">
            <label htmlFor="nu-role">Role</label>
            <select
              id="nu-role"
              className="select"
              value={role}
              onChange={(e) => {
                const nextRole = e.target.value as Exclude<UserRole, 'owner'>;
                setRole(nextRole);
                setPermissions([...ROLE_PRESETS[nextRole]]);
              }}
            >
              <option value="admin">Admin</option>
              <option value="operator">Operator</option>
              <option value="viewer">Viewer</option>
            </select>
          </div>

          <fieldset className="field-group">
            <legend>Granular Permissions</legend>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: '0.5rem', marginTop: '0.35rem' }}>
              {ALL_PERMISSIONS.map((perm) => (
                <label key={perm.id} style={{ display: 'inline-flex', alignItems: 'center', gap: '0.45rem', cursor: 'pointer' }}>
                  <input
                    type="checkbox"
                    checked={permissions.includes(perm.id)}
                    onChange={() => togglePerm(perm.id)}
                  />
                  <span>{perm.label}</span>
                </label>
              ))}
            </div>
          </fieldset>
        </form>
      </ModalDialog>

      {/* Edit User / Owner Modal */}
      <ModalDialog
        open={Boolean(editingUser)}
        onClose={() => !savingEdit && setEditingUser(null)}
        title={
          editingUser?.role === 'owner'
            ? 'Edit Owner Account'
            : `Edit User — ${editingUser?.username || ''}`
        }
        footer={
          <>
            <button type="button" className="btn" onClick={() => setEditingUser(null)} disabled={savingEdit}>
              Cancel
            </button>
            <button type="submit" form="edit-user-form" className="btn btn-primary" disabled={savingEdit}>
              <Save size={14} aria-hidden="true" />
              {savingEdit ? 'Saving...' : 'Save Changes'}
            </button>
          </>
        }
      >
        {editingUser && (
          <form
            id="edit-user-form"
            onSubmit={(e) => void handleSaveEditUser(e)}
            style={{ display: 'flex', flexDirection: 'column', gap: '0.9rem' }}
          >
            <div className="grid-2">
              <div className="field">
                <label htmlFor="eu-user">
                  {editingUser.role === 'owner' ? 'Owner Username' : 'Username'}
                </label>
                <input
                  id="eu-user"
                  type="text"
                  className="input"
                  required
                  minLength={2}
                  autoFocus
                  autoCorrect="off"
                  autoCapitalize="none"
                  spellCheck={false}
                  value={editUsername}
                  onChange={(e) => setEditUsername(e.target.value)}
                />
              </div>
              <div className="field">
                <label htmlFor="eu-pass">New Password (optional)</label>
                <input
                  id="eu-pass"
                  type="password"
                  className="input"
                  minLength={4}
                  autoComplete="new-password"
                  placeholder="Leave blank to keep current"
                  value={editPassword}
                  onChange={(e) => setEditPassword(e.target.value)}
                />
              </div>
            </div>

            {editingUser.role === 'owner' ? (
              <div className="field-hint">
                The primary owner account always retains full administrative permissions across all servers and panel
                settings.
              </div>
            ) : (
              <>
                <div className="field">
                  <label htmlFor="eu-role">Role</label>
                  <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
                    <select
                      id="eu-role"
                      className="select"
                      value={editRole}
                      onChange={(e) => setEditRole(e.target.value as UserRole)}
                    >
                      <option value="admin">Admin</option>
                      <option value="operator">Operator</option>
                      <option value="viewer">Viewer</option>
                    </select>
                    <button
                      type="button"
                      className="btn btn-sm"
                      title="Reset checkboxes to this role's default permissions"
                      onClick={() => {
                        if (editRole !== 'owner') {
                          setEditPermissions([...ROLE_PRESETS[editRole]]);
                        }
                      }}
                    >
                      Apply Preset
                    </button>
                  </div>
                </div>

                <fieldset className="field-group">
                  <legend>Granular Permissions</legend>
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: '0.5rem', marginTop: '0.35rem' }}>
                    {ALL_PERMISSIONS.map((perm) => (
                      <label
                        key={perm.id}
                        style={{ display: 'inline-flex', alignItems: 'center', gap: '0.45rem', cursor: 'pointer' }}
                      >
                        <input
                          type="checkbox"
                          checked={editPermissions.includes(perm.id)}
                          onChange={() => toggleEditPerm(perm.id)}
                        />
                        <span>{perm.label}</span>
                      </label>
                    ))}
                  </div>
                </fieldset>
              </>
            )}
          </form>
        )}
      </ModalDialog>
    </div>
  );
}
