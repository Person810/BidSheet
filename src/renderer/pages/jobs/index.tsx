import React, { useState } from 'react';
import { JobList } from './JobList';
import { JobDetail } from './JobDetail';
import { PlanTakeoff } from '../../modules/underground/plan-takeoff/PlanTakeoff';

type View = 'list' | 'detail' | 'takeoff';

export function JobsPage() {
  const [view, setView] = useState<View>('list');
  const [selectedJobId, setSelectedJobId] = useState<number | null>(null);

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
    <JobList onOpenJob={openJob} />
  ) : (
    <JobDetail jobId={selectedJobId!} onBack={backToList} onOpenJob={openJob} onOpenTakeoff={openTakeoff} />
  );
}
