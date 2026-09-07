import { describe, expect, it, vi } from "vitest";

import { claimReliabilityAutofixIdempotently } from "./reliabilityAutofixClaim";

describe("claimReliabilityAutofixIdempotently", () => {
  it("reuses an existing claim without mutating the queue again", async () => {
    const findExisting = vi.fn().mockResolvedValue({ id: "job-existing" });
    const claimFresh = vi.fn();

    const result = await claimReliabilityAutofixIdempotently({
      findExisting,
      claimFresh,
    });

    expect(result).toEqual({ job: { id: "job-existing" }, recovered: true });
    expect(claimFresh).not.toHaveBeenCalled();
  });

  it("returns a normal fresh claim when the RPC response succeeds", async () => {
    const findExisting = vi.fn().mockResolvedValue(null);
    const claimFresh = vi.fn().mockResolvedValue({ id: "job-fresh" });

    const result = await claimReliabilityAutofixIdempotently({
      findExisting,
      claimFresh,
    });

    expect(result).toEqual({ job: { id: "job-fresh" }, recovered: false });
    expect(findExisting).toHaveBeenCalledTimes(1);
  });

  it("recovers the same run claim after an ambiguous claim timeout", async () => {
    const findExisting = vi
      .fn()
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({ id: "job-committed-before-timeout" });
    const claimFresh = vi.fn().mockRejectedValue(new Error("OPS_SUPABASE_REST_TIMEOUT"));

    const result = await claimReliabilityAutofixIdempotently({
      findExisting,
      claimFresh,
    });

    expect(result).toEqual({
      job: { id: "job-committed-before-timeout" },
      recovered: true,
    });
    expect(claimFresh).toHaveBeenCalledTimes(1);
    expect(findExisting).toHaveBeenCalledTimes(2);
  });

  it("rechecks ownership when the mutating RPC returns an ambiguous null", async () => {
    const findExisting = vi
      .fn()
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({ id: "job-after-null" });
    const claimFresh = vi.fn().mockResolvedValue(null);

    const result = await claimReliabilityAutofixIdempotently({
      findExisting,
      claimFresh,
    });

    expect(result).toEqual({ job: { id: "job-after-null" }, recovered: true });
  });

  it("does not blindly retry the mutating claim RPC when recovery finds nothing", async () => {
    const timeout = new Error("OPS_SUPABASE_REST_TIMEOUT");
    const findExisting = vi.fn().mockResolvedValue(null);
    const claimFresh = vi.fn().mockRejectedValue(timeout);

    await expect(
      claimReliabilityAutofixIdempotently({ findExisting, claimFresh }),
    ).rejects.toBe(timeout);

    expect(claimFresh).toHaveBeenCalledTimes(1);
    expect(findExisting).toHaveBeenCalledTimes(2);
  });

  it("aborts before claiming when the ownership preflight itself is unavailable", async () => {
    const findExisting = vi.fn().mockRejectedValue(new Error("preflight unavailable"));
    const claimFresh = vi.fn();

    await expect(
      claimReliabilityAutofixIdempotently({ findExisting, claimFresh }),
    ).rejects.toThrow("preflight unavailable");

    expect(claimFresh).not.toHaveBeenCalled();
  });
});
