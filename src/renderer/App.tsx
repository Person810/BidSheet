import React, { useState, useEffect } from 'react';
import { HashRouter, Routes, Route, NavLink, Navigate } from 'react-router-dom';
import {
  LayoutGrid, Folder, Package, Boxes, Users, Truck, Settings,
  Spline, FileText, Calculator,
} from 'lucide-react';
import { SetupWizard } from './components/SetupWizard';
import { ToastContainer } from './components/Toast';
import { ShortcutsOverlay } from './components/ShortcutsOverlay';
import { Walkthrough } from './components/Walkthrough';
import { useToastStore } from './stores/toast-store';
import { useWalkthroughStore, hasSeenWalkthrough } from './stores/walkthrough-store';
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
import { ConcreteCalculator } from './modules/concrete';

// Maps tool route paths to their components.
// Add new entries here as tools are built.
const TOOL_COMPONENTS: Record<string, React.FC> = {
  '/tools/trench-profiler': TrenchProfiler,
  '/tools/concrete-calculator': ConcreteCalculator,
};

const APP_VERSION = `v${__APP_VERSION__}`;

// Sidebar / tool nav icons (lucide-react — the maintained successor to the
// feather-style set this app was originally drawn in).
const NAV_ICON = 16;
const TOOL_ICON = 14;
const NAV_STROKE = 2;

const SidebarIcons: Record<string, React.ReactNode> = {
  '/': <LayoutGrid size={NAV_ICON} strokeWidth={NAV_STROKE} />,
  '/jobs': <Folder size={NAV_ICON} strokeWidth={NAV_STROKE} />,
  '/materials': <Package size={NAV_ICON} strokeWidth={NAV_STROKE} />,
  '/assemblies': <Boxes size={NAV_ICON} strokeWidth={NAV_STROKE} />,
  '/labor': <Users size={NAV_ICON} strokeWidth={NAV_STROKE} />,
  '/equipment': <Truck size={NAV_ICON} strokeWidth={NAV_STROKE} />,
  '/settings': <Settings size={NAV_ICON} strokeWidth={NAV_STROKE} />,
};

const ToolIcons: Record<string, React.ReactNode> = {
  '/tools/trench-profiler': <Spline size={TOOL_ICON} strokeWidth={NAV_STROKE} />,
  '/tools/plan-takeoff': <FileText size={TOOL_ICON} strokeWidth={NAV_STROKE} />,
  '/tools/concrete-calculator': <Calculator size={TOOL_ICON} strokeWidth={NAV_STROKE} />,
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
  const [companyName, setCompanyName] = useState('');
  const [companyLogo, setCompanyLogo] = useState('');
  const addToast = useToastStore((s) => s.addToast);
  const openWalkthrough = useWalkthroughStore((s) => s.open);

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

  // Load trade_types to determine which modules are active
  const loadSettings = () =>
    window.api.getSettings().then((s: any) => {
      if (s?.trade_types) {
        setActiveModules(getActiveModules(s.trade_types));
      }
      if (s?.company_name) {
        setCompanyName(s.company_name);
      }
      // Company logo overrides the default BidSheet mark once one is uploaded
      // in Settings. Stored as a data URI, so it renders without a file fetch.
      setCompanyLogo(s?.company_logo || '');
      setLoading(false);
    });

  // Esc closes the topmost open dialog, matching what the shortcuts
  // overlay promises. Every modal already closes on backdrop click, so
  // Esc simply triggers that. Components that consume Esc themselves
  // (e.g. autocomplete dropdowns) stop propagation before this fires.
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || e.defaultPrevented) return;
      const overlays = Array.from(document.querySelectorAll<HTMLElement>('.modal-overlay'));
      if (overlays.length === 0) return;
      const top = overlays.reduce((a, b) =>
        (parseInt(getComputedStyle(b).zIndex, 10) || 0) >= (parseInt(getComputedStyle(a).zIndex, 10) || 0) ? b : a
      );
      top.click();
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, []);

  useEffect(() => {
    window.api.isSetupComplete().then((complete) => {
      setSetupComplete(complete);
      if (complete) {
        loadSettings();

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
        <SetupWizard
          onComplete={() => {
            setSetupComplete(true);
            loadSettings();
            // Fresh install: walk the user through the app once.
            // Skipped if this machine already saw the tour (e.g. the
            // database was reset and setup ran again).
            if (!hasSeenWalkthrough()) openWalkthrough();
          }}
        />
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
            <div className="sidebar-brand-mark">
              <img
                src={companyLogo || './icon.png'}
                alt={companyLogo ? `${companyName || 'Company'} logo` : 'BidSheet'}
              />
            </div>
            <h1 title={companyName || 'BidSheet'}>{companyName || 'BidSheet'}</h1>
          </div>
          <ul className="nav-links">
            <li>
              <NavLink to="/" end className={({ isActive }) => isActive ? 'active' : ''}>
                <span className="nav-icon">{SidebarIcons['/']}</span>
                Dashboard
              </NavLink>
            </li>
            <li>
              <NavLink to="/jobs" data-tour="jobs" className={({ isActive }) => isActive ? 'active' : ''}>
                <span className="nav-icon">{SidebarIcons['/jobs']}</span>
                Jobs & Bids
              </NavLink>
            </li>
            <li>
              <NavLink to="/materials" data-tour="materials" className={({ isActive }) => isActive ? 'active' : ''}>
                <span className="nav-icon">{SidebarIcons['/materials']}</span>
                Materials
              </NavLink>
            </li>
            <li>
              <NavLink to="/assemblies" data-tour="assemblies" className={({ isActive }) => isActive ? 'active' : ''}>
                <span className="nav-icon">{SidebarIcons['/assemblies']}</span>
                Assemblies
              </NavLink>
            </li>
            <li>
              <NavLink to="/labor" data-tour="labor" className={({ isActive }) => isActive ? 'active' : ''}>
                <span className="nav-icon">{SidebarIcons['/labor']}</span>
                Labor & Crews
              </NavLink>
            </li>
            <li>
              <NavLink to="/equipment" data-tour="equipment" className={({ isActive }) => isActive ? 'active' : ''}>
                <span className="nav-icon">{SidebarIcons['/equipment']}</span>
                Equipment
              </NavLink>
            </li>

            {/* Trade module tools -- only renders when modules have tools registered */}
            {modulesWithTools.map((mod, modIdx) => (
              <li key={mod.id} data-tour={modIdx === 0 ? 'tools' : undefined}>
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
              <NavLink to="/settings" data-tour="settings" className={({ isActive }) => isActive ? 'active' : ''}>
                <span className="nav-icon">{SidebarIcons['/settings']}</span>
                Settings
              </NavLink>
            </li>
          </ul>
        </nav>
        <div className="app-main-col">
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
                    element={Comp ? <Comp /> : <Navigate to="/" replace />} />
                );
              })}
            </Routes>
            </ErrorBoundary>
          </main>
          <footer className="app-statusbar">
            <span className="tk-status-cell">Ready</span>
            <span className="tk-status-hint" />
            {companyName && <span className="tk-status-cell">{companyName}</span>}
            <span className="tk-status-cell">BidSheet {APP_VERSION}</span>
          </footer>
        </div>
        <ToastContainer />
        <ShortcutsOverlay />
        <Walkthrough />
      </div>
    </HashRouter>
  );
}
