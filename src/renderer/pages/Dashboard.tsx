import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { formatDateLocal, formatCurrency, statusBadge } from './jobs/helpers';

function statCardClass(type: string, value: number): string {
  if (type === 'drafts' && value > 0) return 'card stat-card-info';
  if (type === 'winrate' && value >= 50) return 'card stat-card-success';
  if (type === 'winrate' && value > 0 && value < 50) return 'card stat-card-warn';
  return 'card';
}

function daysUntilBid(bidDate: string): number | null {
  const match = bidDate.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!match) return null;
  const target = new Date(+match[1], +match[2] - 1, +match[3]);
  const now = new Date();
  now.setHours(0, 0, 0, 0);
  return Math.ceil((target.getTime() - now.getTime()) / 86400000);
}

export function Dashboard() {
  const [jobs, setJobs] = useState<any[]>([]);
  const [settings, setSettings] = useState<any>(null);
  const navigate = useNavigate();
  const [dueSoonJobs, setDueSoonJobs] = useState<any[]>([]);
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

        // Get bid totals for submitted + won jobs (single batch IPC call)
        let totalVolume = 0;
        const bidJobIds = allJobs
          .filter((j: any) => j.status === 'submitted' || j.status === 'won')
          .map((j: any) => j.id);
        if (bidJobIds.length > 0) {
          const summaries = await window.api.getBidSummaryBatch(bidJobIds);
          for (const s of summaries) {
            if (s) totalVolume += s.grandTotal;
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

        const dueSoon = allJobs.filter((j: any) => {
          if (j.status !== 'draft' && j.status !== 'submitted') return false;
          if (!j.bid_date) return false;
          const d = daysUntilBid(j.bid_date);
          return d !== null && d >= 0 && d <= 7;
        });
        setDueSoonJobs(dueSoon);
      }
    );
  }, []);

  const recentJobs = jobs.slice(0, 10);



  return (
    <div>
      <div className="page-header">
        <h2>
          {settings?.company_name ? `${settings.company_name}` : 'Dashboard'}
        </h2>
      </div>

      <div className="card-grid">
        <div className={statCardClass('drafts', stats.drafts)}>
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
        <div className={statCardClass('winrate', stats.winRate)}>
          <div className="stat-value" style={
            stats.won + stats.lost > 0
              ? { color: stats.winRate >= 50 ? 'var(--success)' : 'var(--warning)' }
              : {}
          }>
            {stats.won + stats.lost > 0 ? `${stats.winRate}%` : '--'}
          </div>
          <div className="stat-label">
            Win Rate ({stats.won}W / {stats.lost}L)
          </div>
        </div>
      </div>

      {dueSoonJobs.length > 0 && (
        <div className="due-soon-banner mb-16">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#f59e0b" strokeWidth="2.5" strokeLinecap="round" style={{ flexShrink: 0 }}>
            <circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/>
          </svg>
          <span style={{ fontWeight: 500 }}>
            {dueSoonJobs.length} bid{dueSoonJobs.length > 1 ? 's' : ''} due within 7 days
          </span>
          <span style={{ color: 'var(--text-muted)', fontSize: 12, marginLeft: 4 }}>
            {dueSoonJobs.map((j: any) => {
              const d = daysUntilBid(j.bid_date);
              return `${j.name} (${d === 0 ? 'Today' : d + 'd'})`;
            }).join(' \u00b7 ')}
          </span>
        </div>
      )}

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
              {recentJobs.map((job: any) => {
                const d = job.bid_date ? daysUntilBid(job.bid_date) : null;
                const isUrgent = d !== null && d >= 0 && d <= 7 && (job.status === 'draft' || job.status === 'submitted');
                return (
                  <tr key={job.id} className="clickable-row" title="Open job"
                      onClick={() => navigate(`/jobs?open=${job.id}`)}
                      style={isUrgent ? { borderLeft: '3px solid var(--warning)' } : {}}>
                    <td style={{ fontWeight: 500 }}>{job.name}</td>
                    <td className="text-muted">{job.client || '--'}</td>
                    <td className="text-muted">
                      {job.bid_date ? (
                        <>
                          <span style={isUrgent ? { color: 'var(--warning)' } : {}}>
                            {formatDateLocal(job.bid_date)}
                          </span>
                          {isUrgent && (
                            <span className="due-soon-badge">{d === 0 ? 'Today' : d + 'd'}</span>
                          )}
                        </>
                      ) : '--'}
                    </td>
                    <td>{statusBadge(job.status)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
