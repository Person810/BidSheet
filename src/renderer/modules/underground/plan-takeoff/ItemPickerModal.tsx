import React, { useState, useEffect, useMemo } from 'react';
import {
  FuzzyAutocomplete,
  materialsToAutocomplete,
  type AutocompleteItem,
} from '../../../components/FuzzyAutocomplete';
import type { PlacingMaterial } from './useItemManager';
import type { TakeoffItem } from './types';

interface ItemPickerModalProps {
  onSelect: (material: PlacingMaterial) => void;
  onCancel: () => void;
  items: TakeoffItem[];
}

export default function ItemPickerModal({ onSelect, onCancel, items }: ItemPickerModalProps) {
  const [allMaterials, setAllMaterials] = useState<AutocompleteItem[]>([]);

  useEffect(() => {
    window.api.getMaterials().then((mats: any[]) => {
      setAllMaterials(materialsToAutocomplete(mats));
    }).catch(console.error);
  }, []);

  // Recent materials: last 5 unique from existing items
  const recentMaterials = useMemo(() => {
    const seen = new Set<number>();
    const recent: PlacingMaterial[] = [];
    for (let i = items.length - 1; i >= 0 && recent.length < 5; i--) {
      const item = items[i];
      if (item.materialId && !seen.has(item.materialId)) {
        seen.add(item.materialId);
        recent.push({ id: item.materialId, name: item.materialName });
      }
    }
    return recent;
  }, [items]);

  const handleSelect = (acItem: AutocompleteItem | null) => {
    if (!acItem) return;
    onSelect({ id: Number(acItem.id), name: acItem.label });
  };

  return (
    <div className="modal-overlay" onClick={onCancel}>
      <div className="modal" style={{ maxWidth: 420, minHeight: 200 }}
        onClick={(e) => e.stopPropagation()}>
        <h3 style={{ margin: '0 0 12px 0', fontSize: 15 }}>Place Item</h3>

        <FuzzyAutocomplete
          items={allMaterials}
          value={null}
          onSelect={handleSelect}
          placeholder="Search materials..."
        />

        {recentMaterials.length > 0 && (
          <div style={{ marginTop: 16 }}>
            <div style={{ fontSize: 11, color: 'var(--text-secondary)', marginBottom: 6 }}>
              Recent
            </div>
            {recentMaterials.map((m) => (
              <button
                key={m.id}
                className="btn btn-secondary btn-sm"
                style={{ display: 'block', width: '100%', textAlign: 'left',
                  marginBottom: 4, fontSize: 12 }}
                onClick={() => onSelect(m)}
              >
                {m.name}
              </button>
            ))}
          </div>
        )}

        <div style={{ marginTop: 16, textAlign: 'right' }}>
          <button className="btn btn-secondary btn-sm" onClick={onCancel}>Cancel</button>
        </div>
      </div>
    </div>
  );
}
