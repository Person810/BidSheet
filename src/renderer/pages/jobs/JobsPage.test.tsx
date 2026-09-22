/**
 * The open job lives in JobsPage state, not the URL, so the sidebar's
 * "Jobs & Bids" link lands on the route already showing. It must still take
 * the user back to the list (from a job or its takeoff), while the
 * Dashboard's /jobs?open=<id> hand-off keeps opening that job.
 */
import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Link, Routes, Route } from 'react-router-dom';

vi.mock('./JobList', () => ({
  JobList: ({ onOpenJob }: { onOpenJob: (id: number) => void }) => (
    <div>
      <p>job list</p>
      <button onClick={() => onOpenJob(7)}>open job 7</button>
    </div>
  ),
}));
vi.mock('./JobDetail', () => ({
  JobDetail: ({ jobId, onOpenTakeoff }: { jobId: number; onOpenTakeoff: () => void }) => (
    <div>
      <p>job detail {jobId}</p>
      <button onClick={onOpenTakeoff}>takeoff</button>
    </div>
  ),
}));
vi.mock('../../modules/underground/plan-takeoff/PlanTakeoff', () => ({
  PlanTakeoff: ({ jobId }: { jobId: number }) => <p>takeoff {jobId}</p>,
}));

import { JobsPage } from './index';

function renderAt(url: string) {
  render(
    <MemoryRouter initialEntries={[url]}>
      <Link to="/jobs">Jobs &amp; Bids</Link>
      <Routes>
        <Route path="/jobs" element={<JobsPage />} />
      </Routes>
    </MemoryRouter>,
  );
  return userEvent.setup();
}

describe('JobsPage sidebar navigation', () => {
  it('returns to the list when the sidebar link is clicked from a job', async () => {
    const user = renderAt('/jobs');
    await user.click(screen.getByText('open job 7'));
    expect(screen.getByText('job detail 7')).toBeInTheDocument();
    await user.click(screen.getByText('Jobs & Bids'));
    expect(screen.getByText('job list')).toBeInTheDocument();
  });

  it('returns to the list from the plan takeoff too', async () => {
    const user = renderAt('/jobs');
    await user.click(screen.getByText('open job 7'));
    await user.click(screen.getByText('takeoff'));
    expect(screen.getByText('takeoff 7')).toBeInTheDocument();
    await user.click(screen.getByText('Jobs & Bids'));
    expect(screen.getByText('job list')).toBeInTheDocument();
  });

  it('still opens the job handed over by /jobs?open=<id>', async () => {
    renderAt('/jobs?open=12');
    expect(await screen.findByText('job detail 12')).toBeInTheDocument();
  });
});
