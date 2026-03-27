import React, { useState, useEffect, useCallback } from 'react';
import { LaborRolesTab } from './LaborRolesTab';
import { CrewTemplatesTab } from './CrewTemplatesTab';
import { ProductionRatesTab } from './ProductionRatesTab';

type Tab = 'roles' | 'crews' | 'rates';

export function LaborPage() {
  const [tab, setTab] = useState<Tab>('roles');
  const [roles, setRoles] = useState<any[]>([]);
  const [crews, setCrews] = useState<any[]>([]);
  const [rates, setRates] = useState<any[]>([]);

  const loadAll = useCallback(async () => {
    const [r, c, p] = await Promise.all([
      window.api.getLaborRoles(),
      window.api.getCrewTemplates(),
      window.api.getProductionRates(),
    ]);
    setRoles(r);
    setCrews(c);
    setRates(p);
  }, []);

  useEffect(() => {
    loadAll();
  }, [loadAll]);

  return (
    <div>
      <div className="page-header">
        <h2>Labor & Crews</h2>
      </div>

      {/* Tabs */}
      <div className="flex gap-8 mb-24">
        <button
          className={`btn ${tab === 'roles' ? 'btn-primary' : 'btn-secondary'}`}
          onClick={() => setTab('roles')}
        >
          Labor Roles
        </button>
        <button
          className={`btn ${tab === 'crews' ? 'btn-primary' : 'btn-secondary'}`}
          onClick={() => setTab('crews')}
        >
          Crew Templates
        </button>
        <button
          className={`btn ${tab === 'rates' ? 'btn-primary' : 'btn-secondary'}`}
          onClick={() => setTab('rates')}
        >
          Production Rates
        </button>
      </div>

      {tab === 'roles' && <LaborRolesTab roles={roles} onRefresh={loadAll} />}
      {tab === 'crews' && <CrewTemplatesTab crews={crews} roles={roles} onRefresh={loadAll} />}
      {tab === 'rates' && <ProductionRatesTab rates={rates} crews={crews} onRefresh={loadAll} />}
    </div>
  );
}
