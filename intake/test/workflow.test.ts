import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { addDaysIso, canStaffMove, offerExpired, staffNextStatuses } from "../src/workflow.ts";
import { centsToDollars, offerHelpers, parseDollarsToCents } from "../src/money.ts";

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
});
