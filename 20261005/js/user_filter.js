/**
 * Client-side user exclusion for CTR reports + admin board overlay (no Firebase writes).
 *
 * Storage: localStorage key `ctr_user_filter_excluded_keys_<SHOW_DATE_SLUG>` — JSON string array
 * of Firebase claim child keys (e.g. id_…, sanitized identity) to omit from aggregations and admin UI.
 * Empty array / missing key = include everyone.
 *
 * Usage: load before app inline script. Read/write via CtrUserFilter.* — see filterClaims,
 * getExcludedKeysSet, saveExcludedKeysSet, collectUniqueUsers.
 */
(function (global) {
    var STORAGE_PREFIX = "ctr_user_filter_excluded_keys_";

    function storageKeyForSlug(slug) {
        return STORAGE_PREFIX + String(slug || "");
    }

    function getExcludedKeysSet(slug) {
        try {
            var raw = global.localStorage.getItem(storageKeyForSlug(slug));
            if (!raw) return new Set();
            var arr = JSON.parse(raw);
            return new Set(Array.isArray(arr) ? arr : []);
        } catch (e) {
            return new Set();
        }
    }

    function saveExcludedKeysSet(slug, set) {
        var keys = set instanceof Set ? Array.from(set) : Array.isArray(set) ? set.slice() : [];
        global.localStorage.setItem(storageKeyForSlug(slug), JSON.stringify(keys));
    }

    function truncateUserKey(uid) {
        var s = String(uid);
        if (s.length <= 28) return s;
        return s.slice(0, 14) + "…" + s.slice(-10);
    }

    /** @param {Record<string, Record<string, unknown>>} claims pinKey -> uid -> meta */
    function collectUniqueUsers(claims) {
        var byKey = Object.create(null);
        Object.keys(claims || {}).forEach(function (pinKey) {
            var users = claims[pinKey];
            if (!users || typeof users !== "object") return;
            Object.keys(users).forEach(function (uid) {
                if (byKey[uid]) return;
                var meta = users[uid];
                var label = "";
                if (meta && typeof meta === "object" && meta.label != null) label = String(meta.label).trim();
                byKey[uid] = { userKey: uid, label: label || truncateUserKey(uid) };
            });
        });
        return Object.keys(byKey)
            .map(function (k) {
                return byKey[k];
            })
            .sort(function (a, b) {
                return a.userKey.localeCompare(b.userKey);
            });
    }

    /** Remove excluded uid children from each pin; drops pin entries with zero users left. */
    function filterClaims(claims, excludedSet) {
        if (!excludedSet || excludedSet.size === 0) return claims || {};
        var out = {};
        Object.keys(claims || {}).forEach(function (pinKey) {
            var users = claims[pinKey];
            if (!users || typeof users !== "object") {
                out[pinKey] = users;
                return;
            }
            var filtered = {};
            Object.keys(users).forEach(function (uid) {
                if (!excludedSet.has(uid)) filtered[uid] = users[uid];
            });
            if (Object.keys(filtered).length > 0) out[pinKey] = filtered;
        });
        return out;
    }

    /** Single-pin map: same as filterClaims but for one users object (mutates nothing). */
    function filterUsersOnPin(users, excludedSet) {
        if (!excludedSet || excludedSet.size === 0) return users || {};
        if (!users || typeof users !== "object") return users || {};
        var o = {};
        Object.keys(users).forEach(function (uid) {
            if (!excludedSet.has(uid)) o[uid] = users[uid];
        });
        return o;
    }

    global.CtrUserFilter = {
        storageKeyForSlug: storageKeyForSlug,
        getExcludedKeysSet: getExcludedKeysSet,
        saveExcludedKeysSet: saveExcludedKeysSet,
        collectUniqueUsers: collectUniqueUsers,
        filterClaims: filterClaims,
        filterUsersOnPin: filterUsersOnPin,
        truncateUserKey: truncateUserKey
    };
})(typeof window !== "undefined" ? window : globalThis);
