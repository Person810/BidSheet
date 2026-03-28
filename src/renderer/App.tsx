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
import { getActiveModules } from './modules';
import type { TradeModule } from './modules';
import { TrenchProfiler } from './modules/underground';

// Maps tool route paths to their components.
// Add new entries here as tools are built.
const TOOL_COMPONENTS: Record<string, React.FC> = {
  '/tools/trench-profiler': TrenchProfiler,
};

export function App() {
  const [loading, setLoading] = useState(true);
  const [setupComplete, setSetupComplete] = useState(false);
  const [activeModules, setActiveModules] = useState<TradeModule[]>([]);

  useEffect(() => {
    window.api.isSetupComplete().then((complete) => {
      setSetupComplete(complete);
      if (complete) {
        // Load trade_types to determine which modules are active
        window.api.getSettings().then((s: any) => {
          if (s?.trade_types) {
            setActiveModules(getActiveModules(s.trade_types));
          }
          setLoading(false);
        });
      } else {
        setLoading(false);
      }
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

  // Collect all tool routes from active modules (empty for now, ready for trench profiler etc.)
  const moduleToolRoutes = activeModules.flatMap((mod) =>
    mod.tools.map((tool) => ({ key: `${mod.id}-${tool.id}`, path: tool.path, tool }))
  );

  // Collect sidebar tool entries grouped by module (only modules with tools show up)
  const modulesWithTools = activeModules.filter((mod) => mod.tools.length > 0);

  return (
    <HashRouter>
      <div className="app-layout">
        <nav className="sidebar">
          <div className="sidebar-header">
            <h1>BidSheet</h1>
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

            {/* Trade module tools -- only renders when modules have tools registered */}
            {modulesWithTools.map((mod) => (
              <li key={mod.id}>
                <div className="nav-section-label">{mod.icon ? `${mod.icon} ` : ''}{mod.name}</div>
                <ul className="nav-links-nested">
                  {mod.tools.map((tool) => (
                    <li key={tool.id}>
                      <NavLink to={tool.path}>{tool.icon ? `${tool.icon} ` : ''}{tool.name}</NavLink>
                    </li>
                  ))}
                </ul>
              </li>
            ))}

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

            {/* Trade module tool routes -- populated when tools are added to manifests */}
            {moduleToolRoutes.map((rt) => {
              const Comp = TOOL_COMPONENTS[rt.path];
              return (
                <Route key={rt.key} path={rt.path}
                  element={Comp ? <Comp /> : <div>TODO: {rt.tool.name}</div>} />
              );
            })}
          </Routes>
        </main>
      </div>
    </HashRouter>
  );
}
