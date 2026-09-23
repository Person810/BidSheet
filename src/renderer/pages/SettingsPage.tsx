import React, { useState, useEffect, useCallback } from 'react';
import { useSearchParams } from 'react-router-dom';
import { ConfirmDialog } from '../components/ConfirmDialog';
import { UpdateBanner } from '../components/UpdateBanner';
import { useToastStore } from '../stores/toast-store';
import { useWalkthroughStore } from '../stores/walkthrough-store';
import { CloudSyncCard } from '../components/CloudSyncCard';
import { nextJobNumber } from '../../shared/jobNumbering';
import { useUnitsStore } from '../stores/units-store';
import { useLocaleStore } from '../stores/locale-store';
import { parseUnitSystem, type UnitSystem } from '../../shared/unitSystem';
import { getAllTools, currentToolSelection, normalizeToolSelection } from '../modules';
import {
  MAX_CUSTOM_TRADES,
  MAX_CUSTOM_TRADE_NAME,
  addCustomTrades,
  parseCustomTrades,
  removeCustomTrade,
  serializeCustomTrades,
} from '../../shared/customTrades';
import { HDDRatesModal } from '../components/HDDRatesModal';

// ---- Model -----------------------------------------------------------------

interface SettingsForm {
  companyName: string;
  companyAddress: string;
  companyPhone: string;
  companyEmail: string;
  companyTagline: string;
  companyLogo: string;
  defaultOverheadPercent: number;
  defaultProfitPercent: number;
  defaultTaxPercent: number;
  defaultBondPercent: number;
  tradeTypes: string;
  autoLockOnClose: boolean;
  localOnlyMode: boolean;
  jobNumberAuto: boolean;
  jobNumberFormat: string;
  jobNumberStart: number;
  unitSystem: UnitSystem;
  /** null = follow the locale default; 0/1 = explicit override. */
  freightTaxable: number | null;
  /** null = follow the trades; a string (even '') = the user's own picks. */
  enabledTools: string | null;
  /** Free-text trades with no sample catalog, named at setup. */
  customTrades: string[];
  hddRatesJson: string;
}

const EMPTY_FORM: SettingsForm = {
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
  unitSystem: 'imperial',
  freightTaxable: null,
  enabledTools: null,
  customTrades: [],
  hddRatesJson: '',
};

function fromDb(s: any): SettingsForm {
  return {
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
    freightTaxable: s.freight_taxable === 0 || s.freight_taxable === 1 ? s.freight_taxable : null,
    enabledTools: s.enabled_tools ?? null,
    customTrades: parseCustomTrades(s.custom_trades),
    hddRatesJson: s.hdd_rates_json || '',
  };
}

function toPayload(s: SettingsForm) {
  return {
    companyName: s.companyName,
    companyAddress: s.companyAddress || null,
    companyPhone: s.companyPhone || null,
    companyEmail: s.companyEmail || null,
    companyTagline: s.companyTagline || null,
    companyLogo: s.companyLogo || null,
    defaultOverheadPercent: s.defaultOverheadPercent,
    defaultProfitPercent: s.defaultProfitPercent,
    defaultTaxPercent: s.defaultTaxPercent,
    defaultBondPercent: s.defaultBondPercent,
    autoLockOnClose: s.autoLockOnClose,
    localOnlyMode: s.localOnlyMode,
    jobNumberAuto: s.jobNumberAuto,
    jobNumberFormat: s.jobNumberFormat,
    jobNumberStart: s.jobNumberStart,
    unitSystem: s.unitSystem,
    freightTaxable: s.freightTaxable,
    enabledTools: s.enabledTools,
    customTrades: serializeCustomTrades(s.customTrades),
    hddRatesJson: s.hddRatesJson || null,
  };
}

type SectionId = 'company' | 'estimating' | 'numbering' | 'trades' | 'cloud' | 'backup' | 'help';

const SECTIONS: { id: SectionId; label: string; fields: (keyof SettingsForm)[] }[] = [
  { id: 'company', label: 'Company', fields: ['companyName', 'companyAddress', 'companyPhone', 'companyEmail', 'companyTagline', 'companyLogo'] },
  { id: 'estimating', label: 'Estimating', fields: ['defaultOverheadPercent', 'defaultProfitPercent', 'defaultBondPercent', 'defaultTaxPercent', 'freightTaxable', 'unitSystem', 'autoLockOnClose'] },
  { id: 'numbering', label: 'Job Numbering', fields: ['jobNumberAuto', 'jobNumberFormat', 'jobNumberStart'] },
  { id: 'trades', label: 'Trades & Tools', fields: ['enabledTools', 'customTrades'] },
  { id: 'cloud', label: 'Cloud Sync', fields: ['localOnlyMode'] },
  { id: 'backup', label: 'Backup & Restore', fields: [] },
  { id: 'help', label: 'Help', fields: [] },
];

const TRADE_LABELS: Record<string, string> = {
  water_sewer: 'Water & Sewer',
  storm_drain: 'Storm Drain',
  gas: 'Gas',
  electrical: 'Electrical / Conduit',
  telecom: 'Telecommunications / Fiber',
  concrete: 'Concrete',
};

const LAST_SECTION_KEY = 'bidsheet.settings.section';

function isSectionId(v: string | null): v is SectionId {
  return !!v && SECTIONS.some((s) => s.id === v);
}

/** The message of a thrown value, or the fallback when it has none. */
function messageOf(err: unknown, fallback: string): string {
  return err instanceof Error && err.message ? err.message : fallback;
}

// ---- Layout pieces ---------------------------------------------------------

/** One setting: what it is and what it does on the left, the control on the right. */
function Row({ label, help, htmlFor, children }: {
  label: string;
  help?: React.ReactNode;
  htmlFor?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="settings-row">
      <div className="settings-row-text">
        {htmlFor
          ? <label className="settings-row-label" htmlFor={htmlFor}>{label}</label>
          : <div className="settings-row-label">{label}</div>}
        {help && <div className="settings-row-help">{help}</div>}
      </div>
      <div className="settings-row-control">{children}</div>
    </div>
  );
}

function Group({ title, description, children }: {
  title?: string;
  description?: string;
  children: React.ReactNode;
}) {
  return (
    <section className="settings-group">
      {title && <h4 className="settings-group-title">{title}</h4>}
      {description && <p className="settings-group-desc">{description}</p>}
      <div className="settings-group-body">{children}</div>
    </section>
  );
}

function PercentInput({ id, value, step, onChange }: {
  id: string; value: number; step: number; onChange: (v: number) => void;
}) {
  return (
    <span className="settings-suffix-input">
      <input id={id} type="number" className="form-control" value={value} step={step}
        onChange={(e) => onChange(parseFloat(e.target.value) || 0)} />
      <span className="text-muted">%</span>
    </span>
  );
}

// ---- Page ------------------------------------------------------------------

export function SettingsPage() {
  const addToast = useToastStore((s) => s.addToast);
  const { profile } = useLocaleStore();
  const openWalkthrough = useWalkthroughStore((s) => s.open);
  const setUnitSystem = useUnitsStore((s) => s.setUnitSystem);
  const [searchParams] = useSearchParams();

  const [section, setSection] = useState<SectionId>(() => {
    const fromUrl = searchParams.get('section');
    if (isSectionId(fromUrl)) return fromUrl;
    try {
      const stored = localStorage.getItem(LAST_SECTION_KEY);
      if (isSectionId(stored)) return stored;
    } catch { /* storage unavailable: start at the top */ }
    return 'company';
  });
  const goTo = (id: SectionId) => {
    setSection(id);
    try { localStorage.setItem(LAST_SECTION_KEY, id); } catch { /* not important */ }
  };

  // `saved` is what's in the database; `draft` is what's on screen. Fields
  // edit the draft, and the save bar appears whenever the two differ.
  // Buttons that act immediately (Add Trade, backups, HDD rates) write
  // through to both.
  const [saved, setSaved] = useState<SettingsForm>(EMPTY_FORM);
  const [draft, setDraft] = useState<SettingsForm>(EMPTY_FORM);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const [confirmState, setConfirmState] = useState<{ msg: string; onYes: () => void; yesLabel: string; variant?: 'danger' | 'neutral' } | null>(null);
  const [showHddRatesModal, setShowHddRatesModal] = useState(false);
  const [tradeToAdd, setTradeToAdd] = useState('');
  const [addTradePrices, setAddTradePrices] = useState(true);
  const [addingTrade, setAddingTrade] = useState(false);
  const [seedStatus, setSeedStatus] = useState<{ active: number; hidden: number } | null>(null);
  const [seedBusy, setSeedBusy] = useState(false);
  const [restorePrices, setRestorePrices] = useState(true);
  const [customTradeInput, setCustomTradeInput] = useState('');
  const [backupBusy, setBackupBusy] = useState(false);
  const [backupResult, setBackupResult] = useState<{ ok: boolean; text: string } | null>(null);

  const refreshSeedStatus = () =>
    window.api.seedsStatus().then(setSeedStatus).catch(() => {});

  useEffect(() => {
    window.api.getSettings().then((s) => {
      if (s) {
        const loaded = fromDb(s);
        setSaved(loaded);
        setDraft(loaded);
      }
    }).finally(() => setLoading(false));
    void refreshSeedStatus();
  }, []);

  const dirtyFields = (Object.keys(draft) as (keyof SettingsForm)[])
    .filter((k) => JSON.stringify(draft[k]) !== JSON.stringify(saved[k]));
  const isDirty = dirtyFields.length > 0;
  const sectionDirty = (id: SectionId) =>
    SECTIONS.find((s) => s.id === id)!.fields.some((f) => dirtyFields.includes(f));

  const update = <K extends keyof SettingsForm>(field: K, value: SettingsForm[K]) =>
    setDraft((prev) => ({ ...prev, [field]: value }));

  /** Persist `next` as the saved state, keeping any other unsaved edits on screen. */
  const persist = async (next: SettingsForm) => {
    await window.api.saveSettings(toPayload(next));
    setSaved(next);
  };

  const handleSave = useCallback(async () => {
    if (!isDirty || saving) return;
    setSaving(true);
    try {
      const localOnlyChanged = draft.localOnlyMode !== saved.localOnlyMode;
      await persist(draft);
      // Calculators read the store, so the change applies without a restart.
      setUnitSystem(draft.unitSystem);
      // Same listener the Add Trade path uses: repaints the sidebar's tools.
      window.dispatchEvent(new Event('bidsheet:trades-changed'));
      addToast(localOnlyChanged
        ? 'Settings saved. Restart BidSheet to finish turning cloud sync ' + (draft.localOnlyMode ? 'off.' : 'on.')
        : 'Settings saved.', 'success');
    } catch (err) {
      addToast(messageOf(err, 'Couldn\'t save your settings. Try again.'), 'error');
    } finally {
      setSaving(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- persist/setters are stable enough; draft and saved drive it
  }, [draft, saved, isDirty, saving]);

  // Ctrl+S / Cmd+S saves, like any desktop form.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') {
        e.preventDefault();
        void handleSave();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [handleSave]);

  // Closing the window with unsaved settings asks first.
  useEffect(() => {
    if (!isDirty) return;
    const onBeforeUnload = (e: BeforeUnloadEvent) => { e.preventDefault(); e.returnValue = ''; };
    window.addEventListener('beforeunload', onBeforeUnload);
    return () => window.removeEventListener('beforeunload', onBeforeUnload);
  }, [isDirty]);

  // ---- Company ----
  const handleChooseLogo = async () => {
    try {
      const result = await window.api.chooseLogoFile();
      if (result?.dataUrl) update('companyLogo', result.dataUrl);
    } catch (err) {
      addToast(messageOf(err, 'Couldn\'t load that image.'), 'error');
    }
  };

  // ---- Tools ----
  // Which tools appear in the sidebar, independent of which trade catalogs
  // were loaded. Ticking anything switches out of "follow my trades" and
  // pins the selection.
  const allTools = getAllTools();
  const picked = new Set(currentToolSelection(draft.tradeTypes, draft.enabledTools));
  const followingTrades = draft.enabledTools == null;

  const toggleTool = (toolId: string) => {
    const next = new Set(picked);
    if (next.has(toolId)) next.delete(toolId);
    else next.add(toolId);
    // Registry order, not click order, so the saved string is stable. Landing
    // back on exactly what the trades give normalizes to null: ticking a box
    // and unticking it leaves you where you started, not quietly pinned.
    const ordered = allTools.map((entry) => entry.tool.id).filter((id) => next.has(id));
    setDraft((prev) => ({ ...prev, enabledTools: normalizeToolSelection(prev.tradeTypes, ordered.join(',')) }));
  };

  // ---- Trades ----
  const activeTrades = draft.tradeTypes.split(',').map((t) => t.trim()).filter(Boolean);
  const availableTrades = Object.keys(TRADE_LABELS).filter((t) => !activeTrades.includes(t));

  const addCustomTrade = () => {
    update('customTrades', addCustomTrades(draft.customTrades, customTradeInput));
    setCustomTradeInput('');
  };

  const handleAddTrade = async () => {
    if (!tradeToAdd || addingTrade) return;
    setAddingTrade(true);
    try {
      const result = await window.api.addTrade(tradeToAdd, addTradePrices);
      // Written straight to the database, so both copies move together.
      setSaved((prev) => ({ ...prev, tradeTypes: result.tradeTypes }));
      setDraft((prev) => ({ ...prev, tradeTypes: result.tradeTypes }));
      setTradeToAdd('');
      window.dispatchEvent(new Event('bidsheet:trades-changed'));
      void refreshSeedStatus();
      addToast(`Added ${TRADE_LABELS[tradeToAdd] || tradeToAdd} to your catalog.`, 'success');
    } catch (err) {
      addToast(messageOf(err, 'Couldn\'t add that trade.'), 'error');
    } finally {
      setAddingTrade(false);
    }
  };

  const handleHideSeeds = () => {
    setConfirmState({
      msg: 'Hide all sample items? Your own items and existing bids aren\'t affected, and you can restore them here any time.',
      yesLabel: 'Hide Samples',
      variant: 'neutral',
      onYes: async () => {
        setConfirmState(null);
        setSeedBusy(true);
        try {
          const r = await window.api.seedsRemove();
          const roles = r.deletedRoles > 0
            ? ` and removed ${r.deletedRoles} unused sample labor role${r.deletedRoles === 1 ? '' : 's'}`
            : '';
          addToast(`Hid ${r.hidden} sample item${r.hidden === 1 ? '' : 's'}${roles}.`, 'success');
          void refreshSeedStatus();
        } catch (err) {
          addToast(messageOf(err, 'Couldn\'t hide the sample items.'), 'error');
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
      addToast(`Restored ${r.restored} hidden sample item${r.restored === 1 ? '' : 's'} and re-created ${r.readded}.`, 'success');
      void refreshSeedStatus();
    } catch (err) {
      addToast(messageOf(err, 'Couldn\'t restore the sample items.'), 'error');
    } finally {
      setSeedBusy(false);
    }
  };

  // ---- HDD rates (saved immediately, on top of the last saved settings) ----
  const saveHddRates = async (json: string) => {
    await persist({ ...saved, hddRatesJson: json });
    setDraft((prev) => ({ ...prev, hddRatesJson: json }));
  };

  const handleResetHdd = () => {
    setConfirmState({
      msg: 'Reset HDD rates to the defaults? Your custom rates will be lost.',
      yesLabel: 'Reset Rates',
      onYes: async () => {
        setConfirmState(null);
        try {
          await saveHddRates('');
          addToast('HDD rates reset to the defaults.', 'success');
        } catch (err) {
          addToast(messageOf(err, 'Couldn\'t reset the HDD rates.'), 'error');
        }
      },
    });
  };

  // ---- Backup ----
  const handleExportBackup = async () => {
    setBackupBusy(true);
    setBackupResult(null);
    try {
      const result = await window.api.exportDatabase();
      if (result.canceled) return;
      setBackupResult(result.success
        ? { ok: true, text: `Backup saved${result.path ? ` to ${result.path}` : ''}.` }
        : { ok: false, text: `Backup failed: ${result.error}` });
    } catch (err) {
      setBackupResult({ ok: false, text: `Backup failed: ${messageOf(err, 'unknown error')}` });
    } finally {
      setBackupBusy(false);
    }
  };

  const handleRestoreBackup = () => {
    setConfirmState({
      msg: 'Restore from a backup file? Everything in BidSheet now (catalog, jobs, bids and settings) will be replaced, and BidSheet will restart.',
      yesLabel: 'Choose Backup File',
      onYes: async () => {
        setConfirmState(null);
        const result = await window.api.restoreDatabase();
        if (result.canceled) return;
        // On success the app restarts, so only failure lands here.
        if (!result.success) setBackupResult({ ok: false, text: `Restore failed: ${result.error}` });
      },
    });
  };

  if (loading) return <p className="text-muted">Loading settings…</p>;

  const jobNumberPreview = nextJobNumber(draft.jobNumberFormat, [], draft.jobNumberStart);

  return (
    <div className="settings-page">
      <div className="page-header">
        <h2>Settings</h2>
      </div>

      <div className="settings-layout">
        <nav className="settings-nav" aria-label="Settings sections">
          {SECTIONS.map((s) => (
            <button key={s.id} type="button"
              className={`settings-nav-item ${section === s.id ? 'active' : ''}`}
              aria-current={section === s.id ? 'page' : undefined}
              onClick={() => goTo(s.id)}>
              {s.label}
              {sectionDirty(s.id) && <span className="settings-nav-dot" title="Unsaved changes" aria-label="unsaved changes" />}
            </button>
          ))}
        </nav>

        <div className="settings-content">
          {section === 'company' && (
            <>
              <h3 className="settings-title">Company</h3>
              <p className="settings-subtitle">Shown on your proposals.</p>
              <Group>
                <Row label="Company name" htmlFor="set-company-name">
                  <input id="set-company-name" type="text" className="form-control settings-input-wide"
                    value={draft.companyName} onChange={(e) => update('companyName', e.target.value)} />
                </Row>
                <Row label="Address" htmlFor="set-company-address">
                  <input id="set-company-address" type="text" className="form-control settings-input-wide"
                    value={draft.companyAddress} onChange={(e) => update('companyAddress', e.target.value)}
                    placeholder="e.g. 123 Main St, Dallas, TX 75001" />
                </Row>
                <Row label="Phone" htmlFor="set-company-phone">
                  <input id="set-company-phone" type="tel" className="form-control settings-input-wide"
                    value={draft.companyPhone} onChange={(e) => update('companyPhone', e.target.value)} />
                </Row>
                <Row label="Email" htmlFor="set-company-email">
                  <input id="set-company-email" type="email" className="form-control settings-input-wide"
                    value={draft.companyEmail} onChange={(e) => update('companyEmail', e.target.value)} />
                </Row>
                <Row label="Tagline" help="A short line under your name, e.g. Underground Utility Contractor." htmlFor="set-company-tagline">
                  <input id="set-company-tagline" type="text" className="form-control settings-input-wide"
                    value={draft.companyTagline} onChange={(e) => update('companyTagline', e.target.value)} />
                </Row>
                <Row label="Logo" help="Replaces your company name at the top of proposals.">
                  {draft.companyLogo
                    ? <img src={draft.companyLogo} alt="Company logo" className="settings-logo" />
                    : <span className="text-muted">No logo</span>}
                  <button className="btn btn-secondary" onClick={handleChooseLogo}>
                    {draft.companyLogo ? 'Change…' : 'Choose…'}
                  </button>
                  {draft.companyLogo && (
                    <button className="btn btn-secondary" onClick={() => update('companyLogo', '')}>Remove</button>
                  )}
                </Row>
              </Group>
            </>
          )}

          {section === 'estimating' && (
            <>
              <h3 className="settings-title">Estimating</h3>
              <p className="settings-subtitle">Defaults for new jobs. Each job can change them.</p>
              <Group title="Default markups">
                <Row label="Overhead" htmlFor="set-overhead">
                  <PercentInput id="set-overhead" value={draft.defaultOverheadPercent} step={0.5}
                    onChange={(v) => update('defaultOverheadPercent', v)} />
                </Row>
                <Row label="Profit" htmlFor="set-profit">
                  <PercentInput id="set-profit" value={draft.defaultProfitPercent} step={0.5}
                    onChange={(v) => update('defaultProfitPercent', v)} />
                </Row>
                <Row label="Bond" htmlFor="set-bond">
                  <PercentInput id="set-bond" value={draft.defaultBondPercent} step={0.5}
                    onChange={(v) => update('defaultBondPercent', v)} />
                </Row>
                <Row label={profile.taxLabel} htmlFor="set-tax">
                  <PercentInput id="set-tax" value={draft.defaultTaxPercent} step={0.25}
                    onChange={(v) => update('defaultTaxPercent', v)} />
                </Row>
                <Row label={`${profile.taxLabel} on freight`} help="Whether the tax rate applies to a job's freight." htmlFor="set-freight-tax">
                  <select id="set-freight-tax" className="form-control"
                    value={draft.freightTaxable === null ? 'default' : String(draft.freightTaxable)}
                    onChange={(e) => update('freightTaxable', e.target.value === 'default' ? null : Number(e.target.value))}>
                    <option value="default">Default ({profile.freightTaxable ? 'taxed' : 'not taxed'})</option>
                    <option value="1">Taxed</option>
                    <option value="0">Not taxed</option>
                  </select>
                </Row>
              </Group>
              <Group title="Units">
                <Row label="Measurement units" help="Used by the calculators and takeoff. Switching doesn't change any saved numbers." htmlFor="set-units">
                  <select id="set-units" className="form-control" value={draft.unitSystem}
                    onChange={(e) => update('unitSystem', parseUnitSystem(e.target.value))}>
                    <option value="imperial">Imperial (ft, in, CY)</option>
                    <option value="metric">Metric (m, mm, m³)</option>
                  </select>
                </Row>
              </Group>
              <Group title="Bids">
                <Row label="Lock bids when marked Won or Lost" help="A locked bid asks before any edit." htmlFor="set-autolock">
                  <input id="set-autolock" type="checkbox" className="settings-checkbox"
                    checked={draft.autoLockOnClose} onChange={(e) => update('autoLockOnClose', e.target.checked)} />
                </Row>
                <Row label="HDD rates"
                  help={draft.hddRatesJson.trim() ? 'Using your custom rates.' : 'Using the default rates.'}>
                  {draft.hddRatesJson.trim() !== '' && (
                    <button className="btn btn-secondary" onClick={handleResetHdd}>Reset to Defaults</button>
                  )}
                  <button className="btn btn-secondary" onClick={() => setShowHddRatesModal(true)}>Edit Rates…</button>
                </Row>
              </Group>
            </>
          )}

          {section === 'numbering' && (
            <>
              <h3 className="settings-title">Job Numbering</h3>
              <p className="settings-subtitle">The number suggested for each new job. You can always type over it.</p>
              <Group>
                <Row label="Suggest job numbers" htmlFor="set-jobnum-auto">
                  <input id="set-jobnum-auto" type="checkbox" className="settings-checkbox"
                    checked={draft.jobNumberAuto} onChange={(e) => update('jobNumberAuto', e.target.checked)} />
                </Row>
                {draft.jobNumberAuto && (
                  <>
                    <Row label="Format" htmlFor="set-jobnum-format"
                      help={<>N = counter digits · YYYY or YY = year · MM = month.<br />Formats with a year or month restart the count each period.</>}>
                      <input id="set-jobnum-format" type="text" className="form-control settings-input-mid"
                        value={draft.jobNumberFormat} onChange={(e) => update('jobNumberFormat', e.target.value)}
                        placeholder="YYYY-NNN" />
                    </Row>
                    <Row label="Start at" htmlFor="set-jobnum-start">
                      <input id="set-jobnum-start" type="number" className="form-control settings-input-narrow"
                        min={1} step={1} value={draft.jobNumberStart}
                        onChange={(e) => update('jobNumberStart', Math.max(1, parseInt(e.target.value, 10) || 1))} />
                    </Row>
                    <Row label="Next job number">
                      {jobNumberPreview
                        ? <span className="settings-preview">{jobNumberPreview}</span>
                        : <span className="text-warning">Add at least one N to the format.</span>}
                    </Row>
                  </>
                )}
              </Group>
            </>
          )}

          {section === 'trades' && (
            <>
              <h3 className="settings-title">Trades &amp; Tools</h3>
              <p className="settings-subtitle">The work you do, and the tools in the sidebar.</p>
              <Group title="Trades">
                <Row label="Your trades" help="These decide which sample items are in your catalog.">
                  {activeTrades.length > 0
                    ? activeTrades.map((t) => <span key={t} className="settings-chip">{TRADE_LABELS[t] || t}</span>)
                    : <span className="text-muted">None</span>}
                </Row>
                {availableTrades.length > 0 && (
                  <Row label="Add a trade" htmlFor="set-add-trade"
                    help="Adds that trade's sample materials, labor, equipment and assemblies. Your own items and prices aren't touched.">
                    <select id="set-add-trade" className="form-control" value={tradeToAdd}
                      onChange={(e) => setTradeToAdd(e.target.value)} disabled={addingTrade}>
                      <option value="">Choose a trade…</option>
                      {availableTrades.map((t) => <option key={t} value={t}>{TRADE_LABELS[t] || t}</option>)}
                    </select>
                    <label className="settings-inline-check">
                      <input type="checkbox" checked={addTradePrices}
                        onChange={(e) => setAddTradePrices(e.target.checked)} disabled={addingTrade} />
                      Ballpark prices
                    </label>
                    <button className="btn btn-secondary" onClick={handleAddTrade} disabled={!tradeToAdd || addingTrade}>
                      {addingTrade ? 'Adding…' : 'Add Trade'}
                    </button>
                  </Row>
                )}
                <Row label="Other trades" help="Work BidSheet doesn't have a sample catalog for." htmlFor="set-custom-trade">
                  <div className="settings-stack">
                    {draft.customTrades.length > 0 && (
                      <div className="settings-chips">
                        {draft.customTrades.map((name) => (
                          <span key={name.toLowerCase()} className="settings-chip">
                            {name}
                            <button type="button" className="settings-chip-remove" title={`Remove ${name}`}
                              aria-label={`Remove ${name}`}
                              onClick={() => update('customTrades', removeCustomTrade(draft.customTrades, name))}>
                              ×
                            </button>
                          </span>
                        ))}
                      </div>
                    )}
                    {draft.customTrades.length >= MAX_CUSTOM_TRADES ? (
                      <span className="text-muted">That&apos;s the limit of {MAX_CUSTOM_TRADES}.</span>
                    ) : (
                      <div className="flex gap-8">
                        <input id="set-custom-trade" type="text" className="form-control settings-input-mid"
                          placeholder="e.g. Directional Drilling" maxLength={MAX_CUSTOM_TRADE_NAME}
                          value={customTradeInput} onChange={(e) => setCustomTradeInput(e.target.value)}
                          onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); addCustomTrade(); } }} />
                        <button type="button" className="btn btn-secondary" onClick={addCustomTrade}
                          disabled={!customTradeInput.trim()}>Add</button>
                      </div>
                    )}
                  </div>
                </Row>
              </Group>

              <Group title="Sidebar tools"
                description={followingTrades ? 'Showing the tools that come with your trades.' : 'You picked these yourself.'}>
                {allTools.map(({ tool, moduleName }) => (
                  <Row key={tool.id} label={tool.name} help={moduleName} htmlFor={`set-tool-${tool.id}`}>
                    <input id={`set-tool-${tool.id}`} type="checkbox" className="settings-checkbox"
                      checked={picked.has(tool.id)} onChange={() => toggleTool(tool.id)} />
                  </Row>
                ))}
                {!followingTrades && (
                  <div className="settings-group-footer">
                    <button className="btn btn-ghost" onClick={() => update('enabledTools', null)}>
                      Reset to my trades&apos; tools
                    </button>
                  </div>
                )}
              </Group>

              <Group title="Sample catalog">
                <Row label="Hide sample items"
                  help={seedStatus
                    ? `${seedStatus.active} sample item${seedStatus.active === 1 ? '' : 's'} in your catalog${seedStatus.hidden > 0 ? `, ${seedStatus.hidden} hidden` : ''}. Your own items and existing bids aren't affected.`
                    : 'Your own items and existing bids aren\'t affected.'}>
                  <button className="btn btn-secondary" onClick={handleHideSeeds}
                    disabled={seedBusy || !seedStatus || seedStatus.active === 0}>Hide Samples…</button>
                </Row>
                <Row label="Restore sample items" help="Brings hidden items back as you left them, and re-creates any that were deleted.">
                  <label className="settings-inline-check">
                    <input type="checkbox" checked={restorePrices}
                      onChange={(e) => setRestorePrices(e.target.checked)} disabled={seedBusy} />
                    Ballpark prices
                  </label>
                  <button className="btn btn-secondary" onClick={handleRestoreSeeds} disabled={seedBusy}>Restore Samples</button>
                </Row>
              </Group>
            </>
          )}

          {section === 'cloud' && (
            <>
              <h3 className="settings-title">Cloud Sync <span className="settings-badge">Beta</span></h3>
              <p className="settings-subtitle">Optional. BidSheet works fully offline without it.</p>
              {!saved.localOnlyMode && <CloudSyncCard />}
              <Group title="Privacy">
                <Row label="Local-only mode" htmlFor="set-local-only"
                  help="Turns cloud sync off completely. BidSheet won't go online except to check for updates. Takes effect after you restart.">
                  <input id="set-local-only" type="checkbox" className="settings-checkbox"
                    checked={draft.localOnlyMode} onChange={(e) => update('localOnlyMode', e.target.checked)} />
                </Row>
              </Group>
            </>
          )}

          {section === 'backup' && (
            <>
              <h3 className="settings-title">Backup &amp; Restore</h3>
              <p className="settings-subtitle">
                Your data lives on this computer. Keep a backup somewhere else.
              </p>
              <Group>
                <Row label="Back up to a file" help="Saves your catalog, jobs, bids and settings in one file.">
                  <button className="btn btn-secondary" onClick={handleExportBackup} disabled={backupBusy}>
                    {backupBusy ? 'Backing up…' : 'Back Up…'}
                  </button>
                </Row>
                <Row label="Restore from a file" help="Replaces everything in BidSheet with a backup, then restarts.">
                  <button className="btn btn-secondary" onClick={handleRestoreBackup} disabled={backupBusy}>Restore…</button>
                </Row>
                {backupResult && (
                  <div className={`settings-group-footer ${backupResult.ok ? 'text-success' : 'text-danger'}`} role="status">
                    {backupResult.text}
                  </div>
                )}
              </Group>
              {!saved.localOnlyMode && (
                <p className="settings-note">
                  Automatic cloud backups are in{' '}
                  <button className="btn-link" onClick={() => goTo('cloud')}>Cloud Sync</button>.
                </p>
              )}
            </>
          )}

          {section === 'help' && (
            <>
              <h3 className="settings-title">Help</h3>
              <p className="settings-subtitle">Updates, the tour, and diagnostics.</p>
              <Group>
                <Row label="App updates" help="BidSheet checks for updates each time it starts.">
                  <UpdateBanner />
                </Row>
                <Row label="Guided tour" help="A two-minute walk through the main screens.">
                  <button className="btn btn-secondary" onClick={openWalkthrough}>Replay Tour</button>
                </Row>
                <Row label="Keyboard shortcuts" help="Or press ? anywhere.">
                  <button className="btn btn-secondary"
                    onClick={() => window.dispatchEvent(new Event('bidsheet:toggle-shortcuts'))}>
                    Show Shortcuts
                  </button>
                </Row>
                <Row label="Log files" help="Helpful when you report a problem.">
                  <button className="btn btn-secondary"
                    onClick={() => window.api.openLogDir().catch((err: unknown) => addToast(messageOf(err, 'Couldn\'t open the log folder.'), 'error'))}>
                    Open Log Folder
                  </button>
                </Row>
              </Group>
            </>
          )}
        </div>
      </div>

      {isDirty && (
        <div className="settings-savebar" role="region" aria-label="Unsaved changes">
          <span>You have unsaved changes.</span>
          <button className="btn btn-secondary" onClick={() => setDraft(saved)} disabled={saving}>Discard</button>
          <button className="btn btn-primary" onClick={() => void handleSave()} disabled={saving}>
            {saving ? 'Saving…' : 'Save Changes'}
          </button>
        </div>
      )}

      {showHddRatesModal && (
        <HDDRatesModal
          initialRatesJson={draft.hddRatesJson}
          onSave={async (json) => {
            try {
              await saveHddRates(json);
              setShowHddRatesModal(false);
              addToast('HDD rates saved.', 'success');
            } catch (err) {
              addToast(messageOf(err, 'Couldn\'t save the HDD rates.'), 'error');
            }
          }}
          onClose={() => setShowHddRatesModal(false)}
        />
      )}

      {confirmState && (
        <ConfirmDialog message={confirmState.msg} onYes={confirmState.onYes}
          onNo={() => setConfirmState(null)} yesLabel={confirmState.yesLabel} variant={confirmState.variant} />
      )}
    </div>
  );
}
