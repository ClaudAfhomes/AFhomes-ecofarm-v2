import { describe, expect, it, vi } from 'vitest';

import { sendCustomerOnboardingEmail } from './customer-onboarding-email.js';

const MESSAGE = {
  to: 'member@example.com',
  customerName: 'Ana <Member>',
  membershipNumber: 'MBS-000009',
  activationUrl: 'https://afhomes.example/customer/activate#token=raw-secret',
  expiresAt: '2026-10-02T00:00:00.000Z',
};

describe('customer onboarding email', () => {
  it('fails closed without complete server-only SMTP configuration', async () => {
    const createTransport = vi.fn();
    await expect(sendCustomerOnboardingEmail(MESSAGE, {}, createTransport)).resolves.toEqual({
      status: 'failed',
      reason: 'not_configured',
    });
    expect(createTransport).not.toHaveBeenCalled();
  });

  it('treats a missing customer email as manual delivery without opening SMTP', async () => {
    const createTransport = vi.fn();
    await expect(
      sendCustomerOnboardingEmail(
        { ...MESSAGE, to: ' ' },
        {
          SMTP_HOST: 'smtp.example.com',
          SMTP_USER: 'mailer',
          SMTP_PASSWORD: 'server-secret',
          SMTP_FROM: 'no-reply@example.com',
        },
        createTransport,
      ),
    ).resolves.toEqual({ status: 'failed', reason: 'invalid_recipient' });
    expect(createTransport).not.toHaveBeenCalled();
  });

  it('sends the activation link without generating or exposing a password', async () => {
    const sendMail = vi.fn().mockResolvedValue({ messageId: 'safe-id' });
    const createTransport = vi.fn(() => ({ sendMail }));
    await expect(
      sendCustomerOnboardingEmail(
        MESSAGE,
        {
          SMTP_HOST: 'smtp.example.com',
          SMTP_PORT: '587',
          SMTP_USER: 'mailer',
          SMTP_PASSWORD: 'server-secret',
          SMTP_FROM: 'no-reply@example.com',
          SMTP_FROM_NAME: 'AF Homes',
        },
        createTransport,
      ),
    ).resolves.toEqual({ status: 'sent' });

    const mail = sendMail.mock.calls[0]?.[0] as Record<string, string>;
    expect(mail.to).toBe(MESSAGE.to);
    expect(mail.text).toContain(MESSAGE.activationUrl);
    expect(mail.text).toContain('choose your own password');
    expect(mail.text).not.toMatch(/temporary password|generated password/i);
    expect(mail.html).toContain('Ana &lt;Member&gt;');
  });

  it('returns a safe failure status when SMTP rejects the message', async () => {
    const createTransport = vi.fn(() => ({
      sendMail: vi.fn().mockRejectedValue(new Error('secret provider response')),
    }));
    await expect(
      sendCustomerOnboardingEmail(
        MESSAGE,
        {
          SMTP_HOST: 'smtp.example.com',
          SMTP_USER: 'mailer',
          SMTP_PASSWORD: 'server-secret',
          SMTP_FROM: 'no-reply@example.com',
        },
        createTransport,
      ),
    ).resolves.toEqual({ status: 'failed', reason: 'send_failed' });
  });
});
