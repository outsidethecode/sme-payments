import {
  Injectable,
  Logger,
  BadRequestException,
  ForbiddenException,
  NotFoundException,
} from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";
import { LedgerService, SignatureData } from "../ledger/ledger.service";
import { UsersService } from "../users/users.service";
import { PoliciesService } from "../policies/policies.service";
import { ApprovalsService } from "../approvals/approvals.service";
import { OrganisationsService } from "../organisations/organisations.service";
import { SettlementService } from "../settlements/settlement.service";
import { SettlementRouterService } from "../settlements/settlement-router.service";
import { InstrumentService } from "../settlements/instrument.service";
import { EscrowAccountingService } from "../settlements/escrow-accounting.service";
import { SettlementCurrency } from "../settlements/settlement-adapter.interface";
import {
  FeatureFlagService,
  FeatureFlag,
} from "../config/feature-flags.service";

// Simple PO reference generator
function generateReference(): string {
  const timestamp = Date.now().toString(36).toUpperCase();
  const random = Math.random().toString(36).substring(2, 6).toUpperCase();
  return `PO-${timestamp}-${random}`;
}

export type PaymentTermsValue =
  | "IMMEDIATE"
  | "NET_15"
  | "NET_30"
  | "NET_45"
  | "NET_60"
  | "NET_90";
export type DeliveryTermsValue = "EX_WORKS" | "FOB" | "CIF" | "DDP" | "CUSTOM";

export interface CreatePOInput {
  buyerId: string;
  supplierId: string;
  description?: string;
  lineItems: Array<{
    description: string;
    quantity: number;
    unitPricePennies: number;
    sku?: string;
    unitOfMeasure?: string;
  }>;
  // Phase 4 extended fields
  externalPoNumber?: string;
  paymentTerms?: PaymentTermsValue;
  deliveryTerms?: DeliveryTermsValue;
  deliveryTermsNote?: string;
  deliveryAddress?: string;
  taxRate?: number; // basis points
  disputeWindowHours?: number;
  partialAcceptanceAllowed?: boolean;
  acceptedLineItems?: number[];
  // Import fields
  importSource?: string;
  importBatchId?: string;
  attachmentUrl?: string;
  // Standard PO header fields
  expectedDeliveryDate?: string; // ISO date
  notes?: string;
  buyerContactName?: string;
  buyerContactEmail?: string;
}

@Injectable()
export class PurchaseOrdersService {
  private readonly logger = new Logger(PurchaseOrdersService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly ledger: LedgerService,
    private readonly users: UsersService,
    private readonly policies: PoliciesService,
    private readonly approvals: ApprovalsService,
    private readonly orgs: OrganisationsService,
    private readonly settlement: SettlementService,
    private readonly settlementRouter: SettlementRouterService,
    private readonly instrumentService: InstrumentService,
    private readonly escrowAccounting: EscrowAccountingService,
    private readonly featureFlags: FeatureFlagService,
  ) {}

  async create(input: CreatePOInput) {
    // Validate supplier exists and is a supplier
    const supplier = await this.users.findById(input.supplierId);
    if (!supplier || supplier.role !== "SUPPLIER") {
      throw new BadRequestException("Invalid supplier");
    }

    // Resolve buyer org to get jurisdiction/currency
    const buyerOrg = await this.orgs.getOrgByUserId(input.buyerId);
    const currency = buyerOrg?.currency || "GBP";

    // Calculate total
    const amount = input.lineItems.reduce(
      (sum, item) => sum + item.quantity * item.unitPricePennies,
      0,
    );

    // Currency-aware validation via policy rules (admin-configurable)
    const limits = await this.policies.getPOLimits(
      buyerOrg?.id ?? "",
      currency,
    );
    const currencySymbol = currency === "SAR" ? "SAR" : "£";

    if (amount < limits.minAmount) {
      throw new BadRequestException(
        `Minimum order amount is ${currencySymbol}${(limits.minAmount / 100).toLocaleString()}`,
      );
    }
    if (amount > limits.maxAmount) {
      throw new BadRequestException(
        `Maximum order amount is ${currencySymbol}${(limits.maxAmount / 100).toLocaleString()}`,
      );
    }

    // Compute tax & gross amounts
    const taxRate = input.taxRate ?? 0; // BPS
    const taxAmount = Math.round((amount * taxRate) / 10000);
    const grossAmount = amount + taxAmount;

    const po = await this.prisma.purchaseOrder.create({
      data: {
        referenceNumber: generateReference(),
        buyerId: input.buyerId,
        supplierId: input.supplierId,
        description: input.description || "",
        lineItems: input.lineItems,
        amount,
        currency,
        // Phase 4 extended fields
        externalPoNumber: input.externalPoNumber,
        paymentTerms: (input.paymentTerms as any) || "IMMEDIATE",
        deliveryTerms: (input.deliveryTerms as any) || "EX_WORKS",
        deliveryTermsNote: input.deliveryTermsNote,
        deliveryAddress: input.deliveryAddress,
        taxRate,
        taxAmount,
        grossAmount,
        disputeWindowHours: input.disputeWindowHours ?? 72,
        partialAcceptanceAllowed: input.partialAcceptanceAllowed ?? false,
        acceptedLineItems: input.acceptedLineItems ?? [],
        importSource: input.importSource,
        importBatchId: input.importBatchId,
        importedAt: input.importSource ? new Date() : null,
        attachmentUrl: input.attachmentUrl,
        // Standard PO header fields
        expectedDeliveryDate: input.expectedDeliveryDate
          ? new Date(input.expectedDeliveryDate)
          : null,
        notes: input.notes,
        buyerContactName: input.buyerContactName,
        buyerContactEmail: input.buyerContactEmail,
      },
      include: {
        buyer: {
          select: {
            id: true,
            email: true,
            name: true,
            role: true,
            companyName: true,
          },
        },
        supplier: {
          select: {
            id: true,
            email: true,
            name: true,
            role: true,
            companyName: true,
          },
        },
      },
    });

    // Log event
    await this.ledger.logEvent({
      entityType: "PURCHASE_ORDER",
      entityId: po.id,
      eventType: "PO_CREATED",
      actorId: input.buyerId,
      actorRole: "BUYER",
      payload: {
        reference: po.referenceNumber,
        supplierId: po.supplierId,
        amount: po.amount,
        lineItemCount: input.lineItems.length,
      },
    });

    return this.formatPO(po);
  }

  async findAll(userId: string, role: string) {
    const where =
      role === "ADMIN"
        ? {}
        : role === "BUYER"
          ? { buyerId: userId }
          : role === "SUPPLIER"
            ? { supplierId: userId }
            : role === "LIQUIDITY_PARTNER"
              ? {
                  earlyPaymentRequest: {
                    liquidityPartnerId: userId,
                  },
                }
              : { id: "__none__" };

    const pos = await this.prisma.purchaseOrder.findMany({
      where,
      include: {
        buyer: {
          select: {
            id: true,
            email: true,
            name: true,
            role: true,
            companyName: true,
          },
        },
        supplier: {
          select: {
            id: true,
            email: true,
            name: true,
            role: true,
            companyName: true,
          },
        },
        paymentLock: true,
      },
      orderBy: { createdAt: "desc" },
    });

    return pos.map((po) => this.formatPO(po));
  }

  async findById(id: string) {
    const po = await this.prisma.purchaseOrder.findUnique({
      where: { id },
      include: {
        buyer: {
          select: {
            id: true,
            email: true,
            name: true,
            role: true,
            companyName: true,
          },
        },
        supplier: {
          select: {
            id: true,
            email: true,
            name: true,
            role: true,
            companyName: true,
          },
        },
        paymentLock: true,
        earlyPaymentRequest: true,
        revisions: { orderBy: { revision: "desc" } },
      },
    });

    if (!po) throw new NotFoundException("Purchase order not found");

    return this.formatPO(po);
  }

  async send(id: string, actorId: string, sig?: SignatureData) {
    const po = await this.requireStatus(id, "DRAFT");
    if (po.buyerId !== actorId)
      throw new ForbiddenException("Only the buyer can send this PO");

    // ── Policy evaluation ────────────────────────────────────
    const buyerOrg = await this.orgs.getOrgByUserId(actorId);
    let requiresApproval = false;

    if (buyerOrg) {
      const evaluation = await this.policies.evaluatePOApproval(
        buyerOrg.id,
        po.amount,
      );

      if (evaluation.requiresApproval && !evaluation.autoApprove) {
        // PO needs manual approval — park in PENDING_APPROVAL
        const updated = await this.prisma.purchaseOrder.update({
          where: { id },
          data: { status: "PENDING_APPROVAL" },
          include: {
            buyer: {
              select: {
                id: true,
                email: true,
                name: true,
                role: true,
                companyName: true,
              },
            },
            supplier: {
              select: {
                id: true,
                email: true,
                name: true,
                role: true,
                companyName: true,
              },
            },
            paymentLock: true,
          },
        });

        // Create approval chain
        await this.approvals.createRequest({
          entityType: "PURCHASE_ORDER",
          entityId: id,
          organisationId: buyerOrg.id,
          policyRuleId: evaluation.matchedRule!.id,
          requiredApprovals: evaluation.requiredApprovals,
          expiresInHours: 7 * 24, // 7 days
        });

        const event = await this.ledger.logEvent({
          entityType: "PURCHASE_ORDER",
          entityId: id,
          eventType: "PO_APPROVAL_REQUESTED",
          actorId,
          actorRole: "BUYER",
          payload: {
            supplierId: po.supplierId,
            requiredApprovals: evaluation.requiredApprovals,
            requiredRoles: evaluation.requiredRoles,
            policyRuleId: evaluation.matchedRule!.id,
          },
          ...sig,
        });

        const result = this.formatPO(updated);
        return { ...result, _receipt: this.ledger.buildReceipt(event) };
      }

      // Auto-approved — log it and continue to SENT
      if (evaluation.requiresApproval && evaluation.autoApprove) {
        await this.ledger.logEvent({
          entityType: "PURCHASE_ORDER",
          entityId: id,
          eventType: "PO_AUTO_APPROVED",
          actorId,
          actorRole: "BUYER",
          payload: {
            policyRuleId: evaluation.matchedRule!.id,
            amount: po.amount,
          },
        });
      }
    }
    // ── End policy evaluation ────────────────────────────────

    const updated = await this.prisma.purchaseOrder.update({
      where: { id },
      data: { status: "SENT" },
      include: {
        buyer: {
          select: {
            id: true,
            email: true,
            name: true,
            role: true,
            companyName: true,
          },
        },
        supplier: {
          select: {
            id: true,
            email: true,
            name: true,
            role: true,
            companyName: true,
          },
        },
        paymentLock: true,
      },
    });

    const event = await this.ledger.logEvent({
      entityType: "PURCHASE_ORDER",
      entityId: id,
      eventType: "PO_SENT",
      actorId,
      actorRole: "BUYER",
      payload: { supplierId: po.supplierId },
      ...sig,
    });

    const result = this.formatPO(updated);
    return { ...result, _receipt: this.ledger.buildReceipt(event) };
  }

  /**
   * Called when an approval chain completes — transitions PO from PENDING_APPROVAL → SENT.
   */
  async onApprovalComplete(poId: string, approvedBy: string) {
    const po = await this.requireStatus(poId, "PENDING_APPROVAL");

    const updated = await this.prisma.purchaseOrder.update({
      where: { id: poId },
      data: { status: "SENT" },
      include: {
        buyer: {
          select: {
            id: true,
            email: true,
            name: true,
            role: true,
            companyName: true,
          },
        },
        supplier: {
          select: {
            id: true,
            email: true,
            name: true,
            role: true,
            companyName: true,
          },
        },
        paymentLock: true,
      },
    });

    await this.ledger.logEvent({
      entityType: "PURCHASE_ORDER",
      entityId: poId,
      eventType: "PO_APPROVAL_GRANTED",
      actorId: approvedBy,
      actorRole: "BUYER",
      payload: { supplierId: po.supplierId },
    });

    await this.ledger.logEvent({
      entityType: "PURCHASE_ORDER",
      entityId: poId,
      eventType: "PO_SENT",
      actorId: approvedBy,
      actorRole: "BUYER",
      payload: { supplierId: po.supplierId, autoSentAfterApproval: true },
    });

    return this.formatPO(updated);
  }

  async accept(id: string, actorId: string, sig?: SignatureData) {
    const po = await this.requireStatus(id, "SENT");
    if (po.supplierId !== actorId)
      throw new ForbiddenException("Only the supplier can accept");

    // Update PO status — commercial acceptance only (no funds move yet)
    const updated = await this.prisma.purchaseOrder.update({
      where: { id },
      data: {
        status: "ACCEPTED",
        acceptedAt: new Date(),
      },
      include: {
        buyer: {
          select: {
            id: true,
            email: true,
            name: true,
            role: true,
            companyName: true,
          },
        },
        supplier: {
          select: {
            id: true,
            email: true,
            name: true,
            role: true,
            companyName: true,
          },
        },
        paymentLock: true,
      },
    });

    const event = await this.ledger.logEvent({
      entityType: "PURCHASE_ORDER",
      entityId: id,
      eventType: "PO_ACCEPTED",
      actorId,
      actorRole: "SUPPLIER",
      payload: {
        amount: po.amount,
        currency: po.currency,
      },
      ...sig,
    });

    const result = this.formatPO(updated);
    return { ...result, _receipt: this.ledger.buildReceipt(event) };
  }

  /**
   * Initiate escrow funding for an accepted PO (Step 1 of 2).
   *
   * Buyer action: validates balance → reserves funds via adapter →
   * creates PaymentLock (PENDING → LOCKED) → returns escrow account
   * details so the buyer can see where payment is going.
   *
   * PO stays in ACCEPTED until the bank confirms receipt of funds
   * (Step 2: confirmEscrowFunding). In simulation mode, a delayed
   * callback auto-confirms after a few seconds.
   */
  async fundEscrow(id: string, actorId: string, sig?: SignatureData) {
    // ── Idempotency guard: if PO already past ACCEPTED, return current state ──
    const poCheck = await this.prisma.purchaseOrder.findUnique({
      where: { id },
    });
    if (!poCheck) throw new NotFoundException("Purchase order not found");
    if (poCheck.status === "FULFILLMENT") {
      this.logger.log(
        `fundEscrow(${id}): PO already in FULFILLMENT — returning idempotent response`,
      );
      const current = await this.prisma.purchaseOrder.findUnique({
        where: { id },
        include: {
          buyer: {
            select: {
              id: true,
              email: true,
              name: true,
              role: true,
              companyName: true,
            },
          },
          supplier: {
            select: {
              id: true,
              email: true,
              name: true,
              role: true,
              companyName: true,
            },
          },
          paymentLock: true,
        },
      });
      return this.formatPO(current);
    }

    const po = await this.requireStatus(id, "ACCEPTED");
    if (po.buyerId !== actorId)
      throw new ForbiddenException("Only the buyer can fund escrow");

    // Idempotency: if lock already exists, return current PO + escrow info
    const existingLock = await this.prisma.paymentLock.findUnique({
      where: { purchaseOrderId: id },
    });
    if (existingLock) {
      // If lock is LOCKED (confirmed but PO still ACCEPTED — shouldn't happen normally),
      // return the current state instead of throwing
      if (existingLock.status === "LOCKED") {
        this.logger.log(
          `fundEscrow(${id}): Lock already LOCKED — returning idempotent response`,
        );
        const current = await this.prisma.purchaseOrder.findUnique({
          where: { id },
          include: {
            buyer: {
              select: {
                id: true,
                email: true,
                name: true,
                role: true,
                companyName: true,
              },
            },
            supplier: {
              select: {
                id: true,
                email: true,
                name: true,
                role: true,
                companyName: true,
              },
            },
            paymentLock: true,
          },
        });
        return this.formatPO(current);
      }
      // If still PENDING, return the escrow details again
      const escrowAccount = await this.prisma.escrowAccount.findFirst({
        where: { currency: po.currency as SettlementCurrency, active: true },
      });
      const current = await this.prisma.purchaseOrder.findUnique({
        where: { id },
        include: {
          buyer: {
            select: {
              id: true,
              email: true,
              name: true,
              role: true,
              companyName: true,
            },
          },
          supplier: {
            select: {
              id: true,
              email: true,
              name: true,
              role: true,
              companyName: true,
            },
          },
          paymentLock: true,
        },
      });
      return {
        ...this.formatPO(current),
        escrowDetails: escrowAccount
          ? {
              bank: escrowAccount.bank,
              iban: escrowAccount.iban,
              label: escrowAccount.label,
              currency: escrowAccount.currency,
              country: escrowAccount.country,
            }
          : null,
        fundingPending: true,
      };
    }

    // Check buyer has sufficient balance
    const buyerBalance = await this.users.getBalance(actorId);
    if (buyerBalance < po.amount) {
      throw new BadRequestException("Insufficient funds to fund escrow");
    }

    // Resolve the correct escrow account by PO currency
    const currency = (po.currency || "GBP") as SettlementCurrency;
    const escrowAccount = await this.prisma.escrowAccount.findFirst({
      where: { currency, active: true },
    });
    if (!escrowAccount) {
      throw new BadRequestException(
        `No active escrow account for currency ${currency}`,
      );
    }

    // Resolve buyer's bank account ref (from org, if available)
    const buyerOrg = await this.orgs.getOrgByUserId(actorId);
    const buyerAccountRef = buyerOrg?.bankIban || undefined;

    // Reserve funds via settlement adapter (debits buyer balance)
    const reservation = await this.settlement.reserveForPO({
      purchaseOrderId: id,
      buyerId: actorId,
      buyerAccountRef,
      amount: po.amount,
      currency,
      escrowAccountId: escrowAccount.id,
    });

    // Log the initiation event (funds reserved, awaiting bank confirmation)
    const event = await this.ledger.logEvent({
      entityType: "PURCHASE_ORDER",
      entityId: id,
      eventType: "ESCROW_FUNDING_INITIATED",
      actorId,
      actorRole: "BUYER",
      payload: {
        amount: po.amount,
        currency,
        escrowAccountId: escrowAccount.id,
        escrowAccountLabel: escrowAccount.label,
        escrowBank: escrowAccount.bank,
        escrowIban: escrowAccount.iban,
        paymentLockId: reservation.paymentLockId,
        externalRef: reservation.externalRef,
        settlementRail: this.settlement.getAdapterName(),
      },
      ...sig,
    });

    // Fetch updated PO with lock
    const updated = await this.prisma.purchaseOrder.findUnique({
      where: { id },
      include: {
        buyer: {
          select: {
            id: true,
            email: true,
            name: true,
            role: true,
            companyName: true,
          },
        },
        supplier: {
          select: {
            id: true,
            email: true,
            name: true,
            role: true,
            companyName: true,
          },
        },
        paymentLock: true,
      },
    });

    const result = this.formatPO(updated);

    // If REAL_BANK_ESCROW flag is enabled, skip simulation — wait for real bank webhook.
    // Otherwise, schedule the simulated bank confirmation (setTimeout).
    const realBankEscrow = await this.featureFlags.isEnabled(
      FeatureFlag.REAL_BANK_ESCROW,
      buyerOrg?.id,
    );
    if (!realBankEscrow) {
      this.scheduleEscrowConfirmation(id, escrowAccount.id, po.amount, actorId);
    } else {
      this.logger.log(
        `REAL_BANK_ESCROW enabled for org ${buyerOrg?.id} — skipping simulation, waiting for bank webhook`,
      );
    }

    return {
      ...result,
      escrowDetails: {
        bank: escrowAccount.bank,
        iban: escrowAccount.iban,
        label: escrowAccount.label,
        currency: escrowAccount.currency,
        country: escrowAccount.country,
      },
      fundingPending: true,
      _receipt: this.ledger.buildReceipt(event),
    };
  }

  /**
   * Confirm escrow funding (Step 2 of 2).
   *
   * Called when the bank confirms that funds have arrived in the escrow
   * account. In simulation mode, this is auto-triggered after a short delay.
   * In production, this would be triggered by a bank webhook.
   *
   * Credits escrow balance → PO → FULFILLMENT → paymentLocked = true.
   */
  async confirmEscrowFunding(id: string) {
    const po = await this.prisma.purchaseOrder.findUnique({
      where: { id },
      include: { paymentLock: true },
    });

    if (!po) throw new NotFoundException("PO not found");

    // Idempotency: already in FULFILLMENT → no-op
    if (po.status === "FULFILLMENT") {
      this.logger.log(`Escrow already confirmed for PO ${id}`);
      return;
    }

    // Must be ACCEPTED with a LOCKED payment lock
    if (po.status !== "ACCEPTED") {
      this.logger.warn(
        `Cannot confirm escrow for PO ${id} in status ${po.status}`,
      );
      return;
    }

    if (!po.paymentLock || po.paymentLock.status !== "LOCKED") {
      this.logger.warn(
        `Cannot confirm escrow for PO ${id}: lock status is ${po.paymentLock?.status ?? "missing"}`,
      );
      return;
    }

    // Resolve escrow account
    const currency = (po.currency || "GBP") as SettlementCurrency;
    const escrowAccount = await this.prisma.escrowAccount.findFirst({
      where: { currency, active: true },
    });

    // Credit escrow account shadow balance
    if (escrowAccount) {
      await this.prisma.escrowAccount.update({
        where: { id: escrowAccount.id },
        data: { balanceMinor: { increment: po.amount } },
      });

      // Record deposit in escrow transaction journal
      await this.escrowAccounting.recordDeposit({
        escrowAccountId: escrowAccount.id,
        amountMinor: po.amount,
        currency,
        purchaseOrderId: po.id,
        counterpartyId: po.buyerId,
        reference: `DEPOSIT ${po.referenceNumber}`,
      });
    }

    // Transition PO → FULFILLMENT (funds secured, supplier can begin work)
    await this.prisma.purchaseOrder.update({
      where: { id },
      data: {
        status: "FULFILLMENT",
        paymentLocked: true,
        lockedAt: new Date(),
      },
    });

    // Log the confirmed event
    await this.ledger.logEvent({
      entityType: "PURCHASE_ORDER",
      entityId: id,
      eventType: "ESCROW_FUNDED",
      actorId: po.buyerId,
      actorRole: "SYSTEM",
      payload: {
        amount: po.amount,
        currency,
        escrowAccountId: escrowAccount?.id,
        escrowAccountLabel: escrowAccount?.label,
        paymentLockId: po.paymentLock.id,
        externalRef: po.paymentLock.openBankingRef,
        confirmedBy: "BANK_CALLBACK",
      },
    });

    this.logger.log(`Escrow confirmed for PO ${id}: ACCEPTED → FULFILLMENT`);
  }

  /**
   * Schedule a simulated bank confirmation callback.
   * In production, this would be replaced by a real bank webhook handler.
   * The delay simulates the time for a bank transfer to settle.
   */
  private scheduleEscrowConfirmation(
    poId: string,
    escrowAccountId: string,
    amount: number,
    buyerId: string,
  ) {
    const delayMs = Number(process.env.ESCROW_CONFIRM_DELAY_MS) || 4000;
    this.logger.log(
      `Scheduling simulated escrow confirmation for PO ${poId} in ${delayMs}ms`,
    );
    setTimeout(async () => {
      try {
        await this.confirmEscrowFunding(poId);
      } catch (err) {
        this.logger.error(
          `Simulated escrow confirmation failed for PO ${poId}: ${(err as Error).message}`,
        );
      }
    }, delayMs);
  }

  async reject(id: string, actorId: string, sig?: SignatureData) {
    const po = await this.requireStatus(id, "SENT");
    if (po.supplierId !== actorId)
      throw new ForbiddenException("Only the supplier can reject");

    const updated = await this.prisma.purchaseOrder.update({
      where: { id },
      data: { status: "CANCELLED" },
      include: {
        buyer: {
          select: {
            id: true,
            email: true,
            name: true,
            role: true,
            companyName: true,
          },
        },
        supplier: {
          select: {
            id: true,
            email: true,
            name: true,
            role: true,
            companyName: true,
          },
        },
        paymentLock: true,
      },
    });

    const event = await this.ledger.logEvent({
      entityType: "PURCHASE_ORDER",
      entityId: id,
      eventType: "PO_CANCELLED",
      actorId,
      actorRole: "SUPPLIER",
      payload: { reason: "Rejected by supplier" },
      ...sig,
    });

    const result = this.formatPO(updated);
    return { ...result, _receipt: this.ledger.buildReceipt(event) };
  }

  // ── Negotiation (counter-proposals) ─────────────────────────

  async counterPropose(
    id: string,
    actorId: string,
    input: {
      lineItems: Array<{
        description: string;
        quantity: number;
        unitPricePennies: number;
        sku?: string;
        unitOfMeasure?: string;
      }>;
      notes?: string;
      expectedDeliveryDate?: string;
      paymentTerms?: PaymentTermsValue;
      deliveryTerms?: DeliveryTermsValue;
    },
    sig?: SignatureData,
  ) {
    const po = await this.prisma.purchaseOrder.findUnique({
      where: { id },
      include: { revisions: true },
    });
    if (!po) throw new NotFoundException("PO not found");

    // Supplier can counter from SENT; either party can counter from NEGOTIATION
    if (po.status === "SENT") {
      if (po.supplierId !== actorId)
        throw new ForbiddenException(
          "Only the supplier can counter-propose a SENT PO",
        );
    } else if (po.status === "NEGOTIATION") {
      // The OTHER party counters (not the one who last proposed)
      const lastRevision = po.revisions.sort(
        (a, b) => b.revision - a.revision,
      )[0];
      if (lastRevision && lastRevision.proposedBy === actorId) {
        throw new BadRequestException(
          "You already proposed the latest revision. Wait for the other party to respond.",
        );
      }
      if (po.buyerId !== actorId && po.supplierId !== actorId) {
        throw new ForbiddenException("Only PO parties can negotiate");
      }
    } else {
      throw new BadRequestException(
        `Cannot counter-propose from status ${po.status}`,
      );
    }

    const proposedAmount = input.lineItems.reduce(
      (sum, item) => sum + item.quantity * item.unitPricePennies,
      0,
    );

    const nextRevision = po.currentRevision + 1;
    const actorRole = po.buyerId === actorId ? "BUYER" : "SUPPLIER";

    // Mark any previous pending revision as SUPERSEDED
    await this.prisma.pORevision.updateMany({
      where: { purchaseOrderId: id, status: "PENDING" },
      data: { status: "SUPERSEDED" },
    });

    // Create the revision record
    const revision = await this.prisma.pORevision.create({
      data: {
        purchaseOrderId: id,
        revision: nextRevision,
        proposedBy: actorId,
        proposedByRole: actorRole,
        lineItems: input.lineItems,
        amount: proposedAmount,
        notes: input.notes,
        expectedDeliveryDate: input.expectedDeliveryDate
          ? new Date(input.expectedDeliveryDate)
          : null,
        paymentTerms: input.paymentTerms as any,
        deliveryTerms: input.deliveryTerms as any,
        status: "PENDING",
      },
    });

    // Update PO to NEGOTIATION
    const updated = await this.prisma.purchaseOrder.update({
      where: { id },
      data: {
        status: "NEGOTIATION",
        currentRevision: nextRevision,
      },
      include: {
        buyer: {
          select: {
            id: true,
            email: true,
            name: true,
            role: true,
            companyName: true,
          },
        },
        supplier: {
          select: {
            id: true,
            email: true,
            name: true,
            role: true,
            companyName: true,
          },
        },
        paymentLock: true,
        revisions: { orderBy: { revision: "desc" } },
      },
    });

    const event = await this.ledger.logEvent({
      entityType: "PURCHASE_ORDER",
      entityId: id,
      eventType: "PO_COUNTER_PROPOSED",
      actorId,
      actorRole,
      payload: {
        revision: nextRevision,
        proposedAmount,
        lineItemCount: input.lineItems.length,
        originalAmount: po.amount,
        notes: input.notes || null,
      },
      ...sig,
    });

    const result = this.formatPO(updated);
    return { ...result, _receipt: this.ledger.buildReceipt(event) };
  }

  async acceptCounter(id: string, actorId: string, sig?: SignatureData) {
    const po = await this.prisma.purchaseOrder.findUnique({
      where: { id },
      include: {
        revisions: { orderBy: { revision: "desc" }, take: 1 },
      },
    });
    if (!po) throw new NotFoundException("PO not found");
    if (po.status !== "NEGOTIATION") {
      throw new BadRequestException("PO is not in NEGOTIATION status");
    }

    const latestRevision = po.revisions[0];
    if (!latestRevision || latestRevision.status !== "PENDING") {
      throw new BadRequestException("No pending counter-proposal to accept");
    }
    // Only the OTHER party (not the proposer) can accept
    if (latestRevision.proposedBy === actorId) {
      throw new BadRequestException(
        "You cannot accept your own counter-proposal",
      );
    }
    if (po.buyerId !== actorId && po.supplierId !== actorId) {
      throw new ForbiddenException("Only PO parties can accept a counter");
    }

    const actorRole = po.buyerId === actorId ? "BUYER" : "SUPPLIER";

    // Apply the revision: update PO line items, amount, and move to SENT
    // (so the normal accept flow can continue)
    const taxAmount = Math.round(
      (latestRevision.amount * (po.taxRate || 0)) / 10000,
    );

    await this.prisma.pORevision.update({
      where: { id: latestRevision.id },
      data: { status: "ACCEPTED" },
    });

    const updated = await this.prisma.purchaseOrder.update({
      where: { id },
      data: {
        status: "SENT",
        lineItems: latestRevision.lineItems as any,
        amount: latestRevision.amount,
        taxAmount,
        grossAmount: latestRevision.amount + taxAmount,
        expectedDeliveryDate:
          latestRevision.expectedDeliveryDate ?? po.expectedDeliveryDate,
        paymentTerms: (latestRevision.paymentTerms as any) ?? po.paymentTerms,
        deliveryTerms:
          (latestRevision.deliveryTerms as any) ?? po.deliveryTerms,
      },
      include: {
        buyer: {
          select: {
            id: true,
            email: true,
            name: true,
            role: true,
            companyName: true,
          },
        },
        supplier: {
          select: {
            id: true,
            email: true,
            name: true,
            role: true,
            companyName: true,
          },
        },
        paymentLock: true,
        revisions: { orderBy: { revision: "desc" } },
      },
    });

    const event = await this.ledger.logEvent({
      entityType: "PURCHASE_ORDER",
      entityId: id,
      eventType: "PO_COUNTER_ACCEPTED",
      actorId,
      actorRole,
      payload: {
        revision: latestRevision.revision,
        acceptedAmount: latestRevision.amount,
        previousAmount: po.amount,
      },
      ...sig,
    });

    const result = this.formatPO(updated);
    return { ...result, _receipt: this.ledger.buildReceipt(event) };
  }

  async rejectCounter(id: string, actorId: string, sig?: SignatureData) {
    const po = await this.prisma.purchaseOrder.findUnique({
      where: { id },
      include: {
        revisions: { orderBy: { revision: "desc" }, take: 1 },
      },
    });
    if (!po) throw new NotFoundException("PO not found");
    if (po.status !== "NEGOTIATION") {
      throw new BadRequestException("PO is not in NEGOTIATION status");
    }

    const latestRevision = po.revisions[0];
    if (!latestRevision || latestRevision.status !== "PENDING") {
      throw new BadRequestException("No pending counter-proposal to reject");
    }
    if (latestRevision.proposedBy === actorId) {
      throw new BadRequestException(
        "You cannot reject your own counter-proposal",
      );
    }
    if (po.buyerId !== actorId && po.supplierId !== actorId) {
      throw new ForbiddenException("Only PO parties can reject a counter");
    }

    const actorRole = po.buyerId === actorId ? "BUYER" : "SUPPLIER";

    await this.prisma.pORevision.update({
      where: { id: latestRevision.id },
      data: { status: "REJECTED" },
    });

    // Return PO to CANCELLED — the negotiation failed
    const updated = await this.prisma.purchaseOrder.update({
      where: { id },
      data: { status: "CANCELLED" },
      include: {
        buyer: {
          select: {
            id: true,
            email: true,
            name: true,
            role: true,
            companyName: true,
          },
        },
        supplier: {
          select: {
            id: true,
            email: true,
            name: true,
            role: true,
            companyName: true,
          },
        },
        paymentLock: true,
        revisions: { orderBy: { revision: "desc" } },
      },
    });

    const event = await this.ledger.logEvent({
      entityType: "PURCHASE_ORDER",
      entityId: id,
      eventType: "PO_COUNTER_REJECTED",
      actorId,
      actorRole,
      payload: {
        revision: latestRevision.revision,
        rejectedAmount: latestRevision.amount,
      },
      ...sig,
    });

    const result = this.formatPO(updated);
    return { ...result, _receipt: this.ledger.buildReceipt(event) };
  }

  async markShipped(id: string, actorId: string, sig?: SignatureData) {
    const po = await this.prisma.purchaseOrder.findUnique({
      where: { id },
      include: { paymentLock: true },
    });
    if (!po) throw new NotFoundException("PO not found");
    if (po.status !== "FULFILLMENT") {
      throw new BadRequestException(
        `Cannot mark as shipped from status ${po.status} (escrow must be funded first)`,
      );
    }
    if (po.supplierId !== actorId)
      throw new ForbiddenException("Only the supplier can mark shipment");

    // Defensive guard: ensure payment is actually secured before shipment
    if (
      !po.paymentLocked ||
      !po.paymentLock ||
      po.paymentLock.status !== "LOCKED"
    ) {
      throw new BadRequestException(
        "Cannot ship: buyer payment has not been locked in escrow. " +
          "The buyer must fund escrow before goods can be shipped.",
      );
    }

    const updated = await this.prisma.purchaseOrder.update({
      where: { id },
      data: { status: "SHIPPED", shippedAt: new Date() },
      include: {
        buyer: {
          select: {
            id: true,
            email: true,
            name: true,
            role: true,
            companyName: true,
          },
        },
        supplier: {
          select: {
            id: true,
            email: true,
            name: true,
            role: true,
            companyName: true,
          },
        },
        paymentLock: true,
      },
    });

    const event = await this.ledger.logEvent({
      entityType: "PURCHASE_ORDER",
      entityId: id,
      eventType: "GOODS_SHIPPED",
      actorId,
      actorRole: "SUPPLIER",
      payload: { shippedAt: new Date().toISOString() },
      ...sig,
    });

    const result = this.formatPO(updated);
    return { ...result, _receipt: this.ledger.buildReceipt(event) };
  }

  async markDelivered(id: string, actorId: string, sig?: SignatureData) {
    const po = await this.prisma.purchaseOrder.findUnique({ where: { id } });
    if (!po) throw new NotFoundException("PO not found");
    if (po.status !== "SHIPPED") {
      throw new BadRequestException(
        `Cannot mark as delivered from status ${po.status} (must be shipped first)`,
      );
    }
    if (po.supplierId !== actorId)
      throw new ForbiddenException("Only the supplier can mark delivery");

    const updated = await this.prisma.purchaseOrder.update({
      where: { id },
      data: { status: "DELIVERED", deliveredAt: new Date() },
      include: {
        buyer: {
          select: {
            id: true,
            email: true,
            name: true,
            role: true,
            companyName: true,
          },
        },
        supplier: {
          select: {
            id: true,
            email: true,
            name: true,
            role: true,
            companyName: true,
          },
        },
        paymentLock: true,
      },
    });

    const event = await this.ledger.logEvent({
      entityType: "PURCHASE_ORDER",
      entityId: id,
      eventType: "DELIVERY_MARKED",
      actorId,
      actorRole: "SUPPLIER",
      payload: { deliveredAt: updated.deliveredAt },
      ...sig,
    });

    const result = this.formatPO(updated);
    return { ...result, _receipt: this.ledger.buildReceipt(event) };
  }

  async verifyDelivery(id: string, actorId: string, sig?: SignatureData) {
    const po = await this.requireStatus(id, "DELIVERED");
    if (po.buyerId !== actorId)
      throw new ForbiddenException("Only the buyer can verify delivery");

    const updated = await this.prisma.purchaseOrder.update({
      where: { id },
      data: { status: "VERIFIED", verifiedAt: new Date() },
      include: {
        buyer: {
          select: {
            id: true,
            email: true,
            name: true,
            role: true,
            companyName: true,
          },
        },
        supplier: {
          select: {
            id: true,
            email: true,
            name: true,
            role: true,
            companyName: true,
          },
        },
        paymentLock: true,
      },
    });

    const event = await this.ledger.logEvent({
      entityType: "PURCHASE_ORDER",
      entityId: id,
      eventType: "DELIVERY_VERIFIED",
      actorId,
      actorRole: "BUYER",
      payload: { verifiedAt: updated.verifiedAt },
      ...sig,
    });

    const result = this.formatPO(updated);
    return { ...result, _receipt: this.ledger.buildReceipt(event) };
  }

  /**
   * Buyer acknowledges their obligation to pay. Triggers settlement.
   *
   * DOUBLE-PAYMENT PREVENTION:
   * The recipient is determined by the instrument's settlementBeneficiary,
   * which is read atomically via SELECT FOR UPDATE in requestSettlement().
   * This serialises with any concurrent LP funding attempt.
   */
  async acknowledgeObligation(
    id: string,
    actorId: string,
    sig?: SignatureData,
  ) {
    // ── Idempotency guard: if already SETTLED, return existing state ──
    const poCheck = await this.prisma.purchaseOrder.findUnique({
      where: { id },
      include: {
        buyer: {
          select: {
            id: true,
            email: true,
            name: true,
            role: true,
            companyName: true,
          },
        },
        supplier: {
          select: {
            id: true,
            email: true,
            name: true,
            role: true,
            companyName: true,
          },
        },
        paymentLock: true,
      },
    });
    if (!poCheck) throw new NotFoundException("Purchase order not found");
    if (poCheck.status === "SETTLED") {
      this.logger.log(
        `acknowledgeObligation(${id}): PO already SETTLED — returning idempotent response`,
      );
      return this.formatPO(poCheck);
    }

    const po = await this.requireStatus(id, "VERIFIED");
    if (po.buyerId !== actorId)
      throw new ForbiddenException(
        "Only the buyer can acknowledge the obligation",
      );

    // ── Load instrument + early pay ──────────────────────────
    const instrument = await this.prisma.paymentInstrument.findUnique({
      where: { purchaseOrderId: id },
    });
    if (!instrument) {
      throw new BadRequestException("PO has no payment instrument");
    }

    const earlyPay = await this.prisma.earlyPaymentRequest.findUnique({
      where: { purchaseOrderId: id },
    });

    // Auto-expire unfunded/unrequested early payment requests
    if (earlyPay && earlyPay.status === "REQUESTED") {
      await this.prisma.earlyPaymentRequest.update({
        where: { id: earlyPay.id },
        data: { status: "EXPIRED" },
      });
      await this.ledger.logEvent({
        entityType: "EARLY_PAYMENT",
        entityId: earlyPay.id,
        eventType: "EARLY_PAY_EXPIRED",
        actorId,
        actorRole: "SYSTEM",
        payload: {
          reason: "PO settled without LP funding",
          purchaseOrderId: id,
        },
      });
      // If instrument was in FINANCING_REQUESTED, revert it back to LOCKED
      if (instrument.status === "FINANCING_REQUESTED") {
        await this.instrumentService.revertFinancing(instrument.id, actorId);
      }
    }

    // ── Resolve settlement via centralised router ────────────
    const plan = await this.settlementRouter.resolveSettlement(id);
    const recipientId = plan.recipientUserId;
    const recipientAccountRef = plan.recipientBankIban || undefined;

    // ── Atomically transition instrument to SETTLEMENT_PENDING ──
    // This uses SELECT FOR UPDATE internally, serialising with any
    // concurrent confirmFinancing() call in the LP funding path.
    await this.instrumentService.requestSettlement(
      { instrumentId: instrument.id, recipientAccountRef },
      actorId,
    );

    const hasEarlyPay =
      earlyPay && earlyPay.status === "FUNDED" && earlyPay.liquidityPartnerId;

    // Log obligation acknowledgment before settlement
    const event = await this.ledger.logEvent({
      entityType: "PURCHASE_ORDER",
      entityId: id,
      eventType: "OBLIGATION_ACKNOWLEDGED",
      actorId,
      actorRole: "BUYER",
      payload: {
        totalAmount: plan.grossAmount,
        currency: plan.currency,
        recipientId,
        recipient: plan.recipient,
        settlementBeneficiary: instrument.settlementBeneficiary,
        feeBps: plan.feeBps,
        acknowledgedAt: new Date().toISOString(),
      },
      ...sig,
    });

    // Settle via settlement adapter
    const result = await this.settlement.settlePO({
      purchaseOrderId: id,
      recipientId,
      recipientAccountRef,
      totalAmount: plan.grossAmount,
      feeBps: plan.feeBps,
      currency: plan.currency,
      earlyPaymentRequestId: plan.earlyPaymentRequestId,
    });

    // Update PO status and early payment in a transaction
    const settledPO = await this.prisma.$transaction(async (tx) => {
      if (hasEarlyPay) {
        await tx.earlyPaymentRequest.update({
          where: { id: earlyPay!.id },
          data: { status: "SETTLED", settledAt: new Date() },
        });
      }

      return tx.purchaseOrder.update({
        where: { id },
        data: { status: "SETTLED", settledAt: new Date() },
        include: {
          buyer: {
            select: {
              id: true,
              email: true,
              name: true,
              role: true,
              companyName: true,
            },
          },
          supplier: {
            select: {
              id: true,
              email: true,
              name: true,
              role: true,
              companyName: true,
            },
          },
          paymentLock: true,
        },
      });
    });

    await this.ledger.logEvent({
      entityType: "PURCHASE_ORDER",
      entityId: id,
      eventType: "SETTLEMENT_COMPLETED",
      actorId,
      actorRole: "BUYER",
      payload: {
        totalAmount: plan.grossAmount,
        feeAmount: result.feeAmount,
        recipientReceives: result.netAmount,
        earlyPaySettlement: !!hasEarlyPay,
        recipientId,
        recipient: plan.recipient,
        settlementBeneficiary: instrument.settlementBeneficiary,
        settlementRail: this.settlement.getAdapterName(),
        externalRef: result.externalRef,
      },
    });

    const formatted = this.formatPO(settledPO);
    return { ...formatted, _receipt: this.ledger.buildReceipt(event) };
  }

  // resolveRecipientFromBeneficiary() has been extracted to
  // SettlementRouterService.resolveRecipient() — see Phase 2 hardening.

  async dispute(id: string, actorId: string, sig?: SignatureData) {
    const po = await this.requireStatus(id, "DELIVERED");
    if (po.buyerId !== actorId)
      throw new ForbiddenException("Only the buyer can dispute");

    const updated = await this.prisma.purchaseOrder.update({
      where: { id },
      data: { status: "DISPUTED" },
      include: {
        buyer: {
          select: {
            id: true,
            email: true,
            name: true,
            role: true,
            companyName: true,
          },
        },
        supplier: {
          select: {
            id: true,
            email: true,
            name: true,
            role: true,
            companyName: true,
          },
        },
        paymentLock: true,
      },
    });

    // Auto-expire any unfunded early payment request — dispute blocks normal settlement
    const earlyPay = await this.prisma.earlyPaymentRequest.findUnique({
      where: { purchaseOrderId: id },
    });
    if (earlyPay && earlyPay.status === "REQUESTED") {
      await this.prisma.earlyPaymentRequest.update({
        where: { id: earlyPay.id },
        data: { status: "EXPIRED" },
      });
      await this.ledger.logEvent({
        entityType: "EARLY_PAYMENT",
        entityId: earlyPay.id,
        eventType: "EARLY_PAY_EXPIRED",
        actorId,
        actorRole: "SYSTEM",
        payload: {
          reason: "PO disputed by buyer",
          purchaseOrderId: id,
        },
      });
    }

    const event = await this.ledger.logEvent({
      entityType: "PURCHASE_ORDER",
      entityId: id,
      eventType: "DELIVERY_DISPUTED",
      actorId,
      actorRole: "BUYER",
      payload: {},
      ...sig,
    });

    const result = this.formatPO(updated);
    return { ...result, _receipt: this.ledger.buildReceipt(event) };
  }

  // ── CSV Import ────────────────────────────────────────────

  /**
   * Import POs from a CSV buffer.
   * Expected CSV columns: supplierId, description, lineDescription, quantity, unitPricePennies
   *                        externalPoNumber, paymentTerms, deliveryTerms, deliveryAddress, taxRate
   * Multiple rows with the same externalPoNumber are merged into one PO with multiple line items.
   */
  async importFromCSV(
    csvBuffer: Buffer,
    buyerId: string,
  ): Promise<{ imported: number; errors: string[] }> {
    const text = csvBuffer.toString("utf-8");
    const lines = text.split(/\r?\n/).filter((l) => l.trim());
    if (lines.length < 2) {
      throw new BadRequestException(
        "CSV must have a header row and at least one data row",
      );
    }

    const headers = lines[0].split(",").map((h) => h.trim().toLowerCase());
    const requiredHeaders = [
      "supplierid",
      "linedescription",
      "quantity",
      "unitpricepennies",
    ];
    for (const rh of requiredHeaders) {
      if (!headers.includes(rh)) {
        throw new BadRequestException(`Missing required CSV column: ${rh}`);
      }
    }

    // Group rows by externalPoNumber (or by row index if not provided)
    const groups: Record<string, Record<string, string>[]> = {};
    const errors: string[] = [];

    for (let i = 1; i < lines.length; i++) {
      const values = lines[i].split(",").map((v) => v.trim());
      const row: Record<string, string> = {};
      headers.forEach((h, idx) => {
        row[h] = values[idx] || "";
      });

      const groupKey = row["externalponumber"] || `__row_${i}`;
      if (!groups[groupKey]) groups[groupKey] = [];
      groups[groupKey].push(row);
    }

    const batchId = `import-${Date.now().toString(36)}`;
    let imported = 0;

    for (const [key, rows] of Object.entries(groups)) {
      try {
        const firstRow = rows[0];
        const lineItems = rows.map((r) => ({
          description: r["linedescription"] || "Imported item",
          quantity: parseInt(r["quantity"]) || 1,
          unitPricePennies: parseInt(r["unitpricepennies"]) || 0,
        }));

        await this.create({
          buyerId,
          supplierId: firstRow["supplierid"],
          description: firstRow["description"] || `Imported PO: ${key}`,
          lineItems,
          externalPoNumber: key.startsWith("__row_") ? undefined : key,
          paymentTerms: (firstRow["paymentterms"] as any) || undefined,
          deliveryTerms: (firstRow["deliveryterms"] as any) || undefined,
          deliveryAddress: firstRow["deliveryaddress"] || undefined,
          taxRate: firstRow["taxrate"]
            ? parseInt(firstRow["taxrate"])
            : undefined,
          importSource: "CSV",
          importBatchId: batchId,
        });
        imported++;
      } catch (err: any) {
        errors.push(`Group "${key}": ${err.message}`);
      }
    }

    return { imported, errors };
  }

  // ── Helpers ──────────────────────────────────────────────────

  private async requireStatus(id: string, expectedStatus: string) {
    const po = await this.prisma.purchaseOrder.findUnique({ where: { id } });
    if (!po) throw new NotFoundException("Purchase order not found");
    if (po.status !== expectedStatus) {
      throw new BadRequestException(
        `PO is in ${po.status} status, expected ${expectedStatus}`,
      );
    }
    return po;
  }

  private formatPO(po: any) {
    return {
      id: po.id,
      reference: po.referenceNumber,
      buyerId: po.buyerId,
      supplierId: po.supplierId,
      status: po.status,
      totalAmountPennies: po.amount,
      totalAmountMinor: po.amount,
      currency: po.currency,
      lineItems: po.lineItems,
      description: po.description || null,
      acceptanceDeadline: po.acceptedAt
        ? null
        : po.status === "SENT"
          ? new Date(
              new Date(po.createdAt).getTime() +
                po.acceptanceWindowHours * 60 * 60 * 1000,
            ).toISOString()
          : null,
      paymentLocked: po.paymentLocked,
      // Phase 4 extended fields
      externalPoNumber: po.externalPoNumber || null,
      paymentTerms: po.paymentTerms || "IMMEDIATE",
      deliveryTerms: po.deliveryTerms || "EX_WORKS",
      deliveryTermsNote: po.deliveryTermsNote || null,
      deliveryAddress: po.deliveryAddress || null,
      taxRate: po.taxRate ?? 0,
      taxAmount: po.taxAmount ?? 0,
      grossAmount: po.grossAmount ?? po.amount,
      disputeWindowHours: po.disputeWindowHours ?? 72,
      partialAcceptanceAllowed: po.partialAcceptanceAllowed ?? false,
      acceptedLineItems: po.acceptedLineItems ?? [],
      importSource: po.importSource || null,
      importBatchId: po.importBatchId || null,
      importedAt: po.importedAt || null,
      attachmentUrl: po.attachmentUrl || null,
      // Standard PO header fields
      expectedDeliveryDate: po.expectedDeliveryDate || null,
      notes: po.notes || null,
      buyerContactName: po.buyerContactName || null,
      buyerContactEmail: po.buyerContactEmail || null,
      currentRevision: po.currentRevision ?? 0,
      // Timestamps
      acceptedAt: po.acceptedAt,
      shippedAt: po.shippedAt,
      deliveredAt: po.deliveredAt,
      verifiedAt: po.verifiedAt,
      settledAt: po.settledAt,
      createdAt: po.createdAt,
      updatedAt: po.updatedAt,
      buyer: po.buyer || undefined,
      supplier: po.supplier || undefined,
      paymentLock: po.paymentLock
        ? {
            id: po.paymentLock.id,
            purchaseOrderId: po.paymentLock.purchaseOrderId,
            amountPennies: po.paymentLock.amount,
            amountMinor: po.paymentLock.amount,
            currency: po.paymentLock.currency || po.currency,
            status: po.paymentLock.status,
            externalRef: po.paymentLock.openBankingRef || null,
            lockedAt: po.paymentLock.lockedAt,
            releasedAt: po.paymentLock.releasedAt,
          }
        : null,
      // Revisions (if loaded)
      revisions: po.revisions
        ? po.revisions.map((r: any) => ({
            id: r.id,
            revision: r.revision,
            proposedBy: r.proposedBy,
            proposedByRole: r.proposedByRole,
            lineItems: r.lineItems,
            amount: r.amount,
            notes: r.notes,
            expectedDeliveryDate: r.expectedDeliveryDate,
            paymentTerms: r.paymentTerms,
            deliveryTerms: r.deliveryTerms,
            status: r.status,
            createdAt: r.createdAt,
          }))
        : undefined,
    };
  }
}
