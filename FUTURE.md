# Future development

Ideas and planned enhancements for Click To Request (and related tools). Not committed to a release date.

---

## Cross-device “My requests” (username + short pairing code)

**Goal:** Let someone see the same pin selections on a second phone or tablet without losing their queue, using their whatnot username plus a short code tied to their existing anonymous id.

**Proposed flow**

1. **First device (unchanged core):** User enters their whatnot username as now. The app already stores a random `fp_identity` in `localStorage` and uses it as the Firebase user key under each pin.
2. **Surface a short code:** Show the **last 4 characters** (or digits) of that identity next to their username in the UI so they can write it down or remember it.
3. **Second device:** On the login screen, add something like **“I already set this up on another device”** → prompt for **same username** + **4-character code** → look up or reconstruct the pairing so the app uses the **same** underlying identity as the first device (same Firebase paths as before).

**Thoughts / design notes**

- **Fits the current model:** Claims are already stored per `identityKey`; the missing piece is letting a new browser adopt an existing key instead of always minting a new one.
- **You’ll need a lookup or verification step:** Today only the **full** sanitized key appears in Firebase paths. Options include (a) storing a small `devices/{sanitizedKey}` or `pairing/{shortCode}` map in RTDB (written once from device A), (b) deriving the key deterministically from username+code (usually weaker), or (c) a short-lived server/Cloud Function that validates code and returns the canonical key—stronger, more work.
- **Security / abuse:** A 4-character code from a limited alphabet has a small space; anyone who guesses username + code could impersonate that viewer. Mitigations: longer code (e.g. 6–8), rate limits, short expiry for pairing, or “confirm on first device” if you add push/email later. For a low-stakes show tool, you may accept the risk with clear UX (“treat this like a PIN”).
- **UX detail:** Normalize username the same way on both devices (e.g. `@handle`, case rules) so pairing doesn’t fail on typos.

---

## More ideas (placeholder)

_Add additional bullets here as you go._
