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
    body: "Your catalog is loaded and you're ready to estimate. This short tour follows a bid from start to finish: pricing your catalog, measuring plans, and sending a proposal. It takes about two minutes, and you can replay it anytime from Settings.",
  },
  {
    target: 'dashboard',
    title: 'Dashboard',
    body: 'Your bid pipeline at a glance: active drafts, submitted bids, win rate, and total bid volume, plus a heads-up on anything due in the next week. Mark jobs won or lost and the numbers keep themselves up to date.',
  },
  {
    target: 'materials',
    title: 'Materials',
    body: 'Your material catalog, with unit prices and full price history. Start here: review the seeded items and update prices to match your suppliers. Got a supplier price sheet? Import Prices reads the CSV and matches it to your catalog.',
  },
  {
    target: 'labor',
    title: 'Labor & Crews',
    body: 'Set up labor roles with burdened hourly rates, combine them into crew templates, and dial in production rates (like feet of pipe per day). Accurate crews drive the labor cost on every bid.',
  },
  {
    target: 'equipment',
    title: 'Equipment',
    body: 'Hourly costs for owned and rented equipment: excavators, loaders, trench boxes. Attach equipment to crews and assemblies and it flows into your estimates automatically.',
  },
  {
    target: 'assemblies',
    title: 'Assemblies',
    body: 'Bundle materials, labor, and equipment into reusable per-unit assemblies (like "8″ PVC water main per LF"). Drop one on a bid line item and the whole cost buildup comes with it. Starter assemblies for your trades are already here to tweak.',
  },
  {
    target: 'clients',
    title: 'Clients',
    body: 'The GCs, municipalities, and owners you bid for. Save their contact details once and they fill in automatically when you start a new job.',
  },
  {
    target: 'jobs',
    title: 'Jobs & Bids',
    body: 'Where bids come together. Create a job, build the estimate by section and line item, and apply overhead, profit, bond, tax, and escalation, with per-section overrides and alternates when you need them. Every calculated number opens up to show its math.',
  },
  {
    target: 'jobs',
    title: 'Plan Takeoff',
    body: 'Every job includes plan takeoff. Load the plan PDF, calibrate the scale, then draw pipe runs, measure areas, and count fixtures. Check trenches in 3D, then send the quantities straight into your estimate or out to CSV.',
  },
  {
    target: 'jobs',
    title: 'Quotes, Changes & Reports',
    body: 'Inside a job you can also compare subcontractor and supplier quotes and pick a winner per scope, log change orders after the win, and pull cost-code roll-ups, unit price schedules, and estimate comparisons.',
  },
  {
    target: 'tools-underground',
    title: 'Utility Tools',
    body: 'The Trench Profiler works out a pipe run on its own: depth along the grade, excavation, bedding, and backfill volumes, with a 3D view of the trench. A fast check on a single run without opening a job.',
  },
  {
    target: 'tools-concrete',
    title: 'Concrete Tools',
    body: 'Quick answers for concrete work: size up slabs, footings, and walls to get volume with waste, formwork contact area, and rebar. Handy for sanity checks before anything hits a bid.',
  },
  {
    target: 'tools-tools',
    title: 'Your Tools',
    body: "The trade calculators you picked in Settings, like the Trench Profiler and Concrete Calculator. They're for quick answers on their own, before anything hits a bid.",
  },
  {
    target: 'settings',
    title: 'Settings',
    body: 'Company info and logo for your proposals, default markups, proposal templates, and backup & restore. Make a backup once your pricing is dialed in. Everything lives on this machine; cloud sync is optional and set up here.',
  },
  {
    target: null,
    route: '/jobs',
    title: "You're all set",
    body: 'A good first session: check your Materials prices, build a crew or two, then create your first job in Jobs & Bids and take it all the way to a proposal PDF. Press ? anytime to see keyboard shortcuts.',
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
  // Rendered height of the card, so it can be kept fully on screen next to
  // targets near the bottom of the sidebar (the copy varies in length)
  const [cardHeight, setCardHeight] = useState(0);
  const cardRef = useRef<HTMLDivElement>(null);
  const primaryRef = useRef<HTMLButtonElement>(null);
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

  // Measure the card after each step renders (before paint), and move focus
  // to the primary button so Enter / Space advance the tour and the dialog
  // is announced to screen readers.
  useLayoutEffect(() => {
    if (!isOpen || !cardRef.current) return;
    setCardHeight(cardRef.current.offsetHeight);
    primaryRef.current?.focus({ preventScroll: true });
  }, [isOpen, step, rect]);

  useEffect(() => {
    if (!isOpen) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        close();
      } else if (e.key === 'ArrowRight' || e.key === 'Enter') {
        // Enter on a focused tour button (Back, a progress dot) should do
        // what that button says, not jump forward
        if (e.key === 'Enter' && (e.target as HTMLElement | null)?.closest?.('.tour-tooltip button')) return;
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

  const isFirst = stepIndex === 0;
  const isLast = stepIndex === steps.length - 1;
  const spotlightRect = step.target ? rect : null;

  // Tooltip sits to the right of spotlighted sidebar items, clamped to
  // the viewport, with a small arrow pointing back at the item; the
  // welcome/finish steps are flex-centered by the dimmed overlay instead
  let tooltipStyle: React.CSSProperties | undefined;
  let arrowTop = 0;
  if (spotlightRect) {
    const margin = 12;
    const h = cardHeight || 240;
    const top = Math.max(
      margin,
      Math.min(spotlightRect.top - 8, window.innerHeight - h - margin)
    );
    tooltipStyle = { top, left: spotlightRect.left + spotlightRect.width + 16 };
    arrowTop = Math.max(
      14,
      Math.min(spotlightRect.top + spotlightRect.height / 2 - top, h - 14)
    );
  }

  return (
    <div className={`tour-overlay ${spotlightRect ? '' : 'tour-overlay-dim'}`}
      role="dialog" aria-modal="true" aria-labelledby="tour-title"
      aria-describedby="tour-body">
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
      <div ref={cardRef}
        className={`tour-tooltip ${spotlightRect ? '' : 'tour-tooltip-centered'}`}
        style={tooltipStyle}>
        {spotlightRect && <div className="tour-arrow" style={{ top: arrowTop }} />}
        {/* Keyed by step so the copy fades in fresh each time */}
        <div key={stepIndex} className="tour-content">
          {!spotlightRect && (
            <img className="tour-mark" src="./icon.png" alt="" aria-hidden="true" />
          )}
          <div className="tour-eyebrow">
            {isFirst ? 'Quick tour' : isLast ? 'Tour complete' : `Step ${stepIndex} of ${steps.length - 2}`}
          </div>
          <h4 id="tour-title">{step.title}</h4>
          <p id="tour-body">{step.body}</p>
        </div>
        <div className="tour-dots">
          {steps.map((s, i) => (
            <button key={i} type="button" tabIndex={-1}
              className={`tour-dot ${i === stepIndex ? 'active' : ''} ${i < stepIndex ? 'done' : ''}`}
              title={s.title} aria-label={`Go to step: ${s.title}`}
              onClick={() => goTo(i)} />
          ))}
        </div>
        <div className="tour-nav">
          {isLast ? (
            <span className="tour-hint">Replay anytime from Settings</span>
          ) : (
            <button className="tour-skip" onClick={close}>
              Skip tour
            </button>
          )}
          <div className="flex gap-8 items-center">
            {!isFirst && (
              <button className="btn btn-secondary btn-sm"
                onClick={() => goTo(stepIndex - 1)}>
                Back
              </button>
            )}
            <button ref={primaryRef} className="btn btn-primary btn-sm"
              onClick={() => (isLast ? close() : goTo(stepIndex + 1))}>
              {isFirst ? 'Start tour' : isLast ? 'Get started' : 'Next'}
            </button>
          </div>
        </div>
        {isFirst && (
          <div className="tour-keys">
            <kbd>←</kbd> <kbd>→</kbd> to move around · <kbd>Esc</kbd> to close
          </div>
        )}
      </div>
    </div>
  );
}
