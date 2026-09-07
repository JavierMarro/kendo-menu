import { useState } from 'react';
import { createRoot } from 'react-dom/client';

import { ApplicationRecovery } from '../src/features/errors/ApplicationRecovery';
import '../src/styles.css';

export function ErrorFixture() {
  const [failed, setFailed] = useState(false);
  if (failed) throw new Error('Private notes https://private.invalid/?share=secret#token');
  return <button onClick={() => setFailed(true)}>Throw render error</button>;
}

const root = document.getElementById('root');
if (root === null) throw new Error('Missing fixture root.');
createRoot(root).render(
  <ApplicationRecovery>
    <ErrorFixture />
  </ApplicationRecovery>,
);
