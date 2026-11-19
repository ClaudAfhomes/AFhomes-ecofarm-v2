export const INQUIRY_TYPES = [
  "VIP Privilege",
  "Smart Wellness Hotel",
  "ALM Japanese Restaurant",
  "Hotspring & Ecofarm Resort",
  "General Inquiry",
] as const;

export type InquiryType = (typeof INQUIRY_TYPES)[number];

export interface ContactFormValues {
  requestId?: string;
  kind?: "inquiry" | "reservation";
  visitDate?: string;
  endDate?: string;
  guests?: number;
  website?: string;
  name: string;
  email: string;
  contactNumber: string;
  inquiryType: InquiryType | "";
  message: string;
}

export type SubmitStatus = "idle" | "submitting" | "success" | "error";

export interface ContactSubmitResult {
  ok: boolean;
  message: string;
  reference?: string;
}

export interface OfficeInfo {
  name: string;
  role: string;
  addressLines: string[];
  landmark?: string;
  zip?: string;
}
