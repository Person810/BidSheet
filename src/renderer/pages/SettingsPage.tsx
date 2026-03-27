import React, { useState, useEffect } from 'react';

// In-app confirm dialog — same as JobsPage/AssembliesPage
function ConfirmDialog({ message, onYes, onNo, yesLabel = 'Delete' }: {
  message: string; onYes: () => void; onNo: () => void; yesLabel?: string;
}) {
  return (
    <div className="modal-overlay" onClick={onNo} style={{ zIndex: 10000 }}>
      <div className="modal" onClick={(e) => e.stopPropagation()} style={{ width: 400 }}>
        <h3>Confirm</h3>
        <p style={{ margin: '16px 0 24px', lineHeight: 1.5 }}>{message}</p>
        <div className="modal-actions">
          <button className="btn btn-secondary" onClick={onNo} autoFocus>Cancel</button>
          <button className="btn btn-primary" onClick={onYes}
            style={{ background: 'var(--danger, #ef4444)' }}>{yesLabel}</button>
        </div>
      </div>
    </div>
  );
}

export function SettingsPage() {
  const [settings, setSettings] = useState({
    companyName: '',
    companyAddress: '',
    companyPhone: '',
    companyEmail: '',
    defaultOverheadPercent: 10,
    defaultProfitPercent: 10,
    defaultTaxPercent: 0,
    defaultBondPercent: 0,
    tradeTypes: '',
  });
  const [saved, setSaved] = useState(false);
  const [loading, setLoading] = useState(true);
  const [backupStatus, setBackupStatus] = useState<string | null>(null);
  const [confirmState, setConfirmState] = useState<{ msg: string; onYes: () => void } | null>(null);

  useEffect(() => {
    window.api.getSettings().then((s: any) => {
      if (s) {
        setSettings({
          companyName: s.company_name || '',
          companyAddress: s.company_address || '',
          companyPhone: s.company_phone || '',
          companyEmail: s.company_email || '',
          defaultOverheadPercent: s.default_overhead_percent,
          defaultProfitPercent: s.default_profit_percent,
          defaultTaxPercent: s.default_tax_percent || 0,
          defaultBondPercent: s.default_bond_percent || 0,
          tradeTypes: s.trade_types || '',
        });
      }
      setLoading(false);
    });
  }, []);

  const handleSave = async () => {
    await window.api.saveSettings({
      companyName: settings.companyName,
      companyAddress: settings.companyAddress || null,
      companyPhone: settings.companyPhone || null,
      companyEmail: settings.companyEmail || null,
      companyLogo: null,
      defaultOverheadPercent: settings.defaultOverheadPercent,
      defaultProfitPercent: settings.defaultProfitPercent,
      defaultTaxPercent: settings.defaultTaxPercent,
      defaultBondPercent: settings.defaultBondPercent,
    });
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  };

  const update = (field: string, value: any) => {
    setSettings({ ...settings, [field]: value });
    setSaved(false);
  };

  const tradeLabels: Record<string, string> = {
    water_sewer: 'Water & Sewer',
    storm_drain: 'Storm Drain',
    gas: 'Gas',
    electrical: 'Electrical / Conduit',
    telecom: 'Telecommunications / Fiber',
  };

  if (loading) return <p className="text-muted">Loading settings...</p>;

  return (
    <div>
      <div className="page-header">
        <h2>Settings</h2>
        <div className="flex gap-8 items-center">
          {saved && <span className="text-success" style={{ fontSize: 13 }}>Saved!</span>}
          <button className="btn btn-primary" onClick={handleSave}>
            Save Settings
          </button>
        </div>
      </div>

      <div className="card mb-24">
        <h3 style={{ marginBottom: 16 }}>Company Information</h3>
        <div className="form-group">
          <label>Company Name</label>
          <input
            type="text"
            className="form-control"
            value={settings.companyName}
            onChange={(e) => update('companyName', e.target.value)}
            placeholder="Your Company Name"
          />
        </div>
        <div className="form-group">
          <label>Address</label>
          <input
            type="text"
            className="form-control"
            value={settings.companyAddress}
            onChange={(e) => update('companyAddress', e.target.value)}
            placeholder="123 Main St, City, TX 75001"
          />
        </div>
        <div className="form-row">
          <div className="form-group">
            <label>Phone</label>
            <input
              type="text"
              className="form-control"
              value={settings.companyPhone}
              onChange={(e) => update('companyPhone', e.target.value)}
              placeholder="(555) 555-5555"
            />
          </div>
          <div className="form-group">
            <label>Email</label>
            <input
              type="text"
              className="form-control"
              value={settings.companyEmail}
              onChange={(e) => update('companyEmail', e.target.value)}
              placeholder="bids@company.com"
            />
          </div>
        </div>
      </div>

      <div className="card mb-24">
        <h3 style={{ marginBottom: 16 }}>Default Markup Percentages</h3>
        <p className="text-muted mb-16">
          These defaults apply to new jobs. You can override them per job.
        </p>
        <div className="form-row">
          <div className="form-group">
            <label>Overhead %</label>
            <input
              type="number"
              className="form-control"
              value={settings.defaultOverheadPercent}
              onChange={(e) => update('defaultOverheadPercent', parseFloat(e.target.value) || 0)}
              step={0.5}
            />
          </div>
          <div className="form-group">
            <label>Profit %</label>
            <input
              type="number"
              className="form-control"
              value={settings.defaultProfitPercent}
              onChange={(e) => update('defaultProfitPercent', parseFloat(e.target.value) || 0)}
              step={0.5}
            />
          </div>
          <div className="form-group">
            <label>Bond %</label>
            <input
              type="number"
              className="form-control"
              value={settings.defaultBondPercent}
              onChange={(e) => update('defaultBondPercent', parseFloat(e.target.value) || 0)}
              step={0.5}
            />
          </div>
          <div className="form-group">
            <label>Sales Tax %</label>
            <input
              type="number"
              className="form-control"
              value={settings.defaultTaxPercent}
              onChange={(e) => update('defaultTaxPercent', parseFloat(e.target.value) || 0)}
              step={0.25}
            />
          </div>
        </div>
      </div>

      <div className="card mb-24">
        <h3 style={{ marginBottom: 16 }}>Data Management</h3>
        <p className="text-muted mb-16">
          Export your entire database to a backup file, or restore from a previous backup.
        </p>
        <div className="flex gap-8 items-center">
          <button className="btn btn-secondary" onClick={async () => {
            setBackupStatus(null);
            const result = await window.api.exportDatabase();
            if (result.canceled) return;
            if (result.success) {
              setBackupStatus('Backup saved successfully.');
            } else {
              setBackupStatus('Export failed: ' + result.error);
            }
            setTimeout(() => setBackupStatus(null), 4000);
          }}>Export Backup</button>
          <button className="btn btn-secondary" onClick={() => {
            setConfirmState({
              msg: 'Restoring from a backup will replace ALL current data (materials, jobs, bids, settings). The app will restart. Are you sure?',
              onYes: async () => {
                setConfirmState(null);
                const result = await window.api.restoreDatabase();
                if (result.canceled) return;
                if (!result.success) {
                  setBackupStatus('Restore failed: ' + result.error);
                  setTimeout(() => setBackupStatus(null), 4000);
                }
                // If success, app restarts — we won't reach here
              },
            });
          }}>Restore from Backup</button>
          {backupStatus && (
            <span style={{ fontSize: 13, color: backupStatus.includes('failed') ? 'var(--danger, #ef4444)' : 'var(--success, #22c55e)' }}>
              {backupStatus}
            </span>
          )}
        </div>
      </div>

      {confirmState && (
        <ConfirmDialog message={confirmState.msg} onYes={confirmState.onYes}
          onNo={() => setConfirmState(null)} yesLabel="Restore" />
      )}

      <div className="card">
        <h3 style={{ marginBottom: 16 }}>Trade Configuration</h3>
        <p className="text-muted mb-16">
          Trade types selected during initial setup. These determined which seed materials,
          labor roles, and equipment were loaded into your catalog.
        </p>
        <div className="flex gap-8" style={{ flexWrap: 'wrap' }}>
          {settings.tradeTypes
            ? settings.tradeTypes.split(',').map((t) => (
                <span key={t} className="badge badge-submitted" style={{ fontSize: 12, padding: '4px 12px' }}>
                  {tradeLabels[t.trim()] || t.trim()}
                </span>
              ))
            : <span className="text-muted">No trades configured</span>}
        </div>
      </div>
    </div>
  );
}
