import { useEffect, useRef } from 'react';
import { useRegisterSW } from 'virtual:pwa-register/react';

import { ServiceWorkerUpdateNotice } from './ServiceWorkerUpdateNotice';

export function ServiceWorkerUpdates() {
  const registration = useRef<ServiceWorkerRegistration | undefined>(undefined);
  const {
    needRefresh: [updateAvailable, setUpdateAvailable],
    updateServiceWorker,
  } = useRegisterSW({
    immediate: true,
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
      onUpdate={() => updateServiceWorker(true)}
      onLater={() => setUpdateAvailable(false)}
    />
  ) : null;
}
