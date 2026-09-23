import React, { useState, useEffect, useRef } from 'react';
import { useLocation, useSearchParams } from 'react-router-dom';
import { JobList } from './JobList';
import { JobDetail } from './JobDetail';
import { PlanTakeoff } from '../../modules/underground/plan-takeoff/PlanTakeoff';

type View = 'list' | 'detail' | 'takeoff';

export function JobsPage() {
  const [view, setView] = useState<View>('list');
  const [selectedJobId, setSelectedJobId] = useState<number | null>(null);
  const [searchParams, setSearchParams] = useSearchParams();
  // ?new=1 (from the Dashboard's empty state) opens the New Job form once.
  const [createRequested, setCreateRequested] = useState(false);

  useEffect(() => {
    const openId = searchParams.get('open');
    if (openId) {
      openJob(Number(openId));
      setSearchParams({}, { replace: true });
    } else if (searchParams.get('new')) {
      setCreateRequested(true);
      setSearchParams({}, { replace: true });
    }
  }, [searchParams]);

  // The open job lives in local state, not the URL, so clicking "Jobs & Bids"
  // in the sidebar while a job (or its takeoff) was open landed on the same
  // route and left the user stuck there. Any later navigation to /jobs means
  // "show me the list" — except the ?open= hand-off above, which arrives with
  // the id and then replaces itself away (so skip the step after it too).
  // react-router makes a same-URL link click a REPLACE with a fresh key, so
  // the key, not the navigation type, is what marks a new navigation.
  const location = useLocation();
  const lastLocation = useRef({ key: location.key, search: location.search });
  useEffect(() => {
    const prev = lastLocation.current;
    lastLocation.current = { key: location.key, search: location.search };
    if (location.key === prev.key) return;
    const params = (search: string) => new URLSearchParams(search).get('open');
    if (!params(location.search) && !params(prev.search)) backToList();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- runs once per navigation (key), reading the location it belongs to
  }, [location.key]);

  const openJob = (id: number) => {
    setSelectedJobId(id);
    setView('detail');
  };

  const backToList = () => {
    setSelectedJobId(null);
    setView('list');
  };

  const openTakeoff = () => setView('takeoff');
  const backToDetail = () => setView('detail');

  if (view === 'takeoff' && selectedJobId) {
    return <PlanTakeoff jobId={selectedJobId} onBack={backToDetail} />;
  }

  return view === 'list' ? (
    <JobList onOpenJob={openJob} createRequested={createRequested}
      onCreateHandled={() => setCreateRequested(false)} />
  ) : (
    <JobDetail jobId={selectedJobId!} onBack={backToList} onOpenJob={openJob} onOpenTakeoff={openTakeoff} />
  );
}
