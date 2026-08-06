/**
 * Offerables15 character review — Firebase config.
 *
 * Same Firebase *project* as CTR (fins-and-pins-click-to-claim), but writes ONLY to:
 *   pin_title_review/shows/offerables15/...
 *
 * Never claims/, showConfig/, feedback/, or pin_pricing_*.
 */
window.PIN_TITLE_REVIEW_FIREBASE = {
  enabled: true,
  projectId: "fins-and-pins-click-to-claim",
  databaseURL: "https://fins-and-pins-click-to-claim-default-rtdb.firebaseio.com",
};
