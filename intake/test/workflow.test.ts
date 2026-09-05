import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { addDaysIso, canStaffMove, offerDueLabel, offerExpired, staffNextStatuses } from "../src/workflow.ts";
import { centsToDollars, offerHelpers, parseDollarsToCents } from "../src/money.ts";
import { inviteGateEnabled, presentedInviteMatches } from "../src/invite.ts";

describe("money", () => {
  it("parses dollars to cents", () => {
    assert.equal(parseDollarsToCents("120"), 12000);
    assert.equal(parseDollarsToCents("$1,250"), 125000);
    assert.equal(parseDollarsToCents(""), null);
    assert.equal(parseDollarsToCents("-5"), null);
  });
  it("formats helpers", () => {
    const h = offerHelpers(100000);
    assert.ok(h);
    assert.equal(h.p50, 50000);
    assert.equal(centsToDollars(50000), "$500");
  });
});

describe("workflow", () => {
  it("allows pay-before-ship staff moves", () => {
    assert.deepEqual(staffNextStatuses("accepted"), ["paid", "withdrawn"]);
    assert.equal(canStaffMove("accepted", "paid"), true);
    assert.equal(canStaffMove("submitted", "paid"), false);
  });
  it("detects expired offers", () => {
    assert.equal(offerExpired("2000-01-01T00:00:00.000Z"), true);
    assert.equal(offerExpired(addDaysIso(7)), false);
  });
  it("shows 24h offer due on new submissions", () => {
    assert.equal(offerDueLabel(new Date().toISOString(), "submitted")?.endsWith("to send offer"), true);
    assert.equal(offerDueLabel(new Date().toISOString(), "offer_sent"), null);
  });
});

describe("invite", () => {
  it("is closed in production even without a code", () => {
    assert.equal(inviteGateEnabled({ ENVIRONMENT: "production" }), true);
    assert.equal(presentedInviteMatches({ ENVIRONMENT: "production" }, "guess"), false);
  });
  it("is open in development when no code is set", () => {
    assert.equal(inviteGateEnabled({ ENVIRONMENT: "development" }), false);
    assert.equal(presentedInviteMatches({ ENVIRONMENT: "development" }, undefined), true);
  });
  it("checks the code when set", () => {
    const env = { ENVIRONMENT: "development", INVITE_CODE: "secret" };
    assert.equal(presentedInviteMatches(env, "secret"), true);
    assert.equal(presentedInviteMatches(env, "nope"), false);
  });
});
