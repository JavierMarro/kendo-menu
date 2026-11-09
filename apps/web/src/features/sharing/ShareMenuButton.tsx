import { useEffect, useId, useRef, useState } from 'react';
import type { DashboardEntry } from '@kendo-menu/domain';

import { DialogShell } from '../../components/DialogShell';
import { AccountApiError } from '../../lib/account-api';
import { useWorkspace } from '../../lib/workspace-context';

export function ShareMenuButton({ entry }: { readonly entry: DashboardEntry }) {
  const workspace = useWorkspace();
  const titleId = useId();
  const trigger = useRef<HTMLButtonElement>(null);
  const linkInput = useRef<HTMLInputElement>(null);
  const request = useRef<AbortController | null>(null);
  const [open, setOpen] = useState(false);
  const [pending, setPending] = useState(false);
  const [link, setLink] = useState('');
  const [message, setMessage] = useState('');
  const saved = workspace.getSavedEntry?.(entry.id) ?? null;

  useEffect(() => () => request.current?.abort(), []);
  useEffect(() => {
    if (open && link.length > 0) linkInput.current?.focus();
  }, [open, link]);
  if (workspace.kind !== 'account') return null;

  const close = () => {
    request.current?.abort();
    setOpen(false);
    setPending(false);
    // DialogShell removes inert during unmount; focus only after that cleanup.
    requestAnimationFrame(() => {
      if (trigger.current?.disabled === false) trigger.current.focus();
      else document.getElementById('main-content')?.focus();
    });
  };
  const createLink = async () => {
    if (pending || !workspace.canShare || workspace.createMenuShare === undefined) return;
    const controller = new AbortController();
    request.current?.abort();
    request.current = controller;
    setPending(true);
    setMessage('');
    try {
      const result = await workspace.createMenuShare(entry.id, controller.signal);
      if (!controller.signal.aborted) {
        setLink(new URL(`/app/shared/${result.token}`, window.location.origin).href);
      }
    } catch (error) {
      if (!controller.signal.aborted) {
        setMessage(
          error instanceof AccountApiError && error.status === 409
            ? 'Your saved dashboard changed. Resolve your account save or reload before sharing again.'
            : 'The sharing link could not be created. Check your connection and try again.',
        );
      }
    } finally {
      if (!controller.signal.aborted) setPending(false);
    }
  };
  const copyLink = async () => {
    try {
      await navigator.clipboard.writeText(link);
      setMessage('Link copied.');
    } catch {
      setMessage('Select the link below and copy it manually.');
    }
  };

  return (
    <>
      <button
        ref={trigger}
        type="button"
        className="text-button share-menu-trigger"
        disabled={!workspace.canShare && workspace.saveLabel !== 'conflict'}
        onClick={() => {
          setLink('');
          setMessage('');
          setOpen(true);
        }}
      >
        Share it!
      </button>
      {open ? (
        <DialogShell titleId={titleId} closeLabel="Close sharing" onClose={close}>
          <section className="share-menu-content">
            <h2 id={titleId}>Share your keiko menu</h2>
            <p>Anyone with the link can view this menu. Your notes stay private.</p>
            {saved === null ? (
              <p>Save this menu to your account before sharing it.</p>
            ) : (
              <>
                <p>
                  This shares your last saved version. Save to account first to include your
                  changes.
                </p>
                <p>The shared snapshot stays the same if you edit or remove this menu later.</p>
                {link.length === 0 ? (
                  <button
                    className="primary-button"
                    type="button"
                    aria-disabled={pending || !workspace.canShare}
                    aria-busy={pending}
                    onClick={() => void createLink()}
                  >
                    {pending ? 'Creating link…' : 'Create sharing link'}
                  </button>
                ) : (
                  <>
                    <label htmlFor={`${titleId}-link`}>Sharing link</label>
                    <input
                      ref={linkInput}
                      id={`${titleId}-link`}
                      className="share-menu-link"
                      readOnly
                      value={link}
                      onFocus={(event) => event.currentTarget.select()}
                    />
                    <button
                      className="primary-button"
                      type="button"
                      onClick={() => void copyLink()}
                    >
                      Copy link
                    </button>
                    {typeof navigator.share === 'function' ? (
                      <button
                        className="secondary-button"
                        type="button"
                        onClick={() => {
                          void navigator
                            .share({ url: link, title: saved.trainingSet?.name ?? 'Keiko menu' })
                            .catch(() =>
                              setMessage(
                                'Sharing was cancelled or unavailable. You can copy the link instead.',
                              ),
                            );
                        }}
                      >
                        Share link…
                      </button>
                    ) : null}
                  </>
                )}
              </>
            )}
            <p role="status">{message}</p>
          </section>
        </DialogShell>
      ) : null}
    </>
  );
}
