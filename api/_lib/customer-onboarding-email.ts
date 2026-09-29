import nodemailer from 'nodemailer';
import type SMTPTransport from 'nodemailer/lib/smtp-transport/index.js';
import { z } from 'zod';

type MailEnv = {
  SMTP_HOST?: string;
  SMTP_PORT?: string;
  SMTP_USER?: string;
  SMTP_PASSWORD?: string;
  SMTP_FROM?: string;
  SMTP_FROM_NAME?: string;
  EMAIL_FROM?: string;
};

export type CustomerOnboardingEmail = {
  to: string;
  customerName: string;
  membershipNumber: string;
  activationUrl: string;
  expiresAt: string;
};

export type MailDeliveryResult =
  | { status: 'sent' }
  | { status: 'failed'; reason: 'invalid_recipient' | 'not_configured' | 'send_failed' };

type MailTransport = {
  sendMail(message: Record<string, unknown>): Promise<unknown>;
};

type TransportFactory = (options: SMTPTransport.Options) => MailTransport;

const escapeHtml = (value: string) =>
  value.replace(/[&<>'"]/g, (character) => {
    const escaped: Record<string, string> = {
      '&': '&amp;',
      '<': '&lt;',
      '>': '&gt;',
      "'": '&#39;',
      '"': '&quot;',
    };
    return escaped[character] ?? character;
  });

function smtpConfig(env: MailEnv): { options: SMTPTransport.Options; from: string } | null {
  const host = env.SMTP_HOST?.trim();
  const user = env.SMTP_USER?.trim();
  const pass = env.SMTP_PASSWORD;
  const address = env.SMTP_FROM?.trim() || env.EMAIL_FROM?.trim();
  const port = Number(env.SMTP_PORT?.trim() || '587');
  if (!host || !user || !pass || !address || !Number.isInteger(port) || port < 1 || port > 65535) {
    return null;
  }

  const senderName = env.SMTP_FROM_NAME?.trim();
  const from = senderName ? `"${senderName.replace(/["\r\n]/g, '')}" <${address}>` : address;
  return {
    options: {
      host,
      port,
      secure: port === 465,
      auth: { user, pass },
      connectionTimeout: 8_000,
      greetingTimeout: 8_000,
      socketTimeout: 12_000,
    },
    from,
  };
}

/**
 * Send the app-owned onboarding token from the server. Supabase Auth custom
 * SMTP applies only to Auth messages; this token is intentionally delivered by
 * the application without creating an Auth user or a permanent password.
 */
export async function sendCustomerOnboardingEmail(
  message: CustomerOnboardingEmail,
  env: MailEnv = process.env,
  createTransport: TransportFactory = (options) => nodemailer.createTransport(options),
): Promise<MailDeliveryResult> {
  const recipient = z.string().email().safeParse(message.to.trim().toLowerCase());
  if (!recipient.success) return { status: 'failed', reason: 'invalid_recipient' };
  const config = smtpConfig(env);
  if (!config) return { status: 'failed', reason: 'not_configured' };

  const name = message.customerName.trim() || 'AF Homes member';
  const expiry = new Date(message.expiresAt);
  const expiryText = Number.isNaN(expiry.valueOf()) ? message.expiresAt : expiry.toUTCString();
  try {
    await createTransport(config.options).sendMail({
      from: config.from,
      to: recipient.data,
      subject: 'Activate your AF Homes Ecofarm customer account',
      text: [
        `Hello ${name},`,
        '',
        `Your AF Homes Ecofarm membership ${message.membershipNumber} is active.`,
        'Open the secure link below and choose your own password:',
        message.activationUrl,
        '',
        `This one-time activation link expires at ${expiryText}.`,
        'If you already activated your account, use Forgot Password instead.',
        'AF Homes staff will never ask for or know your password.',
      ].join('\n'),
      html: `<p>Hello ${escapeHtml(name)},</p>
<p>Your AF Homes Ecofarm membership <strong>${escapeHtml(message.membershipNumber)}</strong> is active.</p>
<p><a href="${escapeHtml(message.activationUrl)}">Activate your customer account and choose your password</a></p>
<p>This one-time activation link expires at ${escapeHtml(expiryText)}.</p>
<p>If you already activated your account, use Forgot Password instead. AF Homes staff will never ask for or know your password.</p>`,
    });
    return { status: 'sent' };
  } catch {
    // Never return or log SMTP errors here: providers can echo credentials,
    // recipients, or the token-bearing URL. The caller records only a status.
    return { status: 'failed', reason: 'send_failed' };
  }
}
