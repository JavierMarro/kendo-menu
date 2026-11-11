import { useEffect, useRef } from 'react';
import { useRegisterSW } from 'virtual:pwa-register/react';

import { ServiceWorkerUpdateNotice } from './ServiceWorkerUpdateNotice';

export function ServiceWorkerUpdates() {
  const registration = useRef<ServiceWorkerRegistration | undefined>(undefined);
  const reloadPending = useRef(false);
  const {
    needRefresh: [updateAvailable, setUpdateAvailable],
    updateServiceWorker,
  } = useRegisterSW({
    immediate: true,
    onNeedRefresh: () => {
      reloadPending.current = false;
    },
    onNeedReload: () => {
      reloadPending.current = true;
      window.location.reload();
    },
    onRegisteredSW: (_serviceWorkerUrl, value) => {
      registration.current = value;
    },
  });

  useEffect(() => {
    const checkForUpdate = () => {
      if (document.visibilityState === 'visible') {
        void registration.current?.update().catch(() => undefined);
      }
    };
    document.addEventListener('visibilitychange', checkForUpdate);
    return () => document.removeEventListener('visibilitychange', checkForUpdate);
  }, []);

  return updateAvailable ? (
    <ServiceWorkerUpdateNotice
      onUpdate={async () => {
        // A native leave prompt can cancel the reload after the worker takes control.
        if (reloadPending.current) window.location.reload();
        else await updateServiceWorker(true);
      }}
      onLater={() => setUpdateAvailable(false)}
    />
  ) : null;
}
