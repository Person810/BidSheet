import React, { useState, useEffect, useCallback } from 'react';
import type { MaterialCategoryManagementRow, SaveMaterialCategoryPayload, DeleteMaterialCategoryPayload } from '../../shared/types/ipc';
import {
  createEmptyCategoryForm,
  createCategoryEditForm,
  validateCategoryForm,
  sortMaterialCategories,
  getReplacementCategories,
  isStaleCategoryUsageError,
  CategoryForm,
} from './materialCategoryForm';

interface Props {
  open: boolean;
  onClose: () => void;
  onChanged: () => void;
}

export function MaterialCategoryManager({ open, onClose, onChanged }: Props) {
  const [categories, setCategories] = useState<MaterialCategoryManagementRow[]>([]);
  const [form, setForm] = useState<CategoryForm>(createEmptyCategoryForm());
  const [editingId, setEditingId] = useState<number | null>(null);
  const [isAdding, setIsAdding] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<MaterialCategoryManagementRow | null>(null);
  const [replacementId, setReplacementId] = useState<number | null>(null);

  const loadCategories = useCallback(async () => {
    const cats = await window.api.getMaterialCategoryManagement();
    setCategories(sortMaterialCategories(cats));
  }, []);

  useEffect(() => {
    if (open) loadCategories();
  }, [open, loadCategories]);

  const resetForm = () => {
    setForm(createEmptyCategoryForm());
    setEditingId(null);
    setIsAdding(false);
    setError(null);
  };

  const startAdd = () => {
    resetForm();
    setIsAdding(true);
  };

  const startEdit = (cat: MaterialCategoryManagementRow) => {
    setForm(createCategoryEditForm(cat));
    setEditingId(cat.id);
    setIsAdding(false);
    setError(null);
  };

  const handleSave = async () => {
    const validationError = validateCategoryForm(form);
    if (validationError) { setError(validationError); return; }
    try {
      const payload: SaveMaterialCategoryPayload = {
        ...(editingId ? { id: editingId } : {}),
        name: form.name.trim(),
        description: form.description.trim() || null,
      };
      await window.api.saveMaterialCategory(payload);
      resetForm();
      await loadCategories();
      onChanged();
    } catch (err: any) {
      setError(err.message || 'Failed to save category.');
    }
  };

  const startDelete = (cat: MaterialCategoryManagementRow) => {
    setDeleteTarget(cat);
    setReplacementId(null);
    setError(null);
  };

  const confirmDelete = async () => {
    if (!deleteTarget) return;
    try {
      const payload: DeleteMaterialCategoryPayload = {
        categoryId: deleteTarget.id,
        replacementCategoryId: deleteTarget.materialCount > 0 ? replacementId : null,
        expectedMaterialCount: deleteTarget.materialCount,
      };
      await window.api.deleteMaterialCategory(payload);
      setDeleteTarget(null);
      await loadCategories();
      onChanged();
    } catch (err: any) {
      if (isStaleCategoryUsageError(err.message)) {
        await loadCategories();
      }
      setError(err.message || 'Failed to delete category.');
    }
  };

  if (!open) return null;

  const replacementOptions = deleteTarget ? getReplacementCategories(categories, deleteTarget.id) : [];

  return (
    <div className="modal-overlay" onClick={(e) => { if (e.target === e.currentTarget) { onClose(); resetForm(); setDeleteTarget(null); } }}>
      <div className="modal" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 600, maxHeight: '80vh', overflow: 'auto' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
          <h3 style={{ margin: 0 }}>Manage Categories</h3>
          <button className="btn btn-sm btn-secondary" onClick={() => { onClose(); resetForm(); setDeleteTarget(null); }}>Close</button>
        </div>

          {error && <div style={{ background: 'var(--danger, #ef4444)', color: '#fff', borderRadius: 6, padding: '8px 12px', marginBottom: 12, fontSize: 13 }}>{error}</div>}

          {/* Delete confirmation */}
          {deleteTarget && (
            <div style={{ background: 'var(--bg-secondary)', borderRadius: 8, padding: 16, marginBottom: 16 }}>
              <p style={{ fontWeight: 600, marginBottom: 8 }}>
                Delete "{deleteTarget.name}"?
              </p>
              {deleteTarget.materialCount > 0 ? (
                <>
                  <p style={{ fontSize: 13, marginBottom: 8 }}>
                    This category has {deleteTarget.materialCount} material{deleteTarget.materialCount !== 1 ? 's' : ''}.
                    Choose a replacement category:
                  </p>
                  <select
                    className="form-control"
                    style={{ marginBottom: 12 }}
                    value={replacementId ?? ''}
                    onChange={(e) => setReplacementId(Number(e.target.value) || null)}
                  >
                    <option value="">Select replacement...</option>
                    {replacementOptions.map(c => (
                      <option key={c.id} value={c.id}>{c.name}</option>
                    ))}
                  </select>
                </>
              ) : (
                <p style={{ fontSize: 13, marginBottom: 12 }}>This category is empty and can be safely removed.</p>
              )}
              <div className="modal-actions">
                <button className="btn btn-secondary" onClick={() => { setDeleteTarget(null); setError(null); }}>Cancel</button>
                <button className="btn btn-primary" style={{ background: 'var(--danger, #ef4444)' }} onClick={confirmDelete}
                  disabled={deleteTarget.materialCount > 0 && !replacementId}>
                  Delete
                </button>
              </div>
            </div>
          )}

          {/* Add/Edit form */}
          {(isAdding || editingId) && !deleteTarget && (
            <div style={{ background: 'var(--bg-secondary)', borderRadius: 8, padding: 16, marginBottom: 16 }}>
              <div style={{ marginBottom: 8 }}>
                <label style={{ fontSize: 12, fontWeight: 600, display: 'block', marginBottom: 4 }}>Name</label>
                <input className="form-control" value={form.name}
                  onChange={(e) => setForm({ ...form, name: e.target.value })}
                  maxLength={100} autoFocus />
              </div>
              <div style={{ marginBottom: 12 }}>
                <label style={{ fontSize: 12, fontWeight: 600, display: 'block', marginBottom: 4 }}>Description</label>
                <input className="form-control" value={form.description}
                  onChange={(e) => setForm({ ...form, description: e.target.value })} />
              </div>
              <div className="modal-actions">
                <button className="btn btn-secondary" onClick={resetForm}>Cancel</button>
                <button className="btn btn-primary" onClick={handleSave}>
                  {editingId ? 'Save' : 'Add'}
                </button>
              </div>
            </div>
          )}

          {/* Category list */}
          {!isAdding && !editingId && !deleteTarget && (
            <button className="btn btn-primary" onClick={startAdd} style={{ marginBottom: 12 }}>+ Add Category</button>
          )}

          <table className="data-table" style={{ fontSize: 13 }}>
            <thead>
              <tr>
                <th>Name</th>
                <th style={{ width: 80 }}>Materials</th>
                <th style={{ width: 120 }}></th>
              </tr>
            </thead>
            <tbody>
              {categories.map(cat => (
                <tr key={cat.id}>
                  <td>
                    <span>{cat.name}</span>
                    {cat.description && <span style={{ color: 'var(--text-muted)', marginLeft: 8, fontSize: 12 }}>{cat.description}</span>}
                  </td>
                  <td>{cat.materialCount}</td>
                  <td>
                    <div className="flex gap-4">
                      <button className="btn btn-sm btn-secondary" onClick={() => startEdit(cat)}>Edit</button>
                      <button className="btn btn-sm btn-danger" onClick={() => startDelete(cat)}>Delete</button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
      </div>
    </div>
  );
}
