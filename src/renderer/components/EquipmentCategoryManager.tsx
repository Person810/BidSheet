import React, { useState, useEffect, useCallback, useId, useRef } from 'react';
import type { EquipmentCategoryManagementRow } from '../../shared/types/ipc';
import { dismissOnEscOnly } from './modalDismiss';
import { validateEquipmentCategoryName } from '../../shared/equipmentCategories';

/** Error text from an IPC rejection, without assuming it's an Error. */
function messageOf(err: unknown, fallback: string): string {
  return err instanceof Error && err.message ? err.message : fallback;
}

interface Props {
  open: boolean;
  onClose: () => void;
  onChanged: () => void;
  /** Lets the page follow a rename/delete with its own category filter. */
  onCategoryRenamed?: (previousName: string, newName: string) => void;
  onCategoryDeleted?: (deletedName: string, replacementName: string | null) => void;
}

export function EquipmentCategoryManager({
  open, onClose, onChanged, onCategoryRenamed, onCategoryDeleted,
}: Props) {
  const [categories, setCategories] = useState<EquipmentCategoryManagementRow[]>([]);
  const [name, setName] = useState('');
  const [editingName, setEditingName] = useState<string | null>(null);
  const [isAdding, setIsAdding] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<EquipmentCategoryManagementRow | null>(null);
  const [replacementName, setReplacementName] = useState<string>('');
  const nameFieldId = useId();
  const nameInputRef = useRef<HTMLInputElement>(null);

  const loadCategories = useCallback(async () => {
    setCategories(await window.api.getEquipmentCategoryManagement());
  }, []);

  useEffect(() => {
    if (open) void loadCategories();
  }, [open, loadCategories]);

  // Focus the name field when the add/rename form opens. Done here rather
  // than with autoFocus so the focus move is an explicit, reviewable effect.
  useEffect(() => {
    if (isAdding || editingName) nameInputRef.current?.focus();
  }, [isAdding, editingName]);

  const resetForm = () => {
    setName('');
    setEditingName(null);
    setIsAdding(false);
    setError(null);
  };

  const closeAll = () => {
    onClose();
    resetForm();
    setDeleteTarget(null);
  };

  const startAdd = () => {
    resetForm();
    setIsAdding(true);
  };

  const startEdit = (cat: EquipmentCategoryManagementRow) => {
    setName(cat.name);
    setEditingName(cat.name);
    setIsAdding(false);
    setError(null);
  };

  const handleSave = async () => {
    const names = categories.map((c) => c.name);
    const validationError = validateEquipmentCategoryName(name, names, editingName ?? undefined);
    if (validationError) { setError(validationError); return; }
    try {
      await window.api.saveEquipmentCategory({
        name: name.trim(),
        previousName: editingName,
      });
      if (editingName && onCategoryRenamed) onCategoryRenamed(editingName, name.trim());
      resetForm();
      await loadCategories();
      onChanged();
    } catch (err: unknown) {
      setError(messageOf(err, 'Failed to save category.'));
    }
  };

  const startDelete = (cat: EquipmentCategoryManagementRow) => {
    setDeleteTarget(cat);
    setReplacementName('');
    setError(null);
  };

  const confirmDelete = async () => {
    if (!deleteTarget) return;
    try {
      const replacement = deleteTarget.equipmentCount > 0 ? replacementName || null : null;
      await window.api.deleteEquipmentCategory({
        name: deleteTarget.name,
        replacementName: replacement,
        expectedEquipmentCount: deleteTarget.equipmentCount,
      });
      setDeleteTarget(null);
      if (onCategoryDeleted) onCategoryDeleted(deleteTarget.name, replacement);
      await loadCategories();
      onChanged();
    } catch (err: unknown) {
      const message = messageOf(err, 'Failed to delete category.');
      // A moved count means the catalog changed underneath the dialog —
      // reload so the user is looking at what's actually there.
      if (message.toLowerCase().includes('count has changed')) {
        await loadCategories();
        setDeleteTarget(null);
      }
      setError(message);
    }
  };

  const runBulk = async (action: () => Promise<unknown>) => {
    setError(null);
    try {
      await action();
      await loadCategories();
      onChanged();
    } catch (err: unknown) {
      setError(messageOf(err, 'Failed to update categories.'));
    }
  };

  if (!open) return null;

  const replacementOptions = deleteTarget
    ? categories.filter((c) => c.name !== deleteTarget.name)
    : [];
  const unusedCount = categories.filter((c) => c.equipmentCount === 0).length;
  const unlistedCount = categories.filter((c) => !c.listed).length;

  return (
    // The overlay's onClick is how Esc closes this dialog, not a mouse
    // affordance: App.tsx's global Esc handler dispatches a synthetic click
    // here and dismissOnEscOnly lets only that through (see modalDismiss.ts).
    // A keyboard listener on the backdrop would duplicate the path that is
    // already keyboard-driven.
    // eslint-disable-next-line jsx-a11y/click-events-have-key-events, jsx-a11y/no-static-element-interactions
    <div className="modal-overlay" onClick={dismissOnEscOnly(closeAll)}>
      {/* No stopPropagation needed: dismissOnEscOnly ignores anything that
          didn't originate on the overlay itself. */}
      <div className="modal" style={{ maxWidth: 600, maxHeight: '80vh', overflow: 'auto' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
          <h3 style={{ margin: 0 }}>Manage Equipment Categories</h3>
          <button className="btn btn-sm btn-secondary" onClick={closeAll}>Close</button>
        </div>

        {error && (
          <div style={{ background: 'var(--danger, #ef4444)', color: '#fff', borderRadius: 6, padding: '8px 12px', marginBottom: 12, fontSize: 13 }}>
            {error}
          </div>
        )}

        {/* Delete confirmation */}
        {deleteTarget && (
          <div style={{ background: 'var(--bg-secondary)', borderRadius: 8, padding: 16, marginBottom: 16 }}>
            <p style={{ fontWeight: 600, marginBottom: 8 }}>Delete "{deleteTarget.name}"?</p>
            {deleteTarget.equipmentCount > 0 ? (
              <>
                <p style={{ fontSize: 13, marginBottom: 8 }}>
                  {deleteTarget.equipmentCount} piece{deleteTarget.equipmentCount !== 1 ? 's' : ''} of
                  equipment {deleteTarget.equipmentCount !== 1 ? 'are' : 'is'} in this category.
                  Choose where {deleteTarget.equipmentCount !== 1 ? 'they' : 'it'} should go:
                </p>
                <select
                  className="form-control"
                  style={{ marginBottom: 12 }}
                  value={replacementName}
                  onChange={(e) => setReplacementName(e.target.value)}
                >
                  <option value="">Select replacement...</option>
                  {replacementOptions.map((c) => (
                    <option key={c.name} value={c.name}>{c.name}</option>
                  ))}
                </select>
              </>
            ) : (
              <p style={{ fontSize: 13, marginBottom: 12 }}>
                No equipment uses this category, so nothing else changes.
              </p>
            )}
            <div className="modal-actions">
              <button className="btn btn-secondary" onClick={() => { setDeleteTarget(null); setError(null); }}>
                Cancel
              </button>
              <button className="btn btn-primary" style={{ background: 'var(--danger, #ef4444)' }}
                onClick={confirmDelete}
                disabled={deleteTarget.equipmentCount > 0 && !replacementName}>
                Delete
              </button>
            </div>
          </div>
        )}

        {/* Add/Edit form */}
        {(isAdding || editingName) && !deleteTarget && (
          <div style={{ background: 'var(--bg-secondary)', borderRadius: 8, padding: 16, marginBottom: 16 }}>
            <div style={{ marginBottom: 12 }}>
              <label htmlFor={nameFieldId}
                style={{ fontSize: 12, fontWeight: 600, display: 'block', marginBottom: 4 }}>
                Name
              </label>
              <input id={nameFieldId} ref={nameInputRef} className="form-control" value={name}
                onChange={(e) => setName(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') void handleSave(); }}
                placeholder="e.g. Hydro Excavation"
                maxLength={40} />
              {editingName && (
                <div className="text-muted" style={{ fontSize: 11, marginTop: 4 }}>
                  Equipment in "{editingName}" moves to the new name.
                </div>
              )}
            </div>
            <div className="modal-actions">
              <button className="btn btn-secondary" onClick={resetForm}>Cancel</button>
              <button className="btn btn-primary" onClick={handleSave}>
                {editingName ? 'Save' : 'Add'}
              </button>
            </div>
          </div>
        )}

        {!isAdding && !editingName && !deleteTarget && (
          <div className="flex gap-8 items-center mb-16" style={{ flexWrap: 'wrap' }}>
            <button className="btn btn-primary" onClick={startAdd}>+ Add Category</button>
            {unusedCount > 0 && (
              <button className="btn btn-sm btn-secondary"
                title="Remove every category no equipment is using"
                onClick={() => runBulk(() => window.api.clearUnusedEquipmentCategories())}>
                Remove {unusedCount} unused
              </button>
            )}
            {unlistedCount > 0 && (
              <button className="btn btn-sm btn-secondary"
                title="Add the in-use categories below to your managed list"
                onClick={() => runBulk(() => window.api.adoptUsedEquipmentCategories())}>
                Keep {unlistedCount} in use
              </button>
            )}
          </div>
        )}

        <table className="data-table" style={{ fontSize: 13 }}>
          <thead>
            <tr>
              <th>Name</th>
              <th style={{ width: 90 }}>Equipment</th>
              <th style={{ width: 120 }}></th>
            </tr>
          </thead>
          <tbody>
            {categories.length === 0 ? (
              <tr>
                <td colSpan={3} style={{ textAlign: 'center', padding: '32px 16px', color: 'var(--text-muted)' }}>
                  No categories yet. Add the ones your fleet actually uses.
                </td>
              </tr>
            ) : (
              categories.map((cat) => (
                <tr key={cat.name}>
                  <td>
                    <span>{cat.name}</span>
                    {!cat.listed && (
                      <span className="badge badge-draft" style={{ marginLeft: 8, fontSize: 10 }}
                        title="In use by equipment, but not on your managed list">
                        in use
                      </span>
                    )}
                  </td>
                  <td>
                    {cat.equipmentCount}
                    {cat.equipmentCount !== cat.activeEquipmentCount && (
                      <span className="text-muted" style={{ fontSize: 11, marginLeft: 4 }}>
                        ({cat.equipmentCount - cat.activeEquipmentCount} archived)
                      </span>
                    )}
                  </td>
                  <td>
                    {/* gap-8 to match the app's other button rows. */}
                    <div className="flex gap-8">
                      <button className="btn btn-sm btn-secondary" onClick={() => startEdit(cat)}>Rename</button>
                      <button className="btn btn-sm btn-danger" onClick={() => startDelete(cat)}>Delete</button>
                    </div>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
