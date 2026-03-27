import React, { useState } from 'react';
import { JobList } from './JobList';
import { JobDetail } from './JobDetail';

type View = 'list' | 'detail';

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

  return view === 'list' ? (
    <JobList onOpenJob={openJob} />
  ) : (
    <JobDetail jobId={selectedJobId!} onBack={backToList} />
  );
}
