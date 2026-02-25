import { z } from "zod";
import { AcceptanceType } from "../constants/enums";
import {
  PO_LIMITS,
  DEFAULT_ACCEPTANCE_WINDOW_HOURS,
} from "../constants/config";

const lineItemSchema = z.object({
  description: z.string().min(1, "Description is required"),
  quantity: z.number().int().positive("Quantity must be positive"),
  unitPrice: z.number().int().positive("Unit price must be positive"), // pennies
});

export const createPOSchema = z.object({
  supplierId: z.string().uuid("Invalid supplier ID"),
  description: z.string().min(5, "Description must be at least 5 characters"),
  lineItems: z
    .array(lineItemSchema)
    .min(1, "At least one line item is required"),
  amount: z
    .number()
    .int("Amount must be in whole pennies")
    .min(
      PO_LIMITS.MIN_AMOUNT,
      `Minimum amount is £${PO_LIMITS.MIN_AMOUNT / 100}`,
    )
    .max(
      PO_LIMITS.MAX_AMOUNT,
      `Maximum amount is £${PO_LIMITS.MAX_AMOUNT / 100}`,
    ),
  acceptanceType: z
    .nativeEnum(AcceptanceType)
    .default(AcceptanceType.BUYER_CONFIRMATION),
  acceptanceWindowHours: z
    .number()
    .int()
    .min(1)
    .max(720) // 30 days
    .default(DEFAULT_ACCEPTANCE_WINDOW_HOURS),
});

export type CreatePOInput = z.infer<typeof createPOSchema>;
export type LineItem = z.infer<typeof lineItemSchema>;
