import React, { useState, useEffect } from 'react';
import { HashRouter, Routes, Route, NavLink } from 'react-router-dom';
import { SetupWizard } from './components/SetupWizard';
import { Dashboard } from './pages/Dashboard';
import { MaterialsPage } from './pages/MaterialsPage';
import { LaborPage } from './pages/LaborPage';
import { EquipmentPage } from './pages/EquipmentPage';
import { JobsPage } from './pages/JobsPage';
import { SettingsPage } from './pages/SettingsPage';
import { AssembliesPage } from './pages/AssembliesPage';

export function App() {
  const [loading, setLoading] = useState(true);
  const [setupComplete, setSetupComplete] = useState(false);

  useEffect(() => {
    window.api.isSetupComplete().then((complete) => {
      setSetupComplete(complete);
      setLoading(false);
    });
  }, []);

  if (loading) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100vh' }}>
        <p className="text-muted">Loading...</p>
      </div>
    );
  }

  if (!setupComplete) {
    return <SetupWizard onComplete={() => setSetupComplete(true)} />;
  }

  return (
    <HashRouter>
      <div className="app-layout">
        <nav className="sidebar">
          <div className="sidebar-header">
            <h1>Utility Estimator</h1>
          </div>
          <ul className="nav-links">
            <li>
              <NavLink to="/" end>Dashboard</NavLink>
            </li>
            <li>
              <NavLink to="/jobs">Jobs & Bids</NavLink>
            </li>
            <li>
              <NavLink to="/materials">Materials</NavLink>
            </li>
            <li>
              <NavLink to="/assemblies">Assemblies</NavLink>
            </li>
            <li>
              <NavLink to="/labor">Labor & Crews</NavLink>
            </li>
            <li>
              <NavLink to="/equipment">Equipment</NavLink>
            </li>
            <li>
              <NavLink to="/settings">Settings</NavLink>
            </li>
          </ul>
        </nav>
        <main className="main-content">
          <Routes>
            <Route path="/" element={<Dashboard />} />
            <Route path="/jobs" element={<JobsPage />} />
            <Route path="/materials" element={<MaterialsPage />} />
            <Route path="/assemblies" element={<AssembliesPage />} />
            <Route path="/labor" element={<LaborPage />} />
            <Route path="/equipment" element={<EquipmentPage />} />
            <Route path="/settings" element={<SettingsPage />} />
          </Routes>
        </main>
      </div>
    </HashRouter>
  );
}
