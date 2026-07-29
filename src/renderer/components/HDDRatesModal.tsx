import React, { useState } from 'react';
import { DEFAULT_RATES } from '../modules/underground/hddCalc';
import { lookupTableValue, updateTableValues } from '../modules/underground/hddRatesHelper';
import { dismissOnEscOnly } from './modalDismiss';
import { useUnitSystem } from '../stores/units-store';

interface Props {
  initialRatesJson: string;
  onSave: (json: string) => void;
  onClose: () => void;
}

type LocaleKey = 'en-AU' | 'en-US';

export function HDDRatesModal({ initialRatesJson, onSave, onClose }: Props) {
  const system = useUnitSystem();
  const [locale, setLocale] = useState<LocaleKey>(system === 'metric' ? 'en-AU' : 'en-US');
  const [activeTab, setActiveTab] = useState<'production' | 'establishment' | 'fluids' | 'excavator'>('production');

  // Parse rates state
  const [rates, setRates] = useState(() => {
    try {
      if (initialRatesJson && initialRatesJson.trim() !== '') {
        const parsed = JSON.parse(initialRatesJson);
        // Merge with default rates to ensure all fields exist
        return {
          'en-AU': { ...DEFAULT_RATES['en-AU'], ...parsed['en-AU'] },
          'en-US': { ...DEFAULT_RATES['en-US'], ...parsed['en-US'] },
        };
      }
    } catch (e) {
      console.error('Failed to parse initial rates json', e);
    }
    // Deep clone default rates
    return JSON.parse(JSON.stringify(DEFAULT_RATES));
  });

  const activeRates = rates[locale];
  const sizes = activeRates.sizes;

  // Helper helper to lookup a value from a lookup table
  const getValue = (table: Array<[number, number]>, size: number, defaultVal: number = 0) => {
    return lookupTableValue(table, size, defaultVal);
  };

  // Update a single value in a table for a size
  const updateTableValue = (tableName: string, subKey: string | null, size: number, value: number) => {
    setRates((prev: any) => {
      const prevLocale = prev[locale];
      let table = subKey ? prevLocale[tableName][subKey] : prevLocale[tableName];
      const newTable = updateTableValues(table, prevLocale.sizes, size, value);
      
      const newLocale = {
        ...prevLocale,
        [tableName]: subKey ? {
          ...prevLocale[tableName],
          [subKey]: newTable
        } : newTable
      };

      return {
        ...prev,
        [locale]: newLocale
      };
    });
  };

  const handleGlobalChange = (field: string, value: number) => {
    setRates((prev: any) => ({
      ...prev,
      [locale]: {
        ...prev[locale],
        [field]: value
      }
    }));
  };

  const handleSave = () => {
    onSave(JSON.stringify(rates, null, 2));
  };

  const isMetric = locale === 'en-AU';

  return (
    <div className="modal-overlay" onClick={dismissOnEscOnly(onClose)} style={{ zIndex: 9999 }}>
      <div className="modal" style={{ width: 850, maxWidth: '95vw', height: '90vh', display: 'flex', flexDirection: 'column', padding: 24 }} onClick={(e) => e.stopPropagation()}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
          <h2 style={{ margin: 0 }}>Configure HDD Rates</h2>
          <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
            <label style={{ fontWeight: 'bold', fontSize: 13, margin: 0 }}>Standard System:</label>
            <select
              className="form-control"
              style={{ width: 180 }}
              value={locale}
              onChange={(e) => setLocale(e.target.value as LocaleKey)}
            >
              <option value="en-AU">Metric (en-AU)</option>
              <option value="en-US">Imperial (en-US)</option>
            </select>
          </div>
        </div>

        {/* Tab Headers */}
        <div className="tabs" style={{ marginBottom: 16, display: 'flex', gap: 4, borderBottom: '1px solid var(--border-color)' }}>
          <button
            className={`tab-btn ${activeTab === 'production' ? 'active' : ''}`}
            style={{ padding: '8px 16px', background: 'transparent', border: 'none', borderBottom: activeTab === 'production' ? '2px solid var(--primary)' : 'none', color: activeTab === 'production' ? 'var(--primary)' : 'var(--text-muted)', cursor: 'pointer', fontWeight: 'bold' }}
            onClick={() => setActiveTab('production')}
          >
            Crew & Production
          </button>
          <button
            className={`tab-btn ${activeTab === 'establishment' ? 'active' : ''}`}
            style={{ padding: '8px 16px', background: 'transparent', border: 'none', borderBottom: activeTab === 'establishment' ? '2px solid var(--primary)' : 'none', color: activeTab === 'establishment' ? 'var(--primary)' : 'var(--text-muted)', cursor: 'pointer', fontWeight: 'bold' }}
            onClick={() => setActiveTab('establishment')}
          >
            Establishment (Setup)
          </button>
          <button
            className={`tab-btn ${activeTab === 'fluids' ? 'active' : ''}`}
            style={{ padding: '8px 16px', background: 'transparent', border: 'none', borderBottom: activeTab === 'fluids' ? '2px solid var(--primary)' : 'none', color: activeTab === 'fluids' ? 'var(--primary)' : 'var(--text-muted)', cursor: 'pointer', fontWeight: 'bold' }}
            onClick={() => setActiveTab('fluids')}
          >
            Fluids & Travel
          </button>
          <button
            className={`tab-btn ${activeTab === 'excavator' ? 'active' : ''}`}
            style={{ padding: '8px 16px', background: 'transparent', border: 'none', borderBottom: activeTab === 'excavator' ? '2px solid var(--primary)' : 'none', color: activeTab === 'excavator' ? 'var(--primary)' : 'var(--text-muted)', cursor: 'pointer', fontWeight: 'bold' }}
            onClick={() => setActiveTab('excavator')}
          >
            Excavator & Pits
          </button>
        </div>

        {/* Tab Contents */}
        <div style={{ flex: 1, overflowY: 'auto', paddingRight: 4, marginBottom: 20 }}>
          {activeTab === 'production' && (
            <table className="table" style={{ width: '100%' }}>
              <thead>
                <tr>
                  <th>Pipe Size ({isMetric ? 'DN' : 'inch'})</th>
                  <th>Crew Size</th>
                  <th>Rig Hire ($/day)</th>
                  <th>Metro Prod Rate ({isMetric ? 'm/day' : 'ft/day'})</th>
                  <th>Regional Prod Rate ({isMetric ? 'm/day' : 'ft/day'})</th>
                </tr>
              </thead>
              <tbody>
                {sizes.map((size: number) => (
                  <tr key={size}>
                    <td style={{ fontWeight: 'bold' }}>{isMetric ? `DN${size}` : `${size}"`}</td>
                    <td>
                      <input
                        type="number"
                        className="form-control form-control-sm"
                        style={{ width: 80 }}
                        value={getValue(activeRates.crewSize, size)}
                        onChange={(e) => updateTableValue('crewSize', null, size, parseInt(e.target.value) || 0)}
                      />
                    </td>
                    <td>
                      <input
                        type="number"
                        className="form-control form-control-sm"
                        style={{ width: 120 }}
                        value={getValue(activeRates.rigHirePerDay, size)}
                        onChange={(e) => updateTableValue('rigHirePerDay', null, size, parseFloat(e.target.value) || 0)}
                      />
                    </td>
                    <td>
                      <input
                        type="number"
                        className="form-control form-control-sm"
                        style={{ width: 120 }}
                        value={getValue(activeRates.productionRate.metro, size)}
                        onChange={(e) => updateTableValue('productionRate', 'metro', size, parseFloat(e.target.value) || 0)}
                      />
                    </td>
                    <td>
                      <input
                        type="number"
                        className="form-control form-control-sm"
                        style={{ width: 120 }}
                        value={getValue(activeRates.productionRate.regional, size)}
                        onChange={(e) => updateTableValue('productionRate', 'regional', size, parseFloat(e.target.value) || 0)}
                      />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}

          {activeTab === 'establishment' && (
            <table className="table" style={{ width: '100%' }}>
              <thead>
                <tr>
                  <th>Pipe Size ({isMetric ? 'DN' : 'inch'})</th>
                  <th>Metro Establishment ($)</th>
                  <th>Regional Establishment ($)</th>
                </tr>
              </thead>
              <tbody>
                {sizes.map((size: number) => (
                  <tr key={size}>
                    <td style={{ fontWeight: 'bold' }}>{isMetric ? `DN${size}` : `${size}"`}</td>
                    <td>
                      <input
                        type="number"
                        className="form-control form-control-sm"
                        style={{ width: 180 }}
                        value={getValue(activeRates.establishment.metro, size)}
                        onChange={(e) => updateTableValue('establishment', 'metro', size, parseFloat(e.target.value) || 0)}
                      />
                    </td>
                    <td>
                      <input
                        type="number"
                        className="form-control form-control-sm"
                        style={{ width: 180 }}
                        value={getValue(activeRates.establishment.regional, size)}
                        onChange={(e) => updateTableValue('establishment', 'regional', size, parseFloat(e.target.value) || 0)}
                      />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}

          {activeTab === 'fluids' && (
            <div>
              <div className="form-group" style={{ maxWidth: 300, marginBottom: 20 }}>
                <label style={{ fontWeight: 'bold' }}>Travel Allowance per Crew Day ($)</label>
                <input
                  type="number"
                  className="form-control"
                  value={activeRates.travelAllowancePerDay || 0}
                  onChange={(e) => handleGlobalChange('travelAllowancePerDay', parseFloat(e.target.value) || 0)}
                />
              </div>

              <table className="table" style={{ width: '100%' }}>
                <thead>
                  <tr>
                    <th>Pipe Size ({isMetric ? 'DN' : 'inch'})</th>
                    <th>Total Fluids Cost ({isMetric ? '$/m' : '$/ft'})</th>
                  </tr>
                </thead>
                <tbody>
                  {sizes.map((size: number) => (
                    <tr key={size}>
                      <td style={{ fontWeight: 'bold' }}>{isMetric ? `DN${size}` : `${size}"`}</td>
                      <td>
                        <input
                          type="number"
                          className="form-control form-control-sm"
                          style={{ width: 180 }}
                          value={getValue(activeRates.totalFluidsPerM, size)}
                          onChange={(e) => updateTableValue('totalFluidsPerM', null, size, parseFloat(e.target.value) || 0)}
                        />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {activeTab === 'excavator' && (
            <table className="table" style={{ width: '100%' }}>
              <thead>
                <tr>
                  <th>Pipe Size ({isMetric ? 'DN' : 'inch'})</th>
                  <th>Excavator Daily Rate ($)</th>
                  <th>Excavator Days Per Pit Pair</th>
                </tr>
              </thead>
              <tbody>
                {sizes.map((size: number) => (
                  <tr key={size}>
                    <td style={{ fontWeight: 'bold' }}>{isMetric ? `DN${size}` : `${size}"`}</td>
                    <td>
                      <input
                        type="number"
                        className="form-control form-control-sm"
                        style={{ width: 180 }}
                        value={getValue(activeRates.excavatorDailyRate, size)}
                        onChange={(e) => updateTableValue('excavatorDailyRate', null, size, parseFloat(e.target.value) || 0)}
                      />
                    </td>
                    <td>
                      <input
                        type="number"
                        className="form-control form-control-sm"
                        style={{ width: 180 }}
                        value={getValue(activeRates.excavatorDaysPerPitPair, size)}
                        onChange={(e) => updateTableValue('excavatorDaysPerPitPair', null, size, parseFloat(e.target.value) || 0)}
                      />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>

        <div className="modal-actions" style={{ display: 'flex', justifyContent: 'flex-end', gap: 12 }}>
          <button className="btn btn-secondary" onClick={onClose}>
            Cancel
          </button>
          <button className="btn btn-primary" onClick={handleSave}>
            Save Configuration
          </button>
        </div>
      </div>
    </div>
  );
}
