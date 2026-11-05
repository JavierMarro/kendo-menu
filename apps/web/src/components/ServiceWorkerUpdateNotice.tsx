import { useState } from 'react';

interface ServiceWorkerUpdateNoticeProps {
  readonly onUpdate: () => Promise<void>;
  readonly onLater: () => void;
}

export function ServiceWorkerUpdateNotice({ onUpdate, onLater }: ServiceWorkerUpdateNoticeProps) {
  const [failed, setFailed] = useState(false);

  const update = async () => {
    setFailed(false);
    try {
      await onUpdate();
    } catch {
      setFailed(true);
    }
  };

  return (
    <aside
      className="service-worker-update"
      role="region"
      aria-label="Update available"
      aria-live="polite"
    >
      <p>
        A new version is ready. Save any changes before updating; the page will reload.
        {failed && ' The update could not start. Please try again.'}
      </p>
      <div className="service-worker-update-actions">
        <button className="primary-button" type="button" onClick={() => void update()}>
          Update
        </button>
        <button className="secondary-button" type="button" onClick={onLater}>
          Later
        </button>
      </div>
    </aside>
  );
}
