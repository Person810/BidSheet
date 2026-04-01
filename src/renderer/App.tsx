import React, { useState, useEffect } from 'react';
import { HashRouter, Routes, Route, NavLink } from 'react-router-dom';
import { SetupWizard } from './components/SetupWizard';
import { ToastContainer } from './components/Toast';
import { useToastStore } from './stores/toast-store';
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

const SidebarIcons: Record<string, React.ReactNode> = {
  '/': (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="3" y="3" width="7" height="7" rx="1"/>
      <rect x="14" y="3" width="7" height="7" rx="1"/>
      <rect x="3" y="14" width="7" height="7" rx="1"/>
      <rect x="14" y="14" width="7" height="7" rx="1"/>
    </svg>
  ),
  '/jobs': (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/>
    </svg>
  ),
  '/materials': (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"/>
      <polyline points="3.27 6.96 12 12.01 20.73 6.96"/>
      <line x1="12" y1="22.08" x2="12" y2="12"/>
    </svg>
  ),
  '/assemblies': (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="2" y="7" width="20" height="14" rx="2"/>
      <path d="M16 7V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v2"/>
      <line x1="12" y1="12" x2="12" y2="16"/>
      <line x1="10" y1="14" x2="14" y2="14"/>
    </svg>
  ),
  '/labor': (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/>
      <circle cx="9" cy="7" r="4"/>
      <path d="M23 21v-2a4 4 0 0 0-3-3.87"/>
      <path d="M16 3.13a4 4 0 0 1 0 7.75"/>
    </svg>
  ),
  '/equipment': (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="3"/>
      <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/>
    </svg>
  ),
  '/settings': (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <line x1="4" y1="21" x2="4" y2="14"/><line x1="4" y1="10" x2="4" y2="3"/>
      <line x1="12" y1="21" x2="12" y2="12"/><line x1="12" y1="8" x2="12" y2="3"/>
      <line x1="20" y1="21" x2="20" y2="16"/><line x1="20" y1="12" x2="20" y2="3"/>
      <line x1="1" y1="14" x2="7" y2="14"/>
      <line x1="9" y1="8" x2="15" y2="8"/>
      <line x1="17" y1="16" x2="23" y2="16"/>
    </svg>
  ),
};

const ToolIcons: Record<string, React.ReactNode> = {
  '/tools/trench-profiler': (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M2 20h20"/><path d="M6 20V8l4 4 4-4 4 4V20"/>
    </svg>
  ),
  '/tools/plan-takeoff': (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
      <polyline points="14 2 14 8 20 8"/>
      <line x1="9" y1="15" x2="15" y2="15"/>
    </svg>
  ),
};

class ErrorBoundary extends React.Component<
  { children: React.ReactNode },
  { hasError: boolean }
> {
  state = { hasError: false };
  static getDerivedStateFromError() { return { hasError: true }; }
  render() {
    if (this.state.hasError) {
      return (
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '100vh', gap: 16 }}>
          <h2>Something went wrong</h2>
          <p className="text-muted">An unexpected error occurred.</p>
          <button className="btn btn-primary" onClick={() => window.location.reload()}>Reload</button>
        </div>
      );
    }
    return this.props.children;
  }
}

export function App() {
  const [loading, setLoading] = useState(true);
  const [setupComplete, setSetupComplete] = useState(false);
  const [activeModules, setActiveModules] = useState<TradeModule[]>([]);
  const addToast = useToastStore((s) => s.addToast);

  // Global safety net: catch any unhandled IPC rejections and show a toast
  // so errors never vanish silently. Pages can still catch their own errors
  // for more specific messaging -- this only fires for truly uncaught ones.
  useEffect(() => {
    const handler = (e: PromiseRejectionEvent) => {
      // Electron IPC errors come through as Error objects with user-friendly
      // messages (set by safeHandle in ipc-handlers.ts)
      const msg = e.reason?.message || String(e.reason || 'An unexpected error occurred.');
      addToast(msg, 'error');
      // Prevent the default browser console error -- we've handled it
      e.preventDefault();
    };
    window.addEventListener('unhandledrejection', handler);
    return () => window.removeEventListener('unhandledrejection', handler);
  }, [addToast]);

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

        // Check if a backup reminder is needed after a database upgrade
        window.api.checkBackupReminder().then((reminder) => {
          if (reminder.needed) {
            addToast(
              'BidSheet has been updated. Your existing backups may be outdated. Head to Settings to make a fresh backup.',
              'warn'
            );
          }
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
    return (
      <>
        <SetupWizard onComplete={() => setSetupComplete(true)} />
        <ToastContainer />
      </>
    );
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
              <NavLink to="/" end className={({ isActive }) => isActive ? 'active' : ''}>
                <span className="nav-icon">{SidebarIcons['/']}</span>
                Dashboard
              </NavLink>
            </li>
            <li>
              <NavLink to="/jobs" className={({ isActive }) => isActive ? 'active' : ''}>
                <span className="nav-icon">{SidebarIcons['/jobs']}</span>
                Jobs & Bids
              </NavLink>
            </li>
            <li>
              <NavLink to="/materials" className={({ isActive }) => isActive ? 'active' : ''}>
                <span className="nav-icon">{SidebarIcons['/materials']}</span>
                Materials
              </NavLink>
            </li>
            <li>
              <NavLink to="/assemblies" className={({ isActive }) => isActive ? 'active' : ''}>
                <span className="nav-icon">{SidebarIcons['/assemblies']}</span>
                Assemblies
              </NavLink>
            </li>
            <li>
              <NavLink to="/labor" className={({ isActive }) => isActive ? 'active' : ''}>
                <span className="nav-icon">{SidebarIcons['/labor']}</span>
                Labor & Crews
              </NavLink>
            </li>
            <li>
              <NavLink to="/equipment" className={({ isActive }) => isActive ? 'active' : ''}>
                <span className="nav-icon">{SidebarIcons['/equipment']}</span>
                Equipment
              </NavLink>
            </li>

            {/* Trade module tools -- only renders when modules have tools registered */}
            {modulesWithTools.map((mod) => (
              <li key={mod.id}>
                <div className="nav-section-label">{mod.name}</div>
                <ul className="nav-links-nested">
                  {mod.tools.map((tool) => (
                    <li key={tool.id}>
                      <NavLink to={tool.path}>
                        <span className="nav-icon">{ToolIcons[tool.path]}</span>
                        {tool.name}
                      </NavLink>
                    </li>
                  ))}
                </ul>
              </li>
            ))}

            <li>
              <NavLink to="/settings" className={({ isActive }) => isActive ? 'active' : ''}>
                <span className="nav-icon">{SidebarIcons['/settings']}</span>
                Settings
              </NavLink>
            </li>
          </ul>
          <div className="sidebar-version">v0.9.0-beta</div>
        </nav>
        <main className="main-content">
          <ErrorBoundary>
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
          </ErrorBoundary>
        </main>
        <ToastContainer />
      </div>
    </HashRouter>
  );
}
