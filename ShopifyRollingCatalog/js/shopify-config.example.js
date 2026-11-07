// Copy to shopify-config.js and fill in after Phase A / Headless channel setup.
// Never put Admin API secrets here. Public Storefront token only.
window.FP_SHOPIFY_CONFIG = {
  enabled: false,
  shopDomain: "YOUR_STORE.myshopify.com",
  storefrontAccessToken: "YOUR_PUBLIC_STOREFRONT_TOKEN",
  apiVersion: "2025-10",
  // Optional: force mock even if token is set
  forceMock: false
};
