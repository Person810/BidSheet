import React, { useEffect, useState } from 'react';
import { CloudAccountSetupModal } from './CloudAccountSetupModal';
import { CloudSignInModal } from './CloudSignInModal';
import { useCloudStore, initCloudStore } from '../stores/cloud-store';

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
  const [includePrices, setIncludePrices] = useState<boolean | null>(null);
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

  const handleFinish = async () => {
    setLoading(true);
    try {
      await window.api.runSetup(
        selectedTrades,
        includePrices === true,
        companyName,
        cloudChoice === 'never'
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
              Select all that apply. This determines which materials, labor roles, and
              equipment get loaded into your catalog.
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
            </div>
            <div className="setup-nav">
              <button className="btn btn-secondary" onClick={() => setStep(0)}>
                Back
              </button>
              <button
                className="btn btn-primary"
                onClick={() => setStep(2)}
                disabled={selectedTrades.length === 0}
              >
                Next
              </button>
            </div>
          </div>
        )}

        {step === 2 && (
          <div className="setup-step">
            <h2>Material Pricing</h2>
            <p className="setup-desc">
              We can pre-fill rough ballpark prices as a starting point, or leave
              everything at $0 so you enter your own prices from scratch. Either
              way, you can edit any price at any time.
            </p>
            <div className="price-options">
              <div
                className={`price-option ${includePrices === true ? 'selected' : ''}`}
                onClick={() => setIncludePrices(true)}
              >
                <div className="price-option-title">Include ballpark prices</div>
                <div className="price-option-desc">
                  Pre-fill with rough estimates so you have a starting point.
                  These are NOT accurate quotes -- just a reference to help you
                  get started faster.
                </div>
              </div>
              <div
                className={`price-option ${includePrices === false ? 'selected' : ''}`}
                onClick={() => setIncludePrices(false)}
              >
                <div className="price-option-title">Start at $0.00</div>
                <div className="price-option-desc">
                  All materials start with no price. You'll enter your own
                  supplier pricing from scratch.
                </div>
              </div>
            </div>
            <div className="setup-nav">
              <button className="btn btn-secondary" onClick={() => setStep(1)}>
                Back
              </button>
              <button
                className="btn btn-primary"
                onClick={() => setStep(3)}
                disabled={includePrices === null}
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
