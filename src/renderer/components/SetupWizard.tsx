import React, { useEffect, useState } from 'react';
import { CloudAccountSetupModal } from './CloudAccountSetupModal';
import { CloudSignInModal } from './CloudSignInModal';
import { useCloudStore, initCloudStore } from '../stores/cloud-store';
import { getAllTools, currentToolSelection, normalizeToolSelection } from '../modules';
import {
  MAX_CUSTOM_TRADES,
  MAX_CUSTOM_TRADE_NAME,
  addCustomTrades,
  removeCustomTrade,
  serializeCustomTrades,
} from '@shared/customTrades';

interface SetupWizardProps {
  onComplete: () => void;
}

const TRADES = [
  { key: 'water_sewer', label: 'Water & Sewer', desc: 'Water main, sanitary sewer, service connections' },
  { key: 'storm_drain', label: 'Storm Drain', desc: 'Storm sewer, drainage structures, stormwater' },
  { key: 'gas', label: 'Gas', desc: 'Natural gas main and service installation' },
  { key: 'electrical', label: 'Electrical / Conduit', desc: 'Underground conduit, duct bank, pull boxes' },
  { key: 'telecom', label: 'Telecommunications / Fiber', desc: 'Fiber optic, copper, telecom underground plant' },
  { key: 'concrete', label: 'Concrete', desc: 'Slabs, flatwork, footings, walls, formwork, and finishing' },
];

export function SetupWizard({ onComplete }: SetupWizardProps) {
  const [step, setStep] = useState(0);
  const [companyName, setCompanyName] = useState('');
  const [selectedTrades, setSelectedTrades] = useState<string[]>([]);
  // Trades we ship no catalog for, typed by the user. Purely a label — what
  // makes them usable is the tool picker below.
  const [customTrades, setCustomTrades] = useState<string[]>([]);
  const [customInput, setCustomInput] = useState('');
  const [showCustom, setShowCustom] = useState(false);
  // null = "follow my trades": the tool list keeps tracking the trade
  // selection above it. Ticking anything pins the list instead.
  const [enabledTools, setEnabledTools] = useState<string | null>(null);
  // Sample catalog: seed with ballpark prices, seed at $0, or skip seeding
  const [catalogChoice, setCatalogChoice] = useState<'prices' | 'zero' | 'empty' | null>(null);
  const [cloudChoice, setCloudChoice] = useState<'yes' | 'later' | 'never' | null>(null);
  const [loading, setLoading] = useState(false);
  const [showCloudSetup, setShowCloudSetup] = useState(false);
  const [showCloudSignIn, setShowCloudSignIn] = useState(false);

  // Cloud handlers are already registered on a fresh install (local-only mode
  // only switches on once setup finishes with "Never"), so the account can be
  // created or signed into right here in the wizard.
  const cloudAuth = useCloudStore((s) => s.auth);
  const cloudConnected = cloudAuth?.aal === 'aal2';
  useEffect(() => {
    initCloudStore();
  }, []);

  const toggleTrade = (key: string) => {
    setSelectedTrades((prev) =>
      prev.includes(key) ? prev.filter((t) => t !== key) : [...prev, key]
    );
  };

  const addCustom = () => {
    setCustomTrades((prev) => addCustomTrades(prev, customInput));
    setCustomInput('');
  };

  // A custom trade seeds nothing, so with only custom trades chosen all three
  // catalog options would load the same empty catalog. Say so instead of
  // offering a choice that isn't one.
  const noSeedCatalog = selectedTrades.length === 0;
  const hasAnyTrade = selectedTrades.length > 0 || customTrades.length > 0;

  // The tools a trade brings are its own selling point, but they're also the
  // only reason some people add a trade at all — you shouldn't have to take
  // concrete materials into your catalog to get the concrete calculator. So
  // the list below starts as whatever the chosen trades give and can be
  // changed independently of them.
  const tradeTypes = selectedTrades.join(',');
  const allTools = getAllTools();
  const pickedTools = new Set(currentToolSelection(tradeTypes, enabledTools));
  const followingTrades = enabledTools === null;

  const toggleTool = (toolId: string) => {
    const next = new Set(pickedTools);
    if (next.has(toolId)) next.delete(toolId);
    else next.add(toolId);
    // Registry order, not click order, so the stored string is stable.
    const ordered = allTools.map((entry) => entry.tool.id).filter((id) => next.has(id));
    setEnabledTools(ordered.join(','));
  };

  const handleFinish = async () => {
    setLoading(true);
    try {
      await window.api.runSetup(
        selectedTrades,
        catalogChoice === 'prices',
        companyName,
        cloudChoice === 'never',
        !noSeedCatalog && catalogChoice !== 'empty',
        {
          enabledTools: normalizeToolSelection(tradeTypes, enabledTools),
          customTrades: serializeCustomTrades(customTrades),
        }
      );
      onComplete();
    } catch (err) {
      console.error('Setup failed:', err);
      setLoading(false);
    }
  };

  return (
    <div className="setup-overlay">
      <div className="setup-wizard">
        <div className="setup-progress">
          {[0, 1, 2, 3].map((i) => (
            <div key={i} className={`setup-dot ${step >= i ? 'active' : ''}`} />
          ))}
        </div>

        {step === 0 && (
          <div className="setup-step">
            <h2>Welcome to BidSheet</h2>
            <p className="setup-desc">
              Let's get you set up. First, what's your company name?
            </p>
            <div className="form-group" style={{ maxWidth: 400 }}>
              <label>Company Name</label>
              <input
                type="text"
                className="form-control"
                placeholder="e.g. Smith Underground LLC"
                value={companyName}
                onChange={(e) => setCompanyName(e.target.value)}
                autoFocus
              />
            </div>
            <button
              className="btn btn-primary"
              onClick={() => setStep(1)}
              disabled={!companyName.trim()}
            >
              Next
            </button>
          </div>
        )}

        {step === 1 && (
          <div className="setup-step">
            <h2>What type of work do you do?</h2>
            <p className="setup-desc">
              Select all that apply. This determines which sample materials, labor
              roles, and equipment are available for your catalog, and which tools
              you start with.
            </p>
            <div className="trade-grid">
              {TRADES.map((trade) => (
                <div
                  key={trade.key}
                  className={`trade-card ${selectedTrades.includes(trade.key) ? 'selected' : ''}`}
                  onClick={() => toggleTrade(trade.key)}
                >
                  <div className="trade-check">
                    {selectedTrades.includes(trade.key) ? '✓' : ''}
                  </div>
                  <div>
                    <div className="trade-label">{trade.label}</div>
                    <div className="trade-desc">{trade.desc}</div>
                  </div>
                </div>
              ))}
              <div
                className={`trade-card ${customTrades.length > 0 ? 'selected' : ''}`}
                onClick={() => setShowCustom(true)}
              >
                <div className="trade-check">{customTrades.length > 0 ? '✓' : ''}</div>
                <div>
                  <div className="trade-label">Custom</div>
                  <div className="trade-desc">
                    Something else — name it yourself and pick the tools you use
                  </div>
                </div>
              </div>
            </div>

            {(showCustom || customTrades.length > 0) && (
              <div style={{ marginTop: 16, textAlign: 'left', maxWidth: 520 }}>
                <div className="form-group" style={{ marginBottom: 8 }}>
                  <label>Your trade</label>
                  <div className="flex gap-8">
                    <input
                      type="text"
                      className="form-control"
                      placeholder="e.g. Directional Drilling"
                      maxLength={MAX_CUSTOM_TRADE_NAME}
                      value={customInput}
                      onChange={(e) => setCustomInput(e.target.value)}
                      onKeyDown={(e) => {
                        // Enter here means "add this one", not "submit the wizard".
                        if (e.key === 'Enter') {
                          e.preventDefault();
                          addCustom();
                        }
                      }}
                      disabled={customTrades.length >= MAX_CUSTOM_TRADES}
                      autoFocus
                    />
                    <button
                      className="btn btn-secondary"
                      type="button"
                      onClick={addCustom}
                      disabled={!customInput.trim() || customTrades.length >= MAX_CUSTOM_TRADES}
                    >
                      Add
                    </button>
                  </div>
                </div>
                {customTrades.length > 0 && (
                  <div className="flex gap-8" style={{ flexWrap: 'wrap', marginBottom: 8 }}>
                    {customTrades.map((name) => (
                      <span
                        key={name.toLowerCase()}
                        className="badge badge-submitted"
                        style={{ fontSize: 12, padding: '4px 8px 4px 12px' }}
                      >
                        {name}
                        <button
                          className="btn btn-ghost btn-sm"
                          type="button"
                          title={`Remove ${name}`}
                          style={{ padding: '0 4px', fontSize: 12 }}
                          onClick={() => setCustomTrades((prev) => removeCustomTrade(prev, name))}
                        >
                          ×
                        </button>
                      </span>
                    ))}
                  </div>
                )}
                <p className="text-muted" style={{ fontSize: 12, margin: 0 }}>
                  {customTrades.length >= MAX_CUSTOM_TRADES
                    ? `That's the ${MAX_CUSTOM_TRADES}-trade limit. Remove one to add another.`
                    : 'A custom trade is a label — it brings no sample catalog, so pick your tools below and build your own materials list.'}
                </p>
              </div>
            )}

            {hasAnyTrade && (
              <div
                style={{
                  marginTop: 20,
                  paddingTop: 16,
                  borderTop: '1px solid var(--border)',
                  textAlign: 'left',
                  maxWidth: 520,
                }}
              >
                <div style={{ fontWeight: 600, marginBottom: 6 }}>Your tools</div>
                <p className="setup-desc" style={{ marginBottom: 12 }}>
                  {noSeedCatalog
                    ? 'A custom trade brings no tools of its own, so take whichever of these you’ll actually use.'
                    : 'These come with the trades you picked. Take any others you want — tools are just calculators, so adding one leaves your catalog alone.'}
                </p>
                <div style={{ display: 'grid', gap: 10 }}>
                  {allTools.map(({ tool, moduleName }) => (
                    <label
                      key={tool.id}
                      className="flex items-center gap-8"
                      style={{ fontSize: 13 }}
                    >
                      <input
                        type="checkbox"
                        checked={pickedTools.has(tool.id)}
                        onChange={() => toggleTool(tool.id)}
                      />
                      <span>
                        {tool.name}
                        <span className="text-muted" style={{ marginLeft: 8, fontSize: 12 }}>
                          {moduleName}
                        </span>
                      </span>
                    </label>
                  ))}
                </div>
                {!followingTrades && (
                  <p className="text-muted" style={{ fontSize: 12, marginTop: 12, marginBottom: 0 }}>
                    You&apos;re choosing these yourself, so changing the trades above
                    won&apos;t change the list.{' '}
                    <button
                      className="btn btn-ghost btn-sm"
                      type="button"
                      style={{ padding: '0 4px', fontSize: 12 }}
                      onClick={() => setEnabledTools(null)}
                    >
                      Go back to following my trades
                    </button>
                  </p>
                )}
                <p className="text-muted" style={{ fontSize: 12, marginTop: 8, marginBottom: 0 }}>
                  You can change this any time in Settings.
                </p>
              </div>
            )}

            <div className="setup-nav">
              <button className="btn btn-secondary" onClick={() => setStep(0)}>
                Back
              </button>
              <button
                className="btn btn-primary"
                onClick={() => setStep(2)}
                disabled={!hasAnyTrade}
              >
                Next
              </button>
            </div>
          </div>
        )}

        {step === 2 && (
          <div className="setup-step">
            <h2>Starting Catalog</h2>
            {noSeedCatalog ? (
              <>
                <p className="setup-desc">
                  BidSheet ships sample catalogs per trade, and there isn&apos;t one
                  for {customTrades.length > 1 ? 'the trades' : 'the trade'} you
                  named — so you&apos;ll start with an empty catalog and add your own
                  materials, labor roles, and equipment as you bid.
                </p>
                <p className="setup-desc">
                  If you also do one of the listed trades, go back and tick it: its
                  sample catalog is a faster start, and every item can be edited or
                  hidden later.
                </p>
              </>
            ) : (
            <>
            <p className="setup-desc">
              We can load a sample catalog for your trades — materials, labor roles,
              equipment, and assemblies — with or without rough ballpark prices, or
              you can start completely empty. Sample items can be hidden or restored
              anytime from Settings.
            </p>
            <div className="price-options">
              <div
                className={`price-option ${catalogChoice === 'prices' ? 'selected' : ''}`}
                onClick={() => setCatalogChoice('prices')}
              >
                <div className="price-option-title">Sample catalog with ballpark prices</div>
                <div className="price-option-desc">
                  Pre-fill with rough estimates so you have a starting point.
                  These are NOT accurate quotes -- just a reference to help you
                  get started faster.
                </div>
              </div>
              <div
                className={`price-option ${catalogChoice === 'zero' ? 'selected' : ''}`}
                onClick={() => setCatalogChoice('zero')}
              >
                <div className="price-option-title">Sample catalog at $0.00</div>
                <div className="price-option-desc">
                  All sample materials start with no price. You'll enter your own
                  supplier pricing from scratch.
                </div>
              </div>
              <div
                className={`price-option ${catalogChoice === 'empty' ? 'selected' : ''}`}
                onClick={() => setCatalogChoice('empty')}
              >
                <div className="price-option-title">Empty catalog</div>
                <div className="price-option-desc">
                  No sample items at all. You'll build your materials, labor,
                  and equipment catalog yourself.
                </div>
              </div>
            </div>
            </>
            )}
            <div className="setup-nav">
              <button className="btn btn-secondary" onClick={() => setStep(1)}>
                Back
              </button>
              <button
                className="btn btn-primary"
                onClick={() => setStep(3)}
                disabled={!noSeedCatalog && catalogChoice === null}
              >
                Next
              </button>
            </div>
          </div>
        )}

        {step === 3 && (
          <div className="setup-step">
            <h2>Cloud Sync (Beta)</h2>
            <p className="setup-desc">
              BidSheet is fully local. Your bids live on this computer, no account needed.
              Optional cloud sync ($20/mo after a free trial) adds end-to-end-encrypted
              online backup and multi-computer sync — only you hold the key. Think you'll
              ever use it?
            </p>
            <div className="price-options">
              <div
                className={`price-option ${cloudChoice === 'yes' ? 'selected' : ''}`}
                onClick={() => setCloudChoice('yes')}
              >
                <div className="price-option-title">Yes</div>
                <div className="price-option-desc">
                  Set up your account now, or anytime from Settings.
                </div>
              </div>
              <div
                className={`price-option ${cloudChoice === 'later' ? 'selected' : ''}`}
                onClick={() => setCloudChoice('later')}
              >
                <div className="price-option-title">Maybe later</div>
                <div className="price-option-desc">
                  The option stays in Settings if you change your mind.
                </div>
              </div>
              <div
                className={`price-option ${cloudChoice === 'never' ? 'selected' : ''}`}
                onClick={() => setCloudChoice('never')}
              >
                <div className="price-option-title">Never (keep everything local)</div>
                <div className="price-option-desc">
                  Hides cloud sync and never loads any cloud code. The app makes no
                  network connections except checking GitHub for updates. Reversible
                  in Settings.
                </div>
              </div>
            </div>

            {cloudChoice === 'yes' && (
              <div
                style={{
                  marginTop: 16,
                  paddingTop: 16,
                  borderTop: '1px solid var(--border)',
                  maxWidth: 520,
                }}
              >
                {cloudConnected ? (
                  <p style={{ color: 'var(--success, #22c55e)' }}>
                    ✓ Signed in as <strong>{cloudAuth?.email}</strong>. You're all set. Finish
                    up below.
                  </p>
                ) : (
                  <>
                    <p className="setup-desc" style={{ marginBottom: 12 }}>
                      Create your cloud account now to start your free trial, or sign in if you
                      already have one. You can also skip this and set it up later from Settings.
                    </p>
                    <div className="flex gap-8">
                      <button
                        className="btn btn-primary"
                        type="button"
                        onClick={() => setShowCloudSetup(true)}
                      >
                        Create Account
                      </button>
                      <button
                        className="btn btn-secondary"
                        type="button"
                        onClick={() => setShowCloudSignIn(true)}
                      >
                        Sign In
                      </button>
                    </div>
                  </>
                )}
              </div>
            )}

            <div className="setup-nav">
              <button className="btn btn-secondary" onClick={() => setStep(2)}>
                Back
              </button>
              <button
                className="btn btn-primary"
                onClick={handleFinish}
                disabled={cloudChoice === null || loading}
              >
                {loading ? 'Setting up...' : 'Finish Setup'}
              </button>
            </div>
          </div>
        )}
      </div>

      {/* The cloud modals use .modal-overlay (z-index 500), which sits below the
          setup overlay (z-index 1000). Wrapping them in a stacking context above
          the wizard lets them render on top. */}
      {(showCloudSetup || showCloudSignIn) && (
        <div style={{ position: 'relative', zIndex: 1001 }}>
          {showCloudSetup && (
            <CloudAccountSetupModal onClose={() => setShowCloudSetup(false)} />
          )}
          {showCloudSignIn && (
            <CloudSignInModal onClose={() => setShowCloudSignIn(false)} />
          )}
        </div>
      )}
    </div>
  );
}
