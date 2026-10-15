import { useState } from 'react';
import { Button } from './Button.js';
import styles from './AccreditationId.module.css';

/** Display only the saved value; undefined means unavailable, null means unissued. */
export function AccreditationId({ value }: { value: string | null | undefined }) {
  const [feedback, setFeedback] = useState<{ id: string; text: string } | null>(null);
  return (
    <div className={styles.id}>
      <strong className={styles.number}>
        {value ?? (value === null ? 'Not Yet Issued' : 'AA number unavailable')}
      </strong>
      {value ? (
        <Button
          type="button"
          variant="secondary"
          size="sm"
          aria-label={`Copy ID ${value}`}
          onKeyDown={(event) => {
            if (event.key === 'Enter' || event.key === ' ') event.stopPropagation();
          }}
          onClick={async (event) => {
            event.stopPropagation();
            try {
              await navigator.clipboard.writeText(value);
              setFeedback({ id: value, text: 'Copied' });
            } catch {
              setFeedback({ id: value, text: 'Could not copy. Select and copy the ID.' });
            }
          }}
        >
          Copy ID
        </Button>
      ) : null}
      <span role="status">{feedback && feedback.id === value ? feedback.text : ''}</span>
    </div>
  );
}
