# i18n String Catalog — Complete Extraction

> Every user-visible string from 29 frontend files.
> Format: `key` | English text | interpolation? | status/enum?

---

## 1. `src/app/page.tsx`

No user-visible strings (redirect only).

---

## 2. `src/app/login/page.tsx`

| Key | English Text | Interpolation | Status/Enum |
|-----|-------------|---------------|-------------|
| `login.title` | Programmable SME Settlement | | |
| `login.subtitle` | Event-Driven B2B Payments with Embedded Liquidity and Verifiable Digital Trust | | |
| `login.card.title` | Sign in | | |
| `login.card.description` | Enter your credentials or choose a demo account below | | |
| `login.form.emailLabel` | Email | | |
| `login.form.emailPlaceholder` | you@company.co.uk | | |
| `login.form.passwordLabel` | Password | | |
| `login.form.passwordPlaceholder` | •••••••• | | |
| `login.form.submitLoading` | Signing in… | | |
| `login.form.submit` | Sign in | | |
| `login.demo.title` | KSA Demo Accounts | | |
| `login.demo.description` | Quick-login as any demo persona to test the full lifecycle. Each has a different role and organisation. | | |
| `login.demo.group.buyer` | Buyer Team – Al-Rajhi Trading Co | | |
| `login.demo.group.supplier` | Supplier Team – Noor Supply Chain | | |
| `login.demo.group.lp` | LP Team – Tamweel Capital | | |
| `login.demo.group.platform` | Platform | | |
| `login.demo.account.ahmedAlRashid` | Ahmed Al-Rashid (Owner) | | |
| `login.demo.account.fatimahAlSaud` | Fatimah Al-Saud (Finance) | | |
| `login.demo.account.khalidAlOtaibi` | Khalid Al-Otaibi (Approver) | | |
| `login.demo.account.nouraAlDossari` | Noura Al-Dossari (Viewer) | | |
| `login.demo.account.mohammedAlHarbi` | Mohammed Al-Harbi (Owner) | | |
| `login.demo.account.sarahAlQahtani` | Sarah Al-Qahtani (Finance) | | |
| `login.demo.account.abdullahAlShehri` | Abdullah Al-Shehri (Approver) | | |
| `login.demo.account.lamaAlJuhani` | Lama Al-Juhani (Viewer) | | |
| `login.demo.account.youssefAlTamimi` | Youssef Al-Tamimi (Owner) | | |
| `login.demo.account.reemAlKhalidi` | Reem Al-Khalidi (Finance) | | |
| `login.demo.account.hassanAlMutairi` | Hassan Al-Mutairi (Approver) | | |
| `login.demo.account.adminUser` | Platform Admin | | |
| `login.toast.success` | Logged in successfully | | |
| `login.toast.invalidCredentials` | Invalid email or password | | |
| `login.toast.failed` | Login failed | | |

---

## 3. `src/app/dashboard/page.tsx`

| Key | English Text | Interpolation | Status/Enum |
|-----|-------------|---------------|-------------|
| `dashboard.greeting` | Welcome, {firstName} | ✅ `firstName` | |
| `dashboard.badge.ksa` | 🇸🇦 KSA | | |
| `dashboard.badge.uk` | 🇬🇧 UK | | |
| `dashboard.button.newPO` | New Purchase Order | | |
| `dashboard.stat.escrowBalance` | Escrow Balance | | |
| `dashboard.stat.accountBalance` | Account Balance | | |
| `dashboard.stat.escrowBalanceDesc` | Platform escrow | | |
| `dashboard.stat.accountBalanceDesc` | Available funds | | |
| `dashboard.stat.totalPOs` | Total POs | | |
| `dashboard.stat.totalPOsDesc` | {count} active | ✅ `count` | |
| `dashboard.stat.lockedAmount` | Locked Amount | | |
| `dashboard.stat.pendingAction` | Pending Action | | |
| `dashboard.stat.lockedAmountDesc` | Funds locked against POs | | |
| `dashboard.stat.pendingActionDesc` | Awaiting response | | |
| `dashboard.stat.totalValue` | Total Value | | |
| `dashboard.stat.totalValueDesc` | All purchase orders | | |
| `dashboard.alert.discrepancyTitle` | Escrow / Locked Amount Discrepancy | | |
| `dashboard.alert.runReconciliation` | Run reconciliation | | |
| `dashboard.quickAction.buyer.createPO.title` | Create Purchase Order | | |
| `dashboard.quickAction.buyer.createPO.desc` | Send a new PO to a supplier for goods or services | | |
| `dashboard.quickAction.buyer.viewPOs.title` | View Purchase Orders | | |
| `dashboard.quickAction.buyer.viewPOs.desc` | Track all your purchase orders and their statuses | | |
| `dashboard.quickAction.supplier.incomingOrders.title` | Incoming Orders | | |
| `dashboard.quickAction.supplier.incomingOrders.desc` | View and accept purchase orders from buyers | | |
| `dashboard.quickAction.supplier.earlyPayment.title` | Early Payment | | |
| `dashboard.quickAction.supplier.earlyPayment.desc` | Request early payment on verified deliveries | | |
| `dashboard.quickAction.lp.marketplace.title` | Marketplace | | |
| `dashboard.quickAction.lp.marketplace.desc` | Browse verified POs available for early payment funding | | |
| `dashboard.quickAction.lp.auditLedger.title` | Audit Ledger | | |
| `dashboard.quickAction.lp.auditLedger.desc` | Verify the cryptographic integrity of all events | | |
| `dashboard.quickAction.admin.platformAdmin.title` | Platform Admin | | |
| `dashboard.quickAction.admin.platformAdmin.desc` | View platform statistics and manage operations | | |
| `dashboard.quickAction.admin.fullLedger.title` | Full Ledger | | |
| `dashboard.quickAction.admin.fullLedger.desc` | Audit the complete event ledger with hash verification | | |

---

## 4. `src/app/dashboard/purchase-orders/page.tsx`

| Key | English Text | Interpolation | Status/Enum |
|-----|-------------|---------------|-------------|
| `po.list.title` | Purchase Orders | | |
| `po.list.subtitle.buyer` | Manage orders you've created | | |
| `po.list.subtitle.supplier` | View orders sent to you | | |
| `po.list.button.importCSV` | Import CSV | | |
| `po.list.button.newPO` | New PO | | |
| `po.list.card.title` | All Orders | | |
| `po.list.card.description` | {count} purchase order(s) | ✅ `count` | |
| `po.list.empty.title` | No purchase orders yet | | |
| `po.list.empty.action` | Create your first PO | | |
| `po.list.table.reference` | Reference | | |
| `po.list.table.supplier` | Supplier | | |
| `po.list.table.buyer` | Buyer | | |
| `po.list.table.amount` | Amount | | |
| `po.list.table.status` | Status | | |
| `po.list.table.date` | Date | | |

---

## 5. `src/app/dashboard/purchase-orders/new/page.tsx`

| Key | English Text | Interpolation | Status/Enum |
|-----|-------------|---------------|-------------|
| `po.new.title` | New Purchase Order | | |
| `po.new.subtitle` | Create a PO to send to a supplier | | |
| `po.new.section.orderDetails` | Order Details | | |
| `po.new.label.supplier` | Supplier | | |
| `po.new.placeholder.supplier` | Select a supplier | | |
| `po.new.label.description` | Description (optional) | | |
| `po.new.placeholder.description` | General notes about this order… | | |
| `po.new.label.externalPoNumber` | External PO Number (optional) | | |
| `po.new.placeholder.externalPoNumber` | e.g. EXT-PO-2025-001 | | |
| `po.new.label.paymentTerms` | Payment Terms | | |
| `po.new.paymentTerms.immediate` | Immediate | | ✅ |
| `po.new.paymentTerms.net15` | Net 15 | | ✅ |
| `po.new.paymentTerms.net30` | Net 30 | | ✅ |
| `po.new.paymentTerms.net45` | Net 45 | | ✅ |
| `po.new.paymentTerms.net60` | Net 60 | | ✅ |
| `po.new.paymentTerms.net90` | Net 90 | | ✅ |
| `po.new.label.deliveryTerms` | Delivery Terms | | |
| `po.new.deliveryTerms.exw` | Ex Works | | ✅ |
| `po.new.deliveryTerms.fob` | FOB | | ✅ |
| `po.new.deliveryTerms.cif` | CIF | | ✅ |
| `po.new.deliveryTerms.ddp` | DDP | | ✅ |
| `po.new.deliveryTerms.custom` | Custom | | ✅ |
| `po.new.label.deliveryAddress` | Delivery Address (optional) | | |
| `po.new.placeholder.deliveryAddress` | Warehouse or delivery location | | |
| `po.new.label.taxRate` | Tax Rate (%) | | |
| `po.new.placeholder.taxRate` | e.g. 15 for 15% VAT | | |
| `po.new.label.disputeWindow` | Dispute Window (hours) | | |
| `po.new.label.expectedDeliveryDate` | Expected Delivery Date (optional) | | |
| `po.new.label.specialInstructions` | Special Instructions / Notes (optional) | | |
| `po.new.placeholder.specialInstructions` | Packaging requirements, handling instructions, etc. | | |
| `po.new.section.buyerContact` | Buyer Contact | | |
| `po.new.label.contactName` | Contact Name (optional) | | |
| `po.new.placeholder.contactName` | e.g. John Smith | | |
| `po.new.label.contactEmail` | Contact Email (optional) | | |
| `po.new.placeholder.contactEmail` | e.g. john@company.com | | |
| `po.new.section.lineItems` | Line Items | | |
| `po.new.section.lineItemsDesc` | Add the goods or services being ordered | | |
| `po.new.button.addItem` | Add Item | | |
| `po.new.lineItem.sku` | SKU | | |
| `po.new.lineItem.skuPlaceholder` | SKU / Part # | | |
| `po.new.lineItem.description` | Description | | |
| `po.new.lineItem.descriptionPlaceholder` | Item description | | |
| `po.new.lineItem.qty` | Qty | | |
| `po.new.lineItem.uom` | UOM | | |
| `po.new.lineItem.unitPrice` | Unit Price ({currency}) | ✅ `currency` | |
| `po.new.uom.each` | Each | | ✅ |
| `po.new.uom.kg` | Kg | | ✅ |
| `po.new.uom.litre` | Litre | | ✅ |
| `po.new.uom.metre` | Metre | | ✅ |
| `po.new.uom.box` | Box | | ✅ |
| `po.new.uom.pallet` | Pallet | | ✅ |
| `po.new.uom.hour` | Hour | | ✅ |
| `po.new.uom.day` | Day | | ✅ |
| `po.new.uom.set` | Set | | ✅ |
| `po.new.uom.lot` | Lot | | ✅ |
| `po.new.label.subtotal` | Subtotal: | | |
| `po.new.label.total` | Total | | |
| `po.new.button.submitLoading` | Creating… | | |
| `po.new.button.submit` | Create Purchase Order | | |
| `po.new.button.cancel` | Cancel | | |
| `po.new.toast.noSupplier` | Please select a supplier | | |
| `po.new.toast.noLineItems` | Add at least one line item with a price | | |
| `po.new.toast.minAmount` | Minimum order amount is {amount} | ✅ `amount` | |
| `po.new.toast.maxAmount` | Maximum order amount is {amount} | ✅ `amount` | |
| `po.new.toast.success` | Purchase order created | | |
| `po.new.toast.error` | Failed to create purchase order | | |

---

## 6. `src/app/dashboard/purchase-orders/import/page.tsx`

| Key | English Text | Interpolation | Status/Enum |
|-----|-------------|---------------|-------------|
| `po.import.title` | Import POs from CSV | | |
| `po.import.subtitle` | Bulk-create purchase orders from a spreadsheet | | |
| `po.import.format.title` | CSV Format | | |
| `po.import.format.table.column` | Column | | |
| `po.import.format.table.required` | Required | | |
| `po.import.format.table.description` | Description | | |
| `po.import.format.col.supplierId` | supplier_id | | |
| `po.import.format.col.supplierIdDesc` | Supplier user ID | | |
| `po.import.format.col.description` | description | | |
| `po.import.format.col.descriptionDesc` | Line item description | | |
| `po.import.format.col.quantity` | quantity | | |
| `po.import.format.col.quantityDesc` | Quantity | | |
| `po.import.format.col.pricePennies` | price_pennies | | |
| `po.import.format.col.pricePenniesDesc` | Price in smallest currency unit | | |
| `po.import.format.col.poDescription` | po_description | | |
| `po.import.format.col.poDescriptionDesc` | PO description | | |
| `po.import.format.col.externalRef` | external_ref | | |
| `po.import.format.col.externalRefDesc` | External reference (groups rows) | | |
| `po.import.format.col.paymentTerms` | payment_terms | | |
| `po.import.format.col.paymentTermsDesc` | NET_30, NET_60, etc. | | |
| `po.import.format.col.deliveryTerms` | delivery_terms | | |
| `po.import.format.col.deliveryTermsDesc` | EXW, FOB, CIF, DDP | | |
| `po.import.format.col.deliveryAddress` | delivery_address | | |
| `po.import.format.col.deliveryAddressDesc` | Delivery location | | |
| `po.import.format.col.taxBps` | tax_bps | | |
| `po.import.format.col.taxBpsDesc` | Tax in basis points (1500 = 15%) | | |
| `po.import.format.required.yes` | Yes | | |
| `po.import.format.required.no` | — | | |
| `po.import.upload.title` | Upload CSV | | |
| `po.import.upload.label` | CSV File | | |
| `po.import.button.submitLoading` | Importing… | | |
| `po.import.button.submit` | Import POs | | |
| `po.import.results.title` | Import Results | | |
| `po.import.results.success` | {count} purchase order(s) imported | ✅ `count` | |
| `po.import.results.errors` | {count} error(s) | ✅ `count` | |
| `po.import.results.viewPOs` | View Purchase Orders | | |
| `po.import.toast.allSuccess` | Successfully imported {count} PO(s) | ✅ `count` | |
| `po.import.toast.partial` | Imported {successCount} PO(s), {errorCount} error(s) | ✅ `successCount`, `errorCount` | |
| `po.import.toast.allFailed` | Import failed — check errors below | | |
| `po.import.toast.error` | Import failed | | |
| `po.import.toast.noFile` | Select a CSV file first | | |

---

## 7. `src/app/dashboard/purchase-orders/[id]/page.tsx`

| Key | English Text | Interpolation | Status/Enum |
|-----|-------------|---------------|-------------|
| `po.detail.notFound` | Purchase order not found | | |
| `po.detail.created` | Created {date} | ✅ `date` | |
| `po.detail.policyBanner.awaitingApproval` | Awaiting Approval | | |
| `po.detail.policyBanner.supplierAcceptance` | Supplier Acceptance Policy | | |
| `po.detail.policyBanner.negotiation` | Negotiation Policy | | |
| `po.detail.policyBanner.earlyPayment` | Early Payment Policy | | |
| `po.detail.policyBanner.deliveryVerification` | Delivery Verification Policy | | |
| `po.detail.policyBanner.policyName` | Policy: {name} | ✅ `name` | |
| `po.detail.policyBanner.autoApproval` | auto-approval | | |
| `po.detail.policyBanner.requiresApprovals` | Requires {n} approval(s) | ✅ `n` | |
| `po.detail.policyBanner.progress` | Progress: {current} of {required} received. | ✅ `current`, `required` | |
| `po.detail.disputeBanner.resolved` | Dispute Resolved | | |
| `po.detail.disputeBanner.inProgress` | Dispute in Progress | | |
| `po.detail.disputeBanner.actions` | Dispute Actions | | |
| `po.detail.dispute.outcome.fullRefund` | Full Refund | | ✅ |
| `po.detail.dispute.outcome.partialRefund` | Partial Refund | | ✅ |
| `po.detail.dispute.outcome.releasedToSupplier` | Released to Supplier | | ✅ |
| `po.detail.dispute.outcome.reworkRequired` | Rework Required | | ✅ |
| `po.detail.dispute.reason` | Reason | | |
| `po.detail.dispute.buyerEvidence` | Buyer Evidence: {count} file(s) | ✅ `count` | |
| `po.detail.dispute.supplierEvidence` | Supplier Evidence: {count} file(s) | ✅ `count` | |
| `po.detail.dispute.refundAmount` | Refund Amount: | | |
| `po.detail.dispute.resolutionNotes` | Resolution Notes | | |
| `po.detail.action.sendToSupplier` | Send to Supplier | | |
| `po.detail.action.accept` | Accept | | |
| `po.detail.action.counterPropose` | Counter-Propose | | |
| `po.detail.action.reject` | Reject | | |
| `po.detail.action.fundEscrow` | Fund Escrow | | |
| `po.detail.action.markShipped` | Mark Shipped | | |
| `po.detail.action.requestEarlyPayment` | Request Early Payment | | |
| `po.detail.action.earlyPaymentRequested` | Early Payment Requested | | |
| `po.detail.action.markDelivered` | Mark Delivered | | |
| `po.detail.action.verifyDelivery` | Verify Delivery | | |
| `po.detail.action.dispute` | Dispute | | |
| `po.detail.action.acknowledgeSettle` | Acknowledge & Settle | | |
| `po.detail.action.acceptCounter` | Accept Counter | | |
| `po.detail.action.counterAgain` | Counter Again | | |
| `po.detail.action.rejectCounter` | Reject Counter | | |
| `po.detail.action.submitEvidence` | Submit Evidence | | |
| `po.detail.action.reviewResolve` | Review & Resolve | | |
| `po.detail.action.viewDetails` | View Details | | |
| `po.detail.status.waitingBiometric` | Waiting for biometric… | | |
| `po.detail.status.awaitingBankConfirmation` | Awaiting bank confirmation… | | |
| `po.detail.status.paymentSecured` | Payment Secured — Buyer has funded escrow | | |
| `po.detail.status.paymentNotLocked` | Payment Not Locked — Waiting for buyer to fund escrow | | |
| `po.detail.escrow.title` | Escrow Payment Details | | |
| `po.detail.escrow.amount` | Amount | | |
| `po.detail.escrow.bank` | Bank | | |
| `po.detail.escrow.iban` | IBAN | | |
| `po.detail.escrow.accountLabel` | Account Label | | |
| `po.detail.escrow.currency` | Currency | | |
| `po.detail.escrow.reference` | Reference | | |
| `po.detail.escrow.paymentLock` | Payment Lock | | |
| `po.detail.counter.title` | Counter-Proposal | | |
| `po.detail.counter.description` | Edit line items and submit your counter-proposal | | |
| `po.detail.counter.total` | Counter Total | | |
| `po.detail.counter.notes` | Notes (optional) | | |
| `po.detail.counter.submit` | Submit Counter-Proposal | | |
| `po.detail.counter.addItem` | + Add Line Item | | |
| `po.detail.card.buyer` | Buyer | | |
| `po.detail.card.supplier` | Supplier | | |
| `po.detail.card.description` | Description | | |
| `po.detail.card.specialInstructions` | Special Instructions | | |
| `po.detail.card.lineItems` | Line Items | | |
| `po.detail.card.paymentLock` | Payment Lock | | |
| `po.detail.card.orderTerms` | Order Terms | | |
| `po.detail.card.negotiationHistory` | Negotiation History | | |
| `po.detail.card.eventTimeline` | Event Timeline | | |
| `po.detail.terms.externalPoNum` | External PO # | | |
| `po.detail.terms.expectedDelivery` | Expected Delivery | | |
| `po.detail.terms.shippedAt` | Shipped At | | |
| `po.detail.terms.buyerContact` | Buyer Contact | | |
| `po.detail.terms.paymentTerms` | Payment Terms | | |
| `po.detail.terms.deliveryTerms` | Delivery Terms | | |
| `po.detail.terms.deliveryAddress` | Delivery Address | | |
| `po.detail.terms.taxRate` | Tax Rate | | |
| `po.detail.terms.taxAmount` | Tax Amount | | |
| `po.detail.terms.grossAmount` | Gross Amount | | |
| `po.detail.terms.disputeWindow` | Dispute Window | | |
| `po.detail.terms.partialAcceptance` | Partial Acceptance: Allowed | | |
| `po.detail.timeline.description` | Cryptographically linked audit trail | | |
| `po.detail.timeline.signed` | Signed | | |
| `po.detail.toast.sentToSupplier` | PO sent to supplier | | |
| `po.detail.toast.accepted` | PO accepted | | |
| `po.detail.toast.rejected` | PO rejected | | |
| `po.detail.toast.deliveryMarked` | Delivery marked | | |
| `po.detail.toast.goodsShipped` | Goods shipped | | |
| `po.detail.toast.deliveryVerified` | Delivery verified | | |
| `po.detail.toast.acknowledged` | Obligation acknowledged — settlement triggered | | |
| `po.detail.toast.deliveryDisputed` | Delivery disputed | | |
| `po.detail.toast.escrowInitiated` | Escrow funding initiated — awaiting bank confirmation | | |
| `po.detail.toast.counterAccepted` | Counter-proposal accepted — PO updated | | |
| `po.detail.toast.counterRejected` | Counter-proposal rejected — PO cancelled | | |
| `po.detail.toast.counterSent` | Counter-proposal sent | | |
| `po.detail.toast.bankConfirmed` | Bank confirmed — escrow funded, supplier can begin work | | |
| `po.detail.lineItems.table.sku` | SKU | | |
| `po.detail.lineItems.table.description` | Description | | |
| `po.detail.lineItems.table.qty` | Qty | | |
| `po.detail.lineItems.table.uom` | UOM | | |
| `po.detail.lineItems.table.unitPrice` | Unit Price | | |
| `po.detail.lineItems.table.total` | Total | | |

---

## 8. `src/app/dashboard/approvals/page.tsx`

| Key | English Text | Interpolation | Status/Enum |
|-----|-------------|---------------|-------------|
| `approvals.title` | Approvals | | |
| `approvals.description` | Review and approve pending purchase orders for your organisation. | | |
| `approvals.status.pending` | Pending | | ✅ |
| `approvals.status.approved` | Approved | | ✅ |
| `approvals.status.rejected` | Rejected | | ✅ |
| `approvals.status.expired` | Expired | | ✅ |
| `approvals.status.escalated` | Escalated | | ✅ |
| `approvals.loading` | Loading approvals… | | |
| `approvals.empty.title` | No pending approvals | | |
| `approvals.empty.description` | All caught up! Approval requests will appear here when POs exceed your organisation's auto-approve threshold. | | |
| `approvals.card.description` | Purchase Order Approval | | |
| `approvals.card.amount` | Amount | | |
| `approvals.card.supplier` | Supplier | | |
| `approvals.card.progress` | Progress | | |
| `approvals.card.requiredRoles` | Required Roles | | |
| `approvals.card.progressFormat` | {current} / {required} approvals | ✅ `current`, `required` | |
| `approvals.card.decisions` | Decisions | | |
| `approvals.card.alreadyDecided` | You have already submitted your decision. | | |
| `approvals.card.noPermission` | Your role ({role}) cannot approve this request. Requires: {roles}. | ✅ `role`, `roles` | |
| `approvals.card.escalated` | Escalated | | |
| `approvals.card.expires` | Expires {date} | ✅ `date` | |
| `approvals.button.approve` | Approve | | |
| `approvals.button.reject` | Reject | | |
| `approvals.dialog.approveTitle` | Approve Purchase Order | | |
| `approvals.dialog.rejectTitle` | Reject Purchase Order | | |
| `approvals.dialog.approveDescription` | (approval confirmation description) | | |
| `approvals.dialog.rejectDescription` | (rejection confirmation description) | | |
| `approvals.dialog.commentLabel` | Comment (optional) | | |
| `approvals.dialog.approvePlaceholder` | Approved — looks good. | | |
| `approvals.dialog.rejectPlaceholder` | Reason for rejection… | | |
| `approvals.dialog.cancel` | Cancel | | |
| `approvals.dialog.submitLoading` | Submitting… | | |
| `approvals.dialog.confirmApprove` | Confirm Approval | | |
| `approvals.dialog.confirmReject` | Confirm Rejection | | |

---

## 9. `src/app/dashboard/early-payments/page.tsx`

### Supplier View

| Key | English Text | Interpolation | Status/Enum |
|-----|-------------|---------------|-------------|
| `earlyPayments.supplier.title` | Early Payments | | |
| `earlyPayments.supplier.subtitle` | Get paid early on purchase orders with locked payment | | |
| `earlyPayments.supplier.howItWorks.title` | How it works | | |
| `earlyPayments.supplier.howItWorks.step1` | 1. Your buyer creates a PO and funds escrow | | |
| `earlyPayments.supplier.howItWorks.step2` | 2. You accept the PO — payment is locked | | |
| `earlyPayments.supplier.howItWorks.step3` | 3. You request early payment — a liquidity partner pays you upfront less a 2.5% fee | | |
| `earlyPayments.supplier.howItWorks.step4` | 4. When the buyer settles, the LP is repaid from escrow | | |
| `earlyPayments.supplier.eligible.title` | Eligible Purchase Orders | | |
| `earlyPayments.supplier.eligible.description` | POs with locked payment that you can request early payment on | | |
| `earlyPayments.supplier.eligible.noPermission` | Your role ({role}) cannot request early payments. Required: {roles}. | ✅ `role`, `roles` | |
| `earlyPayments.supplier.eligible.empty` | No eligible purchase orders for early payment. | | |
| `earlyPayments.supplier.eligible.emptyDetail` | POs must be accepted with locked payment and not yet requested for early payment. | | |
| `earlyPayments.supplier.eligible.table.reference` | Reference | | |
| `earlyPayments.supplier.eligible.table.buyer` | Buyer | | |
| `earlyPayments.supplier.eligible.table.status` | Status | | |
| `earlyPayments.supplier.eligible.table.amount` | Amount | | |
| `earlyPayments.supplier.eligible.table.fee` | Fee (2.5%) | | |
| `earlyPayments.supplier.eligible.table.youReceive` | You Receive | | |
| `earlyPayments.supplier.eligible.button.signing` | Signing… | | |
| `earlyPayments.supplier.eligible.button.request` | Request | | |
| `earlyPayments.supplier.eligible.button.noPermission` | No permission | | |
| `earlyPayments.supplier.requests.title` | Your Early Payment Requests | | |
| `earlyPayments.supplier.requests.table.poRef` | PO Reference | | |
| `earlyPayments.supplier.requests.table.faceValue` | Face Value | | |
| `earlyPayments.supplier.requests.table.fee` | Fee | | |
| `earlyPayments.supplier.requests.table.youReceived` | You Received | | |
| `earlyPayments.supplier.requests.table.status` | Status | | |
| `earlyPayments.supplier.requests.table.date` | Date | | |

### LP View

| Key | English Text | Interpolation | Status/Enum |
|-----|-------------|---------------|-------------|
| `earlyPayments.lp.title` | Early Payment Marketplace | | |
| `earlyPayments.lp.subtitle` | Fund verified purchase orders for a service fee return | | |
| `earlyPayments.lp.howItWorks.step1` | 1. A supplier requests early payment on a verified PO | | |
| `earlyPayments.lp.howItWorks.step2` | 2. You advance the funds (less a 2.5% service fee) | | |
| `earlyPayments.lp.howItWorks.step3` | 3. When the buyer settles, you are repaid the full face value from escrow | | |
| `earlyPayments.lp.howItWorks.step4` | 4. Your return is the 2.5% service fee | | |
| `earlyPayments.lp.available.title` | Available Requests | | |
| `earlyPayments.lp.sort.newest` | Newest First | | |
| `earlyPayments.lp.sort.safest` | Safest First (Risk ↓) | | |
| `earlyPayments.lp.sort.riskiest` | Riskiest First (Risk ↑) | | |
| `earlyPayments.lp.sort.highestValue` | Highest Value | | |
| `earlyPayments.lp.available.empty` | No early payment requests available right now. | | |
| `earlyPayments.lp.available.emptyDetail` | Requests appear when suppliers request early payment on verified POs with locked escrow. | | |
| `earlyPayments.lp.available.faceValue` | Face Value | | |
| `earlyPayments.lp.available.serviceFee` | Service Fee (2.5%) | | |
| `earlyPayments.lp.available.youAdvance` | You Advance | | |
| `earlyPayments.lp.available.paymentLocked` | Payment Locked | | |
| `earlyPayments.lp.risk.low` | Low Risk | | ✅ |
| `earlyPayments.lp.risk.medium` | Medium Risk | | ✅ |
| `earlyPayments.lp.risk.high` | High Risk | | ✅ |
| `earlyPayments.lp.risk.modal.title` | Risk Score Breakdown | | |
| `earlyPayments.lp.risk.modal.howCalculated` | How is this calculated? | | |
| `earlyPayments.lp.risk.factor.paymentLocked` | Payment Locked: {value} | ✅ `value` (Yes/No) | |
| `earlyPayments.lp.risk.factor.delivery` | Delivery: {value} | ✅ `value` | |
| `earlyPayments.lp.risk.factor.buyerDisputes` | Buyer Disputes: {value} | ✅ `value` | |
| `earlyPayments.lp.risk.factor.bankConfirmed` | Bank Confirmed: {value} | ✅ `value` | |
| `earlyPayments.lp.risk.factor.evidencePack` | Evidence Pack: {value} | ✅ `value` (Available/None) | |
| `earlyPayments.lp.risk.factor.expSettlement` | Exp. Settlement: {value} | ✅ `value` | |
| `earlyPayments.lp.risk.noBreakdown` | Detailed factor breakdown is not available for this assessment. | | |
| `earlyPayments.lp.fund.confirm` | Confirm funding? | | |
| `earlyPayments.lp.fund.confirmButton` | Confirm | | |
| `earlyPayments.lp.fund.signing` | Signing… | | |
| `earlyPayments.lp.fund.funding` | Funding… | | |
| `earlyPayments.lp.fund.cancel` | Cancel | | |
| `earlyPayments.lp.fund.button` | Fund This Request | | |
| `earlyPayments.lp.funded.title` | Your Funded Payments | | |
| `earlyPayments.lp.funded.table.poRef` | PO Reference | | |
| `earlyPayments.lp.funded.table.supplier` | Supplier | | |
| `earlyPayments.lp.funded.table.advanced` | Advanced | | |
| `earlyPayments.lp.funded.table.feeEarned` | Fee Earned | | |
| `earlyPayments.lp.funded.table.status` | Status | | |
| `earlyPayments.lp.funded.table.funded` | Funded | | |

### Admin View

| Key | English Text | Interpolation | Status/Enum |
|-----|-------------|---------------|-------------|
| `earlyPayments.admin.title` | Early Payments | | |
| `earlyPayments.admin.subtitle` | Admin view of all early payment requests | | |
| `earlyPayments.admin.table.title` | All Early Payment Requests | | |
| `earlyPayments.admin.table.poRef` | PO Reference | | |
| `earlyPayments.admin.table.supplier` | Supplier | | |
| `earlyPayments.admin.table.lp` | LP | | |
| `earlyPayments.admin.table.faceValue` | Face Value | | |
| `earlyPayments.admin.table.fee` | Fee | | |
| `earlyPayments.admin.table.status` | Status | | |
| `earlyPayments.admin.empty` | No early payment requests yet. | | |
| `earlyPayments.roleUnavailable` | Early payments is not available for your role. | | |

---

## 10. `src/app/dashboard/settlements/page.tsx`

### User View

| Key | English Text | Interpolation | Status/Enum |
|-----|-------------|---------------|-------------|
| `settlements.user.title` | Settlements | | |
| `settlements.user.subtitle` | Track all fund transfers for your purchase orders. | | |
| `settlements.user.card.totalSettlements` | Total Settlements | | |
| `settlements.user.card.completedVolume` | Completed Volume | | |
| `settlements.user.card.successRate` | Success Rate | | |
| `settlements.user.empty` | No settlements yet. Settlements are created when purchase orders are verified or early payments are funded. | | |
| `settlements.type.standard` | Standard | | ✅ |
| `settlements.type.earlyPayAdvance` | Early Pay Advance | | ✅ |
| `settlements.type.earlyPaySettlement` | Early Pay Settlement | | ✅ |

### Admin View

| Key | English Text | Interpolation | Status/Enum |
|-----|-------------|---------------|-------------|
| `settlements.admin.title` | Settlement Management | | |
| `settlements.admin.subtitle` | Monitor all platform settlements and trigger reconciliation. | | |
| `settlements.admin.card.total` | Total | | |
| `settlements.admin.card.completed` | Completed | | |
| `settlements.admin.card.pending` | Pending | | |
| `settlements.admin.card.failed` | Failed | | |
| `settlements.admin.card.platformVolume` | Platform Volume | | |
| `settlements.admin.card.platformVolumeDesc` | Total completed settlement volume | | |
| `settlements.admin.pending.title` | Pending Reconciliation | | |
| `settlements.admin.pending.table.poRef` | PO Ref | | |
| `settlements.admin.pending.table.amount` | Amount | | |
| `settlements.admin.pending.table.rail` | Rail | | |
| `settlements.admin.pending.table.externalRef` | External Ref | | |
| `settlements.admin.pending.table.created` | Created | | |
| `settlements.admin.pending.table.action` | Action | | |
| `settlements.admin.pending.reconcileButton` | Reconcile | | |
| `settlements.admin.all.title` | All Settlements | | |
| `settlements.admin.all.empty` | No settlements recorded yet. | | |
| `settlements.admin.all.table.po` | PO | | |
| `settlements.admin.all.table.type` | Type | | |
| `settlements.admin.all.table.amount` | Amount | | |
| `settlements.admin.all.table.status` | Status | | |
| `settlements.admin.all.table.rail` | Rail | | |
| `settlements.admin.all.table.externalRef` | External Ref | | |
| `settlements.admin.all.table.fromTo` | From → To | | |
| `settlements.admin.all.table.date` | Date | | |
| `settlements.admin.all.table.action` | Action | | |
| `settlements.toast.reconciled` | Settlement reconciled: {prev} → {current} | ✅ `prev`, `current` | |
| `settlements.toast.unchanged` | Settlement status unchanged — already up to date. | | |
| `settlements.toast.failed` | Reconciliation failed. | | |
| `settlements.railLabel` | {adapter} Rail | ✅ `adapter` | |

---

## 11. `src/app/dashboard/disputes/page.tsx`

| Key | English Text | Interpolation | Status/Enum |
|-----|-------------|---------------|-------------|
| `disputes.list.title` | Disputes | | |
| `disputes.list.subtitle` | Manage purchase order disputes and resolutions | | |
| `disputes.list.filter.all` | All | | |
| `disputes.status.open` | OPEN | | ✅ |
| `disputes.status.evidenceSubmitted` | EVIDENCE_SUBMITTED | | ✅ |
| `disputes.status.underReview` | UNDER_REVIEW | | ✅ |
| `disputes.status.resolved` | RESOLVED | | ✅ |
| `disputes.outcome.fullRefund` | Full Refund | | ✅ |
| `disputes.outcome.partialRefund` | Partial Refund | | ✅ |
| `disputes.outcome.releasedToSupplier` | Released to Supplier | | ✅ |
| `disputes.outcome.reworkRequired` | Rework Required | | ✅ |
| `disputes.list.empty` | No disputes found. | | |
| `disputes.list.raisedBy` | Raised by {name} on {date} | ✅ `name`, `date` | |
| `disputes.list.reason` | Reason: | | |
| `disputes.list.poAmount` | PO Amount: | | |
| `disputes.list.refundAmount` | Refund Amount: | | |
| `disputes.list.buyerEvidence` | Buyer Evidence: {n} items | ✅ `n` | |
| `disputes.list.supplierEvidence` | Supplier Evidence: {n} items | ✅ `n` | |
| `disputes.list.resolutionNotes` | Resolution Notes: | | |
| `disputes.list.admin.markUnderReview` | Mark Under Review | | |
| `disputes.list.admin.resolveDispute` | Resolve Dispute | | |
| `disputes.resolve.title` | Resolve Dispute | | |
| `disputes.resolve.description` | Choose an outcome for this dispute. PO: {ref} | ✅ `ref` | |
| `disputes.resolve.outcome.fullRefund` | Full Refund to Buyer | | ✅ |
| `disputes.resolve.outcome.partialRefund` | Partial Refund | | ✅ |
| `disputes.resolve.outcome.releaseToSupplier` | Release to Supplier | | ✅ |
| `disputes.resolve.outcome.rework` | Rework Required | | ✅ |
| `disputes.resolve.refundAmountLabel` | Refund Amount (smallest unit) | | |
| `disputes.resolve.resolutionNotesLabel` | Resolution Notes | | |
| `disputes.resolve.resolutionNotesPlaceholder` | Explain the resolution decision… | | |
| `disputes.resolve.submitLoading` | Resolving… | | |
| `disputes.resolve.submit` | Confirm Resolution | | |
| `disputes.list.loading` | Loading disputes… | | |

---

## 12. `src/app/dashboard/disputes/[id]/page.tsx`

| Key | English Text | Interpolation | Status/Enum |
|-----|-------------|---------------|-------------|
| `disputes.detail.notFound` | Dispute not found. | | |
| `disputes.detail.loading` | Loading dispute… | | |
| `disputes.detail.title` | Dispute Details | | |
| `disputes.detail.reason` | Reason | | |
| `disputes.detail.poAmount` | PO Amount | | |
| `disputes.detail.status` | Status | | |
| `disputes.detail.buyerEvidence` | Buyer Evidence: {n} file(s) | ✅ `n` | |
| `disputes.detail.supplierEvidence` | Supplier Evidence: {n} file(s) | ✅ `n` | |
| `disputes.detail.refundAmount` | Refund Amount: | | |
| `disputes.detail.resolutionNotes` | Resolution Notes: | | |
| `disputes.detail.submitEvidence.title` | Submit Evidence | | |
| `disputes.detail.submitEvidence.description` | Upload a file to support your side of the dispute. Files are SHA-256 hashed and recorded on the immutable ledger. | | |
| `disputes.detail.submitEvidence.typeLabel` | Evidence Type | | |
| `disputes.detail.submitEvidence.descLabel` | Description (optional) | | |
| `disputes.detail.submitEvidence.descPlaceholder` | Brief note about this file | | |
| `disputes.detail.submitEvidence.fileLabel` | File | | |
| `disputes.detail.submitEvidence.submit` | Upload & Submit | | |
| `disputes.detail.submitEvidence.submitting` | Uploading… | | |
| `disputes.detail.evidenceType.deliveryNote` | Delivery Note | | ✅ |
| `disputes.detail.evidenceType.signedReceipt` | Signed Receipt | | ✅ |
| `disputes.detail.evidenceType.photoProof` | Photo Proof | | ✅ |
| `disputes.detail.evidenceType.invoice` | Invoice | | ✅ |
| `disputes.detail.evidenceType.inspectionReport` | Inspection Report | | ✅ |
| `disputes.detail.evidenceType.shippingDocument` | Shipping Document | | ✅ |
| `disputes.detail.evidenceType.poDocument` | PO Document | | ✅ |
| `disputes.detail.evidenceType.other` | Other | | ✅ |
| `disputes.detail.buyerEvidenceTitle` | Buyer Evidence | | |
| `disputes.detail.supplierEvidenceTitle` | Supplier Evidence | | |
| `disputes.detail.noBuyerEvidence` | No buyer evidence submitted yet | | |
| `disputes.detail.noSupplierEvidence` | No supplier evidence submitted yet | | |
| `disputes.detail.admin.title` | Admin Actions | | |
| `disputes.detail.admin.markUnderReview` | Mark Under Review | | |
| `disputes.detail.admin.updating` | Updating… | | |
| `disputes.detail.viewPO` | View PO | | |
| `disputes.detail.back` | Back | | |
| `disputes.detail.filesSubmitted` | {n} file(s) submitted | ✅ `n` | |
| `disputes.detail.toast.evidenceSubmitted` | Evidence submitted to the dispute | | |
| `disputes.detail.toast.markedUnderReview` | Dispute marked as Under Review | | |
| `disputes.detail.toast.resolved` | Dispute resolved | | |
| `disputes.detail.toast.uploadFailed` | Upload failed | | |
| `disputes.detail.toast.downloadFailed` | Download failed | | |
| `disputes.detail.toast.selectFile` | Select a file first | | |
| `disputes.detail.howItWorks.title` | How dispute resolution works | | |
| `disputes.detail.howItWorks.step1` | 1. Both the buyer and supplier can upload evidence to support their case. | | |
| `disputes.detail.howItWorks.step2` | 2. Once both sides have submitted evidence, the status changes to Evidence Submitted. | | |
| `disputes.detail.howItWorks.step3` | 3. A platform admin reviews the evidence and resolves the dispute with one of four outcomes: Full Refund, Partial Refund, Release to Supplier, or Rework. | | |
| `disputes.detail.resolve.refundPlaceholder` | e.g. 50000 for {example} | ✅ `example` (SAR 500.00 / £500.00) | |

---

## 13. `src/app/dashboard/ledger/page.tsx`

| Key | English Text | Interpolation | Status/Enum |
|-----|-------------|---------------|-------------|
| `ledger.title` | Event Ledger | | |
| `ledger.subtitle` | Immutable, cryptographically linked audit trail of all platform events | | |
| `ledger.description.title` | Hash-Chained Events | | |
| `ledger.description.body` | Every event is hashed with SHA-256 and linked to the previous event hash, forming a tamper-evident chain. Click any event to inspect its full payload, hash chain, and passkey signature. | | |
| `ledger.empty.title` | No events recorded yet | | |
| `ledger.empty.description` | Events will appear as purchase orders are created and processed | | |
| `ledger.badge.passkeySigned` | Passkey Signed | | |
| `ledger.badge.system` | System | | |
| `ledger.badge.financial` | Financial | | |
| `ledger.badge.genesis` | Genesis | | |
| `ledger.dialog.entityType` | Entity Type | | |
| `ledger.dialog.timestamp` | Timestamp | | |
| `ledger.dialog.actorRole` | Actor Role | | |
| `ledger.dialog.sequence` | Sequence | | |
| `ledger.dialog.financialDetails` | Financial Details | | |
| `ledger.dialog.eventData` | Event Data | | |
| `ledger.dialog.hashChain` | Hash Chain | | |
| `ledger.dialog.eventHash` | Event Hash | | |
| `ledger.dialog.previousHash` | Previous Hash | | |
| `ledger.dialog.genesis` | GENESIS | | |
| `ledger.dialog.passkeySignature` | Passkey Signature | | |
| `ledger.dialog.signature` | Signature | | |
| `ledger.dialog.publicKey` | Public Key | | |
| `ledger.dialog.credentialId` | Credential ID | | |
| `ledger.payload.amount` | Amount | | |
| `ledger.payload.faceValue` | Face Value | | |
| `ledger.payload.platformFee` | Platform Fee | | |
| `ledger.payload.netAdvance` | Net Advance | | |
| `ledger.payload.totalAmount` | Total Amount | | |
| `ledger.payload.recipientReceives` | Recipient Receives | | |
| `ledger.payload.earlyPaySettlement` | Early Pay Settlement | | |
| `ledger.payload.recipientId` | Recipient ID | | |
| `ledger.payload.purchaseOrderId` | Purchase Order ID | | |
| `ledger.payload.reference` | Reference | | |
| `ledger.payload.supplierId` | Supplier ID | | |
| `ledger.payload.buyerId` | Buyer ID | | |
| `ledger.payload.lineItems` | Line Items | | |
| `ledger.payload.openBankingRef` | Open Banking Ref | | |
| `ledger.payload.verifiedAt` | Verified At | | |

---

## 14. `src/app/dashboard/receipts/page.tsx`

| Key | English Text | Interpolation | Status/Enum |
|-----|-------------|---------------|-------------|
| `receipts.title` | My Receipts | | |
| `receipts.subtitle` | Locally stored, platform-signed event receipts — Layer 4 non-repudiation proof | | |
| `receipts.button.refresh` | Refresh | | |
| `receipts.button.exportJSON` | Export JSON | | |
| `receipts.button.verifyingAll` | Verifying… | | |
| `receipts.button.verifyAll` | Verify All | | |
| `receipts.card.totalReceipts` | Total Receipts | | |
| `receipts.card.totalReceiptsDesc` | Stored in browser IndexedDB | | |
| `receipts.card.verified` | Verified | | |
| `receipts.card.verifiedDesc` | Match platform ledger | | |
| `receipts.card.missing` | Missing | | |
| `receipts.card.missingDesc` | Not found in ledger | | |
| `receipts.card.mismatched` | Mismatched | | |
| `receipts.card.mismatchedDesc` | Hash or sequence differs | | |
| `receipts.verification.allMatch` | All {n} local receipts match the platform ledger. No events have been omitted or altered. | ✅ `n` | |
| `receipts.verification.mismatch` | {n} receipt(s) do not match the platform ledger. This may indicate tampering or data loss. | ✅ `n` | |
| `receipts.empty.title` | No receipts stored yet | | |
| `receipts.empty.description` | Receipts are automatically captured when you perform signed actions (creating POs, approving, funding, etc.). | | |
| `receipts.table.title` | Receipt Log | | |
| `receipts.table.description` | Each row is a platform-signed receipt stored in your browser at the moment you performed the action. | | |
| `receipts.table.hash` | # | | |
| `receipts.table.event` | Event | | |
| `receipts.table.entity` | Entity | | |
| `receipts.table.seq` | Seq | | |
| `receipts.table.signed` | Signed | | |
| `receipts.table.timestamp` | Timestamp | | |
| `receipts.table.eventHash` | Event Hash | | |
| `receipts.table.status` | Status | | |
| `receipts.status.verified` | Verified | | ✅ |
| `receipts.status.missing` | Missing | | ✅ |
| `receipts.status.hashMismatch` | Hash Mismatch | | ✅ |
| `receipts.status.seqMismatch` | Seq Mismatch | | ✅ |
| `receipts.status.notChecked` | Not Checked | | ✅ |
| `receipts.about.title` | About Local Receipts | | |
| `receipts.about.p1` | Every time you perform a signed action, the platform returns a digitally signed receipt that is stored in your browser's IndexedDB. | | |
| `receipts.about.p2` | These receipts act as Layer 4 (non-repudiation) proof, independent of the server. | | |
| `receipts.about.p3` | Verify All compares each local receipt against the platform event ledger. | | |
| `receipts.about.p4` | Export JSON downloads all receipts for offline archival. | | |
| `receipts.toast.allVerified` | All {n} receipts verified ✓ | ✅ `n` | |
| `receipts.toast.exported` | Receipts exported | | |

---

## 15. `src/app/dashboard/risk/page.tsx`

| Key | English Text | Interpolation | Status/Enum |
|-----|-------------|---------------|-------------|
| `risk.title` | Risk Controls | | |
| `risk.subtitle` | Fraud detection, velocity controls, and LP exposure monitoring | | |
| `risk.fraud.title` | Fraud Control Configuration | | |
| `risk.fraud.subtitle` | Per-currency velocity limits and thresholds | | |
| `risk.fraud.maxPOsBuyerDay` | Max POs / Buyer / Day | | |
| `risk.fraud.maxDailyValueBuyer` | Max Daily Value / Buyer | | |
| `risk.fraud.mandatoryEvidenceThreshold` | Mandatory Evidence Threshold | | |
| `risk.fraud.maxPOsSupplierDay` | Max POs / Supplier / Day | | |
| `risk.fraud.supplierWhitelist` | Supplier Whitelist | | |
| `risk.fraud.supplierWhitelistEntries` | {n} entries | ✅ `n` | |
| `risk.fraud.supplierWhitelistNone` | Not enforced | | |
| `risk.flags.title` | Unacknowledged Fraud Flags | | |
| `risk.flags.count` | {n} active flag(s) | ✅ `n` | |
| `risk.flags.empty` | No unacknowledged fraud flags. | | |
| `risk.flags.acknowledge` | Acknowledge | | |
| `risk.exposure.title` | LP Exposure Monitor | | |
| `risk.exposure.subtitle` | Real-time liquidity partner exposure and concentration tracking | | |
| `risk.exposure.inputPlaceholder` | Enter LP User ID | | |
| `risk.exposure.buttonLoading` | Loading… | | |
| `risk.exposure.button` | Check Exposure | | |
| `risk.exposure.byCurrency` | Exposure by Currency | | |
| `risk.exposure.totalExposure` | Total Exposure | | |
| `risk.exposure.fundingLimit` | Funding Limit | | |
| `risk.exposure.noLimit` | No limit set | | |
| `risk.exposure.utilisation` | Utilisation | | |
| `risk.exposure.utilisationNA` | N/A | | |
| `risk.exposure.fundingStatus` | Funding Status | | |
| `risk.exposure.suspended` | SUSPENDED | | ✅ |
| `risk.exposure.active` | ACTIVE | | ✅ |
| `risk.exposure.alerts` | Alerts | | |
| `risk.exposure.buyerConcentration` | Buyer Concentration | | |
| `risk.exposure.supplierConcentration` | Supplier Concentration | | |
| `risk.exposure.noBuyerExposure` | No buyer exposure | | |
| `risk.exposure.noSupplierExposure` | No supplier exposure | | |
| `risk.exposure.takeSnapshot` | Take Exposure Snapshot | | |

---

## 16. `src/app/dashboard/policies/page.tsx`

| Key | English Text | Interpolation | Status/Enum |
|-----|-------------|---------------|-------------|
| `policies.title` | Policy Rules | | |
| `policies.subtitle` | Manage approval tiers, limits and compliance rules for your organisation | | |
| `policies.ruleType.poApproval` | PO Approval | | ✅ |
| `policies.ruleType.poOrderLimits` | PO Order Limits | | ✅ |
| `policies.ruleType.fundingLimit` | Funding Limit | | ✅ |
| `policies.ruleType.escrowFunding` | Escrow Funding | | ✅ |
| `policies.ruleType.supplierAcceptance` | Supplier Acceptance | | ✅ |
| `policies.ruleType.settlement` | Settlement | | ✅ |
| `policies.ruleType.earlyPayment` | Early Payment | | ✅ |
| `policies.ruleType.lpFunding` | LP Funding | | ✅ |
| `policies.ruleType.disputeResolution` | Dispute Resolution | | ✅ |
| `policies.ruleType.deliveryVerification` | Delivery Verification | | ✅ |
| `policies.role.owner` | Owner | | ✅ |
| `policies.role.approver` | Approver | | ✅ |
| `policies.role.finance` | Finance | | ✅ |
| `policies.role.member` | Member | | ✅ |
| `policies.role.viewer` | Viewer | | ✅ |
| `policies.noOrg` | No organisation linked. Please complete registration. | | |
| `policies.button.addRule` | Add Rule | | |
| `policies.create.title` | Create Policy Rule | | |
| `policies.create.description` | Amounts are in minor units (pennies / halalas). | | |
| `policies.create.label.name` | Rule Name | | |
| `policies.create.placeholder.name` | e.g. Auto-approve POs ≤ £10,000 | | |
| `policies.create.label.ruleType` | Rule Type | | |
| `policies.create.label.maxExposure` | Max Exposure Total (minor units) | | |
| `policies.create.placeholder.maxExposure` | e.g. 200000000 for £2M | | |
| `policies.create.label.maxPerBuyer` | Max % per Buyer (0–1) | | |
| `policies.create.placeholder.maxPerBuyer` | 0.4 | | |
| `policies.create.label.maxPerSupplier` | Max % per Supplier (0–1) | | |
| `policies.create.placeholder.maxPerSupplier` | 0.3 | | |
| `policies.create.label.maxTenor` | Max Tenor (days) | | |
| `policies.create.placeholder.maxTenor` | 90 | | |
| `policies.create.label.fee` | Fee (basis points) | | |
| `policies.create.placeholder.fee` | 200 | | |
| `policies.create.label.minAmount` | Min Amount (minor units) | | |
| `policies.create.label.maxAmount` | Max Amount (minor units) | | |
| `policies.create.label.priority` | Priority (higher = matched first) | | |
| `policies.create.label.autoApprove` | Auto-approve | | |
| `policies.create.autoApprove.fundingLimitNote` | (always on for Funding Limit) | | |
| `policies.create.autoApprove.note` | (no manual approval needed) | | |
| `policies.create.label.requiredApprovals` | Required Approvals | | |
| `policies.create.label.requiredRoles` | Required Roles | | |
| `policies.create.error` | Error: {message} | ✅ `message` | |
| `policies.create.cancel` | Cancel | | |
| `policies.create.submit` | Create Rule | | |
| `policies.button.seedDefaults` | Seed Defaults | | |
| `policies.button.resetToDefaults` | Reset to Defaults | | |
| `policies.seed.result` | Seeded {created} rules, skipped {skipped} | ✅ `created`, `skipped` | |
| `policies.reset.result` | Reset complete — {created} rules re-seeded | ✅ `created` | |
| `policies.card.totalRules` | Total Rules | | |
| `policies.card.activeRules` | Active Rules | | |
| `policies.card.ruleTypes` | Rule Types | | |
| `policies.card.pilotReadiness` | Pilot Readiness | | |
| `policies.readiness.title` | Pilot Readiness Checklist | | |
| `policies.readiness.description` | {percent}% complete — {passed}/{total} checks passed | ✅ `percent`, `passed`, `total` | |
| `policies.simulator.title` | Policy Simulator | | |
| `policies.simulator.description` | Test which policy rule matches for a given amount and rule type | | |
| `policies.simulator.amountLabel` | Amount (minor units) | | |
| `policies.simulator.amountPlaceholder` | e.g. 5000000 for £50,000 | | |
| `policies.simulator.ruleTypeLabel` | Rule Type | | |
| `policies.simulator.button` | Simulate | | |
| `policies.simulator.matched` | ✓ Matched: {name} | ✅ `name` | |
| `policies.simulator.matchDetails` | Required approvals: {approvals} \| Roles: {roles} \| Auto-approve: {auto} | ✅ `approvals`, `roles`, `auto` | |
| `policies.simulator.noMatch` | No matching rule — {message} | ✅ `message` | |
| `policies.table.title` | Active Policy Rules | | |
| `policies.table.count` | {count} rule(s) shown | ✅ `count` | |
| `policies.table.filter.allTypes` | All Types | | |
| `policies.table.filter.placeholder` | Filter by type | | |
| `policies.table.empty` | No policy rules configured. | | |
| `policies.table.emptyAdmin` | Use 'Seed Defaults' to create standard templates. | | |
| `policies.table.header.name` | Name | | |
| `policies.table.header.type` | Type | | |
| `policies.table.header.range` | Range | | |
| `policies.table.header.approvals` | Approvals | | |
| `policies.table.header.roles` | Roles | | |
| `policies.table.header.auto` | Auto | | |
| `policies.table.header.priority` | Priority | | |
| `policies.table.header.status` | Status | | |
| `policies.table.status.active` | Active | | ✅ |
| `policies.table.status.inactive` | Inactive | | ✅ |

---

## 17. `src/app/dashboard/team/page.tsx`

| Key | English Text | Interpolation | Status/Enum |
|-----|-------------|---------------|-------------|
| `team.title` | Team & Permissions | | |
| `team.subtitle` | Manage members, permission overrides, and authority delegations. | | |
| `team.tab.members` | Members | | |
| `team.tab.permissions` | Permission Matrix | | |
| `team.tab.delegations` | Delegations | | |
| `team.noOrg` | You are not part of an organisation. | | |
| `team.members.title` | Members ({count}) | ✅ `count` | |
| `team.members.description` | Organisation members and their roles. | | |
| `team.members.inviteButton` | Invite Member | | |
| `team.members.loading` | Loading members… | | |
| `team.members.changeRole` | Change Role | | |
| `team.members.changeRoleDialog.title` | Change Role for {name} | ✅ `name` | |
| `team.members.changeRoleDialog.description` | Select a new role for this member. | | |
| `team.members.changeRoleDialog.placeholder` | Select role | | |
| `team.members.changeRoleDialog.cancel` | Cancel | | |
| `team.members.changeRoleDialog.save` | Save | | |
| `team.members.inviteDialog.title` | Invite Team Member | | |
| `team.members.inviteDialog.description` | Create an account and add them to your organisation. | | |
| `team.members.inviteDialog.nameLabel` | Name | | |
| `team.members.inviteDialog.namePlaceholder` | Full name | | |
| `team.members.inviteDialog.emailLabel` | Email | | |
| `team.members.inviteDialog.emailPlaceholder` | email@example.com | | |
| `team.members.inviteDialog.passwordLabel` | Temporary Password | | |
| `team.members.inviteDialog.passwordPlaceholder` | Initial password | | |
| `team.members.inviteDialog.roleLabel` | Role | | |
| `team.members.inviteDialog.submitLoading` | Inviting… | | |
| `team.members.inviteDialog.submit` | Invite | | |
| `team.members.inviteDialog.error` | Failed to invite member | | |
| `team.permissions.title` | Permission Matrix | | |
| `team.permissions.description` | Which roles can perform each action. Blue cells are custom overrides. | | |
| `team.permissions.loading` | Loading permissions… | | |
| `team.permissions.header.action` | Action | | |
| `team.permissions.header.reset` | Reset | | |
| `team.permissions.badge.custom` | Custom | | |
| `team.permissions.button.reset` | Reset | | |
| `team.delegations.title` | Delegations ({count}) | ✅ `count` | |
| `team.delegations.description` | Temporary authority transfers between members. Max 30 days. | | |
| `team.delegations.newButton` | New Delegation | | |
| `team.delegations.empty` | No active delegations. | | |
| `team.delegations.loading` | Loading delegations… | | |
| `team.delegations.create.title` | Create Delegation | | |
| `team.delegations.create.description` | Temporarily grant a member authority to perform specific actions. | | |
| `team.delegations.create.delegateLabel` | Delegate to | | |
| `team.delegations.create.delegatePlaceholder` | Select member | | |
| `team.delegations.create.actionsLabel` | Actions | | |
| `team.delegations.create.validUntilLabel` | Valid until | | |
| `team.delegations.create.cancel` | Cancel | | |
| `team.delegations.create.submit` | Create | | |

---

## 18. `src/app/dashboard/invitations/page.tsx`

| Key | English Text | Interpolation | Status/Enum |
|-----|-------------|---------------|-------------|
| `invitations.title` | Invitations | | |
| `invitations.subtitle` | Invite suppliers to join your supply chain | | |
| `invitations.status.pending` | Pending | | ✅ |
| `invitations.status.accepted` | Accepted | | ✅ |
| `invitations.status.expired` | Expired | | ✅ |
| `invitations.status.cancelled` | Cancelled | | ✅ |
| `invitations.create.title` | Send Invitation | | |
| `invitations.create.description` | Invited suppliers will receive a 1-click registration link | | |
| `invitations.create.emailLabel` | Email Address | | |
| `invitations.create.emailPlaceholder` | supplier@example.com | | |
| `invitations.create.roleLabel` | Role | | |
| `invitations.create.role.supplier` | Supplier | | ✅ |
| `invitations.create.role.lp` | Liquidity Partner | | ✅ |
| `invitations.create.submitLoading` | Sending… | | |
| `invitations.create.submit` | Send Invite | | |
| `invitations.create.error` | Failed to create invitation | | |
| `invitations.create.success` | Invitation sent successfully! | | |
| `invitations.list.title` | Invitations | | |
| `invitations.list.pendingBadge` | {count} pending | ✅ `count` | |
| `invitations.list.loading` | Loading… | | |
| `invitations.list.empty` | No invitations sent yet | | |
| `invitations.list.table.email` | Email | | |
| `invitations.list.table.role` | Role | | |
| `invitations.list.table.status` | Status | | |
| `invitations.list.table.sent` | Sent | | |
| `invitations.list.table.expires` | Expires | | |
| `invitations.list.table.actions` | Actions | | |
| `invitations.list.role.lp` | LP | | ✅ |
| `invitations.list.role.supplier` | Supplier | | ✅ |

---

## 19. `src/app/dashboard/payment-locks/page.tsx`

| Key | English Text | Interpolation | Status/Enum |
|-----|-------------|---------------|-------------|
| `paymentLocks.title` | Payment Locks | | |
| `paymentLocks.subtitle` | Conditional escrow locks for purchase orders | | |
| `paymentLocks.card.activeLocks` | Active Locks | | |
| `paymentLocks.card.totalLocked` | Total Locked | | |
| `paymentLocks.card.released` | Released | | |
| `paymentLocks.table.title.buyer` | Your Payment Locks | | |
| `paymentLocks.table.title.supplier` | Payment Locks on Your POs | | |
| `paymentLocks.table.description.buyer` | Funds locked when suppliers accept your purchase orders | | |
| `paymentLocks.table.description.supplier` | Buyer funds locked against your accepted purchase orders | | |
| `paymentLocks.table.empty` | No payment locks found. | | |
| `paymentLocks.table.emptyDetail` | Payment locks are created automatically when a supplier accepts a purchase order. | | |
| `paymentLocks.table.header.poRef` | PO Reference | | |
| `paymentLocks.table.header.supplier` | Supplier | | |
| `paymentLocks.table.header.buyer` | Buyer | | |
| `paymentLocks.table.header.lockedAmount` | Locked Amount | | |
| `paymentLocks.table.header.status` | Status | | |
| `paymentLocks.table.header.lockedAt` | Locked At | | |
| `paymentLocks.table.header.releasedAt` | Released At | | |

---

## 20. `src/app/dashboard/onboarding/page.tsx`

| Key | English Text | Interpolation | Status/Enum |
|-----|-------------|---------------|-------------|
| `onboarding.title` | Onboarding | | |
| `onboarding.subtitle` | Complete the steps below to activate your organisation | | |
| `onboarding.status.notStarted` | Not Started | | ✅ |
| `onboarding.status.inProgress` | In Progress | | ✅ |
| `onboarding.status.kybPending` | KYB Pending | | ✅ |
| `onboarding.status.kybVerified` | KYB Verified | | ✅ |
| `onboarding.status.kybFailed` | KYB Failed | | ✅ |
| `onboarding.status.completed` | Completed | | ✅ |
| `onboarding.loading` | Loading onboarding status… | | |
| `onboarding.error` | Failed to load onboarding status | | |
| `onboarding.complete.title` | Onboarding Complete | | |
| `onboarding.complete.description` | Your organisation is fully activated and ready to transact. | | |
| `onboarding.identity.done.title` | Step 0: Identity Verified | | |
| `onboarding.identity.done.verifiedAs` | Verified as {name} | ✅ `name` | |
| `onboarding.identity.done.description` | Your identity has been verified | | |
| `onboarding.identity.title` | Step 0: Identity Verification | | |
| `onboarding.identity.description` | Verify your identity using your National ID. In KSA this uses the Nafath app. | | |
| `onboarding.identity.nationalIdLabel` | National ID | | |
| `onboarding.identity.nationalIdPlaceholder` | e.g. 1234567890 | | |
| `onboarding.identity.submitLoading` | Starting… | | |
| `onboarding.identity.submit` | Start Verification | | |
| `onboarding.identity.digitsRemaining` | {n} digits remaining | ✅ `n` | |
| `onboarding.identity.nafathPrompt` | Open the Nafath app and select this number: | | |
| `onboarding.identity.waitingVerification` | Waiting for verification… | | |
| `onboarding.identity.error` | Identity verification failed | | |
| `onboarding.passkey.done.title` | Step 1: Passkey Registered | | |
| `onboarding.passkey.done.description` | Your passkey is active — all actions will be cryptographically signed with biometrics. | | |
| `onboarding.passkey.title` | Step 1: Register Passkey | | |
| `onboarding.passkey.description` | Register a passkey to cryptographically sign all your platform actions using biometrics (Face ID, Touch ID, or PIN). This provides non-repudiation in the evidence pack. | | |
| `onboarding.passkey.whyRequired.title` | Why is this required? | | |
| `onboarding.passkey.whyRequired.body` | Every action you take (sending POs, approving transactions, funding escrow) will be signed with your device biometric. This creates a tamper-proof digital signature chain that is included in the evidence pack and independently verifiable by any third party. | | |
| `onboarding.passkey.submitLoading` | Registering… | | |
| `onboarding.passkey.submit` | Register Passkey | | |
| `onboarding.buyer.kyb.title` | Step 2: Business Verification (KYB-lite) | | |
| `onboarding.buyer.kyb.description` | Submit your commercial registration number and authorized signatory | | |
| `onboarding.buyer.kyb.regNoLabel` | Registration Number (CR) | | |
| `onboarding.buyer.kyb.regNoPlaceholder` | e.g. 1010123456 | | |
| `onboarding.buyer.kyb.signatoryLabel` | Authorized Signatory | | |
| `onboarding.buyer.kyb.signatoryPlaceholder` | Full name of authorized person | | |
| `onboarding.buyer.kyb.error` | KYB verification failed. Please check your details. | | |
| `onboarding.buyer.kyb.submitLoading` | Verifying… | | |
| `onboarding.buyer.kyb.submit` | Verify Business | | |
| `onboarding.buyer.payment.title` | Step 3: Connect Payment Method | | |
| `onboarding.buyer.payment.description` | Link your bank IBAN for settlements | | |
| `onboarding.buyer.payment.ibanLabel` | Bank IBAN | | |
| `onboarding.buyer.payment.ibanPlaceholder` | e.g. SA0380000000608010167519 | | |
| `onboarding.buyer.payment.submitLoading` | Connecting… | | |
| `onboarding.buyer.payment.submit` | Connect Bank | | |
| `onboarding.buyer.completeLoading` | Completing… | | |
| `onboarding.buyer.complete` | Complete Onboarding | | |
| `onboarding.supplier.tier1.title` | Tier 1: Basic Onboarding | | |
| `onboarding.supplier.tier1.badge` | BASIC | | ✅ |
| `onboarding.supplier.tier1.description` | CR number + bank IBAN + platform terms → can receive POs | | |
| `onboarding.supplier.tier1.regNoLabel` | Registration Number (CR) | | |
| `onboarding.supplier.tier1.regNoPlaceholder` | e.g. 1010654321 | | |
| `onboarding.supplier.tier1.ibanLabel` | Bank IBAN | | |
| `onboarding.supplier.tier1.ibanPlaceholder` | e.g. SA0380000000608010167520 | | |
| `onboarding.supplier.tier1.termsLabel` | I accept the platform terms of service | | |
| `onboarding.supplier.tier1.error` | Onboarding failed. Please check your details. | | |
| `onboarding.supplier.tier1.submitLoading` | Submitting… | | |
| `onboarding.supplier.tier1.submit` | Complete Tier 1 | | |
| `onboarding.supplier.tier2.title` | Tier 2: Liquidity Eligible | | |
| `onboarding.supplier.tier2.badge` | LIQUIDITY_ELIGIBLE | | ✅ |
| `onboarding.supplier.tier2.description` | KYB verification + sanctions check + UBO → can request early payment | | |
| `onboarding.supplier.tier2.body` | Upgrading to Tier 2 will run KYB verification and sanctions screening on your business. This enables early payment access. | | |
| `onboarding.supplier.tier2.error` | Tier 2 upgrade failed. Verification may have been unsuccessful. | | |
| `onboarding.supplier.tier2.submitLoading` | Verifying… | | |
| `onboarding.supplier.tier2.submit` | Upgrade to Tier 2 | | |
| `onboarding.lp.profile.title` | Funding Profile Setup | | |
| `onboarding.lp.profile.description` | Configure funding account, limits, and accept participation agreement | | |
| `onboarding.lp.profile.ibanLabel` | Funding Account IBAN | | |
| `onboarding.lp.profile.ibanPlaceholder` | e.g. SA0380000000608010167521 | | |
| `onboarding.lp.profile.fundingLimitLabel` | Total Funding Limit ({currency}) | ✅ `currency` | |
| `onboarding.lp.profile.fundingLimitPlaceholder` | e.g. 5000000 | | |
| `onboarding.lp.profile.agreementLabel` | I accept the participation agreement | | |
| `onboarding.lp.profile.error` | Profile setup failed. Please check your details. | | |
| `onboarding.lp.profile.submitLoading` | Setting up… | | |
| `onboarding.lp.profile.submit` | Complete Setup | | |

---

## 21. `src/app/dashboard/settings/security/page.tsx`

| Key | English Text | Interpolation | Status/Enum |
|-----|-------------|---------------|-------------|
| `security.title` | Security | | |
| `security.subtitle` | Manage your passkeys across devices. Each passkey uses your device's biometric (Face ID, Touch ID, PIN) to cryptographically sign every action you take on the platform. | | |
| `security.info.title` | Multiple-device support | | |
| `security.info.description` | Register a passkey on each device you use (laptop, phone, tablet). Any registered passkey can sign actions. You cannot delete your last passkey — at least one must remain active at all times. | | |
| `security.passkeys.title` | Registered Passkeys | | |
| `security.passkeys.addButton` | Add Device | | |
| `security.passkeys.register.title` | Register New Passkey | | |
| `security.passkeys.register.description` | A biometric prompt will appear. Use Face ID, Touch ID, or your device PIN to create the passkey. | | |
| `security.passkeys.register.placeholder` | Device name (optional) — e.g. MacBook Pro, iPhone 16 | | |
| `security.passkeys.register.submitLoading` | Registering… | | |
| `security.passkeys.register.submit` | Register Passkey | | |
| `security.passkeys.register.cancel` | Cancel | | |
| `security.passkeys.loading` | Loading passkeys… | | |
| `security.passkeys.loadError` | Failed to load passkeys. | | |
| `security.passkeys.empty` | No passkeys registered. | | |
| `security.passkeys.emptyAction` | Click "Add Device" to register your first passkey. | | |
| `security.passkeys.card.synced` | Synced | | |
| `security.passkeys.card.created` | Created {time} | ✅ `time` | |
| `security.passkeys.card.used` | Used {time} | ✅ `time` | |
| `security.passkeys.card.never` | Never | | |
| `security.passkeys.card.singleDevice` | Single-device passkey | | |
| `security.passkeys.card.syncedPasskey` | Synced passkey | | |
| `security.passkeys.card.renamePlaceholder` | e.g. MacBook Pro, iPhone 16 | | |
| `security.passkeys.card.save` | Save | | |
| `security.passkeys.card.cancel` | Cancel | | |
| `security.passkeys.card.renameTitle` | Rename | | |
| `security.passkeys.delete.title` | Delete passkey? | | |
| `security.passkeys.delete.description` | This will permanently remove "{name}". You won't be able to sign actions from this device unless you register a new passkey. | ✅ `name` | |
| `security.passkeys.delete.cancel` | Cancel | | |
| `security.passkeys.delete.submitLoading` | Deleting… | | |
| `security.passkeys.delete.submit` | Delete | | |
| `security.passkeys.delete.cannotDelete` | Cannot delete your only passkey | | |
| `security.passkeys.delete.tooltip` | Delete passkey | | |
| `security.toast.renamed` | Passkey renamed | | |
| `security.toast.renameFailed` | Rename failed | | |
| `security.toast.deleted` | Passkey deleted | | |
| `security.toast.deleteFailed` | Delete failed | | |

---

## 22. `src/app/dashboard/admin/page.tsx`

| Key | English Text | Interpolation | Status/Enum |
|-----|-------------|---------------|-------------|
| `admin.title` | Platform Admin | | |
| `admin.subtitle` | Platform-wide statistics and metrics | | |
| `admin.stat.totalPOs` | Total POs | | |
| `admin.stat.totalPOsDesc` | {count} settled | ✅ `count` | |
| `admin.stat.volume` | Volume ({currency}) | ✅ `currency` | |
| `admin.stat.volumeDesc` | PO value | | |
| `admin.stat.activeLocks` | Active Locks | | |
| `admin.stat.activeLocksDesc` | Funds in escrow | | |
| `admin.stat.earlyPayments` | Early Payments | | |
| `admin.stat.earlyPaymentsDesc` | Funded/settled | | |
| `admin.stat.fees` | Fees ({currency}) | ✅ `currency` | |
| `admin.stat.feesDesc` | Revenue collected | | |
| `admin.stat.totalUsers` | Total Users | | |
| `admin.stat.totalUsersDesc` | All registered users | | |
| `admin.stat.settlementRate` | Settlement Rate | | |
| `admin.stat.settlementRateDesc` | POs settled / total | | |
| `admin.overview.title` | Platform Overview | | |
| `admin.overview.description` | Key platform metrics at a glance | | |
| `admin.overview.txFeeRate` | Transaction Fee Rate | | |
| `admin.overview.txFeeRateValue` | 0.5% (50 BPS) | | |
| `admin.overview.earlyPayFee` | Early Payment Facilitation Fee | | |
| `admin.overview.earlyPayFeeValue` | 2.5% (250 BPS) | | |
| `admin.overview.poLimitsGBP` | PO Limits (GBP) | | |
| `admin.overview.poLimitsSAR` | PO Limits (SAR) | | |
| `admin.overview.acceptanceWindow` | Acceptance Window | | |
| `admin.overview.acceptanceWindowValue` | 48 hours | | |
| `admin.overview.volumeLabel` | Volume ({ccy}) | ✅ `ccy` | |
| `admin.overview.feesLabel` | Fees ({ccy}) | ✅ `ccy` | |
| `admin.integrity.title` | Financial Integrity Check | | |
| `admin.integrity.description` | Cross-state-machine invariant verification (INV-001 – INV-012) | | |
| `admin.integrity.buttonLoading` | Checking… | | |
| `admin.integrity.button` | Run Check | | |
| `admin.integrity.allClear` | ALL CLEAR | | ✅ |
| `admin.integrity.violations` | {count} VIOLATION(S) | ✅ `count` | ✅ |
| `admin.integrity.summary` | {total} POs checked · {valid} valid · {time} | ✅ `total`, `valid`, `time` | |
| `admin.integrity.expected` | Expected: {value} | ✅ `value` | |
| `admin.integrity.actual` | Actual: {value} | ✅ `value` | |
| `admin.integrity.runPrompt` | Click "Run Check" to verify financial state consistency. | | |
| `admin.loadFailed` | Failed to load admin statistics. | | |

---

## 23. `src/app/dashboard/admin/reconciliation/page.tsx`

| Key | English Text | Interpolation | Status/Enum |
|-----|-------------|---------------|-------------|
| `reconciliation.title` | Bank Reconciliation | | |
| `reconciliation.subtitle` | Bank ↔ Platform consistency monitoring | | |
| `reconciliation.button.runLoading` | Running… | | |
| `reconciliation.button.run` | Run Reconciliation | | |
| `reconciliation.banner.noData` | No data | | |
| `reconciliation.banner.noDataDesc` | No reconciliation reports yet | | |
| `reconciliation.banner.allClear` | All Clear | | |
| `reconciliation.banner.allClearDesc` | Bank ↔ Platform fully consistent | | |
| `reconciliation.banner.idle` | Idle | | |
| `reconciliation.banner.idleDesc` | No pending instruments or settlements to check | | |
| `reconciliation.banner.mismatch` | {count} Mismatch(es) | ✅ `count` | |
| `reconciliation.banner.mismatchDesc` | Action required — review alerts below | | |
| `reconciliation.banner.pending` | Pending | | |
| `reconciliation.banner.pendingDesc` | Reconciliation in progress | | |
| `reconciliation.banner.lastRun` | Last run: {time} | ✅ `time` | |
| `reconciliation.card.totalChecked` | Total Checked | | |
| `reconciliation.card.matched` | Matched | | |
| `reconciliation.card.mismatches` | Mismatches | | |
| `reconciliation.card.ledgerBalance` | Ledger Balance | | |
| `reconciliation.card.variance` | Variance: {amount} | ✅ `amount` | |
| `reconciliation.card.bankBalanceNA` | Bank balance not available | | |
| `reconciliation.tab.alerts` | Alerts | | |
| `reconciliation.tab.history` | Report History | | |
| `reconciliation.alerts.empty` | No alerts — all operations reconciled cleanly. | | |
| `reconciliation.alerts.title` | Mismatch Details | | |
| `reconciliation.alerts.count` | {count} alert(s) from the last run | ✅ `count` | |
| `reconciliation.alerts.table.type` | Type | | |
| `reconciliation.alerts.table.id` | ID | | |
| `reconciliation.alerts.table.expected` | Expected | | |
| `reconciliation.alerts.table.actual` | Actual | | |
| `reconciliation.alerts.table.externalRef` | External Ref | | |
| `reconciliation.alerts.table.severity` | Severity | | |
| `reconciliation.alerts.table.reason` | Reason | | |
| `reconciliation.alerts.type.instrument` | Instrument | | |
| `reconciliation.alerts.type.settlement` | Settlement | | |
| `reconciliation.alerts.severity.stale` | Stale | | ✅ |
| `reconciliation.alerts.severity.error` | Error | | ✅ |
| `reconciliation.alerts.severity.failed` | Failed | | ✅ |
| `reconciliation.alerts.severity.mismatch` | Mismatch | | ✅ |
| `reconciliation.history.empty` | No reconciliation reports yet. | | |
| `reconciliation.history.title` | Historical Reports | | |
| `reconciliation.history.count` | {count} report(s) | ✅ `count` | |
| `reconciliation.history.table.runAt` | Run At | | |
| `reconciliation.history.table.checked` | Checked | | |
| `reconciliation.history.table.matched` | Matched | | |
| `reconciliation.history.table.mismatches` | Mismatches | | |
| `reconciliation.history.table.ledgerBalance` | Ledger Balance | | |
| `reconciliation.history.table.status` | Status | | |
| `reconciliation.history.status.clean` | Clean | | ✅ |

---

## 24. `src/app/dashboard/admin/escrow-accounts/page.tsx`

| Key | English Text | Interpolation | Status/Enum |
|-----|-------------|---------------|-------------|
| `escrowAccounts.title` | Escrow Accounts | | |
| `escrowAccounts.subtitle` | Manage segregated escrow accounts per country and currency | | |
| `escrowAccounts.button.newAccount` | New Account | | |
| `escrowAccounts.card.totalAccounts` | Total Accounts | | |
| `escrowAccounts.card.activeCount` | {count} active | ✅ `count` | |
| `escrowAccounts.card.shadowBalanceGBP` | Shadow Balance (GBP) | | |
| `escrowAccounts.card.shadowBalanceSAR` | Shadow Balance (SAR) | | |
| `escrowAccounts.table.title` | All Escrow Accounts | | |
| `escrowAccounts.table.description` | Each escrow account holds funds for a specific country/currency pair | | |
| `escrowAccounts.table.empty` | No escrow accounts created yet. | | |
| `escrowAccounts.table.header.label` | Label | | |
| `escrowAccounts.table.header.bank` | Bank | | |
| `escrowAccounts.table.header.country` | Country | | |
| `escrowAccounts.table.header.currency` | Currency | | |
| `escrowAccounts.table.header.shadowBalance` | Shadow Balance | | |
| `escrowAccounts.table.header.instruments` | Instruments | | |
| `escrowAccounts.table.header.status` | Status | | |
| `escrowAccounts.table.header.created` | Created | | |
| `escrowAccounts.table.status.active` | Active | | ✅ |
| `escrowAccounts.table.status.inactive` | Inactive | | ✅ |
| `escrowAccounts.table.button.statement` | Statement | | |
| `escrowAccounts.create.title` | Create Escrow Account | | |
| `escrowAccounts.create.description` | Add a new segregated escrow account for a country/currency pair. | | |
| `escrowAccounts.create.label.label` | Label | | |
| `escrowAccounts.create.placeholder.label` | e.g. UK GBP Primary | | |
| `escrowAccounts.create.label.bank` | Bank | | |
| `escrowAccounts.create.placeholder.bank` | e.g. Barclays PLC | | |
| `escrowAccounts.create.label.country` | Country | | |
| `escrowAccounts.create.country.gb` | GB — United Kingdom | | |
| `escrowAccounts.create.country.sa` | SA — Saudi Arabia | | |
| `escrowAccounts.create.label.currency` | Currency | | |
| `escrowAccounts.create.currency.gbp` | GBP (£) | | |
| `escrowAccounts.create.currency.sar` | SAR (﷼) | | |
| `escrowAccounts.create.submitLoading` | Creating… | | |
| `escrowAccounts.create.submit` | Create Account | | |
| `escrowAccounts.toast.updated` | Escrow account updated | | |
| `escrowAccounts.toast.updateFailed` | Failed to update escrow account | | |
| `escrowAccounts.toast.created` | Escrow account created | | |
| `escrowAccounts.toast.createFailed` | Failed to create escrow account | | |

---

## 25. `src/app/dashboard/admin/escrow-accounts/[id]/statement/page.tsx`

| Key | English Text | Interpolation | Status/Enum |
|-----|-------------|---------------|-------------|
| `escrowStatement.title` | Escrow Statement | | |
| `escrowStatement.subtitle` | {label} · {currency} | ✅ `label`, `currency` | |
| `escrowStatement.button.refresh` | Refresh | | |
| `escrowStatement.card.currentBalance` | Current Balance | | |
| `escrowStatement.card.totalTransactions` | Total Transactions | | |
| `escrowStatement.card.journalVerification` | Journal Verification | | |
| `escrowStatement.card.balanced` | Balanced | | |
| `escrowStatement.card.mismatch` | Mismatch | | |
| `escrowStatement.card.mismatchDetail` | Shadow: {shadow} \| Journal: {computed} | ✅ `shadow`, `computed` | |
| `escrowStatement.txType.deposit` | Deposit | | ✅ |
| `escrowStatement.txType.releaseSupplier` | Release (Supplier) | | ✅ |
| `escrowStatement.txType.releaseLP` | Release (LP) | | ✅ |
| `escrowStatement.txType.refund` | Refund | | ✅ |
| `escrowStatement.txType.platformFee` | Platform Fee | | ✅ |
| `escrowStatement.journal.title` | Transaction Journal | | |
| `escrowStatement.journal.description` | All escrow balance movements in chronological order | | |
| `escrowStatement.journal.empty` | No transactions yet | | |
| `escrowStatement.journal.table.date` | Date | | |
| `escrowStatement.journal.table.type` | Type | | |
| `escrowStatement.journal.table.reference` | Reference | | |
| `escrowStatement.journal.table.amount` | Amount | | |
| `escrowStatement.journal.table.balanceAfter` | Balance After | | |

---

## 26. `src/app/dashboard/admin/feature-flags/page.tsx`

| Key | English Text | Interpolation | Status/Enum |
|-----|-------------|---------------|-------------|
| `featureFlags.title` | Feature Flags | | |
| `featureFlags.subtitle` | Manage platform feature flags and pilot gating | | |
| `featureFlags.subtitleFull` | Manage platform feature flags and pilot gating. Toggle flags globally or per-organisation. | | |
| `featureFlags.loadError` | Failed to load feature flags. Please try again. | | |
| `featureFlags.flag.REAL_BANK_ESCROW` | Use real bank webhooks for escrow funding instead of simulated setTimeout | | |
| `featureFlags.flag.REAL_KYB_PROVIDER` | Use Wathq KYB provider instead of mock verification | | |
| `featureFlags.flag.LP_MARKETPLACE` | Enable the liquidity-provider marketplace for early payment matching | | |
| `featureFlags.flag.EARLY_PAYMENTS` | Allow suppliers to request early payment on eligible POs | | |
| `featureFlags.flag.MULTI_CURRENCY` | Enable SAR alongside GBP for cross-border transactions | | |
| `featureFlags.flag.ESCROW_TRANSACTIONS` | Enable the escrow transaction journal for audit trail | | |
| `featureFlags.flag.POLICY_ENGINE` | Enable the policy evaluation engine with approval workflows and escalation | | |
| `featureFlags.flag.SUPPLIER_APPROVALS` | Require supplier-side approval before accepting purchase orders (Phase 9) | | |
| `featureFlags.flag.LP_FUNDING_APPROVALS` | Require LP funding approval before early payment disbursement (Phase 9) | | |
| `featureFlags.flag.DELEGATION` | Allow authority delegation between organisation members (Phase 9) | | |
| `featureFlags.flag.ESCALATION` | Enable automatic approval escalation and expiry handling (Phase 9) | | |
| `featureFlags.flag.REAL_IDENTITY_PROVIDER` | Use Nafath identity provider instead of mock verification (KSA) | | |
| `featureFlags.flag.noDescription` | No description available | | |
| `featureFlags.source.env` | Env Var | | ✅ |
| `featureFlags.source.dbGlobal` | Global Override | | ✅ |
| `featureFlags.source.dbOrg` | Org Override | | ✅ |
| `featureFlags.source.default` | Default | | ✅ |
| `featureFlags.status.on` | ON | | ✅ |
| `featureFlags.status.off` | OFF | | ✅ |
| `featureFlags.scope.title` | Scope | | |
| `featureFlags.scope.description` | View global defaults or select an organisation to see per-org resolution and set overrides. | | |
| `featureFlags.scope.globalPlaceholder` | Global (all organisations) | | |
| `featureFlags.scope.clearButton` | Clear | | |
| `featureFlags.toggle.disableGlobally` | Disable Globally | | |
| `featureFlags.toggle.enableGlobally` | Enable Globally | | |
| `featureFlags.toggle.disableForOrg` | Disable for {orgName} | ✅ `orgName` | |
| `featureFlags.toggle.enableForOrg` | Enable for {orgName} | ✅ `orgName` | |
| `featureFlags.toggle.orgOverrideNote` | This org has a specific override | | |

---

## 27. `src/app/verify/page.tsx`

| Key | English Text | Interpolation | Status/Enum |
|-----|-------------|---------------|-------------|
| `verify.title` | Evidence Pack Verifier | | |
| `verify.subtitle` | Upload a Trust Envelope JSON to independently verify its integrity, hash chains, signatures, and tamper-evidence | | |
| `verify.upload.title` | Upload Evidence Pack | | |
| `verify.upload.description` | Drag & drop a .json evidence pack file, or click to browse | | |
| `verify.upload.verifying` | Verifying… | | |
| `verify.upload.loaded` | Loaded: {fileName} | ✅ `fileName` | |
| `verify.upload.dropPrompt` | Drop evidence-pack.json here or click to browse | | |
| `verify.error.notJSON` | Please upload a JSON file (.json) | | |
| `verify.error.invalidJSON` | Invalid JSON — could not parse the file | | |
| `verify.error.requestFailed` | Verification request failed | | |
| `verify.verdict.passed` | ALL CHECKS PASSED | | ✅ |
| `verify.verdict.passedWithWarnings` | PASSED WITH WARNINGS | | ✅ |
| `verify.verdict.failed` | VERIFICATION FAILED | | ✅ |
| `verify.verdict.summary` | {passed} passed · {failed} failed · {warnings} warnings | ✅ `passed`, `failed`, `warnings` | |
| `verify.verdict.envelope` | Envelope v{version} | ✅ `version` | |
| `verify.section.badge.fail` | FAIL | | ✅ |
| `verify.section.badge.warn` | WARN | | ✅ |
| `verify.section.badge.ok` | OK | | ✅ |
| `verify.button.verifyAnother` | Verify Another Pack | | |
| `verify.info.title` | What does this verify? | | |
| `verify.info.item1` | SHA-256 hash chain integrity across all events | | |
| `verify.info.item2` | Payload hash & intent hash correctness | | |
| `verify.info.item3` | WebAuthn ECDSA P-256 digital signatures (passkey-signed approvals) | | |
| `verify.info.item4` | Challenge binding to clientDataJSON | | |
| `verify.info.item5` | Integrity root hashes (document, ledger, attachments, envelope) | | |
| `verify.info.item6` | Actor & approval cross-references | | |
| `verify.info.item7` | Platform signature (ECDSA P-256 envelope seal) | | |
| `verify.info.item8` | Timestamp ordering & credential uniqueness | | |
| `verify.info.footer` | This verification runs entirely on the server using the same cryptographic primitives as the platform. No login required — this is a public service for banks, auditors, and counterparties. | | |

---

## 28. `src/components/passkey-banner.tsx`

| Key | English Text | Interpolation | Status/Enum |
|-----|-------------|---------------|-------------|
| `passkeyBanner.title` | Passkey required | | |
| `passkeyBanner.description` | You must register a passkey to use this platform. All actions require a cryptographic signature from your device biometrics. | | |
| `passkeyBanner.goToOnboarding` | Go to Onboarding | | |
| `passkeyBanner.dismiss` | Dismiss | | |

---

## 29. `src/components/health-indicator.tsx`

| Key | English Text | Interpolation | Status/Enum |
|-----|-------------|---------------|-------------|
| `health.loading` | Checking… | | |
| `health.offline` | API Offline | | |
| `health.offlineTooltip` | Could not reach the backend API | | |
| `health.healthy` | Healthy | | |
| `health.degraded` | Degraded | | |
| `health.tooltip.database` | Database: {status} | ✅ `status` | |
| `health.tooltip.unknown` | unknown | | |

---

## Summary Statistics

| Metric | Count |
|--------|-------|
| Total files scanned | 29 |
| Files with strings | 28 |
| Files with no strings | 1 (redirect) |
| Total unique string entries | ~750+ |
| Strings with interpolation | ~80 |
| Status/enum label strings | ~90 |

---

## Notes for Implementation

1. **`statusLabel()` and `statusVariant()`** in `@/lib/format` generate display strings from status enum values (e.g. `PENDING_SUPPLIER` → `"Pending Supplier"`). These functions should be i18n-aware — they produce strings that need translation too.

2. **`formatCurrency()` and `formatDate()`** are locale-sensitive utility functions. Ensure they accept a locale parameter for i18n.

3. **Dynamic strings from API**: Some strings come from the server (e.g. policy rule names, user names, company names, error messages). These are NOT included above — only hardcoded UI strings are listed.

4. **Toast messages** (via Sonner) are scattered throughout. All are extracted above.

5. **Shared keys**: Some strings repeat across pages (e.g. "Cancel", "Status", "Amount"). Consider using a `common.*` namespace for shared terms.
