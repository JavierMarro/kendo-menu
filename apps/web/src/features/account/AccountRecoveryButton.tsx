import { useManagedAuth } from '../../lib/managed-auth-context';

export function AccountRecoveryButton({
  className = 'primary-button',
  verificationLabel = 'Retry account check',
}: {
  readonly className?: string;
  readonly verificationLabel?: string;
}) {
  const { identity, signOutProvider, verifyIdentity } = useManagedAuth();
  const signOut = identity.status === 'unavailable' ? identity.signOut : undefined;

  return (
    <button
      className={className}
      type="button"
      disabled={signOut === 'pending'}
      onClick={() => void (signOut === 'failed' ? signOutProvider() : verifyIdentity())}
    >
      {signOut === 'pending'
        ? 'Signing out…'
        : signOut === 'failed'
          ? 'Retry sign-out'
          : verificationLabel}
    </button>
  );
}
