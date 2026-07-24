import React, { useState, useEffect } from 'react';

interface Props {
  open: boolean;
  title?: string;
  onPick: (categoryId: number) => void;
  onClose: () => void;
  excludeCategoryId?: number;
}

export function CategoryPickerModal({ open, title, onPick, onClose, excludeCategoryId }: Props) {
  const [categories, setCategories] = useState<{ id: number; name: string }[]>([]);
  const [selected, setSelected] = useState<number | null>(null);

  useEffect(() => {
    if (open) {
      window.api.getMaterialCategories().then(cats => {
        const filtered = excludeCategoryId
          ? cats.filter((c: any) => c.id !== excludeCategoryId)
          : cats;
        setCategories(filtered);
        setSelected(null);
      });
    }
  }, [open, excludeCategoryId]);

  if (!open) return null;

  return (
    <div className="modal-overlay" onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="modal" style={{ maxWidth: 400 }}>
        <div className="modal-header">
          <h3>{title || 'Select Category'}</h3>
          <button className="btn-icon" onClick={onClose}>×</button>
        </div>
        <div className="modal-body">
          <select className="form-control" value={selected ?? ''}
            onChange={(e) => setSelected(Number(e.target.value) || null)}>
            <option value="">Choose a category...</option>
            {categories.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        </div>
        <div className="modal-footer">
          <button className="btn btn-primary" disabled={!selected}
            onClick={() => selected && onPick(selected)}>Confirm</button>
          <button className="btn btn-secondary" onClick={onClose}>Cancel</button>
        </div>
      </div>
    </div>
  );
}
