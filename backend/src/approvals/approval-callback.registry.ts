import { Injectable, Logger } from "@nestjs/common";

export type ApprovalCallback = (
  entityId: string,
  approvedBy: string,
) => Promise<void>;

export type RejectionCallback = (
  entityId: string,
  rejectedBy: string,
) => Promise<void>;

/**
 * Registry for post-approval callbacks.
 *
 * Each domain service registers callbacks for its entity types during
 * `onModuleInit()`. When an approval is completed, the ApprovalsController
 * delegates to this registry instead of hardcoded switches.
 *
 * Supports composite keys: `entityType` can be a simple string like
 * "PURCHASE_ORDER" or a compound like "PURCHASE_ORDER:ESCROW_FUNDING"
 * for action-specific callbacks.
 */
@Injectable()
export class ApprovalCallbackRegistry {
  private readonly logger = new Logger(ApprovalCallbackRegistry.name);
  private readonly callbacks = new Map<string, ApprovalCallback>();
  private readonly rejectionCallbacks = new Map<string, RejectionCallback>();

  /**
   * Register a callback for a given entity type (or entityType:action compound key).
   */
  register(entityType: string, callback: ApprovalCallback): void {
    this.callbacks.set(entityType, callback);
    this.logger.log(`Registered approval callback for: ${entityType}`);
  }

  /**
   * Register a rejection callback for a given entity type.
   */
  registerRejection(entityType: string, callback: RejectionCallback): void {
    this.rejectionCallbacks.set(entityType, callback);
    this.logger.log(`Registered rejection callback for: ${entityType}`);
  }

  /**
   * Called when an approval request reaches APPROVED status.
   *
   * Tries compound key first (entityType:action), then falls
   * back to entityType alone.
   */
  async onApproved(
    entityType: string,
    entityId: string,
    approvedBy: string,
    action?: string,
  ): Promise<void> {
    // Try compound key first
    if (action) {
      const compoundKey = `${entityType}:${action}`;
      const cb = this.callbacks.get(compoundKey);
      if (cb) {
        this.logger.log(
          `Executing callback for ${compoundKey} (entity: ${entityId})`,
        );
        await cb(entityId, approvedBy);
        return;
      }
    }

    // Fall back to entity type
    const cb = this.callbacks.get(entityType);
    if (cb) {
      this.logger.log(
        `Executing callback for ${entityType} (entity: ${entityId})`,
      );
      await cb(entityId, approvedBy);
      return;
    }

    this.logger.warn(
      `No approval callback registered for entityType=${entityType}, action=${action ?? "N/A"}`,
    );
  }

  /**
   * Called when an approval request reaches REJECTED status.
   */
  async onRejected(
    entityType: string,
    entityId: string,
    rejectedBy: string,
  ): Promise<void> {
    const cb = this.rejectionCallbacks.get(entityType);
    if (cb) {
      this.logger.log(
        `Executing rejection callback for ${entityType} (entity: ${entityId})`,
      );
      await cb(entityId, rejectedBy);
      return;
    }
    this.logger.warn(
      `No rejection callback registered for entityType=${entityType}`,
    );
  }

  /** List all registered callback keys (for diagnostics) */
  getRegisteredTypes(): string[] {
    return Array.from(this.callbacks.keys());
  }
}
