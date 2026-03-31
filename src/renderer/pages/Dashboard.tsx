import React, { useState, useEffect } from 'react';
import { formatDateLocal } from './jobs/helpers';

export function Dashboard() {
  const [jobs, setJobs] = useState<any[]>([]);
  const [settings, setSettings] = useState<any>(null);
  const [stats, setStats] = useState({
    drafts: 0,
    submitted: 0,
    won: 0,
    lost: 0,
    totalBidVolume: 0,
    winRate: 0,
  });

  useEffect(() => {
    Promise.all([window.api.getJobs(), window.api.getSettings()]).then(
      async ([allJobs, s]) => {
        setJobs(allJobs);
        setSettings(s);

        const drafts = allJobs.filter((j: any) => j.status === 'draft').length;
        const submitted = allJobs.filter((j: any) => j.status === 'submitted').length;
        const won = allJobs.filter((j: any) => j.status === 'won').length;
        const lost = allJobs.filter((j: any) => j.status === 'lost').length;
        const decided = won + lost;

        // Get bid totals for submitted + won jobs
        let totalVolume = 0;
        for (const job of allJobs) {
          if (job.status === 'submitted' || job.status === 'won') {
            const summary = await window.api.getBidSummary(job.id);
            if (summary) totalVolume += summary.grandTotal;
          }
        }

        setStats({
          drafts,
          submitted,
          won,
          lost,
          totalBidVolume: totalVolume,
          winRate: decided > 0 ? Math.round((won / decided) * 100) : 0,
        });
      }
    );
  }, []);

  const recentJobs = jobs.slice(0, 10);

  const statusBadge = (status: string) => {
    const classes: Record<string, string> = {
      draft: 'badge-draft',
      submitted: 'badge-submitted',
      won: 'badge-won',
      lost: 'badge-lost',
      archived: 'badge-draft',
    };
    return <span className={`badge ${classes[status] || 'badge-draft'}`}>{status}</span>;
  };

  const formatCurrency = (val: number) =>
    val.toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });

  return (
    <div>
      <div className="page-header">
        <h2>
          {settings?.company_name ? `${settings.company_name}` : 'Dashboard'}
        </h2>
      </div>

      <div className="card-grid">
        <div className="card">
          <div className="stat-value">{stats.drafts}</div>
          <div className="stat-label">Active Drafts</div>
        </div>
        <div className="card">
          <div className="stat-value">{stats.submitted}</div>
          <div className="stat-label">Bids Submitted</div>
        </div>
        <div className="card">
          <div className="stat-value">{formatCurrency(stats.totalBidVolume)}</div>
          <div className="stat-label">Total Bid Volume</div>
        </div>
        <div className="card">
          <div className="stat-value">
            {stats.won + stats.lost > 0 ? `${stats.winRate}%` : '--'}
          </div>
          <div className="stat-label">
            Win Rate ({stats.won}W / {stats.lost}L)
          </div>
        </div>
      </div>

      <div className="card">
        <h3 style={{ marginBottom: 16 }}>Recent Jobs</h3>
        {recentJobs.length === 0 ? (
          <p className="text-muted">No jobs yet. Create your first bid from the Jobs & Bids page.</p>
        ) : (
          <table className="data-table">
            <thead>
              <tr>
                <th>Job Name</th>
                <th>Client</th>
                <th>Bid Date</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {recentJobs.map((job: any) => (
                <tr key={job.id}>
                  <td style={{ fontWeight: 500 }}>{job.name}</td>
                  <td className="text-muted">{job.client || '--'}</td>
                  <td className="text-muted">
                    {job.bid_date ? formatDateLocal(job.bid_date) : '--'}
                  </td>
                  <td>{statusBadge(job.status)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
