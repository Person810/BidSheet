import React, { useState } from 'react';
import { FuzzyAutocomplete } from '../../../components/FuzzyAutocomplete';
import type { AutocompleteItem } from '../../../components/FuzzyAutocomplete';
import { fromDisplay, toDisplay, unitLabel } from '../../../../shared/unitSystem';
import { useUnitSystem } from '../../../stores/units-store';
import type { TakeoffVertex, TakeoffNode } from './types';
import { dismissOnEscOnly } from '../../../components/modalDismiss';

const STRUCTURE_TYPES: AutocompleteItem[] = [
  { id: 'Manhole', label: 'Manhole' },
  { id: 'Cleanout', label: 'Cleanout' },
  { id: 'Tie-In', label: 'Tie-In' },
  { id: 'End of Line', label: 'End of Line' },
  { id: 'Bend', label: 'Bend' },
  { id: 'Tee', label: 'Tee' },
  { id: 'Wye', label: 'Wye' },
  { id: 'Other', label: 'Other' },
];

interface EditVertexDialogProps {
  vertex: TakeoffVertex;
  vertexIndex: number;
  runLabel: string;
  onSave: (data: { invertElev: number | null; rimElev: number | null; structureType: string | null; label?: string }) => void;
  onClose: () => void;
  /** When editing a node-linked vertex, pass the node for label editing */
  node?: TakeoffNode | null;
  connectedRunCount?: number;
}

export function EditVertexDialog({ vertex, vertexIndex, runLabel, onSave, onClose, node, connectedRunCount }: EditVertexDialogProps) {
  const system = useUnitSystem();
  // Elevation state holds what the user sees/types (ft or m); stored
  // elevations are canonical feet, converted at open and save.
  const [invertElev, setInvertElev] = useState(
    vertex.invertElev != null ? String(toDisplay(vertex.invertElev, 'ft', system)) : ''
  );
  const [rimElev, setRimElev] = useState(
    vertex.rimElev != null ? String(toDisplay(vertex.rimElev, 'ft', system)) : ''
  );
  const [structureType, setStructureType] = useState<string | null>(vertex.structureType ?? null);
  const [nodeLabel, setNodeLabel] = useState(node?.label ?? '');

  const invertNum = invertElev === '' ? null : Number(invertElev);
  const rimNum = rimElev === '' ? null : Number(rimElev);
  // Both values are in display units, so their difference already is too
  const depth = invertNum != null && rimNum != null && !isNaN(invertNum) && !isNaN(rimNum)
    ? (rimNum - invertNum).toFixed(2)
    : null;

  const handleSave = () => {
    onSave({
      invertElev: invertElev === '' ? null : fromDisplay(Number(invertElev), 'ft', system),
      rimElev: rimElev === '' ? null : fromDisplay(Number(rimElev), 'ft', system),
      structureType,
      ...(node ? { label: nodeLabel } : {}),
    });
  };

  return (
    <div className="modal-overlay" onClick={dismissOnEscOnly(onClose)} style={{ zIndex: 10000 }}>
      <div className="modal" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 380 }}>
        <h3>Edit Vertex</h3>
        <p style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 16 }}>
          {runLabel} &middot; Vertex {vertexIndex + 1}
        </p>

        {node && (
          <>
            {connectedRunCount != null && connectedRunCount > 1 && (
              <div style={{
                marginBottom: 12, padding: '6px 10px', borderRadius: 4,
                background: 'rgba(59,130,246,0.1)', border: '1px solid rgba(59,130,246,0.25)',
                fontSize: 11, color: 'var(--accent)',
              }}>
                Shared junction &mdash; connected to {connectedRunCount} run{connectedRunCount !== 1 ? 's' : ''}
              </div>
            )}
            <div className="form-group">
              <label style={{ fontSize: 12, color: 'var(--text-secondary)', marginBottom: 4, display: 'block' }}>
                Junction Label
              </label>
              <input
                type="text"
                className="form-control"
                value={nodeLabel}
                onChange={(e) => setNodeLabel(e.target.value)}
                placeholder="e.g. MH-1, CO-3"
              />
            </div>
          </>
        )}

        <div className="form-group">
          <label style={{ fontSize: 12, color: 'var(--text-secondary)', marginBottom: 4, display: 'block' }}>
            Invert Elevation ({unitLabel('ft', system)})
          </label>
          <input
            type="number"
            step="0.01"
            className="form-control"
            value={invertElev}
            onChange={(e) => setInvertElev(e.target.value === '' ? '' : e.target.value)}
            placeholder={system === 'metric' ? 'e.g. 104.35' : 'e.g. 842.35'}
            autoFocus
          />
        </div>

        <div className="form-group">
          <label style={{ fontSize: 12, color: 'var(--text-secondary)', marginBottom: 4, display: 'block' }}>
            Rim / Grade Elevation ({unitLabel('ft', system)})
          </label>
          <input
            type="number"
            step="0.01"
            className="form-control"
            value={rimElev}
            onChange={(e) => setRimElev(e.target.value === '' ? '' : e.target.value)}
            placeholder={system === 'metric' ? 'e.g. 106.70' : 'e.g. 850.00'}
          />
        </div>

        {depth != null && (
          <div style={{
            marginBottom: 16, padding: '8px 12px', borderRadius: 6,
            background: 'var(--bg-primary)', fontSize: 12,
          }}>
            <span style={{ color: 'var(--text-secondary)' }}>Depth: </span>
            <span style={{ fontWeight: 600 }}>{depth} {unitLabel('ft', system)}</span>
          </div>
        )}

        <div className="form-group">
          <label style={{ fontSize: 12, color: 'var(--text-secondary)', marginBottom: 4, display: 'block' }}>
            Structure Type
          </label>
          <FuzzyAutocomplete
            items={STRUCTURE_TYPES}
            value={structureType}
            onSelect={(item: AutocompleteItem | null) => setStructureType(item ? String(item.id) : null)}
            placeholder="Select structure type..."
          />
        </div>

        <div className="modal-actions">
          <button className="btn btn-secondary" onClick={onClose}>Cancel</button>
          <button className="btn btn-primary" onClick={handleSave}>Save</button>
        </div>
      </div>
    </div>
  );
}
