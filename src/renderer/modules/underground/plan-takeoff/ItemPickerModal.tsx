import React, { useState, useEffect, useMemo } from 'react';
import {
  FuzzyAutocomplete,
  materialsToAutocomplete,
  type AutocompleteItem,
} from '../../../components/FuzzyAutocomplete';
import { parsePipeSizeFromName } from '../trenchCalc';
import type { TakeoffItem } from './types';

interface ItemPickerModalProps {
  onSelect: (material: { id: number; name: string }) => void;
  onCancel: () => void;
  items: TakeoffItem[];
  contextPipeSizeIn?: number;
}

export default function ItemPickerModal({ onSelect, onCancel, items, contextPipeSizeIn }: ItemPickerModalProps) {
  const [allMaterials, setAllMaterials] = useState<AutocompleteItem[]>([]);
  const [suggestedMaterials, setSuggestedMaterials] = useState<{ id: number; name: string; detail: string }[]>([]);

  // Load full catalog for the search field
  useEffect(() => {
    window.api.getMaterials().then((mats: any[]) => {
      setAllMaterials(materialsToAutocomplete(mats));
    }).catch(console.error);
  }, []);

  // Load context-aware suggestions from Fittings + Valves categories
  useEffect(() => {
    if (!contextPipeSizeIn) { setSuggestedMaterials([]); return; }

    async function loadSuggestions() {
      try {
        const [fittings, valves] = await Promise.all([
          window.api.getMaterialsByCategoryName('Fittings'),
          window.api.getMaterialsByCategoryName('Valves'),
        ]);
        const all = [...fittings, ...valves];
        const matching = all
          .filter((m: any) => parsePipeSizeFromName(m.name) === contextPipeSizeIn)
          .map((m: any) => ({
            id: m.id,
            name: m.name,
            detail: `$${Number(m.default_unit_cost).toFixed(2)}/${m.unit}`,
          }));
        setSuggestedMaterials(matching);
      } catch (err) {
        console.error('Failed to load fitting suggestions:', err);
      }
    }
    loadSuggestions();
  }, [contextPipeSizeIn]);

  // Recent materials: last 5 unique from existing items
  const recentMaterials = useMemo(() => {
    const seen = new Set<number>();
    const recent: { id: number; name: string }[] = [];
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
      <div className="modal" style={{ maxWidth: 480, minHeight: 400, maxHeight: '80vh', display: 'flex', flexDirection: 'column' }}
        onClick={(e) => e.stopPropagation()}>
        <h3 style={{ margin: '0 0 4px 0', fontSize: 15, flexShrink: 0 }}>Add Fitting</h3>
        {contextPipeSizeIn != null && (
          <div style={{ fontSize: 11, color: 'var(--text-secondary)', marginBottom: 12 }}>
            on {contextPipeSizeIn}&quot; pipe
          </div>
        )}

        <div style={{ overflowY: 'auto', flex: 1, minHeight: 0 }}>
          {/* Suggested fittings for this pipe size */}
          {suggestedMaterials.length > 0 && (
            <div style={{ marginBottom: 16 }}>
              <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-secondary)', marginBottom: 6, textTransform: 'uppercase', letterSpacing: 0.5 }}>
                Suggested for {contextPipeSizeIn}&quot; pipe
              </div>
              {suggestedMaterials.map((m) => (
                <div
                  key={m.id}
                  onClick={() => onSelect(m)}
                  style={{
                    display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                    padding: '6px 8px', borderRadius: 4, cursor: 'pointer', marginBottom: 2,
                  }}
                  onMouseEnter={(e) => (e.currentTarget.style.background = 'var(--bg-hover, #f5f5f5)')}
                  onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}
                >
                  <span style={{ fontSize: 12 }}>{m.name}</span>
                  <span style={{ fontSize: 11, color: 'var(--text-secondary)' }}>{m.detail}</span>
                </div>
              ))}
            </div>
          )}

          {/* Recent materials */}
          {recentMaterials.length > 0 && (
            <div style={{ marginBottom: 16 }}>
              <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-secondary)', marginBottom: 6, textTransform: 'uppercase', letterSpacing: 0.5 }}>
                Recent
              </div>
              {recentMaterials.map((m) => (
                <div
                  key={m.id}
                  onClick={() => onSelect(m)}
                  style={{
                    padding: '6px 8px', borderRadius: 4, cursor: 'pointer', marginBottom: 2, fontSize: 12,
                  }}
                  onMouseEnter={(e) => (e.currentTarget.style.background = 'var(--bg-hover, #f5f5f5)')}
                  onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}
                >
                  {m.name}
                </div>
              ))}
            </div>
          )}

          {/* Full catalog search */}
          <div>
            <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-secondary)', marginBottom: 6, textTransform: 'uppercase', letterSpacing: 0.5 }}>
              Search all materials
            </div>
            <FuzzyAutocomplete
              items={allMaterials}
              value={null}
              onSelect={handleSelect}
              placeholder="Search materials..."
            />
          </div>
        </div>

        <div style={{ marginTop: 12, textAlign: 'right', flexShrink: 0 }}>
          <button className="btn btn-secondary btn-sm" onClick={onCancel}>Cancel</button>
        </div>
      </div>
    </div>
  );
}
