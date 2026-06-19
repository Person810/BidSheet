import React, { useState, useEffect, useRef, useCallback } from 'react';
import {
  PdfTemplate,
  PdfSectionId,
  PDF_SECTION_LABELS,
  DEFAULT_PDF_TEMPLATE,
} from '../../../shared/types/pdf';

interface Props {
  jobId: number;
  onClose: () => void;
}

const PREVIEW_WIDTH = 570;
const LETTER_WIDTH = 816;
const SCALE = PREVIEW_WIDTH / LETTER_WIDTH;
const PREVIEW_HEIGHT = Math.round(1056 * SCALE);

export function PdfCustomizerModal({ jobId, onClose }: Props) {
  const [template, setTemplate] = useState<PdfTemplate>({ ...DEFAULT_PDF_TEMPLATE, sectionOrder: [...DEFAULT_PDF_TEMPLATE.sectionOrder] });
  const [previewHtml, setPreviewHtml] = useState('');
  const [loadingPreview, setLoadingPreview] = useState(false);
  const [saving, setSaving] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [dragOverIdx, setDragOverIdx] = useState<number | null>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Load saved template on mount
  useEffect(() => {
    window.api.getPdfTemplate().then((saved) => {
      setTemplate(saved);
    }).catch(() => {});
  }, []);

  // Debounced preview refresh
  const refreshPreview = useCallback((tpl: PdfTemplate) => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(async () => {
      setLoadingPreview(true);
      try {
        const html = await window.api.getPdfHtml(jobId, tpl);
        setPreviewHtml(html);
      } catch {
        // ignore
      } finally {
        setLoadingPreview(false);
      }
    }, 400);
  }, [jobId]);

  useEffect(() => {
    refreshPreview(template);
  }, [template, refreshPreview]);

  const set = <K extends keyof PdfTemplate>(key: K, value: PdfTemplate[K]) => {
    setTemplate((t) => ({ ...t, [key]: value }));
  };

  const resetToDefaults = () => {
    setTemplate({ ...DEFAULT_PDF_TEMPLATE, sectionOrder: [...DEFAULT_PDF_TEMPLATE.sectionOrder] });
  };

  const saveAsDefault = async () => {
    setSaving(true);
    try {
      await window.api.savePdfTemplate(template);
    } finally {
      setSaving(false);
    }
  };

  const handleExport = async () => {
    setExporting(true);
    try {
      await window.api.exportBidPdfWithTemplate(jobId, template);
    } finally {
      setExporting(false);
    }
  };

  // Section drag-and-drop
  const dragSrcIdx = useRef<number | null>(null);

  const onDragStart = (idx: number) => {
    dragSrcIdx.current = idx;
  };

  const onDragOver = (e: React.DragEvent, idx: number) => {
    e.preventDefault();
    setDragOverIdx(idx);
  };

  const onDrop = (idx: number) => {
    const src = dragSrcIdx.current;
    if (src === null || src === idx) { setDragOverIdx(null); return; }
    const next = [...template.sectionOrder];
    const [moved] = next.splice(src, 1);
    next.splice(idx, 0, moved);
    setTemplate((t) => ({ ...t, sectionOrder: next }));
    setDragOverIdx(null);
    dragSrcIdx.current = null;
  };

  const onDragEnd = () => {
    setDragOverIdx(null);
    dragSrcIdx.current = null;
  };

  const SECTION_TOGGLE_KEY: Record<PdfSectionId, keyof PdfTemplate> = {
    breakdown: 'showCostBreakdown',
    alternates: 'showAlternates',
    terms: 'showTerms',
    signature: 'showSignature',
  };

  const toggleSection = (id: PdfSectionId) => {
    const key = SECTION_TOGGLE_KEY[id];
    set(key, !template[key] as any);
  };

  const sectionVisible = (id: PdfSectionId): boolean => {
    return template[SECTION_TOGGLE_KEY[id]] as boolean;
  };

  return (
    <div className="modal-overlay" onClick={onClose} style={{ zIndex: 600 }}>
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          display: 'flex',
          flexDirection: 'column',
          background: 'var(--bg-secondary)',
          border: '1px solid var(--border)',
          borderRadius: 6,
          boxShadow: '0 16px 50px rgba(0,0,0,0.6)',
          width: 1020,
          maxWidth: '98vw',
          maxHeight: '94vh',
          overflow: 'hidden',
        }}
        role="dialog"
        aria-label="Customize Proposal PDF"
      >
        {/* Header */}
        <div style={{
          padding: '10px 18px',
          background: 'var(--bg-tertiary)',
          borderBottom: '1px solid var(--border)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          flexShrink: 0,
        }}>
          <span style={{ fontWeight: 600, fontSize: 12, textTransform: 'uppercase', letterSpacing: '0.05em', color: 'var(--text-primary)' }}>
            Customize Proposal PDF
          </span>
          <button className="btn btn-sm btn-secondary" onClick={onClose}>✕</button>
        </div>

        {/* Body: controls + preview */}
        <div style={{ display: 'flex', flex: 1, overflow: 'hidden', minHeight: 0 }}>
          {/* Left: controls */}
          <div style={{
            width: 400,
            flexShrink: 0,
            borderRight: '1px solid var(--border)',
            overflowY: 'auto',
            padding: '16px 18px',
            display: 'flex',
            flexDirection: 'column',
            gap: 18,
          }}>
            {/* Colors */}
            <section>
              <div style={sectionHeadStyle}>Colors</div>
              <div className="form-row" style={{ gridTemplateColumns: '1fr 1fr' }}>
                <ColorField label="Accent / Highlight" value={template.accentColor} onChange={(v) => set('accentColor', v)} />
                <ColorField label="Header Background" value={template.headerColor} onChange={(v) => set('headerColor', v)} />
              </div>
            </section>

            {/* Content toggles */}
            <section>
              <div style={sectionHeadStyle}>Content</div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                <Toggle label="Show unit prices" checked={template.showUnitPrices} onChange={(v) => set('showUnitPrices', v)} />
                <Toggle label="Show scope of work" checked={template.showScope} onChange={(v) => set('showScope', v)} />
              </div>
            </section>

            {/* Sections */}
            <section>
              <div style={sectionHeadStyle}>Sections</div>
              <div style={{ fontSize: 11, color: 'var(--text-secondary)', marginBottom: 8 }}>
                Drag to reorder • toggle to show/hide
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                {template.sectionOrder.map((id, idx) => (
                  <div
                    key={id}
                    draggable
                    onDragStart={() => onDragStart(idx)}
                    onDragOver={(e) => onDragOver(e, idx)}
                    onDrop={() => onDrop(idx)}
                    onDragEnd={onDragEnd}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: 8,
                      padding: '6px 10px',
                      background: dragOverIdx === idx ? 'var(--accent-subtle, rgba(59,130,246,0.12))' : 'var(--bg-tertiary)',
                      border: `1px solid ${dragOverIdx === idx ? 'var(--accent)' : 'var(--border)'}`,
                      borderRadius: 4,
                      cursor: 'grab',
                      userSelect: 'none',
                      transition: 'border-color 0.1s',
                    }}
                  >
                    <span style={{ color: 'var(--text-muted)', fontSize: 13, lineHeight: 1 }}>⠿</span>
                    <span style={{ flex: 1, fontSize: 12.5, color: 'var(--text-primary)' }}>
                      {PDF_SECTION_LABELS[id]}
                    </span>
                    <label style={{ display: 'flex', alignItems: 'center', gap: 5, cursor: 'pointer', userSelect: 'none' }}
                      onClick={(e) => e.stopPropagation()}>
                      <input
                        type="checkbox"
                        checked={sectionVisible(id)}
                        onChange={() => toggleSection(id)}
                        style={{ accentColor: 'var(--accent)', width: 14, height: 14 }}
                      />
                    </label>
                  </div>
                ))}
              </div>
            </section>

            {/* Terms text */}
            {template.showTerms && (
              <section>
                <div style={sectionHeadStyle}>Terms &amp; Conditions</div>
                <div style={{ fontSize: 11, color: 'var(--text-secondary)', marginBottom: 6 }}>
                  One condition per line
                </div>
                <textarea
                  className="form-control"
                  value={template.termsText}
                  onChange={(e) => set('termsText', e.target.value)}
                  rows={6}
                  style={{ fontFamily: 'inherit', fontSize: 12, resize: 'vertical' }}
                />
              </section>
            )}

            {/* Signature block */}
            {template.showSignature && (
              <section>
                <div style={sectionHeadStyle}>Signature Block</div>
                <div className="form-row" style={{ gridTemplateColumns: '1fr 1fr' }}>
                  <div className="form-group">
                    <label>Contractor label</label>
                    <input
                      className="form-control"
                      value={template.signatorLabel}
                      placeholder="Your company name"
                      onChange={(e) => set('signatorLabel', e.target.value)}
                    />
                  </div>
                  <div className="form-group">
                    <label>Client label</label>
                    <input
                      className="form-control"
                      value={template.clientLabel}
                      onChange={(e) => set('clientLabel', e.target.value)}
                    />
                  </div>
                </div>
              </section>
            )}
          </div>

          {/* Right: preview */}
          <div style={{
            flex: 1,
            background: '#888',
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            overflow: 'auto',
            padding: '16px 0',
            gap: 0,
          }}>
            <div style={{ fontSize: 11, color: '#ddd', marginBottom: 10, letterSpacing: '0.03em', textTransform: 'uppercase' }}>
              {loadingPreview ? 'Updating preview…' : 'Preview'}
            </div>
            <div style={{
              width: PREVIEW_WIDTH,
              height: PREVIEW_HEIGHT,
              flexShrink: 0,
              position: 'relative',
              boxShadow: '0 6px 24px rgba(0,0,0,0.5)',
              overflow: 'hidden',
            }}>
              {previewHtml ? (
                <iframe
                  srcDoc={previewHtml}
                  title="PDF Preview"
                  style={{
                    width: LETTER_WIDTH,
                    height: 1056,
                    border: 'none',
                    transform: `scale(${SCALE})`,
                    transformOrigin: 'top left',
                    pointerEvents: 'none',
                  }}
                  sandbox="allow-same-origin"
                />
              ) : (
                <div style={{
                  width: '100%',
                  height: '100%',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  background: '#fff',
                  color: '#aaa',
                  fontSize: 13,
                }}>
                  Loading preview…
                </div>
              )}
              {loadingPreview && (
                <div style={{
                  position: 'absolute',
                  inset: 0,
                  background: 'rgba(255,255,255,0.35)',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                }} />
              )}
            </div>
            <div style={{ fontSize: 10, color: '#bbb', marginTop: 10 }}>
              First page only — full document exported to PDF
            </div>
          </div>
        </div>

        {/* Footer */}
        <div style={{
          padding: '10px 18px',
          borderTop: '1px solid var(--border)',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          flexShrink: 0,
          background: 'var(--bg-tertiary)',
          gap: 8,
        }}>
          <button className="btn btn-sm btn-secondary" onClick={resetToDefaults}>
            Use Defaults
          </button>
          <div style={{ display: 'flex', gap: 8 }}>
            <button className="btn btn-sm btn-secondary" onClick={onClose}>
              Close
            </button>
            <button className="btn btn-sm btn-secondary" onClick={saveAsDefault} disabled={saving}>
              {saving ? 'Saving…' : 'Save as Default'}
            </button>
            <button className="btn btn-sm btn-primary" onClick={handleExport} disabled={exporting}>
              {exporting ? 'Generating…' : 'Export PDF'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

const sectionHeadStyle: React.CSSProperties = {
  fontSize: 11,
  fontWeight: 600,
  color: 'var(--text-secondary)',
  textTransform: 'uppercase',
  letterSpacing: '0.04em',
  marginBottom: 8,
  paddingBottom: 4,
  borderBottom: '1px solid var(--border)',
};

function ColorField({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) {
  return (
    <div className="form-group">
      <label>{label}</label>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <input
          type="color"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          style={{ width: 36, height: 28, padding: 2, border: '1px solid var(--border)', borderRadius: 3, background: 'var(--bg-tertiary)', cursor: 'pointer' }}
        />
        <input
          className="form-control"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          style={{ flex: 1, fontFamily: 'monospace', fontSize: 12 }}
          maxLength={7}
          placeholder="#000000"
        />
      </div>
    </div>
  );
}

function Toggle({ label, checked, onChange }: { label: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer', userSelect: 'none', fontSize: 12.5 }}>
      <input
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        style={{ accentColor: 'var(--accent)', width: 14, height: 14 }}
      />
      <span style={{ color: 'var(--text-primary)' }}>{label}</span>
    </label>
  );
}
