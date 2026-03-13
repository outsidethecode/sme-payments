import { z } from "zod";
import { AcceptanceType } from "../constants/enums";
import {
  PO_LIMITS,
  DEFAULT_ACCEPTANCE_WINDOW_HOURS,
} from "../constants/config";

const lineItemSchema = z.object({
  description: z.string().min(1, "Description is required"),
  quantity: z.number().int().positive("Quantity must be positive"),
  unitPrice: z.number().int().positive("Unit price must be positive"), // minor units
});

/** Currency-aware PO limits helper */
function getLimits(currency: string = "GBP") {
  return PO_LIMITS[currency] ?? PO_LIMITS["GBP"];
}

export const createPOSchema = z
  .object({
    supplierId: z.string().uuid("Invalid supplier ID"),
    description: z.string().min(5, "Description must be at least 5 characters"),
    lineItems: z
      .array(lineItemSchema)
      .min(1, "At least one line item is required"),
    amount: z.number().int("Amount must be in whole minor units"),
    currency: z.enum(["GBP", "SAR"]).optional(),
    acceptanceType: z
      .nativeEnum(AcceptanceType)
      .default(AcceptanceType.BUYER_CONFIRMATION),
    acceptanceWindowHours: z
      .number()
      .int()
      .min(1)
      .max(720) // 30 days
      .default(DEFAULT_ACCEPTANCE_WINDOW_HOURS),
  })
  .refine(
    (data) => {
      const limits = getLimits(data.currency);
      return data.amount >= limits.MIN_AMOUNT;
    },
    {
      message: "Amount is below the minimum for this currency",
      path: ["amount"],
    },
  )
  .refine(
    (data) => {
      const limits = getLimits(data.currency);
      return data.amount <= limits.MAX_AMOUNT;
    },
    {
      message: "Amount exceeds the maximum for this currency",
      path: ["amount"],
    },
  );

export type CreatePOInput = z.infer<typeof createPOSchema>;
export type LineItem = z.infer<typeof lineItemSchema>;
