import { describe, expect, it, vi } from "vitest";
import { withNonEmptyList } from "../src/presentation/commands/with-non-empty-list";
import { appError } from "../src/shared/errors/errors";
import { err, ok } from "../src/shared/result/result";

const notices = { loadError: "Could not load", empty: "Nothing yet." };

describe("withNonEmptyList", () => {
  it("hands the non-empty list to onItems", async () => {
    const onItems = vi.fn();
    await withNonEmptyList<number>(Promise.resolve(ok([1, 2, 3])), notices, onItems);
    expect(onItems).toHaveBeenCalledTimes(1);
    expect(onItems).toHaveBeenCalledWith([1, 2, 3]);
  });

  it("notifies and skips onItems when the load fails", async () => {
    const onItems = vi.fn();
    await withNonEmptyList<number>(
      Promise.resolve(err(appError("VALIDATION_FAILED", "boom"))),
      notices,
      onItems,
    );
    expect(onItems).not.toHaveBeenCalled();
  });

  it("notifies and skips onItems when the list is empty", async () => {
    const onItems = vi.fn();
    await withNonEmptyList<number>(Promise.resolve(ok([])), notices, onItems);
    expect(onItems).not.toHaveBeenCalled();
  });
});
