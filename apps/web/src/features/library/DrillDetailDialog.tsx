import { useEffect, useRef, type KeyboardEvent as ReactKeyboardEvent } from 'react';
import { createPortal } from 'react-dom';

import type { TrainingSet } from '@kendo-menu/domain';

import { DrillDetailContent } from './DrillDetailContent';

interface DrillDetailDialogProps {
  readonly onClose: () => void;
  readonly trainingSet: TrainingSet;
}

const FOCUSABLE_SELECTOR = [
  'a[href]',
  'button:not([disabled])',
  'input:not([disabled])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  'summary',
  '[tabindex]:not([tabindex="-1"])',
].join(',');

function getFocusableElements(dialog: HTMLElement): readonly HTMLElement[] {
  return [...dialog.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)]
    .filter(
      (element) =>
        element.getAttribute('aria-hidden') !== 'true' && element.closest('[hidden]') === null,
    )
    .filter((element) => !isHiddenByClosedDetails(element));
}

function isHiddenByClosedDetails(element: HTMLElement): boolean {
  let ancestor = element.parentElement;
  while (ancestor !== null) {
    if (ancestor instanceof HTMLDetailsElement && !ancestor.open) {
      const isOwnSummary = element.tagName === 'SUMMARY' && element.parentElement === ancestor;
      if (!isOwnSummary) {
        return true;
      }
    }
    ancestor = ancestor.parentElement;
  }

  return false;
}

function restoreAttribute(element: HTMLElement, name: string, previousValue: string | null): void {
  if (previousValue === null) {
    element.removeAttribute(name);
    return;
  }

  element.setAttribute(name, previousValue);
}

export function DrillDetailDialog({ onClose, trainingSet }: DrillDetailDialogProps) {
  const dialogRef = useRef<HTMLDivElement>(null);
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  const titleId = `drill-dialog-title-${trainingSet.id}`;
  const closeLabel = `Close ${trainingSet.name} details.`;

  useEffect(() => {
    const applicationRoot =
      document.getElementById('root') ?? document.querySelector('.app-shell')?.parentElement;
    const previousInert = applicationRoot?.getAttribute('inert') ?? null;
    const previousAriaHidden = applicationRoot?.getAttribute('aria-hidden') ?? null;

    document.documentElement.classList.add('drill-dialog-open');
    document.body.classList.add('drill-dialog-open');
    closeButtonRef.current?.focus({ preventScroll: true });
    applicationRoot?.setAttribute('inert', '');
    applicationRoot?.setAttribute('aria-hidden', 'true');

    return () => {
      if (applicationRoot !== undefined && applicationRoot !== null) {
        restoreAttribute(applicationRoot, 'inert', previousInert);
        restoreAttribute(applicationRoot, 'aria-hidden', previousAriaHidden);
      }
      document.documentElement.classList.remove('drill-dialog-open');
      document.body.classList.remove('drill-dialog-open');
    };
  }, []);

  const handleKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      onClose();
      return;
    }

    if (event.key !== 'Tab' || dialogRef.current === null) {
      return;
    }

    const focusableElements = getFocusableElements(dialogRef.current);
    const firstElement = focusableElements[0];
    const lastElement = focusableElements.at(-1);

    if (firstElement === undefined || lastElement === undefined) {
      event.preventDefault();
      dialogRef.current.focus();
      return;
    }

    const activeElement = document.activeElement;
    if (
      event.shiftKey &&
      (activeElement === firstElement || !dialogRef.current.contains(activeElement))
    ) {
      event.preventDefault();
      lastElement.focus();
      return;
    }

    if (!event.shiftKey && activeElement === lastElement) {
      event.preventDefault();
      firstElement.focus();
    }
  };

  return createPortal(
    <div className="drill-dialog-layer">
      <button
        className="drill-dialog-backdrop"
        type="button"
        tabIndex={-1}
        aria-hidden="true"
        onClick={onClose}
      />
      <div
        ref={dialogRef}
        className="drill-dialog-panel"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        onKeyDown={handleKeyDown}
      >
        <div className="drill-dialog-toolbar">
          <button
            ref={closeButtonRef}
            className="drill-dialog-close"
            type="button"
            aria-label={closeLabel}
            onClick={onClose}
          >
            <svg aria-hidden="true" viewBox="0 0 24 24">
              <path d="M6 6l12 12M18 6L6 18" />
            </svg>
          </button>
        </div>
        <div className="drill-dialog-scroll">
          <DrillDetailContent titleId={titleId} trainingSet={trainingSet} />
        </div>
      </div>
    </div>,
    document.body,
  );
}
