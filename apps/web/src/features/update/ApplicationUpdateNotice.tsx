import { useRef, useState, type ReactElement } from 'react';

import { useRegisterSW } from 'virtual:pwa-register/react';

import { reloadApplication } from '../../lib/application-reload';

export function ApplicationUpdateNotice(): ReactElement {
  const reloadAllowedRef = useRef(false);
  const [reloadReady, setReloadReady] = useState(false);
  const {
    needRefresh: [needRefresh, setNeedRefresh],
    updateServiceWorker,
  } = useRegisterSW({
    immediate: true,
    onNeedReload: () => {
      if (reloadAllowedRef.current) {
        reloadApplication();
        return;
      }

      // Another tab may have activated the worker. Keep this tab's work intact and
      // let its practitioner confirm the reload explicitly.
      setReloadReady(true);
    },
  });

  const isNoticeVisible = needRefresh || reloadReady;

  const handleUpdate = (): void => {
    reloadAllowedRef.current = true;

    if (reloadReady) {
      reloadApplication();
      return;
    }

    void updateServiceWorker().catch(() => {
      // The notice remains available when the browser cannot activate the worker.
      reloadAllowedRef.current = false;
    });
  };

  const handleLater = (): void => {
    reloadAllowedRef.current = false;
    setReloadReady(false);
    setNeedRefresh(false);
  };

  return (
    <>
      <p className="sr-only" role="status" aria-live="polite" aria-atomic="true">
        {isNoticeVisible ? 'A new version of KendoMenu is available.' : ''}
      </p>
      {isNoticeVisible ? (
        <aside
          className="update-notice"
          aria-label="Application update"
          aria-describedby="update-notice-message update-notice-description"
        >
          <div className="update-notice-copy">
            <p id="update-notice-message">A new version of KendoMenu is available.</p>
            <p id="update-notice-description">
              Updating reloads this page. Save any unfinished session work first.
            </p>
          </div>
          <div className="update-notice-actions">
            <button className="primary-button" type="button" onClick={handleUpdate}>
              Update now
            </button>
            <button className="text-button" type="button" onClick={handleLater}>
              Later
            </button>
          </div>
        </aside>
      ) : null}
    </>
  );
}
