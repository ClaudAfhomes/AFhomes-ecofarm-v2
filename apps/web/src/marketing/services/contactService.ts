import { contactApi, hasInquiryBackend } from "../api/contact";
import type { ContactFormValues, ContactSubmitResult } from "../types/contact";

export { hasInquiryBackend };

export const contactService = {
  submitInquiry(payload: ContactFormValues): Promise<ContactSubmitResult> {
    return contactApi.submitInquiry(payload);
  },
};