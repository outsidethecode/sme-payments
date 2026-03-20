/**
 * English translation dictionary — extracted from all 29 frontend files.
 *
 * Keys use dot-separated namespaces matching file/feature areas.
 * Template literals use {{variable}} placeholders for runtime interpolation.
 */

const en = {
  // ─── Common / Shared ───────────────────────────────────────────────
  common: {
    appName: "Programmable SME Settlement",
    loading: "Loading…",
    save: "Save",
    cancel: "Cancel",
    confirm: "Confirm",
    back: "Back",
    refresh: "Refresh",
    signOut: "Sign out",
    active: "Active",
    inactive: "Inactive",
    on: "ON",
    off: "OFF",
    total: "Total",
    status: "Status",
    date: "Date",
    actions: "Actions",
    amount: "Amount",
    reference: "Reference",
    noPermission: "No permission",
    dismiss: "Dismiss",
    reset: "Reset",
    simulate: "Simulate",
  },

  // ─── Jurisdictions ─────────────────────────────────────────────────
  jurisdiction: {
    ksa: "🇸🇦 KSA",
    uk: "🇬🇧 UK",
  },

  // ─── Roles ─────────────────────────────────────────────────────────
  roles: {
    owner: "Owner",
    approver: "Approver",
    finance: "Finance",
    member: "Member",
    viewer: "Viewer",
    supplier: "Supplier",
    liquidityPartner: "Liquidity Partner",
  },

  // ─── Status Labels (used via statusLabel() or inline) ──────────────
  // statusLabel() is a mechanical title-case formatter.
  // These are the display values for known enum statuses:
  statusLabels: {
    draft: "Draft",
    sent: "Sent",
    pending_approval: "Pending Approval",
    accepted: "Accepted",
    rejected: "Rejected",
    cancelled: "Cancelled",
    fulfillment: "Fulfillment",
    shipped: "Shipped",
    delivered: "Delivered",
    verified: "Verified",
    disputed: "Disputed",
    settled: "Settled",
    completed: "Completed",
    failed: "Failed",
    pending: "Pending",
    expired: "Expired",
    escalated: "Escalated",
    locked: "Locked",
    released: "Released",
    refunded: "Refunded",
    negotiation: "Negotiation",
    under_review: "Under Review",
    resolved: "Resolved",
    not_started: "Not Started",
    in_progress: "In Progress",
    kyb_pending: "KYB Pending",
    kyb_verified: "KYB Verified",
    kyb_failed: "KYB Failed",
    funded: "Funded",
    requested: "Requested",
    suspended: "Suspended",
  },

  // ─── Navigation (layout.tsx) ───────────────────────────────────────
  nav: {
    dashboard: "Dashboard",
    onboarding: "Onboarding",
    purchaseOrders: "Purchase Orders",
    approvals: "Approvals",
    team: "Team",
    invitations: "Invitations",
    paymentLocks: "Payment Locks",
    earlyPayments: "Early Payments",
    settlements: "Settlements",
    disputes: "Disputes",
    riskControls: "Risk Controls",
    ledger: "Ledger",
    myReceipts: "My Receipts",
    reconciliation: "Reconciliation",
    escrowAccounts: "Escrow Accounts",
    featureFlags: "Feature Flags",
    policies: "Policies",
    admin: "Admin",
    verifyEvidence: "Verify Evidence",
    settings: "Settings",
    passkeys: "Passkeys",
  },

  // ─── Layout ────────────────────────────────────────────────────────
  layout: {
    completeOnboardingFirst: "Complete Onboarding First",
    completeOnboardingDescription:
      "Your organisation must complete onboarding before accessing platform features.",
    goToOnboarding: "Go to Onboarding",
  },

  // ─── Login Page ────────────────────────────────────────────────────
  login: {
    tagline:
      "Event-Driven B2B Payments with Embedded Liquidity and Verifiable Digital Trust",
    signIn: "Sign in",
    signInDescription: "Enter your credentials or choose a demo account below",
    email: "Email",
    password: "Password",
    emailPlaceholder: "you@company.co.uk",
    passwordPlaceholder: "••••••••",
    signingIn: "Signing in…",
    ksaDemoAccounts: "KSA Demo Accounts",
    ksaDemoDescription:
      "Click to sign in as any team member role – test PO approvals, escrow, settlement & more",
    // Demo group labels
    buyerTeam: "Buyer Team – Al-Rajhi Trading Co",
    supplierTeam: "Supplier Team – Noor Supply Chain",
    lpTeam: "LP Team – Tamweel Capital",
    platform: "Platform",
    // Toasts
    loginSuccess: "Logged in successfully",
    loginInvalidCredentials: "Invalid email or password",
    loginFailed: "Login failed",
  },

  // ─── Dashboard Page ────────────────────────────────────────────────
  dashboard: {
    welcome: "Welcome, {{firstName}}",
    // Stat cards
    escrowBalance: "Escrow Balance",
    accountBalance: "Account Balance",
    platformEscrow: "Platform escrow",
    availableFunds: "Available funds",
    totalPOs: "Total POs",
    activePOs: "active",
    lockedAmount: "Locked Amount",
    fundsLockedAgainstPOs: "Funds locked against POs",
    pendingAction: "Pending Action",
    awaitingResponse: "Awaiting response",
    totalValue: "Total Value",
    allPurchaseOrders: "All purchase orders",
    // Quick actions
    createPurchaseOrder: "Create Purchase Order",
    createPODescription: "Send a new PO to a supplier for goods or services",
    viewPurchaseOrders: "View Purchase Orders",
    viewPODescription: "Track all your purchase orders and their statuses",
    incomingOrders: "Incoming Orders",
    incomingOrdersDescription: "View and accept purchase orders from buyers",
    earlyPayment: "Early Payment",
    earlyPaymentDescription: "Request early payment on verified deliveries",
    marketplace: "Marketplace",
    marketplaceDescription:
      "Browse verified POs available for early payment funding",
    auditLedger: "Audit Ledger",
    auditLedgerDescription: "Verify the cryptographic integrity of all events",
    platformAdmin: "Platform Admin",
    platformAdminDescription: "View platform statistics and manage operations",
    fullLedger: "Full Ledger",
    fullLedgerDescription:
      "Audit the complete event ledger with hash verification",
    newPurchaseOrder: "New Purchase Order",
    escrowLockedDiscrepancy: "Escrow / Locked Amount Discrepancy",
    runReconciliation: "Run reconciliation",
  },

  // ─── Onboarding ────────────────────────────────────────────────────
  onboarding: {
    title: "Onboarding",
    subtitle: "Complete the steps below to activate your organisation",
    complete: "Onboarding Complete",
    completeDescription:
      "Your organisation is fully activated and ready to transact.",
    // Status labels
    statusNotStarted: "Not Started",
    statusInProgress: "In Progress",
    statusKybPending: "KYB Pending",
    statusKybVerified: "KYB Verified",
    statusKybFailed: "KYB Failed",
    statusCompleted: "Completed",
    // Step 0 - Identity
    step0Title: "Step 0: Identity Verification",
    step0TitleComplete: "Step 0: Identity Verified",
    nationalId: "National ID",
    identityDescription:
      "Verify your identity using your National ID. In KSA this uses the Nafath app.",
    nafathPrompt: "Open the Nafath app and select this number:",
    waitingForVerification: "Waiting for verification…",
    startVerification: "Start Verification",
    startingVerification: "Starting…",
    // Step 1 - Passkey
    step1Title: "Step 1: Register Passkey",
    step1TitleComplete: "Step 1: Passkey Registered",
    passkeyActive:
      "Your passkey is active — all actions will be cryptographically signed with biometrics.",
    whyRequired: "Why is this required?",
    whyRequiredExplanation:
      "Every action you take (sending POs, accepting deliveries, funding early payments) is signed with your device biometrics. This creates a tamper-proof audit trail and proves non-repudiation — no party can deny their actions.",
    registerPasskey: "Register Passkey",
    registeringPasskey: "Registering…",
    // Step 2 - KYB
    step2Title: "Step 2: Business Verification (KYB-lite)",
    verifyBusiness: "Verify Business",
    verifyingBusiness: "Verifying…",
    // Step 3 - Payment
    step3Title: "Step 3: Connect Payment Method",
    connectBank: "Connect Bank",
    connectingBank: "Connecting…",
    // Supplier tiers
    tier1Title: "Tier 1: Basic Onboarding",
    tier1Badge: "BASIC",
    tier2Title: "Tier 2: Liquidity Eligible",
    tier2Badge: "LIQUIDITY_ELIGIBLE",
    completeTier1: "Complete Tier 1",
    submittingTier1: "Submitting…",
    upgradeToTier2: "Upgrade to Tier 2",
    // LP
    fundingProfileSetup: "Funding Profile Setup",
    completeSetup: "Complete Setup",
    settingUp: "Setting up…",
    // Completion
    completeOnboarding: "Complete Onboarding",
    completingOnboarding: "Completing…",
    // Agreements
    acceptTerms: "I accept the platform terms of service",
    acceptParticipation: "I accept the participation agreement",
  },

  // ─── Settings / Security ───────────────────────────────────────────
  security: {
    title: "Security",
    multiDeviceSupport: "Multiple-device support",
    multiDeviceDescription:
      "You can register passkeys on multiple devices (phone, laptop, tablet). Synced passkeys (e.g. iCloud Keychain) work across all your Apple devices automatically.",
    registeredPasskeys: "Registered Passkeys",
    addDevice: "Add Device",
    registerNewPasskey: "Register New Passkey",
    singleDevice: "Single-device passkey",
    syncedPasskey: "Synced passkey",
    syncedBadge: "Synced",
    createdTimeAgo: "Created {{timeAgo}}",
    usedTimeAgo: "Used {{timeAgo}}",
    never: "Never",
    deletePasskeyTitle: "Delete passkey?",
    deletePasskeyDescription:
      'This will permanently remove "{{name}}" from your account. If this is your only passkey, you\'ll need to register a new one to continue using the platform.',
    deleting: "Deleting…",
    delete: "Delete",
    loadingPasskeys: "Loading passkeys…",
    failedToLoadPasskeys: "Failed to load passkeys.",
    noPasskeysRegistered: "No passkeys registered.",
    noPasskeysHint: 'Click "Add Device" to register your first passkey.',
    deviceNamePlaceholder:
      "Device name (optional) — e.g. MacBook Pro, iPhone 16",
    deviceNameShortPlaceholder: "e.g. MacBook Pro, iPhone 16",
    subtitle:
      "Manage your passkeys across devices. Each passkey uses your device's biometric (Face ID, Touch ID, PIN) to cryptographically sign every action you take on the platform.",
    biometricPrompt:
      "A biometric prompt will appear. Use Face ID, Touch ID, or your device PIN to create the passkey.",
    rename: "Rename",
    cannotDeleteOnly: "Cannot delete your only passkey",
    deletePasskeyTooltip: "Delete passkey",
    registering: "Registering…",
    registerPasskey: "Register Passkey",
    // Toasts
    passkeyRenamed: "Passkey renamed",
    passkeyDeleted: "Passkey deleted",
    renameFailed: "Rename failed",
    deleteFailed: "Delete failed",
  },

  // ─── Purchase Orders List ──────────────────────────────────────────
  purchaseOrders: {
    title: "Purchase Orders",
    buyerSubtitle: "Manage orders you've created",
    supplierSubtitle: "View orders sent to you",
    importCSV: "Import CSV",
    newPO: "New PO",
    allOrders: "All Orders",
    // Table
    colReference: "Reference",
    colSupplier: "Supplier",
    colBuyer: "Buyer",
    colAmount: "Amount",
    colStatus: "Status",
    colDate: "Date",
    // Empty
    noPurchaseOrders: "No purchase orders yet",
    createFirstPO: "Create your first PO",
  },

  // ─── New Purchase Order ────────────────────────────────────────────
  newPO: {
    title: "New Purchase Order",
    subtitle: "Create a PO to send to a supplier",
    orderDetails: "Order Details",
    // Form labels
    supplier: "Supplier",
    description: "Description (optional)",
    externalPONumber: "External PO Number (optional)",
    paymentTerms: "Payment Terms",
    deliveryTerms: "Delivery Terms",
    deliveryAddress: "Delivery Address (optional)",
    taxRate: "Tax Rate (%)",
    disputeWindow: "Dispute Window (hours)",
    expectedDeliveryDate: "Expected Delivery Date (optional)",
    specialInstructions: "Special Instructions / Notes (optional)",
    buyerContact: "Buyer Contact",
    contactName: "Contact Name (optional)",
    contactEmail: "Contact Email (optional)",
    // Payment terms options
    immediate: "Immediate",
    net15: "Net 15",
    net30: "Net 30",
    net45: "Net 45",
    net60: "Net 60",
    net90: "Net 90",
    // Delivery terms options
    exWorks: "Ex Works",
    fob: "FOB",
    cif: "CIF",
    ddp: "DDP",
    custom: "Custom",
    // Line items
    lineItems: "Line Items",
    lineItemsDescription: "Add the goods or services being ordered",
    addItem: "Add Item",
    sku: "SKU",
    lineDescription: "Description",
    qty: "Qty",
    uom: "UOM",
    unitPrice: "Unit Price",
    // UOM options
    each: "Each",
    kg: "Kg",
    litre: "Litre",
    metre: "Metre",
    box: "Box",
    pallet: "Pallet",
    hour: "Hour",
    day: "Day",
    set: "Set",
    lot: "Lot",
    // Placeholders
    selectSupplier: "Select a supplier",
    descriptionPlaceholder: "General notes about this order…",
    externalPOPlaceholder: "e.g. EXT-PO-2025-001",
    deliveryAddressPlaceholder: "Warehouse or delivery location",
    taxRatePlaceholder: "e.g. 15 for 15% VAT",
    skuPlaceholder: "SKU / Part #",
    itemDescriptionPlaceholder: "Item description",
    notesPlaceholder: "Packaging requirements, handling instructions, etc.",
    contactNamePlaceholder: "e.g. John Smith",
    contactEmailPlaceholder: "e.g. john@company.com",
    // Summary
    subtotal: "Subtotal:",
    total: "Total",
    createPurchaseOrder: "Create Purchase Order",
    creating: "Creating…",
    // Toasts
    poCreated: "Purchase order created",
    poCreateFailed: "Failed to create purchase order",
    selectSupplierError: "Please select a supplier",
    addLineItemError: "Add at least one line item with a price",
    minAmountError: "Minimum order amount is {{amount}}",
    maxAmountError: "Maximum order amount is {{amount}}",
  },

  // ─── Import POs ────────────────────────────────────────────────────
  importPO: {
    title: "Import POs from CSV",
    subtitle: "Bulk-create purchase orders from a spreadsheet",
    csvFormat: "CSV Format",
    // Column table headers
    colColumn: "Column",
    colRequired: "Required",
    colDescription: "Description",
    // Column descriptions
    colSupplierId: "Supplier user ID",
    colItemDescription: "Line item description",
    colQuantity: "Quantity",
    colPrice: "Price in smallest currency unit",
    colPODescription: "PO description",
    colExternalRef: "External reference (groups rows)",
    colPaymentTerms: "IMMEDIATE, NET_15, NET_30, etc.",
    colDeliveryTerms: "EX_WORKS, FOB, CIF, DDP, CUSTOM",
    colDeliveryAddress: "Delivery location",
    colTaxRate: "Tax in basis points (1500 = 15%)",
    // Upload
    uploadCSV: "Upload CSV",
    csvFile: "CSV File",
    importPOs: "Import POs",
    importing: "Importing…",
    // Results
    importResults: "Import Results",
    posImported: "{{count}} purchase order(s) imported",
    errorsCount: "{{count}} error(s)",
    viewPurchaseOrders: "View Purchase Orders",
    // Toasts
    importSuccess: "Successfully imported {{count}} PO(s)",
    importPartial: "Imported {{imported}} PO(s), {{errors}} error(s)",
    importCheckErrors: "Import failed — check errors below",
    importFailed: "Import failed",
    selectCSVFirst: "Select a CSV file first",
  },

  // ─── PO Detail Page ────────────────────────────────────────────────
  poDetail: {
    purchaseOrderNotFound: "Purchase order not found",
    createdDate: "Created {{date}}",
    // Policy banners
    awaitingApproval: "Awaiting Approval",
    awaitingApprovalDescription:
      "This purchase order requires approval before it can be sent to the supplier. Team members with the appropriate role can approve it on the",
    approvalsPage: "Approvals page",
    organisationPolicy: "Organisation policy",
    supplierAcceptancePolicy: "Supplier Acceptance Policy",
    supplierAcceptancePolicyDesc:
      "Your organisation's policy for accepting purchase orders.",
    negotiationPolicy: "Negotiation Policy",
    negotiationPolicyDesc:
      "Your organisation's policy for responding to counter-proposals.",
    earlyPaymentPolicy: "Early Payment Policy",
    earlyPaymentPolicyDesc:
      "Your organisation's policy for requesting early payment.",
    deliveryVerificationPolicy: "Delivery Verification Policy",
    deliveryVerificationPolicyDesc:
      "Your organisation's policy for verifying delivery.",
    // Policy template strings
    policyLabel: "Policy: {{name}}",
    autoApprovalQualify: "This amount qualifies for auto-approval.",
    requiresApprovals: "Requires {{count}} {{approvalWord}}",
    approval: "approval",
    approvals: "approvals",
    fromRoleWith: "from a team member with the {{roles}} role",
    approvalProgress: "Progress: {{current}} of {{required}} received.",
    noPermissionRole: "Your role ({{role}}) {{text}}",
    doesNotHavePermission: "does not have permission to act on this PO.",
    doesNotHavePermissionCounter:
      "does not have permission to respond to this counter-proposal.",
    doesNotHavePermissionEarlyPay:
      "does not have permission to request early payment.",
    doesNotHavePermissionVerify: "does not have permission to verify delivery.",
    doesNotHavePermissionActions:
      "does not have permission to perform actions on this PO. Required: {{roles}}.",
    // Dispute banners
    disputeResolved: "Dispute Resolved",
    disputeResolvedOutcome:
      "This dispute was resolved with outcome: {{outcome}}",
    resolutionNotes: "Resolution Notes",
    viewFullDisputeDetails: "View full dispute details",
    refundAmountLabel: "Refund Amount: {{amount}} of {{total}} total",
    disputeInProgress: "Dispute in Progress",
    disputedByBuyer: "This PO was disputed by the buyer. Status: {{status}}",
    reason: "Reason",
    buyerEvidence: "Buyer Evidence",
    supplierEvidence: "Supplier Evidence",
    filesCount: "{{count}} file(s)",
    noneYet: "None yet",
    adminResolveHint:
      "As admin, you can review and resolve this dispute from the Disputes page.",
    bothPartiesHint:
      "Both buyer and supplier can submit evidence. An admin will review and resolve the dispute.",
    adminWillReview:
      "An admin will review the evidence and decide the outcome.",
    poUnderDispute:
      "This purchase order is under dispute. A platform admin will review and resolve it.",
    disputeActions: "Dispute Actions",
    submitEvidence: "Submit Evidence",
    reviewAndResolve: "Review & Resolve",
    viewDetails: "View Details",
    adminOnlyResolve:
      "Only a platform admin can resolve disputes. Contact your admin or wait for the resolution.",
    // Dispute outcomes (also used in disputes pages)
    outcomeFullRefund: "Full Refund",
    outcomePartialRefund: "Partial Refund",
    outcomeReleaseToSupplier: "Released to Supplier",
    outcomeRework: "Rework Required",
    // Actions
    waitingForBiometric: "Waiting for biometric…",
    sendToSupplier: "Send to Supplier",
    accept: "Accept",
    counterPropose: "Counter-Propose",
    reject: "Reject",
    fundEscrow: "Fund Escrow",
    awaitingBankConfirmation: "Awaiting bank confirmation…",
    markShipped: "Mark Shipped",
    markDelivered: "Mark Delivered",
    verifyDelivery: "Verify Delivery",
    dispute: "Dispute",
    acknowledgeAndSettle: "Acknowledge & Settle",
    acceptCounter: "Accept Counter",
    counterAgain: "Counter Again",
    rejectCounter: "Reject Counter",
    requestEarlyPayment: "Request Early Payment",
    earlyPaymentRequested: "Early Payment Requested",
    // Escrow payment details
    escrowPaymentDetails: "Escrow Payment Details",
    escrowPaymentDescription:
      "Transfer the amount below to the escrow account. The system will automatically confirm once the bank verifies the deposit.",
    bank: "Bank",
    iban: "IBAN",
    accountLabel: "Account Label",
    currency: "Currency",
    paymentLock: "Payment Lock",
    awaitingBankConfirmationLong:
      "Awaiting bank confirmation — this page will update automatically. In simulation mode, this completes in a few seconds.",
    bankConfirmedToast:
      "Bank confirmed — escrow funded, supplier can begin work",
    // Fulfillment status
    paymentSecured: "Payment Secured — Buyer has funded escrow",
    paymentNotLocked: "Payment Not Locked — Waiting for buyer to fund escrow",
    // Counter-proposal form
    counterProposalTitle: "Counter-Proposal",
    counterProposalDescription:
      "Edit line items and submit your counter-proposal",
    counterTableDescription: "Description",
    counterTableQty: "Qty",
    counterTableUnitPrice: "Unit Price (pennies)",
    addLineItem: "+ Add Line Item",
    counterTotal: "Counter Total",
    notesOptional: "Notes (optional)",
    notesPlaceholder: "Explain your proposed changes…",
    submitCounterProposal: "Submit Counter-Proposal",
    // Details cards
    buyer: "Buyer",
    supplier: "Supplier",
    descriptionTitle: "Description",
    specialInstructions: "Special Instructions",
    lineItemsTitle: "Line Items",
    // Line items table
    colSKU: "SKU",
    colDescription: "Description",
    colQty: "Qty",
    colUOM: "UOM",
    colUnitPrice: "Unit Price",
    colTotal: "Total",
    // Payment lock card
    paymentLockTitle: "Payment Lock",
    fundsLockedInEscrow: "Funds locked in escrow for this order",
    refundedAmount: "Refunded Amount",
    partial: "(partial)",
    lockedAt: "Locked at",
    // Order terms card
    orderTerms: "Order Terms",
    orderTermsDescription: "Payment, delivery, and tax details",
    externalPO: "External PO #",
    expectedDelivery: "Expected Delivery",
    shippedAt: "Shipped At",
    buyerContactLabel: "Buyer Contact",
    paymentTermsLabel: "Payment Terms",
    deliveryTermsLabel: "Delivery Terms",
    deliveryAddressLabel: "Delivery Address",
    taxRate: "Tax Rate",
    taxAmount: "Tax Amount",
    grossAmount: "Gross Amount",
    disputeWindow: "Dispute Window",
    partialAcceptance: "Partial Acceptance",
    allowed: "Allowed",
    // Negotiation history
    negotiationHistory: "Negotiation History",
    revisionLabel: "Revision {{current}} — {{count}} counter-proposal{{s}}",
    revLabel: "Rev #{{num}}",
    amountLabel: "Amount: {{amount}}",
    // Event timeline
    eventTimeline: "Event Timeline",
    eventTimelineDescription: "Cryptographically linked audit trail",
    signed: "Signed",
    // Toasts
    poSent: "PO sent to supplier",
    poAccepted: "PO accepted",
    poRejected: "PO rejected",
    deliveryMarked: "Delivery marked",
    goodsShipped: "Goods shipped",
    deliveryVerified: "Delivery verified",
    obligationAcknowledged: "Obligation acknowledged — settlement triggered",
    deliveryDisputed: "Delivery disputed",
    escrowFundingInitiated:
      "Escrow funding initiated — awaiting bank confirmation",
    counterProposalAccepted: "Counter-proposal accepted — PO updated",
    counterProposalRejected: "Counter-proposal rejected — PO cancelled",
    counterProposalSent: "Counter-proposal sent",
    passkeySigned: "✓ Passkey signed",
    actionCancelled: "Action cancelled",
    actionFailed: "Action failed",
    failedToFundEscrow: "Failed to fund escrow",
    failedToSendCounter: "Failed to send counter-proposal",
  },

  // ─── Approvals ─────────────────────────────────────────────────────
  approvals: {
    title: "Approvals",
    subtitle:
      "Review and approve pending purchase orders for your organisation.",
    purchaseOrderApproval: "Purchase Order Approval",
    loadingApprovals: "Loading approvals…",
    noPendingApprovals: "No pending approvals",
    noPendingDescription:
      "All caught up! Approval requests will appear here when POs exceed your organisation's auto-approve threshold.",
    // Status badges
    statusPending: "Pending",
    statusApproved: "Approved",
    statusRejected: "Rejected",
    statusExpired: "Expired",
    statusEscalated: "Escalated",
    // Card labels
    amount: "Amount",
    supplierLabel: "Supplier",
    progress: "Progress",
    requiredRoles: "Required Roles",
    decisions: "Decisions",
    // Comment
    commentOptional: "Comment (optional)",
    approvePlaceholder: "Approved — looks good.",
    rejectPlaceholder: "Reason for rejection…",
    // Buttons
    approve: "Approve",
    reject: "Reject",
    confirmApproval: "Confirm Approval",
    confirmRejection: "Confirm Rejection",
    submitting: "Submitting…",
    // Messages
    alreadySubmitted: "You have already submitted your decision.",
    roleRestriction:
      "Your role does not have permission to approve or reject this request.",
  },

  // ─── Early Payments ────────────────────────────────────────────────
  earlyPayments: {
    // Supplier view
    title: "Early Payments",
    subtitle: "Get paid early on purchase orders with locked payment",
    howItWorks: "How Early Payment Works",
    howStep1:
      "1. Your buyer creates a PO and funds escrow — payment is locked.",
    howStep2:
      "2. You request early payment — the platform verifies your eligibility.",
    howStep3:
      "3. A liquidity partner (LP) advances you the funds minus a 2.5% service fee.",
    howStep4:
      "4. When the PO settles, the LP is repaid from the locked escrow funds.",
    eligiblePOs: "Eligible Purchase Orders",
    eligiblePOsDescription:
      "POs with locked payment that you can request early payment on",
    yourRequests: "Your Early Payment Requests",
    // Table headers
    colReference: "Reference",
    colBuyer: "Buyer",
    colStatus: "Status",
    colAmount: "Amount",
    colFee: "Fee (2.5%)",
    colYouReceive: "You Receive",
    colPOReference: "PO Reference",
    colFaceValue: "Face Value",
    colFeeLabel: "Fee",
    colYouReceived: "You Received",
    colDate: "Date",
    // Empty state
    noEligiblePOs: "No eligible purchase orders for early payment.",
    noEligiblePOsDescription:
      "POs must be accepted with locked payment and not already have an early payment request.",
    // Buttons
    request: "Request",
    signing: "Signing…",
    // LP view
    lpTitle: "Early Payment Marketplace",
    lpSubtitle: "Fund verified purchase orders for a service fee return",
    lpHowItWorks: "How It Works for Liquidity Partners",
    lpStep1: "1. Browse verified purchase orders with locked escrow funds.",
    lpStep2: "2. Fund a request — you advance the face value minus a 2.5% fee.",
    lpStep3: "3. When the PO settles normally, escrow pays you back in full.",
    lpStep4: "4. Your return is the 2.5% service fee for providing liquidity.",
    availableRequests: "Available Requests",
    // Sort options
    sortNewest: "Newest First",
    sortSafest: "Safest First (Risk ↓)",
    sortRiskiest: "Riskiest First (Risk ↑)",
    sortHighestValue: "Highest Value",
    // Request cards
    faceValue: "Face Value",
    serviceFee: "Service Fee (2.5%)",
    youAdvance: "You Advance",
    paymentLockedBadge: "Payment Locked",
    fundThisRequest: "Fund This Request",
    confirmFunding: "Confirm funding?",
    funding: "Funding…",
    yourFundedPayments: "Your Funded Payments",
    colSupplier: "Supplier",
    colAdvanced: "Advanced",
    colFeeEarned: "Fee Earned",
    colFunded: "Funded",
    // Risk
    lowRisk: "Low Risk",
    mediumRisk: "Medium Risk",
    highRisk: "High Risk",
    riskScoreBreakdown: "Risk Score Breakdown",
    // Admin view
    adminTitle: "All Early Payment Requests",
    noRequestsYet: "No early payment requests yet.",
    // Toasts
    requestedPasskey: "Early payment requested ✓ Passkey signed",
    requestedSuccess: "Early payment requested successfully",
    requestFailed: "Failed to request early payment",
    fundedPasskey: "Early payment funded ✓ Passkey signed",
    fundedSuccess: "Early payment funded successfully",
    fundFailed: "Failed to fund early payment",
    // Role error
    roleNotAvailable: "Early payments is not available for your role.",
  },

  // ─── Settlements ───────────────────────────────────────────────────
  settlements: {
    // User view
    title: "Settlements",
    subtitle: "Track all fund transfers for your purchase orders.",
    // Type labels
    typeStandard: "Standard",
    typeEarlyPayAdvance: "Early Pay Advance",
    typeEarlyPaySettlement: "Early Pay Settlement",
    // Summary cards
    totalSettlements: "Total Settlements",
    completedVolume: "Completed Volume",
    successRate: "Success Rate",
    // Empty
    noSettlements:
      "No settlements yet. Settlements are created when purchase orders are verified or early payments are funded.",
    // Admin view
    adminTitle: "Settlement Management",
    adminSubtitle:
      "Monitor all platform settlements and trigger reconciliation.",
    adminTotal: "Total",
    adminCompleted: "Completed",
    adminPending: "Pending",
    adminFailed: "Failed",
    platformVolume: "Platform Volume",
    totalCompletedVolume: "Total completed settlement volume",
    pendingReconciliation: "Pending Reconciliation",
    reconcile: "Reconcile",
    allSettlements: "All Settlements",
    noSettlementsRecorded: "No settlements recorded yet.",
    // Table
    colPO: "PO",
    colType: "Type",
    colAmount: "Amount",
    colStatus: "Status",
    colRail: "Rail",
    colExternalRef: "External Ref",
    colFromTo: "From → To",
    colDate: "Date",
    colAction: "Action",
    railBadge: "{{adapter}} Rail",
    // Toasts
    reconciled: "Settlement reconciled: {{prev}} → {{current}}",
    reconcileUnchanged: "Settlement status unchanged — already up to date.",
    reconcileFailed: "Reconciliation failed.",
  },

  // ─── Disputes ──────────────────────────────────────────────────────
  disputes: {
    title: "Disputes",
    subtitle: "Manage purchase order disputes and resolutions",
    loading: "Loading disputes…",
    noDisputes: "No disputes found.",
    // Outcome labels
    outcomeFullRefund: "Full Refund",
    outcomePartialRefund: "Partial Refund",
    outcomeReleaseToSupplier: "Released to Supplier",
    outcomeRework: "Rework Required",
    // Filter
    filterAll: "All",
    // Card labels
    reasonLabel: "Reason:",
    poAmount: "PO Amount:",
    refundAmount: "Refund Amount:",
    buyerEvidence: "Buyer Evidence:",
    supplierEvidence: "Supplier Evidence:",
    resolutionNotes: "Resolution Notes:",
    // Actions
    markUnderReview: "Mark Under Review",
    resolveDispute: "Resolve Dispute",
    confirmResolution: "Confirm Resolution",
    resolving: "Resolving…",
    // Resolve dialog
    outcome: "Outcome",
    fullRefundToBuyer: "Full Refund to Buyer",
    partialRefund: "Partial Refund",
    releaseToSupplier: "Release to Supplier",
    reworkRequired: "Rework Required",
    refundAmountMinorUnit: "Refund Amount (smallest unit)",
    resolutionNotesLabel: "Resolution Notes",
    resolutionNotesPlaceholder: "Explain the resolution decision…",
  },

  // ─── Dispute Detail ────────────────────────────────────────────────
  disputeDetail: {
    title: "Dispute Details",
    reason: "Reason",
    poAmount: "PO Amount",
    status: "Status",
    buyerEvidence: "Buyer Evidence",
    supplierEvidence: "Supplier Evidence",
    noBuyerEvidence: "No buyer evidence submitted yet",
    noSupplierEvidence: "No supplier evidence submitted yet",
    disputeNotFound: "Dispute not found.",
    loadingDispute: "Loading dispute…",
    // Evidence types
    evidenceDeliveryNote: "Delivery Note",
    evidenceSignedReceipt: "Signed Receipt",
    evidencePhotoProof: "Photo Proof",
    evidenceInvoice: "Invoice",
    evidenceInspectionReport: "Inspection Report",
    evidenceShippingDocument: "Shipping Document",
    evidencePODocument: "PO Document",
    evidenceOther: "Other",
    // Submit evidence
    submitEvidence: "Submit Evidence",
    submitEvidenceDescription:
      "Upload a file to support your side of the dispute. Files are SHA-256 hashed and recorded on the immutable ledger.",
    evidenceType: "Evidence Type",
    descriptionOptional: "Description (optional)",
    descriptionPlaceholder: "Brief note about this file",
    file: "File",
    uploadAndSubmit: "Upload & Submit",
    uploading: "Uploading…",
    // Actions
    viewPO: "View PO",
    adminActions: "Admin Actions",
    markUnderReview: "Mark Under Review",
    updating: "Updating…",
    resolveDispute: "Resolve Dispute",
    // Guidance
    howDisputeResolutionWorks: "How dispute resolution works",
    guidanceStep1:
      "1. Both buyer and supplier can submit evidence files (delivery notes, photos, receipts).",
    guidanceStep2:
      "2. Each file is SHA-256 hashed and recorded on the immutable ledger for tamper-evidence.",
    guidanceStep3:
      "3. A platform admin reviews evidence and selects an outcome — full refund, partial refund, release to supplier, or rework.",
    // Toasts
    evidenceSubmitted: "Evidence submitted to the dispute",
    uploadFailed: "Upload failed",
    submitEvidenceFailed: "Failed to submit evidence",
    markedUnderReview: "Dispute marked as Under Review",
    disputeResolved: "Dispute resolved",
    downloadFailed: "Download failed",
    selectFileFirst: "Select a file first",
  },

  // ─── Ledger ────────────────────────────────────────────────────────
  ledger: {
    title: "Event Ledger",
    subtitle:
      "Immutable, cryptographically linked audit trail of all platform events",
    hashChainedEvents: "Hash-Chained Events",
    hashChainDescription:
      "Each event is SHA-256 hashed with its predecessor, forming a tamper-evident chain. Any alteration breaks the chain.",
    // Payload labels
    payloadAmount: "Amount",
    payloadFaceValue: "Face Value",
    payloadPlatformFee: "Platform Fee",
    payloadNetAdvance: "Net Advance",
    payloadTotalAmount: "Total Amount",
    payloadRecipientReceives: "Recipient Receives",
    payloadEarlyPaySettlement: "Early Pay Settlement",
    payloadRecipientId: "Recipient ID",
    payloadPurchaseOrderId: "Purchase Order ID",
    payloadReference: "Reference",
    payloadSupplierId: "Supplier ID",
    payloadBuyerId: "Buyer ID",
    payloadLineItems: "Line Items",
    payloadOpenBankingRef: "Open Banking Ref",
    payloadVerifiedAt: "Verified At",
    // Event detail
    financialDetails: "Financial Details",
    eventData: "Event Data",
    hashChain: "Hash Chain",
    passkeySignature: "Passkey Signature",
    passkeySignedBadge: "Passkey Signed",
    systemBadge: "System",
    financialBadge: "Financial",
    entityType: "Entity Type",
    timestamp: "Timestamp",
    actorRole: "Actor Role",
    sequence: "Sequence",
    eventHash: "Event Hash",
    previousHash: "Previous Hash",
    genesis: "GENESIS",
    genesisLabel: "Genesis",
    signature: "Signature",
    publicKey: "Public Key",
    credentialId: "Credential ID",
    // Empty
    noEvents: "No events recorded yet",
    noEventsDescription:
      "Events will appear as purchase orders are created and processed",
  },

  // ─── Receipts ──────────────────────────────────────────────────────
  receipts: {
    title: "My Receipts",
    subtitle:
      "Locally stored, platform-signed event receipts — Layer 4 non-repudiation proof",
    exportJSON: "Export JSON",
    verifyAll: "Verify All",
    verifying: "Verifying…",
    // Summary cards
    totalReceipts: "Total Receipts",
    storedInIndexedDB: "Stored in browser IndexedDB",
    verified: "Verified",
    matchPlatformLedger: "Match platform ledger",
    missing: "Missing",
    notFoundInLedger: "Not found in ledger",
    mismatched: "Mismatched",
    hashOrSequenceDiffers: "Hash or sequence differs",
    // Verification banners
    allVerified:
      "All {{count}} local receipts match the platform ledger. No events have been omitted or altered.",
    verificationIssues:
      "{{count}} receipt(s) do not match the platform ledger. This may indicate tampering or data loss.",
    // Table
    receiptLogTitle: "Receipt Log",
    receiptLogDescription:
      "Each row is a platform-signed receipt stored in your browser at the moment you performed the action.",
    colNum: "#",
    colEvent: "Event",
    colEntity: "Entity",
    colSeq: "Seq",
    colSigned: "Signed",
    colTimestamp: "Timestamp",
    colEventHash: "Event Hash",
    colStatus: "Status",
    // Status badges
    statusVerified: "Verified",
    statusMissing: "Missing",
    statusHashMismatch: "Hash Mismatch",
    statusSeqMismatch: "Seq Mismatch",
    statusNotChecked: "Not Checked",
    // Empty
    noReceipts: "No receipts stored yet",
    noReceiptsDescription:
      "Receipts are automatically captured when you perform signed actions (send POs, accept deliveries, fund early payments, etc.)",
    // About section
    aboutTitle: "About Local Receipts",
    aboutLayer4:
      "Layer 4 receipts are stored in your browser's IndexedDB the moment you perform a signed action. Each receipt contains the platform-signed event hash, sequence number, and your passkey signature.",
    aboutWhyMatters:
      "Why it matters: If the platform ever omits, alters, or replays an event, your local receipt provides independent proof of what was recorded at the moment of action.",
    aboutVerification:
      "Verification compares each local receipt against the live ledger. If the hash or sequence number differs, it may indicate the platform event was modified after your action.",
    aboutExport:
      "Export your receipts as a JSON file for offline storage, legal evidence, or third-party audit.",
    // Toasts
    allVerifiedToast: "All {{count}} receipts verified ✓",
    partialVerifiedToast:
      "{{verified}}/{{total}} verified — {{issues}} issues found",
    receiptsExported: "Receipts exported",
    loadFailed: "Failed to load local receipts",
    verifyFailed: "Failed to verify receipts against ledger",
    exportFailed: "Failed to export receipts",
    noReceiptsToVerify: "No receipts to verify",
  },

  // ─── Risk Controls ─────────────────────────────────────────────────
  risk: {
    title: "Risk Controls",
    subtitle: "Fraud detection, velocity controls, and LP exposure monitoring",
    // Fraud config
    fraudConfig: "Fraud Control Configuration",
    fraudConfigDescription: "Per-currency velocity limits and thresholds",
    maxPOsPerBuyerPerDay: "Max POs / Buyer / Day",
    maxDailyValuePerBuyer: "Max Daily Value / Buyer",
    mandatoryEvidenceThreshold: "Mandatory Evidence Threshold",
    maxPOsPerSupplierPerDay: "Max POs / Supplier / Day",
    supplierWhitelist: "Supplier Whitelist",
    whitelistEntries: "{{count}} entries",
    whitelistNotEnforced: "Not enforced",
    // Fraud flags
    unacknowledgedFlags: "Unacknowledged Fraud Flags",
    activeFlagsCount: "{{count}} active flag(s)",
    noFlags: "No unacknowledged fraud flags.",
    acknowledge: "Acknowledge",
    // LP exposure
    lpExposureMonitor: "LP Exposure Monitor",
    lpExposureDescription:
      "Real-time liquidity partner exposure and concentration tracking",
    enterLPUserId: "Enter LP User ID",
    checkExposure: "Check Exposure",
    exposureByCurrency: "Exposure by Currency",
    totalExposure: "Total Exposure",
    fundingLimit: "Funding Limit",
    noLimitSet: "No limit set",
    utilisation: "Utilisation",
    na: "N/A",
    fundingStatus: "Funding Status",
    statusSuspended: "SUSPENDED",
    statusActive: "ACTIVE",
    alerts: "Alerts",
    buyerConcentration: "Buyer Concentration",
    noBuyerExposure: "No buyer exposure",
    supplierConcentration: "Supplier Concentration",
    noSupplierExposure: "No supplier exposure",
    takeExposureSnapshot: "Take Exposure Snapshot",
  },

  // ─── Invitations ───────────────────────────────────────────────────
  invitations: {
    title: "Invitations",
    subtitle: "Invite suppliers to join your supply chain",
    sendInvitation: "Send Invitation",
    sendInvitationDescription:
      "Invited suppliers will receive a 1-click registration link",
    emailAddress: "Email Address",
    emailPlaceholder: "supplier@example.com",
    role: "Role",
    roleSupplier: "Supplier",
    roleLiquidityPartner: "Liquidity Partner",
    sendInvite: "Send Invite",
    sending: "Sending…",
    // Status
    statusPending: "Pending",
    statusAccepted: "Accepted",
    statusExpired: "Expired",
    statusCancelled: "Cancelled",
    // Table
    colEmail: "Email",
    colRole: "Role",
    colStatus: "Status",
    colSent: "Sent",
    colExpires: "Expires",
    colActions: "Actions",
    lpBadge: "LP",
    pendingCount: "{{count}} pending",
    noInvitations: "No invitations sent yet",
    // Toasts
    invitationSent: "Invitation sent successfully!",
    invitationFailed: "Failed to create invitation",
  },

  // ─── Payment Locks ─────────────────────────────────────────────────
  paymentLocks: {
    title: "Payment Locks",
    subtitle: "Conditional escrow locks for purchase orders",
    // Summary cards
    activeLocks: "Active Locks",
    totalLocked: "Total Locked",
    released: "Released",
    // Table title
    buyerTitle: "Your Payment Locks",
    supplierTitle: "Payment Locks on Your POs",
    buyerDescription: "Funds locked when suppliers accept your purchase orders",
    supplierDescription:
      "Buyer funds locked against your accepted purchase orders",
    // Table headers
    colPOReference: "PO Reference",
    colSupplier: "Supplier",
    colBuyer: "Buyer",
    colLockedAmount: "Locked Amount",
    colStatus: "Status",
    colLockedAt: "Locked At",
    colReleasedAt: "Released At",
    // Empty
    noPaymentLocks: "No payment locks found.",
    noPaymentLocksDescription:
      "Payment locks are created automatically when a supplier accepts a purchase order.",
  },

  // ─── Policies ──────────────────────────────────────────────────────
  policies: {
    title: "Policy Rules",
    subtitle:
      "Manage approval tiers, limits and compliance rules for your organisation",
    noOrganisation: "No organisation linked. Please complete registration.",
    // Rule type labels
    rulePoApproval: "PO Approval",
    rulePoOrderLimits: "PO Order Limits",
    ruleFundingLimit: "Funding Limit",
    ruleEscrowFunding: "Escrow Funding",
    ruleSupplierAcceptance: "Supplier Acceptance",
    ruleSettlement: "Settlement",
    ruleEarlyPayment: "Early Payment",
    ruleLpFunding: "LP Funding",
    ruleDisputeResolution: "Dispute Resolution",
    ruleDeliveryVerification: "Delivery Verification",
    // Add rule dialog
    addRule: "Add Rule",
    createPolicyRule: "Create Policy Rule",
    // Form labels
    ruleName: "Rule Name",
    ruleType: "Rule Type",
    maxExposureTotal: "Max Exposure Total (minor units)",
    maxPerBuyer: "Max % per Buyer (0–1)",
    maxPerSupplier: "Max % per Supplier (0–1)",
    maxTenorDays: "Max Tenor (days)",
    feeBasisPoints: "Fee (basis points)",
    minAmount: "Min Amount (minor units)",
    maxAmount: "Max Amount (minor units)",
    priority: "Priority (higher = matched first)",
    requiredApprovals: "Required Approvals",
    requiredRoles: "Required Roles",
    autoApprove: "Auto-approve",
    autoApproveNone: "(no manual approval needed)",
    autoApproveFundingLimit: "(always on for Funding Limit)",
    createRule: "Create Rule",
    // Seed/reset
    seedDefaults: "Seed Defaults",
    resetToDefaults: "Reset to Defaults",
    seededResult: "Seeded {{created}} rules, skipped {{skipped}}",
    resetResult: "Reset complete — {{count}} rules re-seeded",
    // Summary cards
    totalRules: "Total Rules",
    activeRules: "Active Rules",
    ruleTypes: "Rule Types",
    pilotReadiness: "Pilot Readiness",
    // Pilot checklist
    pilotChecklist: "Pilot Readiness Checklist",
    pilotProgress: "{{pct}}% complete — {{passed}}/{{total}} checks passed",
    // Simulator
    policySimulator: "Policy Simulator",
    simulatorDescription:
      "Test which policy rule matches for a given amount and rule type",
    amountMinorUnits: "Amount (minor units)",
    amountPlaceholder: "e.g. 5000000 for £50,000",
    simulateRuleType: "Rule Type",
    simulateButton: "Simulate",
    simMatched: "✓ Matched: {{name}}",
    simDetails:
      "Required approvals: {{approvals}} | Roles: {{roles}} | Auto-approve: {{autoApprove}}",
    simAutoApproveYes: "Yes",
    simAutoApproveNo: "No",
    simNoMatch: "No matching rule — {{message}}",
    // Table
    activePolicyRules: "Active Policy Rules",
    rulesShown: "{{count}} rule(s) shown",
    filterByType: "Filter by type",
    allTypes: "All Types",
    colName: "Name",
    colType: "Type",
    colRange: "Range",
    colApprovals: "Approvals",
    colRoles: "Roles",
    colAuto: "Auto",
    colPriority: "Priority",
    colStatus: "Status",
    activeBadge: "Active",
    inactiveBadge: "Inactive",
    // Empty
    noPolicyRules: "No policy rules configured.",
    seedHint: "Use 'Seed Defaults' to create standard templates.",
  },

  // ─── Team ──────────────────────────────────────────────────────────
  team: {
    title: "Team & Permissions",
    subtitle:
      "Manage members, permission overrides, and authority delegations.",
    noOrganisation: "You are not part of an organisation.",
    // Tabs
    tabMembers: "Members",
    tabPermissionMatrix: "Permission Matrix",
    tabDelegations: "Delegations",
    // Members
    membersCount: "Members ({{count}})",
    membersDescription: "Organisation members and their roles.",
    inviteMember: "Invite Member",
    changeRole: "Change Role",
    loadingMembers: "Loading members…",
    // Change role dialog
    changeRoleFor: "Change Role for {{name}}",
    changeRoleDescription: "Select a new role for this member.",
    selectRole: "Select role",
    // Invite dialog
    inviteTeamMember: "Invite Team Member",
    inviteTeamDescription:
      "Create an account and add them to your organisation.",
    name: "Name",
    namePlaceholder: "Full name",
    email: "Email",
    emailPlaceholder: "email@example.com",
    temporaryPassword: "Temporary Password",
    passwordPlaceholder: "Initial password",
    inviteButton: "Invite",
    inviting: "Inviting…",
    inviteFailed: "Failed to invite member",
    // Permission matrix
    permissionMatrix: "Permission Matrix",
    permissionMatrixDescription:
      "Which roles can perform each action. Blue cells are custom overrides.",
    action: "Action",
    customBadge: "Custom",
    // Delegations
    delegationsCount: "Delegations ({{count}})",
    delegationsDescription:
      "Temporary authority transfers between members. Max 30 days.",
    newDelegation: "New Delegation",
    noDelegations: "No active delegations.",
    loadingDelegations: "Loading delegations…",
    // Create delegation dialog
    createDelegation: "Create Delegation",
    createDelegationDescription:
      "Temporarily grant a member authority to perform specific actions.",
    delegateTo: "Delegate to",
    selectMember: "Select member",
    delegationActions: "Actions",
    validUntil: "Valid until",
    create: "Create",
  },

  // ─── Admin ─────────────────────────────────────────────────────────
  admin: {
    title: "Platform Admin",
    subtitle: "Platform-wide statistics and metrics",
    // Stat cards
    totalPOs: "Total POs",
    settledCount: "{{count}} settled",
    volumeLabel: "Volume ({{currency}})",
    poValue: "PO value",
    activeLocks: "Active Locks",
    fundsInEscrow: "Funds in escrow",
    earlyPayments: "Early Payments",
    fundedSettled: "Funded/settled",
    feesLabel: "Fees ({{currency}})",
    revenueCollected: "Revenue collected",
    totalUsers: "Total Users",
    allRegisteredUsers: "All registered users",
    settlementRate: "Settlement Rate",
    posSettledTotal: "POs settled / total",
    // Overview
    platformOverview: "Platform Overview",
    keyMetrics: "Key platform metrics at a glance",
    transactionFeeRate: "Transaction Fee Rate",
    transactionFeeValue: "0.5% (50 BPS)",
    earlyPayFacilitationFee: "Early Payment Facilitation Fee",
    earlyPayFacilitationFeeValue: "2.5% (250 BPS)",
    poLimitsGBP: "PO Limits (GBP)",
    poLimitsSAR: "PO Limits (SAR)",
    acceptanceWindow: "Acceptance Window",
    acceptanceWindowValue: "48 hours",
    // Financial integrity
    financialIntegrityCheck: "Financial Integrity Check",
    integrityDescription:
      "Cross-state-machine invariant verification (INV-001 – INV-012)",
    runCheck: "Run Check",
    checking: "Checking…",
    allClear: "ALL CLEAR",
    violationsCount: "{{count}} VIOLATION(S)",
    posChecked: "{{checked}} POs checked · {{valid}} valid",
    expected: "Expected:",
    actual: "Actual:",
    clickRunCheck: 'Click "Run Check" to verify financial state consistency.',
    failedToLoadStats: "Failed to load admin statistics.",
  },

  // ─── Reconciliation ────────────────────────────────────────────────
  reconciliation: {
    title: "Bank Reconciliation",
    subtitle: "Bank ↔ Platform consistency monitoring",
    runReconciliation: "Run Reconciliation",
    running: "Running…",
    // Status banners
    noData: "No data",
    noDataDescription: "No reconciliation reports yet",
    allClear: "All Clear",
    allClearDescription: "Bank ↔ Platform fully consistent",
    idle: "Idle",
    idleDescription: "No pending instruments or settlements to check",
    mismatchCount: "{{count}} Mismatch(es)",
    mismatchDescription: "Action required — review alerts below",
    pendingStatus: "Pending",
    pendingDescription: "Reconciliation in progress",
    lastRun: "Last run: {{date}}",
    // Summary cards
    totalChecked: "Total Checked",
    matched: "Matched",
    mismatches: "Mismatches",
    ledgerBalance: "Ledger Balance",
    variance: "Variance: {{amount}}",
    bankBalanceUnavailable: "Bank balance not available",
    // Tabs
    tabAlerts: "Alerts",
    tabReportHistory: "Report History",
    // Alerts
    mismatchDetails: "Mismatch Details",
    alertsCount: "{{count}} alert(s) from the last run",
    noAlerts: "No alerts — all operations reconciled cleanly.",
    // Alert table
    colType: "Type",
    colId: "ID",
    colExpected: "Expected",
    colActual: "Actual",
    colExternalRef: "External Ref",
    colSeverity: "Severity",
    colReason: "Reason",
    typeInstrument: "Instrument",
    typeSettlement: "Settlement",
    severityStale: "Stale",
    severityError: "Error",
    severityFailed: "Failed",
    severityMismatch: "Mismatch",
    // History
    historicalReports: "Historical Reports",
    reportsCount: "{{count}} report(s)",
    noReports: "No reconciliation reports yet.",
    // History table
    colRunAt: "Run At",
    colChecked: "Checked",
    colMatched: "Matched",
    colMismatches: "Mismatches",
    colLedgerBalance: "Ledger Balance",
    colStatus: "Status",
    cleanStatus: "Clean",
    alertsStatus: "alert(s)",
  },

  // ─── Escrow Accounts ───────────────────────────────────────────────
  escrowAccounts: {
    title: "Escrow Accounts",
    subtitle: "Manage segregated escrow accounts per country and currency",
    newAccount: "New Account",
    // Summary cards
    totalAccounts: "Total Accounts",
    activeCount: "{{count}} active",
    shadowBalanceGBP: "Shadow Balance (GBP)",
    shadowBalanceSAR: "Shadow Balance (SAR)",
    // Table
    allEscrowAccounts: "All Escrow Accounts",
    allEscrowDescription:
      "Each escrow account holds funds for a specific country/currency pair",
    colLabel: "Label",
    colBank: "Bank",
    colCountry: "Country",
    colCurrency: "Currency",
    colShadowBalance: "Shadow Balance",
    colInstruments: "Instruments",
    colStatus: "Status",
    colCreated: "Created",
    activeBadge: "Active",
    inactiveBadge: "Inactive",
    statement: "Statement",
    noAccounts: "No escrow accounts created yet.",
    // Create dialog
    createEscrowAccount: "Create Escrow Account",
    createEscrowDescription:
      "Add a new segregated escrow account for a country/currency pair.",
    label: "Label",
    labelPlaceholder: "e.g. UK GBP Primary",
    bankLabel: "Bank",
    bankPlaceholder: "e.g. Barclays PLC",
    country: "Country",
    currency: "Currency",
    countryGB: "GB — United Kingdom",
    countrySA: "SA — Saudi Arabia",
    currencyGBP: "GBP (£)",
    currencySAR: "SAR (﷼)",
    createAccount: "Create Account",
    creatingAccount: "Creating…",
    // Toasts
    accountUpdated: "Escrow account updated",
    accountUpdateFailed: "Failed to update escrow account",
    accountCreated: "Escrow account created",
    accountCreateFailed: "Failed to create escrow account",
  },

  // ─── Escrow Statement ──────────────────────────────────────────────
  escrowStatement: {
    title: "Escrow Statement",
    // Summary cards
    currentBalance: "Current Balance",
    totalTransactions: "Total Transactions",
    journalVerification: "Journal Verification",
    balanced: "Balanced",
    mismatch: "Mismatch",
    shadowJournal: "Shadow: {{shadow}} | Journal: {{journal}}",
    // Transaction journal
    transactionJournal: "Transaction Journal",
    transactionJournalDescription:
      "All escrow balance movements in chronological order",
    noTransactions: "No transactions yet",
    // Transaction types
    txDeposit: "Deposit",
    txReleaseSupplier: "Release (Supplier)",
    txReleaseLP: "Release (LP)",
    txRefund: "Refund",
    txPlatformFee: "Platform Fee",
    // Table
    colDate: "Date",
    colType: "Type",
    colReference: "Reference",
    colAmount: "Amount",
    colBalanceAfter: "Balance After",
  },

  // ─── Feature Flags ─────────────────────────────────────────────────
  featureFlags: {
    title: "Feature Flags",
    subtitle: "Manage platform feature flags and pilot gating",
    description: "Toggle flags globally or per-organisation.",
    // Flag descriptions
    flagUseRealBank:
      "Use real bank webhooks for escrow funding instead of simulated setTimeout",
    flagNafathEnabled:
      "Enable Nafath national-ID verification flow for Saudi users",
    flagMultiCurrency: "Enable multi-currency (GBP + SAR) support",
    flagEarlyPayment: "Enable early-payment requests and LP marketplace",
    flagDisputeResolution: "Enable dispute filing and resolution workflow",
    flagEvidencePack: "Enable evidence-pack generation and verification",
    flagPolicyEngine: "Enable configurable policy rules and approval workflows",
    flagPdpaConsent: "Require PDPA consent collection before data processing",
    flagRiskEngine:
      "Enable fraud-detection, velocity controls and LP exposure monitoring",
    flagReconciliation: "Enable bank-reconciliation monitoring and alerting",
    flagFeeCollection: "Collect platform transaction fees on settlement",
    flagPaymentLockRequired:
      "Require escrow funding (payment lock) before supplier can begin work",
    // Source labels
    sourceEnvVar: "Env Var",
    sourceGlobalOverride: "Global Override",
    sourceOrgOverride: "Org Override",
    sourceDefault: "Default",
    // Scope
    scopeLabel: "Scope",
    scopeDescription:
      "View global defaults or select an organisation to see per-org resolution and set overrides.",
    globalAllOrgs: "Global (all organisations)",
    clear: "Clear",
    // Toggle buttons
    disableGlobally: "Disable Globally",
    enableGlobally: "Enable Globally",
    disableForOrg: "Disable for {{orgName}}",
    enableForOrg: "Enable for {{orgName}}",
    orgOverrideHint: "This org has a specific override",
    noDescription: "No description available",
    failedToLoad: "Failed to load feature flags. Please try again.",
  },

  // ─── Verify Evidence ───────────────────────────────────────────────
  verify: {
    title: "Evidence Pack Verifier",
    subtitle:
      "Upload a Trust Envelope JSON to independently verify its integrity, hash chains, signatures, and tamper-evidence",
    uploadTitle: "Upload Evidence Pack",
    uploadDescription:
      "Drag & drop a .json evidence pack file, or click to browse",
    verifying: "Verifying…",
    dropOrBrowse: "Drop evidence-pack.json here or click to browse",
    loaded: "Loaded: {{fileName}}",
    // Errors
    errorJsonOnly: "Please upload a JSON file (.json)",
    errorInvalidJson: "Invalid JSON — could not parse the file",
    errorRequestFailed: "Verification request failed",
    // Verdicts
    verdictAllPassed: "ALL CHECKS PASSED",
    verdictPassedWithWarnings: "PASSED WITH WARNINGS",
    verdictFailed: "VERIFICATION FAILED",
    resultsSummary:
      "{{passed}} passed · {{failed}} failed · {{warnings}} warnings",
    envelopeVersion: "Envelope v{{version}}",
    // Section badges
    badgeFail: "FAIL",
    badgeWarn: "WARN",
    badgeOk: "OK",
    verifyAnother: "Verify Another Pack",
    // What does this verify
    whatDoesThisVerify: "What does this verify?",
    check1: "Hash-chain integrity — every event hash links to its predecessor",
    check2:
      "Passkey signatures — WebAuthn assertions are cryptographically valid",
    check3: "Sequence continuity — no gaps or duplicates in event sequences",
    check4:
      "Financial invariants — amounts, fees, and settlements are consistent",
    check5:
      "Entity-chain isolation — each entity's events form an independent chain",
    check6: "Timestamp ordering — events are chronologically consistent",
    check7:
      "Settlement completeness — every verified PO has a corresponding settlement",
    check8: "Escrow accounting — deposits and releases balance correctly",
    // Footer
    footer:
      "This verification runs entirely on the server using the same cryptographic primitives as the platform. No login required — this is a public service for banks, auditors, and counterparties.",
  },

  // ─── Passkey Banner Component ──────────────────────────────────────
  passkeyBanner: {
    title: "Passkey required",
    description:
      "You must register a passkey to use this platform. All actions require a cryptographic signature from your device biometrics.",
    goToOnboarding: "Go to Onboarding",
    dismiss: "Dismiss",
  },
} as const;

/** Recursively maps a const object's leaf values to `string`. */
type DeepStringify<T> = {
  [K in keyof T]: T[K] extends string ? string : DeepStringify<T[K]>;
};

export type TranslationKeys = DeepStringify<typeof en>;
export default en;
