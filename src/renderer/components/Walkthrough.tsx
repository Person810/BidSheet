import React, { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useWalkthroughStore } from '../stores/walkthrough-store';

interface TourStep {
  /** data-tour attribute of the element to spotlight; null = centered card */
  target: string | null;
  /**
   * Route to switch the main view to when this step activates, so the real
   * screen shows behind the spotlight. For spotlighted sidebar steps the
   * destination is derived from the link itself; this is only needed for the
   * centered welcome/finish cards that have no target to derive from.
   */
  route?: string;
  title: string;
  body: string;
}

const STEPS: TourStep[] = [
  {
    target: null,
    route: '/',
    title: 'Welcome to BidSheet',
    body: "Your catalog is loaded and you're ready to estimate. This tour walks the whole workflow — from pricing your catalog to measuring plans to sending a proposal. It takes a couple of minutes, and you can skip it anytime and replay it later from Settings.",
  },
  {
    target: 'dashboard',
    title: 'Dashboard',
    body: 'Your bid pipeline at a glance: active drafts, submitted bids, win rate, and total bid volume, plus a heads-up on anything due in the next week. As you mark jobs won or lost, the numbers keep themselves up to date.',
  },
  {
    target: 'materials',
    title: 'Materials',
    body: 'Your material catalog with unit prices and full price history. Start here: review the seeded items and update prices to match your suppliers. You can also import a CSV price sheet from Settings on this page — it fuzzy-matches against your catalog.',
  },
  {
    target: 'labor',
    title: 'Labor & Crews',
    body: 'Set up labor roles with burdened hourly rates, combine them into crew templates, and dial in production rates (like feet of pipe per day). Accurate crews are what drive your labor costs on every bid.',
  },
  {
    target: 'equipment',
    title: 'Equipment',
    body: 'Track hourly costs for owned and rented equipment: excavators, loaders, trench boxes. Equipment gets attached to crews and assemblies so it flows into your estimates automatically.',
  },
  {
    target: 'assemblies',
    title: 'Assemblies',
    body: 'Bundle materials, labor, and equipment into reusable per-unit assemblies (like "8″ PVC water main per LF"). Drop an assembly on a bid line item and the whole cost buildup comes with it. Starter assemblies for your trades are already seeded — tweak them to match how you build.',
  },
  {
    target: 'jobs',
    title: 'Jobs & Bids',
    body: 'This is where bids come together. Create a job, build the estimate by section and line item, and apply overhead, profit, bond, tax, and escalation markups — with per-section overrides and bid alternates when you need them. Every calculated number opens up to show its math, and you can duplicate a past bid to start the next one.',
  },
  {
    target: 'jobs',
    title: 'Plan Takeoff',
    body: 'Every job includes plan takeoff. Load the plan PDF, calibrate the scale, then draw pipe runs, measure restoration areas, trace wall runs, count fixtures, and add annotations. Check trenches in the 3D view, then send measured quantities straight into your estimate — or export them to CSV.',
  },
  {
    target: 'jobs',
    title: 'Quotes, Changes & Reports',
    body: 'Inside a job you can also track subcontractor and supplier quotes side by side and pick a winner per scope, log change orders after the win, and pull cost-code roll-ups, unit price schedules, and side-by-side estimate comparisons.',
  },
  {
    target: 'tools-concrete',
    title: 'Concrete Tools',
    body: 'Quick answers for concrete work: size up slabs, footings, and walls to get concrete volume with waste, formwork contact area, and rebar — handy for sanity checks before anything hits a bid.',
  },
  {
    target: 'settings',
    title: 'Settings',
    body: 'Company info and logo for your proposals, default markup percentages, PDF proposal templates, and database backup & restore. Make a backup once your pricing is dialed in. Everything lives locally on this machine — cloud sync is optional and can be set up (or hidden entirely) here.',
  },
  {
    target: null,
    route: '/jobs',
    title: "You're all set",
    body: 'A good first session: check your Materials prices, build a crew or two, then create your first job in Jobs & Bids and take it all the way to a proposal PDF. Press ? anytime to see keyboard shortcuts, and replay this tour from Settings.',
  },
];

interface Rect {
  top: number;
  left: number;
  width: number;
  height: number;
}

function getTargetRect(target: string | null): Rect | null {
  if (!target) return null;
  const el = document.querySelector(`[data-tour="${target}"]`);
  if (!el) return null;
  const r = el.getBoundingClientRect();
  return { top: r.top, left: r.left, width: r.width, height: r.height };
}

/**
 * Where the main view should go when a step activates. An explicit
 * step.route wins (the centered welcome/finish cards use it); otherwise the
 * route is read off the spotlighted sidebar link's own href, which keeps the
 * tour in sync with the real nav — including the dynamic trade-tool routes —
 * without duplicating the route table here.
 */
function destForStep(step: TourStep): string | null {
  if (step.route) return step.route;
  if (!step.target) return null;
  const el = document.querySelector(`[data-tour="${step.target}"]`);
  if (!el) return null;
  const anchor = (el.matches('a') ? el : el.querySelector('a')) as HTMLAnchorElement | null;
  const href = anchor?.getAttribute('href') ?? '';
  // HashRouter renders hrefs like "#/materials"; strip the leading hash.
  return href.startsWith('#') ? href.slice(1) : href || null;
}

/**
 * First-run guided tour. Walks through the app in workflow order: each step
 * switches the main view to the relevant screen and spotlights its sidebar
 * link with a short explanation, so users see the real page behind the
 * spotlight. Mounted once in App; opens via the walkthrough store (after
 * setup, or replayed from Settings).
 */
export function Walkthrough() {
  const isOpen = useWalkthroughStore((s) => s.isOpen);
  const close = useWalkthroughStore((s) => s.close);
  const navigate = useNavigate();
  const [steps, setSteps] = useState<TourStep[]>(STEPS);
  const [stepIndex, setStepIndex] = useState(0);
  const [rect, setRect] = useState<Rect | null>(null);
  // Direction of travel so steps with a missing target (e.g. no takeoff
  // tools registered) get skipped the way the user is heading
  const dirRef = useRef(1);

  const goTo = (i: number) => {
    dirRef.current = i >= stepIndex ? 1 : -1;
    setStepIndex(i);
  };

  // Reset to the first step each time the tour opens. Steps whose spotlight
  // target isn't in the app at all (e.g. a trade module the user didn't
  // enable) are dropped up front so the dots and counter reflect the tour
  // this user will actually see -- every target lives in the always-mounted
  // sidebar, so presence can be checked right when the tour opens. The
  // per-step skip in the layout effect below stays as a safety net.
  useEffect(() => {
    if (isOpen) {
      dirRef.current = 1;
      setSteps(
        STEPS.filter(
          (s) => !s.target || document.querySelector(`[data-tour="${s.target}"]`)
        )
      );
      setStepIndex(0);
    }
  }, [isOpen]);

  const step = steps[stepIndex];

  // Measure the spotlight target before paint; if the target isn't in
  // the DOM, hop over the step in the current direction of travel
  useLayoutEffect(() => {
    if (!isOpen) return;
    if (!step || (step.target && !document.querySelector(`[data-tour="${step.target}"]`))) {
      const next = stepIndex + dirRef.current;
      if (!step || next < 0 || next >= steps.length) close();
      else setStepIndex(next);
      return;
    }
    // Switch the main view to the screen this step describes, so the real
    // page sits behind the spotlight instead of whatever was last open.
    // The spotlight itself stays on the (always-present) sidebar link, so
    // there's no wait-for-the-new-page-to-mount timing to manage.
    const dest = destForStep(step);
    if (dest) navigate(dest);
    const measure = () => setRect(getTargetRect(step.target));
    measure();
    window.addEventListener('resize', measure);
    return () => window.removeEventListener('resize', measure);
  }, [isOpen, step, stepIndex, steps, close, navigate]);

  useEffect(() => {
    if (!isOpen) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        close();
      } else if (e.key === 'ArrowRight' || e.key === 'Enter') {
        e.preventDefault();
        if (stepIndex < steps.length - 1) goTo(stepIndex + 1);
        else close();
      } else if (e.key === 'ArrowLeft') {
        e.preventDefault();
        goTo(Math.max(0, stepIndex - 1));
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [isOpen, stepIndex, steps, close]);

  if (!isOpen || !step) return null;

  const isLast = stepIndex === steps.length - 1;
  const spotlightRect = step.target ? rect : null;

  // Tooltip sits to the right of spotlighted sidebar items, clamped to
  // the viewport; the welcome/finish steps are flex-centered by the
  // dimmed overlay instead
  let tooltipStyle: React.CSSProperties | undefined;
  if (spotlightRect) {
    const top = Math.max(
      12,
      Math.min(spotlightRect.top - 8, window.innerHeight - 240)
    );
    tooltipStyle = { top, left: spotlightRect.left + spotlightRect.width + 16 };
  }

  return (
    <div className={`tour-overlay ${spotlightRect ? '' : 'tour-overlay-dim'}`}
      role="dialog" aria-label="Walkthrough">
      {spotlightRect && (
        <div
          className="tour-spotlight"
          style={{
            top: spotlightRect.top - 4,
            left: spotlightRect.left + 4,
            width: spotlightRect.width - 8,
            height: spotlightRect.height + 8,
          }}
        />
      )}
      <div className={`tour-tooltip ${spotlightRect ? '' : 'tour-tooltip-centered'}`}
        style={tooltipStyle}>
        <h4>{step.title}</h4>
        <p>{step.body}</p>
        <div className="tour-dots">
          {steps.map((_, i) => (
            <div key={i} className={`tour-dot ${i === stepIndex ? 'active' : ''}`}
              onClick={() => goTo(i)} />
          ))}
          <span className="tour-step-count">{stepIndex + 1} / {steps.length}</span>
        </div>
        <div className="tour-nav">
          <button className="tour-skip" onClick={close}
            style={isLast ? { visibility: 'hidden' } : undefined}>
            Skip tour
          </button>
          <div className="flex gap-8">
            {stepIndex > 0 && (
              <button className="btn btn-secondary btn-sm"
                onClick={() => goTo(stepIndex - 1)}>
                Back
              </button>
            )}
            <button className="btn btn-primary btn-sm"
              onClick={() => (isLast ? close() : goTo(stepIndex + 1))}>
              {isLast ? 'Get Started' : 'Next'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
