import React, { useState } from 'react';

interface SetupWizardProps {
  onComplete: () => void;
}

const TRADES = [
  { key: 'water_sewer', label: 'Water & Sewer', desc: 'Water main, sanitary sewer, service connections' },
  { key: 'storm_drain', label: 'Storm Drain', desc: 'Storm sewer, drainage structures, stormwater' },
  { key: 'gas', label: 'Gas', desc: 'Natural gas main and service installation' },
  { key: 'electrical', label: 'Electrical / Conduit', desc: 'Underground conduit, duct bank, pull boxes' },
  { key: 'telecom', label: 'Telecommunications / Fiber', desc: 'Fiber optic, copper, telecom underground plant' },
];

export function SetupWizard({ onComplete }: SetupWizardProps) {
  const [step, setStep] = useState(0);
  const [companyName, setCompanyName] = useState('');
  const [selectedTrades, setSelectedTrades] = useState<string[]>([]);
  const [includePrices, setIncludePrices] = useState<boolean | null>(null);
  const [loading, setLoading] = useState(false);

  const toggleTrade = (key: string) => {
    setSelectedTrades((prev) =>
      prev.includes(key) ? prev.filter((t) => t !== key) : [...prev, key]
    );
  };

  const handleFinish = async () => {
    setLoading(true);
    try {
      await window.api.runSetup(selectedTrades, includePrices === true, companyName);
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
          {[0, 1, 2].map((i) => (
            <div key={i} className={`setup-dot ${step >= i ? 'active' : ''}`} />
          ))}
        </div>

        {step === 0 && (
          <div className="setup-step">
            <h2>Welcome to Utility Estimator</h2>
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
                onClick={handleFinish}
                disabled={includePrices === null || loading}
              >
                {loading ? 'Setting up...' : 'Finish Setup'}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
