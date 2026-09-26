import { useState, type FormEvent, type ReactNode } from 'react';

import { CTASection } from '../components/CTASection';
import { Hero } from '../components/Hero';
import { useQuery } from '@tanstack/react-query';
import { getContactCmsPublic } from '@/lib/cms';
import { submitContact } from '@/lib/api/endpoints';
import { CONTACT } from '../content';
import type { ContactMethod } from '../content/contact';
import { Alert } from '../../../components/Alert';
import { apiErrorMessage } from '../../../lib/api/errorMessage';
import styles from './ContactPage.module.css';

const MESSENGER_ICON = (
  <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
    <path
      d="M12 0C5.24 0 0 4.952 0 11.64c0 3.499 1.434 6.521 3.769 8.61a.96.96 0 0 1 .323.683l.065 2.135a.96.96 0 0 0 1.347.85l2.381-1.053a.96.96 0 0 1 .641-.046A13 13 0 0 0 12 23.28c6.76 0 12-4.952 12-11.64S18.76 0 12 0m6.806 7.44c.522-.03.971.567.63 1.094l-4.178 6.457a.707.707 0 0 1-.977.208l-3.87-2.504a.44.44 0 0 0-.49.007l-4.363 3.01c-.637.438-1.415-.317-.995-.966l4.179-6.457a.706.706 0 0 1 .977-.21l3.87 2.505c.15.097.344.094.491-.007l4.362-3.008a.7.7 0 0 1 .364-.13"
      fill="currentColor"
    />
  </svg>
);

const PHONE_ICON = (
  <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
    <path
      d="M6.8 3.5h2.6l1.4 3.7-1.9 1.5a11.4 11.4 0 0 0 6.4 6.4l1.5-1.9 3.7 1.4v2.6c0 1-.8 1.8-1.8 1.8C11.3 18.9 5.1 12.7 5 4.3a1.8 1.8 0 0 1 1.8-.8Z"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinejoin="round"
    />
  </svg>
);

const EMAIL_ICON = (
  <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
    <rect
      x="3.5"
      y="5.5"
      width="17"
      height="13"
      rx="2"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
    />
    <path
      d="M5 7.5l7 5.5 7-5.5"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  </svg>
);

const PIN_ICON = (
  <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
    <path
      d="M12 21s-6.5-5.4-6.5-10a6.5 6.5 0 0 1 13 0c0 4.6-6.5 10-6.5 10Z"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinejoin="round"
    />
    <circle cx="12" cy="11" r="2.5" fill="none" stroke="currentColor" strokeWidth="1.7" />
  </svg>
);

const ARROW_ICON = (
  <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
    <path
      d="M8 5l7 7-7 7"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  </svg>
);

const METHOD_ICONS: Record<ContactMethod['icon'], ReactNode> = {
  messenger: MESSENGER_ICON,
  phone: PHONE_ICON,
  email: EMAIL_ICON,
  location: PIN_ICON,
};

/**
 * Public Contact page. Contact details follow the legacy website supplied by
 * the project owner. Messenger is the primary channel (real external link);
 * the form posts to `POST /api/v1/contact` and the inquiry lands in the
 * admin Inquiries queue - the acknowledgement below renders only after a
 * real 201, never as a fake send.
 */
export function ContactPage() {
  const { data: cms } = useQuery({
    queryKey: ['cms', 'contact'],
    queryFn: getContactCmsPublic,
    staleTime: 0,
  });
  const content = (cms ?? CONTACT) as typeof CONTACT;
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [message, setMessage] = useState('');
  // Honeypot - bots fill it, humans never see it (off-screen, untabbable).
  const [company, setCompany] = useState('');
  const [errors, setErrors] = useState<{ name?: string; email?: string; message?: string }>({});
  const [serverError, setServerError] = useState<string | undefined>();
  const [submitting, setSubmitting] = useState(false);
  const [acknowledged, setAcknowledged] = useState(false);

  const setField = (field: 'name' | 'email' | 'message', value: string) => {
    if (field === 'name') setName(value);
    else if (field === 'email') setEmail(value);
    else setMessage(value);
    setErrors((current) => ({ ...current, [field]: undefined }));
    setServerError(undefined);
  };

  const validate = (): boolean => {
    const next: { name?: string; email?: string; message?: string } = {};
    if (!name.trim()) next.name = 'Enter your name.';
    if (!email.trim()) next.email = 'Enter your email address.';
    else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) {
      next.email = 'Enter a valid email address.';
    }
    if (message.trim().length < 10) {
      next.message = 'Tell us a little more (at least 10 characters).';
    }
    setErrors(next);
    return Object.keys(next).length === 0;
  };

  const onSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (submitting || !validate()) return;
    setSubmitting(true);
    setServerError(undefined);
    try {
      await submitContact({
        name: name.trim(),
        email: email.trim(),
        message: message.trim(),
        company,
      });
      setAcknowledged(true);
    } catch (error) {
      setServerError(apiErrorMessage(error, 'We could not send your message. Please try again.'));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className={styles.page}>
      <Hero
        variant="page"
        eyebrow={content.hero.eyebrow}
        title={content.title}
        primaryCta={content.hero.primaryCta}
        image={content.hero.image}
      />

      <section className={`${styles.section} ${styles.sectionMuted}`}>
        <div className={`container ${styles.contactGrid}`}>
          <ul className={styles.methods}>
            {content.methods.map((method) => {
              const row = (
                <>
                  <span
                    className={`${styles.methodIcon} ${method.featured ? styles.methodIconFeatured : ''}`}
                  >
                    {METHOD_ICONS[method.icon]}
                  </span>
                  <span className={styles.methodText}>
                    <span className={styles.methodLabel}>{method.label}</span>
                    <span
                      className={`${styles.methodValue} ${method.featured ? styles.methodValueFeatured : ''}`}
                    >
                      {method.value}
                    </span>
                  </span>
                  {method.href ? (
                    <span className={styles.methodArrow} aria-hidden="true">
                      {ARROW_ICON}
                    </span>
                  ) : null}
                </>
              );

              return (
                <li key={method.label}>
                  {method.href ? (
                    <a
                      className={`${styles.method} ${styles.methodLink} ${method.featured ? styles.methodFeatured : ''}`}
                      href={method.href}
                      {...(method.external ? { target: '_blank', rel: 'noopener noreferrer' } : {})}
                    >
                      {row}
                    </a>
                  ) : (
                    <div className={styles.method}>{row}</div>
                  )}
                </li>
              );
            })}
          </ul>

          <div className={styles.formPanel}>
            <h2 className={styles.formHeading}>{content.form.heading}</h2>
            {acknowledged ? (
              <div className={styles.acknowledgement} role="status">
                <h3 className={styles.acknowledgementTitle}>Thank you for reaching out.</h3>
                <p>
                  We have noted your message and will be in touch. For a faster response, call{' '}
                  {content.details.find((detail) => detail.label === 'Phone')?.value} or write to{' '}
                  {content.details.find((detail) => detail.label === 'Email')?.value}.
                </p>
              </div>
            ) : (
              <form
                className={styles.form}
                aria-describedby="contact-form-note"
                onSubmit={onSubmit}
                noValidate
              >
                {serverError ? (
                  <Alert variant="danger" title="We could not send your message">
                    {serverError}
                  </Alert>
                ) : null}
                <div className={styles.field}>
                  <label htmlFor="contact-name">Name</label>
                  <input
                    id="contact-name"
                    name="name"
                    type="text"
                    autoComplete="name"
                    required
                    value={name}
                    onChange={(event) => setField('name', event.target.value)}
                    aria-invalid={errors.name ? true : undefined}
                    aria-describedby={errors.name ? 'contact-name-error' : undefined}
                    className={errors.name ? styles.inputInvalid : undefined}
                  />
                  {errors.name ? (
                    <p id="contact-name-error" className={styles.fieldError}>
                      {errors.name}
                    </p>
                  ) : null}
                </div>
                <div className={styles.field}>
                  <label htmlFor="contact-email">Email</label>
                  <input
                    id="contact-email"
                    name="email"
                    type="email"
                    autoComplete="email"
                    required
                    value={email}
                    onChange={(event) => setField('email', event.target.value)}
                    aria-invalid={errors.email ? true : undefined}
                    aria-describedby={errors.email ? 'contact-email-error' : undefined}
                    className={errors.email ? styles.inputInvalid : undefined}
                  />
                  {errors.email ? (
                    <p id="contact-email-error" className={styles.fieldError}>
                      {errors.email}
                    </p>
                  ) : null}
                </div>
                <div className={styles.field}>
                  <label htmlFor="contact-message">Message</label>
                  <textarea
                    id="contact-message"
                    name="message"
                    rows={5}
                    required
                    value={message}
                    onChange={(event) => setField('message', event.target.value)}
                    aria-invalid={errors.message ? true : undefined}
                    aria-describedby={errors.message ? 'contact-message-error' : undefined}
                    className={errors.message ? styles.inputInvalid : undefined}
                  />
                  {errors.message ? (
                    <p id="contact-message-error" className={styles.fieldError}>
                      {errors.message}
                    </p>
                  ) : null}
                </div>
                <div className={styles.honeypot} aria-hidden="true">
                  <label htmlFor="contact-company">Company</label>
                  <input
                    id="contact-company"
                    name="company"
                    type="text"
                    autoComplete="off"
                    tabIndex={-1}
                    value={company}
                    onChange={(event) => setCompany(event.target.value)}
                  />
                </div>
                <p id="contact-form-note" className={styles.formNote}>
                  {content.form.note}
                </p>
                <button type="submit" className={styles.submit} disabled={submitting}>
                  {submitting ? 'Sending…' : content.form.submitLabel}
                </button>
              </form>
            )}
          </div>
        </div>
      </section>

      <CTASection
        title={content.cta.title}
        lead={content.cta.lead}
        primaryCta={content.cta.primaryCta}
        secondaryCta={content.cta.secondaryCta}
      />
    </div>
  );
}
