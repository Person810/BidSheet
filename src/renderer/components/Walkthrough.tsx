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
    body: 'Your catalog is loaded and you’re ready to estimate. Here’s a quick tour of how everything is organized — it takes about a minute. You can skip it anytime and replay it later from Settings.',
  },
  {
    target: 'materials',
    title: 'Materials',
    body: 'Your material catalog with unit prices and full price history. Start here: review the seeded items and update prices to match your suppliers. You can also import a CSV price sheet from Settings on this page.',
  },
  {
    target: 'labor',
    title: 'Labor & Crews',
    body: 'Set up labor roles with burdened hourly rates, then combine them into crew templates with production rates (like feet of pipe per day). Accurate crews are what drive your labor costs on every bid.',
  },
  {
    target: 'equipment',
    title: 'Equipment',
    body: 'Track hourly costs for owned and rented equipment — excavators, loaders, trench boxes. Equipment gets attached to crews and assemblies so it flows into your estimates automatically.',
  },
  {
    target: 'assemblies',
    title: 'Assemblies',
    body: 'Bundle materials, labor, and equipment into reusable per-unit assemblies (like “8″ PVC water main per LF”). Drop an assembly on a bid line item and the whole cost buildup comes with it.',
  },
  {
    target: 'jobs',
    title: 'Jobs & Bids',
    body: 'This is where bids come together. Create a job, build the estimate by section and line item, apply overhead, profit, bond, and tax markups, track quotes, and export a professional bid proposal PDF.',
  },
  {
    target: 'tools',
    title: 'Takeoff Tools',
    body: 'Measure quantities straight from your plans: load a PDF, calibrate the scale, draw pipe runs and areas, and send measured quantities into your estimate. The trench profiler calculates excavation and backfill volumes.',
  },
  {
    target: 'settings',
    title: 'Settings',
    body: 'Company info for your proposals, default markup percentages, and database backup & restore. Make a backup once your pricing is dialed in — everything lives locally on this machine.',
  },
  {
    target: null,
    route: '/jobs',
    title: 'You’re all set',
    body: 'A good first session: check your Materials prices, build a crew or two, then create your first job in Jobs & Bids. Press ? anytime to see keyboard shortcuts, and replay this tour from Settings.',
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
  const [stepIndex, setStepIndex] = useState(0);
  const [rect, setRect] = useState<Rect | null>(null);
  // Direction of travel so steps with a missing target (e.g. no takeoff
  // tools registered) get skipped the way the user is heading
  const dirRef = useRef(1);

  const goTo = (i: number) => {
    dirRef.current = i >= stepIndex ? 1 : -1;
    setStepIndex(i);
  };

  // Reset to the first step each time the tour opens
  useEffect(() => {
    if (isOpen) {
      dirRef.current = 1;
      setStepIndex(0);
    }
  }, [isOpen]);

  const step = STEPS[stepIndex];

  // Measure the spotlight target before paint; if the target isn't in
  // the DOM, hop over the step in the current direction of travel
  useLayoutEffect(() => {
    if (!isOpen) return;
    if (step.target && !document.querySelector(`[data-tour="${step.target}"]`)) {
      const next = stepIndex + dirRef.current;
      if (next < 0 || next >= STEPS.length) close();
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
  }, [isOpen, step, stepIndex, close, navigate]);

  useEffect(() => {
    if (!isOpen) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        close();
      } else if (e.key === 'ArrowRight' || e.key === 'Enter') {
        e.preventDefault();
        if (stepIndex < STEPS.length - 1) goTo(stepIndex + 1);
        else close();
      } else if (e.key === 'ArrowLeft') {
        e.preventDefault();
        goTo(Math.max(0, stepIndex - 1));
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [isOpen, stepIndex, close]);

  if (!isOpen) return null;

  const isLast = stepIndex === STEPS.length - 1;
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
          {STEPS.map((_, i) => (
            <div key={i} className={`tour-dot ${i === stepIndex ? 'active' : ''}`}
              onClick={() => goTo(i)} />
          ))}
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
