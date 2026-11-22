import { AlertTriangle, CheckCircle2, Loader2, PowerOff } from 'lucide-react';
import type { ServerStatus } from '../../../shared/types';

export function StatusBadge({ status }: { status: ServerStatus }) {
  if (status === 'online') {
    return (
      <span className="badge badge-online">
        <CheckCircle2 size={14} aria-hidden="true" />
        Online
      </span>
    );
  }
  if (status === 'starting' || status === 'stopping' || status === 'installing') {
    const label = status === 'starting' ? 'Starting' : status === 'stopping' ? 'Stopping' : 'Installing';
    return (
      <span className="badge badge-warn">
        <Loader2 size={14} className="spin" aria-hidden="true" />
        {label}
      </span>
    );
  }
  if (status === 'crashed') {
    return (
      <span className="badge badge-danger">
        <AlertTriangle size={14} aria-hidden="true" />
        Crashed
      </span>
    );
  }
  return (
    <span className="badge badge-offline">
      <PowerOff size={14} aria-hidden="true" />
      Offline
    </span>
  );
}
