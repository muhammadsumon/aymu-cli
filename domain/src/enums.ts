// GLOSSARY as code: every stored enum value (snake_case, identical in DB, Zod, JSON, logs and docs).
// Each enum is a readonly tuple (the source of truth), a Zod schema and a PascalCase union type.
// test/glossary.test.ts compares these tuples with docs/GLOSSARY.md, so the two cannot drift.
import { z } from 'zod';

function enumOf<const T extends readonly [string, ...string[]]>(values: T) {
  return z.enum(values);
}

// ---- 3. Principals -------------------------------------------------------------------------------
export const ROLES = ['customer', 'admin', 'owner'] as const;
export const Role = enumOf(ROLES);
export type Role = z.infer<typeof Role>;

/** GLOSSARY 3.1. Staff endpoints check exactly one of these on the server. */
export const STAFF_PERMISSIONS = [
  'catalog.write',
  'upload.write',
  'release.manage',
  'release.publish',
  'release.unpublish',
  'release.revoke',
  'plan.write',
  'entitlement.grant',
  'entitlement.revoke',
  'entitlement.restore',
  'account_hold.place',
  'account_hold.lift',
  'user.read',
  'order.read',
  'audit.read',
  'analytics.read',
  'order.manage',
  'user.ban',
  'user.unban',
  'role.assign',
  'settings.write',
  'signing_key.manage',
  'user.close',
] as const;
export const StaffPermission = enumOf(STAFF_PERMISSIONS);
export type StaffPermission = z.infer<typeof StaffPermission>;
/** Owner-only permissions (GLOSSARY 3.1, "no" for admin). */
export const OWNER_ONLY_PERMISSIONS = ['role.assign', 'settings.write', 'signing_key.manage', 'user.close'] as const;

// ---- 4. Catalog ------------------------------------------------------------------------------------
export const PRODUCT_KINDS = ['template', 'section'] as const;
export const ProductKind = enumOf(PRODUCT_KINDS);
export type ProductKind = z.infer<typeof ProductKind>;

export const PRODUCT_STATUSES = ['draft', 'published', 'unpublished'] as const;
export const ProductStatus = enumOf(PRODUCT_STATUSES);
export type ProductStatus = z.infer<typeof ProductStatus>;

export const ACCESS_POLICIES = ['paid', 'free_with_account'] as const;
export const AccessPolicy = enumOf(ACCESS_POLICIES);
export type AccessPolicy = z.infer<typeof AccessPolicy>;

export const CATEGORY_TAXONOMIES = ['template_category', 'section_type'] as const;
export const CategoryTaxonomy = enumOf(CATEGORY_TAXONOMIES);
export type CategoryTaxonomy = z.infer<typeof CategoryTaxonomy>;

export const TAG_KINDS = ['style', 'use_case', 'feature', 'keyword'] as const;
export const TagKind = enumOf(TAG_KINDS);
export type TagKind = z.infer<typeof TagKind>;

export const PAGE_TYPES = [
  'home',
  'about',
  'pricing',
  'features',
  'blog_index',
  'blog_post',
  'contact',
  'faq',
  'docs',
  'changelog',
  'careers',
  'team',
  'portfolio',
  'legal',
  'auth',
  'error',
  'other',
] as const;
export const PageType = enumOf(PAGE_TYPES);
export type PageType = z.infer<typeof PageType>;

export const TEMPLATE_SECTION_RELATIONSHIPS = ['extracted_from', 'used_in'] as const;
export const TemplateSectionRelationship = enumOf(TEMPLATE_SECTION_RELATIONSHIPS);
export type TemplateSectionRelationship = z.infer<typeof TemplateSectionRelationship>;

export const VARIANT_KINDS = ['astro_project', 'astro_section', 'asset_pack'] as const;
export const VariantKind = enumOf(VARIANT_KINDS);
export type VariantKind = z.infer<typeof VariantKind>;

/** Every variant kind is backed by an immutable release (ADR-173 removed the only link-only kind). */
export const RELEASE_BACKED_VARIANT_KINDS = VARIANT_KINDS;
export const ReleaseBackedVariantKind = enumOf(RELEASE_BACKED_VARIANT_KINDS);
export type ReleaseBackedVariantKind = z.infer<typeof ReleaseBackedVariantKind>;

export const INSTALLABLE_VARIANT_KINDS = ['astro_project', 'astro_section'] as const;
export const InstallableVariantKind = enumOf(INSTALLABLE_VARIANT_KINDS);
export type InstallableVariantKind = z.infer<typeof InstallableVariantKind>;

export const VARIANT_STATUSES = ['draft', 'published', 'unpublished'] as const;
export const VariantStatus = enumOf(VARIANT_STATUSES);
export type VariantStatus = z.infer<typeof VariantStatus>;

export const MEDIA_ROLES = ['screenshot', 'thumbnail', 'preview_video', 'og_image'] as const;
export const MediaRole = enumOf(MEDIA_ROLES);
export type MediaRole = z.infer<typeof MediaRole>;

export const VIEWPORTS = ['desktop', 'tablet', 'mobile'] as const;
export const Viewport = enumOf(VIEWPORTS);
export type Viewport = z.infer<typeof Viewport>;

export const ASSET_PURPOSES = [
  'screenshot',
  'thumbnail',
  'preview_video',
  'og_image',
  'font',
  'image',
  'source_upload',
] as const;
export const AssetPurpose = enumOf(ASSET_PURPOSES);
export type AssetPurpose = z.infer<typeof AssetPurpose>;

export const STORAGE_BUCKETS = ['public_media', 'private_releases'] as const;
export const StorageBucket = enumOf(STORAGE_BUCKETS);
export type StorageBucket = z.infer<typeof StorageBucket>;

export const ASSET_STATUSES = ['pending', 'ready', 'rejected', 'deleted'] as const;
export const AssetStatus = enumOf(ASSET_STATUSES);
export type AssetStatus = z.infer<typeof AssetStatus>;

// ---- 5. Releases -------------------------------------------------------------------------------
export const RELEASE_STATES = [
  'draft',
  'validating',
  'preview',
  'review',
  'published',
  'unpublished',
  'revoked',
] as const;
export const ReleaseState = enumOf(RELEASE_STATES);
export type ReleaseState = z.infer<typeof ReleaseState>;

export const FILE_ROLES = [
  'page',
  'layout',
  'component',
  'style',
  'script',
  'asset',
  'font',
  'image',
  'config',
  'doc',
  'license',
] as const;
export const FileRole = enumOf(FILE_ROLES);
export type FileRole = z.infer<typeof FileRole>;

export const DEPENDENCY_TYPES = ['dependencies', 'dev_dependencies', 'peer_dependencies'] as const;
export const DependencyType = enumOf(DEPENDENCY_TYPES);
export type DependencyType = z.infer<typeof DependencyType>;

export const SIGNING_KEY_STATUSES = ['active', 'retired', 'compromised'] as const;
export const SigningKeyStatus = enumOf(SIGNING_KEY_STATUSES);
export type SigningKeyStatus = z.infer<typeof SigningKeyStatus>;

export const REVISION_STRATEGIES = ['latest', 'pinned'] as const;
export const RevisionStrategy = enumOf(REVISION_STRATEGIES);
export type RevisionStrategy = z.infer<typeof RevisionStrategy>;

export const RELEASE_REVOKE_REASON_CODES = [
  'compromised',
  'rights_withdrawn',
  'security_defect',
  'signing_key_compromised',
  'other',
] as const;
export const ReleaseRevokeReasonCode = enumOf(RELEASE_REVOKE_REASON_CODES);
export type ReleaseRevokeReasonCode = z.infer<typeof ReleaseRevokeReasonCode>;

export const INSTALL_MODES = ['into_project', 'new_project'] as const;
export const InstallMode = enumOf(INSTALL_MODES);
export type InstallMode = z.infer<typeof InstallMode>;

export const ENTRYPOINT_KINDS = ['component', 'layout', 'page', 'style', 'config'] as const;
export const EntrypointKind = enumOf(ENTRYPOINT_KINDS);
export type EntrypointKind = z.infer<typeof EntrypointKind>;

/** RELEASE_FORMAT 15.3 / GLOSSARY 5.2: CLI verification codes, also the install report's `failureCode`. */
export const CLI_VERIFICATION_CODES = [
  'non_canonical_manifest',
  'manifest_mismatch',
  'manifest_hash_mismatch',
  'object_hash_mismatch',
  'unknown_signing_key',
  'signing_key_compromised',
  'signature_invalid',
  'unsafe_path',
  'limit_exceeded',
  'source_hash_mismatch',
  'archive_invalid',
  'unexpected_entry',
  'missing_entry',
  'file_hash_mismatch',
  'incompatible_project',
  'path_collision',
  'target_exists',
  'local_changes',
] as const;
export const CliVerificationCode = enumOf(CLI_VERIFICATION_CODES);
export type CliVerificationCode = z.infer<typeof CliVerificationCode>;

// ---- 6. Commerce (Paddle values copied verbatim) ----------------------------------------------
export const PLAN_KINDS = ['single_product', 'bundle', 'subscription', 'lifetime'] as const;
export const PlanKind = enumOf(PLAN_KINDS);
export type PlanKind = z.infer<typeof PlanKind>;

export const PLAN_STATUSES = ['draft', 'active', 'retired'] as const;
export const PlanStatus = enumOf(PLAN_STATUSES);
export type PlanStatus = z.infer<typeof PlanStatus>;

export const INCLUSION_TARGETS = ['product', 'template_sections', 'product_kind', 'all_products'] as const;
export const InclusionTarget = enumOf(INCLUSION_TARGETS);
export type InclusionTarget = z.infer<typeof InclusionTarget>;

export const ENVIRONMENTS = ['sandbox', 'production'] as const;
export const Environment = enumOf(ENVIRONMENTS);
export type Environment = z.infer<typeof Environment>;

export const PADDLE_CATALOG_STATUSES = ['active', 'archived'] as const;
export const PaddleCatalogStatus = enumOf(PADDLE_CATALOG_STATUSES);
export type PaddleCatalogStatus = z.infer<typeof PaddleCatalogStatus>;

export const BILLING_INTERVALS = ['day', 'week', 'month', 'year'] as const;
export const BillingInterval = enumOf(BILLING_INTERVALS);
export type BillingInterval = z.infer<typeof BillingInterval>;

export const CHECKOUT_INTENT_STATUSES = ['created', 'completed', 'expired', 'canceled'] as const;
export const CheckoutIntentStatus = enumOf(CHECKOUT_INTENT_STATUSES);
export type CheckoutIntentStatus = z.infer<typeof CheckoutIntentStatus>;

export const ORDER_KINDS = [
  'one_time',
  'subscription_initial',
  'subscription_renewal',
  'subscription_change',
  'subscription_other',
] as const;
export const OrderKind = enumOf(ORDER_KINDS);
export type OrderKind = z.infer<typeof OrderKind>;

export const ORDER_STATUSES = ['pending', 'paid', 'completed', 'past_due', 'canceled'] as const;
export const OrderStatus = enumOf(ORDER_STATUSES);
export type OrderStatus = z.infer<typeof OrderStatus>;

export const ADJUSTMENT_STATES = ['none', 'partially_refunded', 'refunded', 'charged_back'] as const;
export const AdjustmentState = enumOf(ADJUSTMENT_STATES);
export type AdjustmentState = z.infer<typeof AdjustmentState>;

export const ORDER_ITEM_STATUSES = ['active', 'refunded', 'charged_back'] as const;
export const OrderItemStatus = enumOf(ORDER_ITEM_STATUSES);
export type OrderItemStatus = z.infer<typeof OrderItemStatus>;

export const ADJUSTMENT_ACTIONS = [
  'refund',
  'credit',
  'chargeback',
  'chargeback_warning',
  'chargeback_reverse',
  'chargeback_warning_reverse',
  'credit_reverse',
] as const;
export const AdjustmentAction = enumOf(ADJUSTMENT_ACTIONS);
export type AdjustmentAction = z.infer<typeof AdjustmentAction>;

export const ADJUSTMENT_STATUSES = ['pending_approval', 'approved', 'rejected', 'reversed'] as const;
export const AdjustmentStatus = enumOf(ADJUSTMENT_STATUSES);
export type AdjustmentStatus = z.infer<typeof AdjustmentStatus>;

export const ADJUSTMENT_TYPES = ['full', 'partial'] as const;
export const AdjustmentType = enumOf(ADJUSTMENT_TYPES);
export type AdjustmentType = z.infer<typeof AdjustmentType>;

export const ADJUSTMENT_EFFECTS = ['none', 'revoked', 'restored'] as const;
export const AdjustmentEffect = enumOf(ADJUSTMENT_EFFECTS);
export type AdjustmentEffect = z.infer<typeof AdjustmentEffect>;

export const SUBSCRIPTION_STATUSES = ['active', 'trialing', 'past_due', 'paused', 'canceled'] as const;
export const SubscriptionStatus = enumOf(SUBSCRIPTION_STATUSES);
export type SubscriptionStatus = z.infer<typeof SubscriptionStatus>;

export const SCHEDULED_CHANGE_ACTIONS = ['cancel', 'pause', 'resume'] as const;
export const ScheduledChangeAction = enumOf(SCHEDULED_CHANGE_ACTIONS);
export type ScheduledChangeAction = z.infer<typeof ScheduledChangeAction>;

// ---- 7. Entitlements and metering ---------------------------------------------------------------
export const ENTITLEMENT_SOURCES = [
  'one_time_purchase',
  'bundle_purchase',
  'lifetime_purchase',
  'subscription',
  'admin_grant',
] as const;
export const EntitlementSource = enumOf(ENTITLEMENT_SOURCES);
export type EntitlementSource = z.infer<typeof EntitlementSource>;

export const ENTITLEMENT_STATUSES = ['active', 'past_due', 'paused', 'revoked'] as const;
export const EntitlementStatus = enumOf(ENTITLEMENT_STATUSES);
export type EntitlementStatus = z.infer<typeof EntitlementStatus>;

/** Computed, never stored (GLOSSARY 7.1). */
export const ENTITLEMENT_EFFECTIVE_STATES = [
  'not_started',
  'valid',
  'in_grace',
  'grace_over',
  'paused',
  'expired',
  'revoked',
] as const;
export const EntitlementEffectiveState = enumOf(ENTITLEMENT_EFFECTIVE_STATES);
export type EntitlementEffectiveState = z.infer<typeof EntitlementEffectiveState>;

export const ENTITLEMENT_GRANT_ACTIONS = [
  'grant',
  'revoke',
  'restore',
  'status_change',
  'plan_change',
  'end_change',
] as const;
export const EntitlementGrantAction = enumOf(ENTITLEMENT_GRANT_ACTIONS);
export type EntitlementGrantAction = z.infer<typeof EntitlementGrantAction>;

export const GRANT_REASON_CODES = [
  'support_compensation',
  'promotion',
  'partner',
  'migration',
  'qa_testing',
  'dispute_resolution',
  'other',
] as const;
export const GrantReasonCode = enumOf(GRANT_REASON_CODES);
export type GrantReasonCode = z.infer<typeof GrantReasonCode>;

export const REVOKE_REASON_CODES = [
  'refund_approved',
  'chargeback',
  'chargeback_warning',
  'admin_revocation',
  'fraud',
  'account_closed',
] as const;
export const RevokeReasonCode = enumOf(REVOKE_REASON_CODES);
export type RevokeReasonCode = z.infer<typeof RevokeReasonCode>;

export const RESTORE_REASON_CODES = ['chargeback_reversed', 'admin_restore'] as const;
export const RestoreReasonCode = enumOf(RESTORE_REASON_CODES);
export type RestoreReasonCode = z.infer<typeof RestoreReasonCode>;

export const SYSTEM_REASON_CODES = [
  'purchase_completed',
  'subscription_created',
  'subscription_status_changed',
  'subscription_plan_changed',
  'subscription_cancel_scheduled',
  'subscription_cancel_unscheduled',
  'subscription_canceled',
] as const;
export const SystemReasonCode = enumOf(SYSTEM_REASON_CODES);
export type SystemReasonCode = z.infer<typeof SystemReasonCode>;

export const HOLD_KINDS = ['chargeback', 'fraud_review', 'admin'] as const;
export const HoldKind = enumOf(HOLD_KINDS);
export type HoldKind = z.infer<typeof HoldKind>;

export const USAGE_KINDS = ['unlock'] as const;
export const UsageKind = enumOf(USAGE_KINDS);
export type UsageKind = z.infer<typeof UsageKind>;

export const FAIR_USE_METRICS = ['deliveries', 'install_grants'] as const;
export const FairUseMetric = enumOf(FAIR_USE_METRICS);
export type FairUseMetric = z.infer<typeof FairUseMetric>;

// ---- 8. Access decisions -------------------------------------------------------------------------
export const ACCESS_ACTIONS = ['view_metadata', 'preview', 'download', 'install'] as const;
export const AccessAction = enumOf(ACCESS_ACTIONS);
export type AccessAction = z.infer<typeof AccessAction>;

export const DELIVERY_ACTIONS = ['download', 'install'] as const;
export type DeliveryAction = (typeof DELIVERY_ACTIONS)[number];

export const ACCESS_PHASES = ['pre_exchange', 'post_exchange'] as const;
export const AccessPhase = enumOf(ACCESS_PHASES);
export type AccessPhase = z.infer<typeof AccessPhase>;

export const ACCESS_DECISIONS = ['allow', 'deny'] as const;
export const AccessDecisionValue = enumOf(ACCESS_DECISIONS);
export type AccessDecisionValue = z.infer<typeof AccessDecisionValue>;

export const ALLOW_REASONS = ['public_catalog', 'entitled', 'entitled_grace', 'free_product', 'staff_access'] as const;
export const AllowReason = enumOf(ALLOW_REASONS);
export type AllowReason = z.infer<typeof AllowReason>;

export const DENY_REASONS = [
  'auth_required',
  'email_unverified',
  'account_banned',
  'account_closed',
  'account_restricted',
  'not_found',
  'variant_required',
  'action_not_supported',
  'variant_unavailable',
  'rights_unverified',
  'release_unavailable',
  'release_revoked',
  'no_entitlement',
  'not_in_plan',
  'entitlement_not_started',
  'entitlement_expired',
  'entitlement_revoked',
  'subscription_paused',
  'billing_past_due',
  'quota_exhausted',
  'fair_use_exceeded',
  'config_missing',
] as const;
export const DenyReason = enumOf(DENY_REASONS);
export type DenyReason = z.infer<typeof DenyReason>;

export const ACCESS_REASONS = [...ALLOW_REASONS, ...DENY_REASONS] as const;
export const AccessReason = enumOf(ACCESS_REASONS);
export type AccessReason = z.infer<typeof AccessReason>;

/** HTTP error codes that are never `access_reason` values and never come from canAccess (GLOSSARY 8.3). */
export const NON_REASON_DELIVERY_CODES = [
  'download_expired',
  'not_exchanged',
  'invalid_fetch_key',
  'rate_limited',
  'origin_rejected',
  'unsupported_media_type',
] as const;
export const NonReasonDeliveryCode = enumOf(NON_REASON_DELIVERY_CODES);
export type NonReasonDeliveryCode = z.infer<typeof NonReasonDeliveryCode>;

// ---- 9. Delivery records -------------------------------------------------------------------------
export const DOWNLOAD_KINDS = ['file_download'] as const;
export const DownloadKind = enumOf(DOWNLOAD_KINDS);
export type DownloadKind = z.infer<typeof DownloadKind>;

export const DOWNLOAD_STATUSES = ['authorized', 'exchanged', 'failed', 'expired', 'denied'] as const;
export const DownloadStatus = enumOf(DOWNLOAD_STATUSES);
export type DownloadStatus = z.infer<typeof DownloadStatus>;

export const INSTALL_STATUSES = [
  'prepared',
  'redeemed',
  'confirmed',
  'failed',
  'expired',
  'canceled',
  'denied',
] as const;
export const InstallStatus = enumOf(INSTALL_STATUSES);
export type InstallStatus = z.infer<typeof InstallStatus>;

export const DELIVERY_CHANNELS = ['web', 'mcp', 'cli'] as const;
export const DeliveryChannel = enumOf(DELIVERY_CHANNELS);
export type DeliveryChannel = z.infer<typeof DeliveryChannel>;

export const DELIVERY_FAILURE_REASONS = [
  ...DENY_REASONS,
  'object_missing',
  'stream_error',
  'client_reported_failure',
  'connection_revoked',
] as const;
export const DeliveryFailureReason = enumOf(DELIVERY_FAILURE_REASONS);
export type DeliveryFailureReason = z.infer<typeof DeliveryFailureReason>;

// ---- 10. Selection boards ------------------------------------------------------------------------
export const SELECTION_BOARD_STATUSES = ['open', 'submitted', 'expired', 'revoked'] as const;
export const SelectionBoardStatus = enumOf(SELECTION_BOARD_STATUSES);
export type SelectionBoardStatus = z.infer<typeof SelectionBoardStatus>;

export const PROPOSED_BY = ['agent', 'user'] as const;
export const ProposedBy = enumOf(PROPOSED_BY);
export type ProposedBy = z.infer<typeof ProposedBy>;

export const BOARD_CREATED_VIA = ['mcp', 'web'] as const;
export const BoardCreatedVia = enumOf(BOARD_CREATED_VIA);
export type BoardCreatedVia = z.infer<typeof BoardCreatedVia>;

// ---- 11. MCP, OAuth and the CLI ------------------------------------------------------------------
export const OAUTH_SCOPES = ['mcp:read', 'mcp:write', 'mcp:install', 'cli:install', 'offline_access'] as const;
export const OAuthScope = enumOf(OAUTH_SCOPES);
export type OAuthScope = z.infer<typeof OAuthScope>;

export const CLIENT_REGISTRATION_KINDS = ['cimd', 'dcr', 'preregistered'] as const;
export const ClientRegistrationKind = enumOf(CLIENT_REGISTRATION_KINDS);
export type ClientRegistrationKind = z.infer<typeof ClientRegistrationKind>;

export const MCP_TOOL_NAMES = [
  'search_templates',
  'search_sections',
  'get_template',
  'get_section',
  'list_categories',
  'list_recent',
  'list_favorites',
  'add_favorite',
  'remove_favorite',
  'get_my_plan',
  'get_install_allowance',
  'create_selection_board',
  'get_selection',
  'prepare_install',
  'get_install_status',
] as const;
export const McpToolName = enumOf(MCP_TOOL_NAMES);
export type McpToolName = z.infer<typeof McpToolName>;

/** MCP_PROTOCOL 5.3: tool error codes besides the deny AccessReasons. */
export const MCP_TOOL_ERROR_CODES = [
  'invalid_input',
  'insufficient_scope',
  'rate_limited',
  'selection_not_submitted',
  'mixed_install_kinds',
  'internal_error',
] as const;
export const McpToolErrorCode = enumOf(MCP_TOOL_ERROR_CODES);
export type McpToolErrorCode = z.infer<typeof McpToolErrorCode>;

export const GRANT_ENDPOINT_ERROR_CODES = ['invalid_request', 'invalid_grant', 'invalid_fetch_key'] as const;
export const GrantEndpointErrorCode = enumOf(GRANT_ENDPOINT_ERROR_CODES);
export type GrantEndpointErrorCode = z.infer<typeof GrantEndpointErrorCode>;

export const LIST_RECENT_EVENTS = ['new_product', 'new_release'] as const;
export const ListRecentEvent = enumOf(LIST_RECENT_EVENTS);
export type ListRecentEvent = z.infer<typeof ListRecentEvent>;

// ---- 12. Webhooks --------------------------------------------------------------------------------
export const WEBHOOK_EVENT_STATUSES = [
  'received',
  'processing',
  'processed',
  'superseded',
  'ignored',
  'failed',
] as const;
export const WebhookEventStatus = enumOf(WEBHOOK_EVENT_STATUSES);
export type WebhookEventStatus = z.infer<typeof WebhookEventStatus>;

export const WEBHOOK_ENTITY_TYPES = ['transaction', 'subscription', 'adjustment', 'customer', 'other'] as const;
export const WebhookEntityType = enumOf(WEBHOOK_ENTITY_TYPES);
export type WebhookEntityType = z.infer<typeof WebhookEntityType>;

export const WEBHOOK_PROVIDERS = ['paddle'] as const;
export const WebhookProvider = enumOf(WEBHOOK_PROVIDERS);
export type WebhookProvider = z.infer<typeof WebhookProvider>;

// ---- 13. Audit -----------------------------------------------------------------------------------
export const ACTOR_TYPES = [
  'visitor',
  'user',
  'staff',
  'system',
  'paddle_webhook',
  'reconciler',
  'oauth_client',
  'cli',
] as const;
export const ActorType = enumOf(ACTOR_TYPES);
export type ActorType = z.infer<typeof ActorType>;

export const AUDIT_ACTIONS = [
  'role.changed',
  'user.banned',
  'user.unbanned',
  'user.closed',
  'account_hold.placed',
  'account_hold.lifted',
  'product.created',
  'product.updated',
  'product.status_changed',
  'variant.updated',
  'variant.rights_verified',
  'variant.current_release_changed',
  'release.created',
  'release.state_changed',
  'release.published',
  'release.unpublished',
  'release.revoked',
  'asset.uploaded',
  'asset.deleted',
  'plan.created',
  'plan.updated',
  'plan.status_changed',
  'price.mapped',
  'settings.updated',
  'signing_key.added',
  'signing_key.status_changed',
  'entitlement.granted',
  'entitlement.revoked',
  'entitlement.restored',
  'install_grant.created',
  'install_grant.redeemed',
  'oauth.connection_created',
  'oauth.connection_revoked',
  'webhook.signature_rejected',
  'webhook.processing_failed',
  'checkout.created',
  'variant.created',
  'product.deleted',
  'product.pages_updated',
  'product.relationships_updated',
  'product.media_updated',
  'taxonomy.updated',
  'import.applied',
  'release.deleted',
  'release.preview_token_created',
  'webhook.retried',
  'subscription.refetched',
  'plan.inclusions_updated',
  'price.default_changed',
] as const;
export const AuditAction = enumOf(AUDIT_ACTIONS);
export type AuditAction = z.infer<typeof AuditAction>;

// ---- 14. Analytics -------------------------------------------------------------------------------
export const EVENT_SOURCES = ['client', 'server'] as const;
export const EventSource = enumOf(EVENT_SOURCES);
export type EventSource = z.infer<typeof EventSource>;

export const DEDUPE_RULES = ['none', 'once_per_subject'] as const;
export const DedupeRule = enumOf(DEDUPE_RULES);
export type DedupeRule = z.infer<typeof DedupeRule>;

export const PRIVACY_CLASSES = ['public', 'pseudonymous'] as const;
export const PrivacyClass = enumOf(PRIVACY_CLASSES);
export type PrivacyClass = z.infer<typeof PrivacyClass>;

export const OUTBOX_STATUSES = ['pending', 'sent', 'skipped_no_visitor', 'failed'] as const;
export const OutboxStatus = enumOf(OUTBOX_STATUSES);
export type OutboxStatus = z.infer<typeof OutboxStatus>;

// ---- 17. Email consent and lifecycle email (ADR-168) ---------------------------------------------
export const EMAIL_CONSENT_ACTIONS = ['granted', 'withdrawn'] as const;
export const EmailConsentAction = enumOf(EMAIL_CONSENT_ACTIONS);
export type EmailConsentAction = z.infer<typeof EmailConsentAction>;

export const EMAIL_CONSENT_SOURCES = ['signup', 'settings', 'unsubscribe_link', 'account_closed'] as const;
export const EmailConsentSource = enumOf(EMAIL_CONSENT_SOURCES);
export type EmailConsentSource = z.infer<typeof EmailConsentSource>;

export const LIFECYCLE_TRACKS = ['first_win', 'shortlist', 'paywall', 'checkout'] as const;
export const LifecycleTrack = enumOf(LIFECYCLE_TRACKS);
export type LifecycleTrack = z.infer<typeof LifecycleTrack>;

export const LIFECYCLE_SEND_STATUSES = ['sending', 'sent', 'failed'] as const;
export const LifecycleSendStatus = enumOf(LIFECYCLE_SEND_STATUSES);
export type LifecycleSendStatus = z.infer<typeof LifecycleSendStatus>;

// ---- 15. Environment -----------------------------------------------------------------------------
export const DEPLOY_ENVS = ['production', 'staging', 'development'] as const;
export const DeployEnv = enumOf(DEPLOY_ENVS);
export type DeployEnv = z.infer<typeof DeployEnv>;

// ---- Variant kind capabilities (GLOSSARY 4.4) ----------------------------------------------------
/** Delivery actions each variant kind supports. `preview` is offered only for installable kinds (live preview). */
export const VARIANT_KIND_ACTIONS: Readonly<Record<VariantKind, readonly AccessAction[]>> = {
  astro_project: ['preview', 'download', 'install'],
  astro_section: ['preview', 'download', 'install'],
  asset_pack: ['download'],
};

/** Which product kinds a variant kind may belong to (GLOSSARY 4.4 "Allowed on"). */
export const VARIANT_KIND_PRODUCT_KINDS: Readonly<Record<VariantKind, readonly ProductKind[]>> = {
  astro_project: ['template'],
  astro_section: ['section'],
  asset_pack: ['template', 'section'],
};

export function variantKindSupports(kind: VariantKind, action: AccessAction): boolean {
  return VARIANT_KIND_ACTIONS[kind].includes(action);
}

export function installableKindFor(productKind: ProductKind): InstallableVariantKind {
  return productKind === 'template' ? 'astro_project' : 'astro_section';
}
