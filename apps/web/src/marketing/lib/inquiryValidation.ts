import { z } from "zod";

export const inquirySchema = z.object({
  requestId: z.string().uuid(),
  name: z.string().trim().min(2).max(150),
  email: z.string().trim().email().max(254),
  contactNumber: z.string().trim().min(7).max(40),
  inquiryType: z.enum(["VIP Privilege", "Smart Wellness Hotel", "ALM Japanese Restaurant", "Hotspring & Ecofarm Resort", "General Inquiry"]),
  message: z.string().trim().min(10).max(5000),
  kind: z.enum(["inquiry", "reservation"]).default("inquiry"),
  visitDate: z.string().date().optional(),
  endDate: z.string().date().optional(),
  guests: z.number().int().min(1).max(100).optional(),
  website: z.string().max(0).optional(),
}).superRefine((value, context) => {
  if (value.kind !== "reservation") return;
  if (!value.visitDate || !value.guests) context.addIssue({ code: "custom", path: ["visitDate"], message: "Choose your visit date and number of guests." });
  const today = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Manila", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
  if (value.visitDate && value.visitDate < today) context.addIssue({ code: "custom", path: ["visitDate"], message: "Choose today or a future date." });
  if (value.endDate && value.visitDate && value.endDate < value.visitDate) context.addIssue({ code: "custom", path: ["endDate"], message: "End date must be on or after the visit date." });
});
export type InquiryInput = z.infer<typeof inquirySchema>;
