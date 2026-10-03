import { useRef, useState } from 'react';
import { useSearchParams } from 'react-router';
import { inquirySchema } from '../../lib/inquiryValidation';
import { FormField, FieldInput, FieldSelect, FieldTextarea } from '../../components/ui/Form';
import { Button } from '../../components/ui/Button';
import { cn } from '../../lib/cn';
import { INQUIRY_TYPES, type ContactFormValues, type SubmitStatus } from '../../types/contact';
import { contactService, hasInquiryBackend } from '../../services/contactService';

type Errors = Partial<Record<keyof ContactFormValues, string>>;

const initialValues: ContactFormValues = {
  name: '',
  email: '',
  contactNumber: '',
  inquiryType: '',
  message: '',
};

function validate(values: ContactFormValues): Errors {
  const errors: Errors = {};

  if (values.name.trim().length < 2) {
    errors.name = 'Please enter your name.';
  }

  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(values.email.trim())) {
    errors.email = 'Please enter a valid email address.';
  }

  if (values.contactNumber.trim().length < 7) {
    errors.contactNumber = 'Please enter a contact number.';
  }

  if (!values.inquiryType) {
    errors.inquiryType = 'Please choose an inquiry type.';
  }

  if (values.message.trim().length < 10) {
    errors.message = 'Please write a message of at least 10 characters.';
  }

  return errors;
}

export function ContactForm() {
  const [params] = useSearchParams();
  const [values, setValues] = useState<ContactFormValues>(() => ({
    ...initialValues,
    kind: params.get('reservation') === '1' ? 'reservation' : 'inquiry',
    guests: 1,
  }));
  const requestId = useRef(crypto.randomUUID());
  const inFlight = useRef(false);
  const [errors, setErrors] = useState<Errors>({});
  const [status, setStatus] = useState<SubmitStatus>('idle');
  const [notice, setNotice] = useState<string | null>(null);

  const update = <K extends keyof ContactFormValues>(key: K, value: ContactFormValues[K]) => {
    setValues((current) => ({ ...current, [key]: value }));
    setErrors((current) => (current[key] ? { ...current, [key]: undefined } : current));
  };

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (inFlight.current) return;

    const nextErrors = validate(values);
    setErrors(nextErrors);

    if (Object.values(nextErrors).some(Boolean)) return;
    const payload = {
      ...values,
      requestId: requestId.current,
      visitDate: values.visitDate || undefined,
      endDate: values.endDate || undefined,
    };
    const checked = inquirySchema.safeParse(payload);
    if (!checked.success) {
      setStatus('error');
      setNotice(checked.error.issues.map((issue) => issue.message).join(' '));
      return;
    }

    inFlight.current = true;
    setStatus('submitting');
    setNotice(null);

    try {
      const result = await contactService.submitInquiry(payload);
      if (result.ok) {
        setStatus('success');
        setNotice(`${result.message} Reference: ${result.reference}`);
      } else {
        setStatus('error');
        setNotice(result.message);
      }
    } catch (cause) {
      setStatus('error');
      setNotice(cause instanceof Error ? cause.message : 'Something went wrong. Please try again.');
    } finally {
      inFlight.current = false;
    }
  };

  if (status === 'success') {
    return (
      <div
        className="rounded-[1.25rem] border border-leaf-500/30 bg-leaf-100/60 p-10 text-center sm:p-14"
        role="status"
        aria-live="polite"
      >
        <p className="font-display text-4xl font-medium text-navy-900 text-balance">
          {hasInquiryBackend ? 'Message sent.' : 'Request saved locally.'}
        </p>
        <p className="mx-auto mt-4 max-w-xl leading-relaxed text-ink-600">{notice}</p>
        <Button
          variant="secondary"
          type="button"
          onClick={() => {
            setValues(initialValues);
            requestId.current = crypto.randomUUID();
            setStatus('idle');
            setNotice(null);
          }}
          className="mt-8"
        >
          Send another message
        </Button>
      </div>
    );
  }

  return (
    <form onSubmit={handleSubmit} noValidate className="space-y-6">
      {!hasInquiryBackend && (
        <p className="rounded-lg border border-line bg-leaf-100 p-4 text-sm text-pine-800">
          Local demo: submissions stay in this browser and are not sent to AFhomes.
        </p>
      )}
      <FormField id="request-kind" label="How can we help?">
        <FieldSelect
          id="request-kind"
          value={values.kind ?? 'inquiry'}
          onChange={(event) => update('kind', event.target.value as 'inquiry' | 'reservation')}
        >
          <option value="inquiry">Send an inquiry</option>
          <option value="reservation">Request a reservation</option>
        </FieldSelect>
      </FormField>
      <div hidden aria-hidden="true">
        <label>
          Website
          <input
            tabIndex={-1}
            autoComplete="off"
            value={values.website ?? ''}
            onChange={(event) => update('website', event.target.value)}
          />
        </label>
      </div>
      {values.kind === 'reservation' && (
        <div className="space-y-4 rounded-lg border border-line p-5">
          <p className="text-sm text-pine-800">
            Request your preferred dates. Our team will confirm availability and any payment
            arrangements directly.
          </p>
          <div className="grid gap-4 sm:grid-cols-3">
            <FormField id="visit-date" label="Visit / check-in date" required>
              <FieldInput
                id="visit-date"
                type="date"
                value={values.visitDate ?? ''}
                onChange={(event) => update('visitDate', event.target.value)}
              />
            </FormField>
            <FormField id="end-date" label="Check-out date (optional)">
              <FieldInput
                id="end-date"
                type="date"
                value={values.endDate ?? ''}
                onChange={(event) => update('endDate', event.target.value)}
              />
            </FormField>
            <FormField id="guests" label="Guests" required>
              <FieldInput
                id="guests"
                type="number"
                min={1}
                max={100}
                value={values.guests ?? 1}
                onChange={(event) => update('guests', Number(event.target.value))}
              />
            </FormField>
          </div>
        </div>
      )}
      <div className="grid grid-cols-1 gap-6 sm:grid-cols-2">
        <FormField id="contact-name" label="Name" required error={errors.name}>
          <FieldInput
            id="contact-name"
            name="name"
            autoComplete="name"
            value={values.name}
            onChange={(event) => update('name', event.target.value)}
            invalid={Boolean(errors.name)}
            aria-invalid={Boolean(errors.name)}
            aria-describedby={errors.name ? 'contact-name-error' : undefined}
            placeholder="Your full name"
          />
        </FormField>

        <FormField id="contact-email" label="Email" required error={errors.email}>
          <FieldInput
            id="contact-email"
            name="email"
            type="email"
            autoComplete="email"
            value={values.email}
            onChange={(event) => update('email', event.target.value)}
            invalid={Boolean(errors.email)}
            aria-invalid={Boolean(errors.email)}
            aria-describedby={errors.email ? 'contact-email-error' : undefined}
            placeholder="you@example.com"
          />
        </FormField>
      </div>

      <div className="grid grid-cols-1 gap-6 sm:grid-cols-2">
        <FormField id="contact-number" label="Contact Number" required error={errors.contactNumber}>
          <FieldInput
            id="contact-number"
            name="contactNumber"
            type="tel"
            autoComplete="tel"
            value={values.contactNumber}
            onChange={(event) => update('contactNumber', event.target.value)}
            invalid={Boolean(errors.contactNumber)}
            aria-invalid={Boolean(errors.contactNumber)}
            aria-describedby={errors.contactNumber ? 'contact-number-error' : undefined}
            placeholder="+63 …"
          />
        </FormField>

        <FormField id="contact-type" label="Inquiry Type" required error={errors.inquiryType}>
          <FieldSelect
            id="contact-type"
            name="inquiryType"
            value={values.inquiryType}
            onChange={(event) =>
              update('inquiryType', event.target.value as ContactFormValues['inquiryType'])
            }
            invalid={Boolean(errors.inquiryType)}
            aria-invalid={Boolean(errors.inquiryType)}
            aria-describedby={errors.inquiryType ? 'contact-type-error' : undefined}
          >
            <option value="" disabled>
              Choose an inquiry type…
            </option>
            {INQUIRY_TYPES.map((type) => (
              <option key={type} value={type}>
                {type}
              </option>
            ))}
          </FieldSelect>
        </FormField>
      </div>

      <FormField id="contact-message" label="Message" required error={errors.message}>
        <FieldTextarea
          id="contact-message"
          name="message"
          value={values.message}
          onChange={(event) => update('message', event.target.value)}
          invalid={Boolean(errors.message)}
          aria-invalid={Boolean(errors.message)}
          aria-describedby={errors.message ? 'contact-message-error' : undefined}
          placeholder="How can we help?"
        />
      </FormField>

      <div className="flex flex-col gap-4 pt-2 sm:flex-row sm:items-center">
        <Button
          type="submit"
          variant="primary"
          size="lg"
          withArrow
          disabled={status === 'submitting'}
          className="w-full sm:w-auto"
        >
          {status === 'submitting' ? 'Sending…' : 'Send message'}
        </Button>
        {status === 'error' && (
          <p className="text-sm font-medium text-red-600" role="alert">
            {notice}
          </p>
        )}
      </div>

      <p className={cn('text-xs leading-relaxed text-ink-600')}>
        By submitting, you agree that AFhomes may contact you about your inquiry. Payments are never
        collected through this form — all official payments are handled directly by the AFhomes
        Finance Department through verified channels.
      </p>
    </form>
  );
}
