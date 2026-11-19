import { useId, useRef, useState } from 'react';
import styles from './CustomerApplicationV4.module.css';

export function ApplicationProgress({
  steps,
  activeStep,
  maxReached,
  onNavigate,
}: {
  steps: readonly { id: string; label: string; done: boolean }[];
  activeStep: number;
  maxReached: number;
  onNavigate: (step: number) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const menuId = useId();
  const toggleRef = useRef<HTMLButtonElement>(null);
  return (
    <nav aria-label="Application steps">
      <div className={styles.progress}>
        <span className={styles.currentProgress} aria-live="polite">
          Step {activeStep + 1} of {steps.length} · {steps[activeStep]?.label}
        </span>
        <div className={styles.miniProgress}>
          {steps.map((step, index) => (
            <button
              className={`${styles.bar} ${index === activeStep ? styles.now : index < activeStep ? styles.past : ''}`}
              key={step.id}
              type="button"
              aria-label={`Go to ${step.label}`}
              aria-current={index === activeStep ? 'step' : undefined}
              disabled={index > maxReached}
              onClick={() => onNavigate(index)}
              data-state={index === activeStep ? 'current' : step.done ? 'done' : 'pending'}
            />
          ))}
        </div>
        <button
          className={styles.stepnav}
          ref={toggleRef}
          type="button"
          aria-expanded={expanded}
          aria-controls={menuId}
          onClick={() => setExpanded(!expanded)}
        >
          All steps {expanded ? '▴' : '▾'}
        </button>
      </div>
      <ol
        id={menuId}
        hidden={!expanded}
        className={`${styles.stepmenu} ${!expanded ? styles.collapsed : ''}`}
      >
        {steps.map((step, index) => (
          <li key={step.id} data-done={step.done}>
            <button
              className={index === activeStep ? styles.sel : undefined}
              type="button"
              disabled={index > maxReached}
              aria-current={index === activeStep ? 'step' : undefined}
              onClick={() => {
                onNavigate(index);
                setExpanded(false);
                toggleRef.current?.focus();
              }}
            >
              <span className={styles.n} aria-hidden="true">
                {step.done ? '✓' : index + 1}
              </span>{' '}
              {step.label}
            </button>
          </li>
        ))}
      </ol>
    </nav>
  );
}
