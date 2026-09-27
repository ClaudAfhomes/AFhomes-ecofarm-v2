import type { ContactFormValues } from "../types/contact";

export const DEFAULT_SYSTEM_EMAIL = "claudmarsjimenez.afhomes@gmail.com";

export function buildClientMessageMailto(payload: ContactFormValues): string {
  const name = payload.name.trim();
  const email = payload.email.trim();
  const phone = payload.contactNumber.trim();
  const inquiryType = payload.inquiryType || "General Inquiry";
  const kind = payload.kind === "reservation" ? "Reservation request" : "Inquiry";
  const visitDate = payload.visitDate ? `Visit date: ${payload.visitDate}\n` : "";
  const endDate = payload.endDate ? `End date: ${payload.endDate}\n` : "";
  const guests = typeof payload.guests === "number" ? `Guests: ${payload.guests}\n` : "";

  const subject = encodeURIComponent(`${kind} from ${name}`);
  const body = encodeURIComponent(
    [
      `Name: ${name}`,
      `Email: ${email}`,
      `Phone: ${phone}`,
      `Inquiry type: ${inquiryType}`,
      `Message type: ${kind}`,
      visitDate,
      endDate,
      guests,
      "",
      "Message:",
      payload.message.trim(),
    ]
      .filter(Boolean)
      .join("\n"),
  );

  return `mailto:${DEFAULT_SYSTEM_EMAIL}?subject=${subject}&body=${body}`;
}

export function sendClientMessage(payload: ContactFormValues): boolean {
  if (typeof window === "undefined") return false;

  const mailtoUrl = buildClientMessageMailto(payload);
  window.location.href = mailtoUrl;
  return true;
}
