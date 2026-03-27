import React, { useState } from 'react';

interface AssemblyPickerModalProps {
  assemblies: any[];
  onAdd: (assemblyId: number, qty: number) => void;
  onClose: () => void;
}

export function AssemblyPickerModal({ assemblies, onAdd, onClose }: AssemblyPickerModalProps) {
  const [selectedAssemblyId, setSelectedAssemblyId] = useState<number | null>(null);
  const [assemblyQty, setAssemblyQty] = useState(1);

  const handleAdd = () => {
    if (selectedAssemblyId && assemblyQty > 0) {
      onAdd(selectedAssemblyId, assemblyQty);
    }
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()} tabIndex={-1} style={{ width: 500, outline: 'none' }}>
        <h3>Add Assembly</h3>
        <div className="form-group">
          <label>Assembly</label>
          <select
            className="form-control"
            value={selectedAssemblyId || ''}
            onChange={(e) => setSelectedAssemblyId(Number(e.target.value) || null)}
            autoFocus
          >
            <option value="">-- Select an assembly --</option>
            {assemblies.map((a: any) => (
              <option key={a.id} value={a.id}>
                {a.name} ({a.items.length} material{a.items.length !== 1 ? 's' : ''} · ${a.items.reduce((s: number, i: any) => s + i.material_unit_cost * i.quantity, 0).toFixed(2)}/{a.unit})
              </option>
            ))}
          </select>
        </div>

        {selectedAssemblyId && (() => {
          const asm = assemblies.find((a: any) => a.id === selectedAssemblyId);
          if (!asm) return null;
          const unitCost = asm.items.reduce((s: number, i: any) => s + i.material_unit_cost * i.quantity, 0);
          return (
            <>
              <div className="form-group">
                <label>Quantity ({asm.unit})</label>
                <input type="number" className="form-control" value={assemblyQty}
                  onChange={(e) => setAssemblyQty(parseFloat(e.target.value) || 0)}
                  min="0" step="any" style={{ width: 120 }} />
              </div>
              <div style={{ background: 'var(--bg-tertiary)', borderRadius: 6, padding: 12, marginBottom: 16 }}>
                <div style={{ fontSize: 12, color: 'var(--text-secondary)', textTransform: 'uppercase', marginBottom: 8, fontWeight: 600 }}>
                  Materials to add ({asm.items.length})
                </div>
                {asm.items.map((item: any) => (
                  <div key={item.id} style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13, padding: '3px 0' }}>
                    <span>{item.material_name}</span>
                    <span className="text-muted">
                      {(item.quantity * assemblyQty).toFixed(2)} {item.material_unit} · ${(item.material_unit_cost * item.quantity * assemblyQty).toFixed(2)}
                    </span>
                  </div>
                ))}
                <div style={{ borderTop: '1px solid var(--border)', marginTop: 8, paddingTop: 8, display: 'flex', justifyContent: 'space-between', fontWeight: 600 }}>
                  <span>Total</span>
                  <span style={{ color: 'var(--accent)' }}>${(unitCost * assemblyQty).toFixed(2)}</span>
                </div>
              </div>
            </>
          );
        })()}

        <div className="modal-actions">
          <button className="btn btn-secondary" onClick={onClose}>Cancel</button>
          <button className="btn btn-primary" onClick={handleAdd}
            disabled={!selectedAssemblyId || assemblyQty <= 0}>Add to Bid</button>
        </div>
      </div>
    </div>
  );
}
