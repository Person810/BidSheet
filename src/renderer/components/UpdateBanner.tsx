import React, { useState, useEffect } from 'react';

type UpdateState =
  | { status: 'idle' }
  | { status: 'checking' }
  | { status: 'available'; version: string }
  | { status: 'up-to-date'; version: string }
  | { status: 'downloading'; percent: number }
  | { status: 'downloaded'; version: string }
  | { status: 'error'; error: string };

export function UpdateBanner() {
  const [state, setState] = useState<UpdateState>({ status: 'idle' });
  const [appVersion, setAppVersion] = useState('');

  useEffect(() => {
    window.api.getAppVersion().then((v: string) => setAppVersion(v));

    const cleanup = window.api.onUpdateStatus((data: any) => {
      setState(data as UpdateState);
    });

    return cleanup;
  }, []);

  const handleCheck = () => {
    setState({ status: 'checking' });
    window.api.checkForUpdate();
  };

  const handleDownload = () => {
    window.api.downloadUpdate();
  };

  const handleInstall = () => {
    window.api.installUpdate();
  };

  return (
    <div>
      <p style={{ fontSize: 13, marginBottom: 12 }}>
        Current version: <strong>v{appVersion || '...'}</strong>
      </p>

      {state.status === 'idle' && (
        <button className="btn btn-secondary" onClick={handleCheck}>
          Check for Updates
        </button>
      )}

      {state.status === 'checking' && (
        <span className="text-muted" style={{ fontSize: 13 }}>Checking for updates...</span>
      )}

      {state.status === 'up-to-date' && (
        <div className="flex gap-8 items-center">
          <span className="text-success" style={{ fontSize: 13 }}>You're on the latest version.</span>
          <button className="btn btn-secondary" onClick={handleCheck} style={{ fontSize: 12 }}>
            Check Again
          </button>
        </div>
      )}

      {state.status === 'available' && (
        <div className="flex gap-8 items-center">
          <span style={{ fontSize: 13 }}>
            <strong>v{state.version}</strong> is available!
          </span>
          <button className="btn btn-primary" onClick={handleDownload}>
            Download Update
          </button>
        </div>
      )}

      {state.status === 'downloading' && (
        <div>
          <span className="text-muted" style={{ fontSize: 13 }}>
            Downloading... {state.percent}%
          </span>
          <div style={{
            marginTop: 6,
            height: 6,
            borderRadius: 3,
            background: 'var(--border-color, #333)',
            overflow: 'hidden',
            maxWidth: 300,
          }}>
            <div style={{
              height: '100%',
              width: `${state.percent}%`,
              background: 'var(--primary, #3b82f6)',
              borderRadius: 3,
              transition: 'width 0.3s ease',
            }} />
          </div>
        </div>
      )}

      {state.status === 'downloaded' && (
        <div className="flex gap-8 items-center">
          <span style={{ fontSize: 13 }}>
            <strong>v{state.version}</strong> is ready to install.
          </span>
          <button className="btn btn-primary" onClick={handleInstall}>
            Restart & Install
          </button>
        </div>
      )}

      {state.status === 'error' && (
        <div className="flex gap-8 items-center">
          <span style={{ fontSize: 13, color: 'var(--danger, #ef4444)' }}>
            Update check failed: {state.error}
          </span>
          <button className="btn btn-secondary" onClick={handleCheck} style={{ fontSize: 12 }}>
            Retry
          </button>
        </div>
      )}
    </div>
  );
}
