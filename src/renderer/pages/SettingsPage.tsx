import React, { useState, useEffect } from 'react';
import { ConfirmDialog } from '../components/ConfirmDialog';
import { UpdateBanner } from '../components/UpdateBanner';
import { useToastStore } from '../stores/toast-store';
import { useWalkthroughStore } from '../stores/walkthrough-store';
import { CloudSyncCard } from '../components/CloudSyncCard';
import { nextJobNumber } from '../../shared/jobNumbering';
import { useUnitsStore } from '../stores/units-store';
import { parseUnitSystem, type UnitSystem } from '../../shared/unitSystem';

export function SettingsPage() {
  const addToast = useToastStore((s) => s.addToast);
  const openWalkthrough = useWalkthroughStore((s) => s.open);
  const setUnitSystem = useUnitsStore((s) => s.setUnitSystem);
  const [settings, setSettings] = useState({
    companyName: '',
    companyAddress: '',
    companyPhone: '',
    companyEmail: '',
    companyTagline: '',
    companyLogo: '',
    defaultOverheadPercent: 10,
    defaultProfitPercent: 10,
    defaultTaxPercent: 0,
    defaultBondPercent: 0,
    tradeTypes: '',
    autoLockOnClose: true,
    localOnlyMode: false,
    jobNumberAuto: true,
    jobNumberFormat: 'YYYY-NNN',
    jobNumberStart: 1,
    unitSystem: 'imperial' as UnitSystem,
  });
  const [saved, setSaved] = useState(false);
  const [loading, setLoading] = useState(true);
  const [backupStatus, setBackupStatus] = useState<string | null>(null);
  const [confirmState, setConfirmState] = useState<{ msg: string; onYes: () => void; yesLabel?: string } | null>(null);
  const [tradeToAdd, setTradeToAdd] = useState('');
  const [addTradePrices, setAddTradePrices] = useState(true);
  const [addingTrade, setAddingTrade] = useState(false);
  const [seedStatus, setSeedStatus] = useState<{ active: number; hidden: number } | null>(null);
  const [seedBusy, setSeedBusy] = useState(false);
  const [restorePrices, setRestorePrices] = useState(true);

  useEffect(() => {
    window.api.getSettings().then((s: any) => {
      if (s) {
        setSettings({
          companyName: s.company_name || '',
          companyAddress: s.company_address || '',
          companyPhone: s.company_phone || '',
          companyEmail: s.company_email || '',
          companyTagline: s.company_tagline || '',
          companyLogo: s.company_logo || '',
          defaultOverheadPercent: s.default_overhead_percent,
          defaultProfitPercent: s.default_profit_percent,
          defaultTaxPercent: s.default_tax_percent || 0,
          defaultBondPercent: s.default_bond_percent || 0,
          tradeTypes: s.trade_types || '',
          autoLockOnClose: s.auto_lock_on_close !== 0,
          localOnlyMode: s.local_only_mode === 1,
          jobNumberAuto: s.job_number_auto !== 0,
          jobNumberFormat: s.job_number_format || 'YYYY-NNN',
          jobNumberStart: s.job_number_start || 1,
          unitSystem: parseUnitSystem(s.unit_system),
        });
      }
    }).finally(() => setLoading(false));
    window.api.seedsStatus().then(setSeedStatus).catch(() => {});
  }, []);

  const handleSave = async () => {
    await window.api.saveSettings({
      companyName: settings.companyName,
      companyAddress: settings.companyAddress || null,
      companyPhone: settings.companyPhone || null,
      companyEmail: settings.companyEmail || null,
      companyTagline: settings.companyTagline || null,
      companyLogo: settings.companyLogo || null,
      defaultOverheadPercent: settings.defaultOverheadPercent,
      defaultProfitPercent: settings.defaultProfitPercent,
      defaultTaxPercent: settings.defaultTaxPercent,
      defaultBondPercent: settings.defaultBondPercent,
      autoLockOnClose: settings.autoLockOnClose,
      localOnlyMode: settings.localOnlyMode,
      jobNumberAuto: settings.jobNumberAuto,
      jobNumberFormat: settings.jobNumberFormat,
      jobNumberStart: settings.jobNumberStart,
      unitSystem: settings.unitSystem,
    });
    // Calculators read the store, so the change applies without a restart
    setUnitSystem(settings.unitSystem);
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  };

  const update = (field: string, value: any) => {
    setSettings({ ...settings, [field]: value });
    setSaved(false);
  };

  const handleChooseLogo = async () => {
    try {
      const result = await window.api.chooseLogoFile();
      if (result?.dataUrl) update('companyLogo', result.dataUrl);
    } catch (err: any) {
      addToast(err?.message || 'Could not load that image.', 'error');
    }
  };

  const tradeLabels: Record<string, string> = {
    water_sewer: 'Water & Sewer',
    storm_drain: 'Storm Drain',
    gas: 'Gas',
    electrical: 'Electrical / Conduit',
    telecom: 'Telecommunications / Fiber',
    concrete: 'Concrete',
  };

  const activeTrades = settings.tradeTypes.split(',').map((t) => t.trim()).filter(Boolean);
  const availableTrades = Object.keys(tradeLabels).filter((t) => !activeTrades.includes(t));

  const handleAddTrade = async () => {
    if (!tradeToAdd || addingTrade) return;
    setAddingTrade(true);
    try {
      const result = await window.api.addTrade(tradeToAdd, addTradePrices);
      setSettings((prev) => ({ ...prev, tradeTypes: result.tradeTypes }));
      setTradeToAdd('');
      // Refresh the sidebar so the new trade's gated tools appear immediately.
      window.dispatchEvent(new Event('bidsheet:trades-changed'));
      addToast(`Added ${tradeLabels[tradeToAdd] || tradeToAdd}. Its catalog items were added to your existing catalog.`, 'success');
    } catch (err: any) {
      addToast(err?.message || 'Failed to add trade', 'error');
    } finally {
      setAddingTrade(false);
    }
  };

  const refreshSeedStatus = () =>
    window.api.seedsStatus().then(setSeedStatus).catch(() => {});

  const handleHideSeeds = () => {
    setConfirmState({
      msg: 'Hide all sample items? Your own items and any bids that already use sample items are unaffected, and you can restore them here anytime.',
      yesLabel: 'Hide',
      onYes: async () => {
        setConfirmState(null);
        setSeedBusy(true);
        try {
          const r = await window.api.seedsRemove();
          const roles = r.deletedRoles > 0
            ? ` and removed ${r.deletedRoles} unused sample labor role${r.deletedRoles === 1 ? '' : 's'}`
            : '';
          addToast(`Hid ${r.hidden} sample item${r.hidden === 1 ? '' : 's'}${roles}.`, 'success');
          refreshSeedStatus();
        } catch (err: any) {
          addToast(err?.message || 'Failed to hide sample items', 'error');
        } finally {
          setSeedBusy(false);
        }
      },
    });
  };

  const handleRestoreSeeds = async () => {
    setSeedBusy(true);
    try {
      const r = await window.api.seedsRestore(restorePrices);
      addToast(
        `Restored ${r.restored} hidden sample item${r.restored === 1 ? '' : 's'} and re-created ${r.readded}.`,
        'success'
      );
      refreshSeedStatus();
    } catch (err: any) {
      addToast(err?.message || 'Failed to restore sample items', 'error');
    } finally {
      setSeedBusy(false);
    }
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
        <div className="form-row">
          <div className="form-group" style={{ flex: 1 }}>
            <label>Tagline (shown on PDF exports)</label>
            <input
              type="text"
              className="form-control"
              value={settings.companyTagline}
              onChange={(e) => update('companyTagline', e.target.value)}
              placeholder="e.g. Underground Utility Contractor"
            />
          </div>
        </div>
        <div className="form-group">
          <label>Logo (shown on proposal PDFs in place of the company name)</label>
          <div className="flex gap-8 items-center">
            {settings.companyLogo ? (
              <img src={settings.companyLogo} alt="Company logo"
                style={{ maxHeight: 48, maxWidth: 160, objectFit: 'contain',
                  background: '#fff', borderRadius: 4, padding: 4 }} />
            ) : (
              <span className="text-muted" style={{ fontSize: 12 }}>No logo set</span>
            )}
            <button className="btn btn-sm btn-secondary" onClick={handleChooseLogo}>
              {settings.companyLogo ? 'Change Logo' : 'Choose Logo'}
            </button>
            {settings.companyLogo && (
              <button className="btn btn-sm btn-secondary" onClick={() => update('companyLogo', '')}>
                Remove
              </button>
            )}
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
        <h3 style={{ marginBottom: 16 }}>Measurement Units</h3>
        <div className="form-group" style={{ maxWidth: 320 }}>
          <select
            className="form-control"
            value={settings.unitSystem}
            onChange={(e) => update('unitSystem', parseUnitSystem(e.target.value))}
          >
            <option value="imperial">Imperial — ft, in, CY</option>
            <option value="metric">Metric — m, mm, m³</option>
          </select>
        </div>
        <p className="text-muted" style={{ fontSize: 13, margin: 0 }}>
          Metric changes how the calculators display and accept dimensions — type
          metres, get m³. Your saved data is unaffected and switching back and
          forth never changes any numbers. Catalog items and prices keep the
          units they were entered in.
        </p>
      </div>

      <div className="card mb-24">
        <h3 style={{ marginBottom: 16 }}>Job Numbering</h3>
        <div className="form-group" style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <input
            type="checkbox"
            id="jobNumberAuto"
            checked={settings.jobNumberAuto}
            onChange={(e) => update('jobNumberAuto', e.target.checked)}
            style={{ width: 16, height: 16, cursor: 'pointer' }}
          />
          <label htmlFor="jobNumberAuto" style={{ margin: 0, cursor: 'pointer' }}>
            Suggest the next job number for new jobs
          </label>
        </div>
        {settings.jobNumberAuto && (
          <>
            <p className="text-muted mb-16" style={{ marginTop: 8 }}>
              The suggestion continues from your highest existing number in this format, and the
              field stays editable — type over it any time a job needs a different number.
            </p>
            <div className="form-row">
              <div className="form-group">
                <label>Format</label>
                <input
                  type="text"
                  className="form-control"
                  value={settings.jobNumberFormat}
                  onChange={(e) => update('jobNumberFormat', e.target.value)}
                  placeholder="YYYY-NNN"
                />
                <div className="text-muted" style={{ fontSize: 12, marginTop: 4 }}>
                  N&apos;s become the counter (their count sets the padding); YYYY or YY the
                  current year, MM the month. Date formats restart the count each new
                  year or month.
                </div>
              </div>
              <div className="form-group" style={{ maxWidth: 140 }}>
                <label>Start At</label>
                <input
                  type="number"
                  className="form-control"
                  min={1}
                  step={1}
                  value={settings.jobNumberStart}
                  onChange={(e) => update('jobNumberStart', Math.max(1, parseInt(e.target.value, 10) || 1))}
                />
              </div>
              <div className="form-group" style={{ maxWidth: 180 }}>
                <label>Preview</label>
                <div className="form-control" style={{ background: 'transparent' }}>
                  {nextJobNumber(settings.jobNumberFormat, [], settings.jobNumberStart) ?? (
                    <span className="text-warning">Add at least one N</span>
                  )}
                </div>
              </div>
            </div>
          </>
        )}
      </div>

      <div className="card mb-24">
        <h3 style={{ marginBottom: 16 }}>Bid Behavior</h3>
        <div className="form-group" style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <input
            type="checkbox"
            id="autoLockOnClose"
            checked={settings.autoLockOnClose}
            onChange={(e) => update('autoLockOnClose', e.target.checked)}
            style={{ width: 16, height: 16, cursor: 'pointer' }}
          />
          <label htmlFor="autoLockOnClose" style={{ margin: 0, cursor: 'pointer' }}>
            Lock bids automatically when marked Won or Lost
          </label>
        </div>
      </div>

      {!settings.localOnlyMode && <CloudSyncCard />}

      <div className="card mb-24">
        <h3 style={{ marginBottom: 16 }}>Privacy</h3>
        <div className="form-group" style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 8 }}>
          <input
            type="checkbox"
            id="localOnlyMode"
            checked={settings.localOnlyMode}
            onChange={(e) => update('localOnlyMode', e.target.checked)}
            style={{ width: 16, height: 16, cursor: 'pointer' }}
          />
          <label htmlFor="localOnlyMode" style={{ margin: 0, cursor: 'pointer' }}>
            Local-only mode. I'll never use cloud sync, so hide it.
          </label>
        </div>
        <p className="text-muted" style={{ fontSize: 13, margin: 0 }}>
          Hides the Cloud Sync section and never loads any cloud code: no accounts,
          no servers, no network connections except checking GitHub for app updates.
          Your data lives only on this computer, so keep regular backups (below).
          Uncheck anytime to bring cloud sync back. Takes effect after saving and
          restarting BidSheet.
        </p>
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
          onNo={() => setConfirmState(null)} yesLabel={confirmState.yesLabel ?? 'Restore'} />
      )}

      <div className="card mb-24">
        <h3 style={{ marginBottom: 16 }}>App Updates</h3>
        <p className="text-muted mb-16">
          BidSheet checks for updates automatically on launch. You can also check manually below.
        </p>
        <UpdateBanner />
      </div>

      <div className="card mb-24">
        <h3 style={{ marginBottom: 16 }}>Help</h3>
        <p className="text-muted mb-16">
          New to BidSheet, or want a refresher? Replay the guided tour of the app's
          main sections. Press <kbd>?</kbd> anywhere to see keyboard shortcuts.
        </p>
        <button className="btn btn-secondary" onClick={openWalkthrough}>
          Replay Walkthrough
        </button>
      </div>

      <div className="card">
        <h3 style={{ marginBottom: 16 }}>Trade Configuration</h3>
        <p className="text-muted mb-16">
          Trade types selected during initial setup. These determined which seed materials,
          labor roles, and equipment were loaded into your catalog.
        </p>
        <div className="flex gap-8" style={{ flexWrap: 'wrap' }}>
          {activeTrades.length > 0
            ? activeTrades.map((t) => (
                <span key={t} className="badge badge-submitted" style={{ fontSize: 12, padding: '4px 12px' }}>
                  {tradeLabels[t] || t}
                </span>
              ))
            : <span className="text-muted">No trades configured</span>}
        </div>

        {availableTrades.length > 0 && (
          <div style={{ marginTop: 20, paddingTop: 16, borderTop: '1px solid var(--border)' }}>
            <h4 style={{ margin: '0 0 6px', fontSize: 13, fontWeight: 600 }}>Add a trade</h4>
            <p className="text-muted" style={{ fontSize: 12, marginBottom: 12 }}>
              Loads the trade's seed materials, labor roles, equipment, and assemblies, and
              makes its tools visible. This only adds new items — your existing catalog and any
              prices you've edited are left untouched.
            </p>
            <div className="flex gap-8 items-center" style={{ flexWrap: 'wrap' }}>
              <select
                className="form-control"
                style={{ maxWidth: 260 }}
                value={tradeToAdd}
                onChange={(e) => setTradeToAdd(e.target.value)}
                disabled={addingTrade}
              >
                <option value="">Select a trade…</option>
                {availableTrades.map((t) => (
                  <option key={t} value={t}>{tradeLabels[t] || t}</option>
                ))}
              </select>
              <label className="flex items-center gap-8" style={{ fontSize: 13 }}>
                <input
                  type="checkbox"
                  checked={addTradePrices}
                  onChange={(e) => setAddTradePrices(e.target.checked)}
                  disabled={addingTrade}
                />
                Include ballpark prices
              </label>
              <button
                className="btn btn-primary btn-sm"
                onClick={handleAddTrade}
                disabled={!tradeToAdd || addingTrade}
              >
                {addingTrade ? 'Adding…' : 'Add Trade'}
              </button>
            </div>
          </div>
        )}

        <div style={{ marginTop: 20, paddingTop: 16, borderTop: '1px solid var(--border)' }}>
          <h4 style={{ margin: '0 0 6px', fontSize: 13, fontWeight: 600 }}>Sample catalog</h4>
          <p className="text-muted" style={{ fontSize: 12, marginBottom: 12 }}>
            {seedStatus && (
              <>
                {seedStatus.active} sample item{seedStatus.active === 1 ? '' : 's'} in your catalog
                {seedStatus.hidden > 0 ? `, ${seedStatus.hidden} hidden` : ''}.{' '}
              </>
            )}
            Hiding removes sample items from pickers and lists without touching your own
            items or any bids that use them. Restore brings hidden items back with your
            edits intact and re-creates deleted ones with fresh sample values.
          </p>
          <div className="flex gap-8 items-center" style={{ flexWrap: 'wrap' }}>
            <button
              className="btn btn-secondary btn-sm"
              onClick={handleHideSeeds}
              disabled={seedBusy || !seedStatus || seedStatus.active === 0}
            >
              Hide Sample Items
            </button>
            <button
              className="btn btn-secondary btn-sm"
              onClick={handleRestoreSeeds}
              disabled={seedBusy}
            >
              Restore Sample Items
            </button>
            <label className="flex items-center gap-8" style={{ fontSize: 13 }}>
              <input
                type="checkbox"
                checked={restorePrices}
                onChange={(e) => setRestorePrices(e.target.checked)}
                disabled={seedBusy}
              />
              Ballpark prices on re-created items
            </label>
          </div>
        </div>
      </div>
    </div>
  );
}
