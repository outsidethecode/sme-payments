import { z } from "zod";

export const requestEarlyPaymentSchema = z.object({
  purchaseOrderId: z.string().uuid("Invalid purchase order ID"),
});

export const approveEarlyPaymentSchema = z.object({
  riskAcknowledged: z.literal(true, {
    errorMap: () => ({ message: "You must acknowledge the delivery risk" }),
  }),
});

export type RequestEarlyPaymentInput = z.infer<
  typeof requestEarlyPaymentSchema
>;
export type ApproveEarlyPaymentInput = z.infer<
  typeof approveEarlyPaymentSchema
>;
