export type Bindings = {
  DB: D1Database;
  BUCKET: R2Bucket;
  ASSETS: Fetcher;
  APP_NAME: string;
  PUBLIC_BASE_URL: string;
  FROM_EMAIL: string;
  STAFF_ALERT_EMAILS: string;
  STAFF_EMAILS: string;
  SHIP_TO_NAME: string;
  SHIP_TO_ADDRESS: string;
  OFFER_TTL_DAYS: string;
  MAX_PHOTOS: string;
  MAX_PHOTO_BYTES: string;
  ENVIRONMENT: string;
  INVITE_CODE?: string;
  NOREPLY_EMAIL?: string;
  DEV_ADMIN_EMAIL?: string;
  SIGHTENGINE_USER?: string;
  SIGHTENGINE_SECRET?: string;
  GOOGLE_VISION_API_KEY?: string;
  RESEND_API_KEY?: string;
};

export type Status =
  | "uploading"
  | "submitted"
  | "pricing"
  | "offer_sent"
  | "accepted"
  | "paid"
  | "waiting_for_package"
  | "received"
  | "done"
  | "declined"
  | "withdrawn";

export type CollectionRow = {
  id: string;
  status: Status;
  seller_name: string;
  seller_email: string;
  paypal_gs_email: string;
  instagram: string | null;
  accepted_terms_at: string;
  cover_photo_id: string | null;
  overlay_url: string | null;
  harness_total_cents: number | null;
  offer_cents: number | null;
  offer_sent_at: string | null;
  offer_expires_at: string | null;
  offer_token: string | null;
  internal_note: string | null;
  decline_reason: string | null;
  decline_wanted_cents: number | null;
  decline_detail: string | null;
  tracking: string | null;
  photo_count: number;
  created_at: string;
  updated_at: string;
};

export type PhotoRow = {
  id: string;
  collection_id: string;
  kind: string;
  r2_key: string;
  original_filename: string | null;
  content_type: string | null;
  size_bytes: number | null;
  sha256: string | null;
  moderation_status: string;
  created_at: string;
};
