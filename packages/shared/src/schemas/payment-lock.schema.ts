import { z } from "zod";

export const lockPaymentSchema = z.object({
  purchaseOrderId: z.string().uuid("Invalid purchase order ID"),
});

export type LockPaymentInput = z.infer<typeof lockPaymentSchema>;
