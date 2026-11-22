import React from 'react';
import { useOnlineStatus } from '../hooks/usePWAInstall';

export const OfflineIndicator: React.FC = () => {
  const isOnline = useOnlineStatus();
  if (isOnline) return null;

  return (
    <div className="fixed top-2 left-1/2 -translate-x-1/2 z-40 px-3 py-1 rounded border border-amber-400/60 bg-[#0b1826] text-amber-300 text-xs font-mono-tabular shadow-lg pointer-events-none">
      Offline Mode · Local Cache Active
    </div>
  );
};
