import { describe, expect, it } from "vitest";
import { RunnerTemplateWriter } from "../src/infrastructure/runner/runner-template-writer";
import { unsafeVaultPath as vp } from "../src/domain/value-objects/vault-path";
import { FakeAbsoluteFileSystem } from "./fakes";

const request = {
  targetPath: vp(".testrunner"),
  templates: [
    { path: vp("package.json"), content: "managed", overwrite: true },
    { path: vp("src/steps/example.steps.ts"), content: "user", overwrite: false },
  ],
};

describe("RunnerTemplateWriter", () => {
  it("writes templates under the resolved vault base path", async () => {
    const fs = new FakeAbsoluteFileSystem();
    fs.basePath = "/vault";
    const writer = new RunnerTemplateWriter(fs);

    const result = await writer.writeTemplates(request);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.writtenFiles).toEqual([
      ".testrunner/package.json",
      ".testrunner/src/steps/example.steps.ts",
    ]);
    expect(fs.written.get("/vault/.testrunner/package.json")).toBe("managed");
  });

  it("skips existing files that must not be overwritten (repair safety)", async () => {
    const fs = new FakeAbsoluteFileSystem();
    fs.basePath = "/vault";
    fs.existing.add("/vault/.testrunner/src/steps/example.steps.ts");
    const writer = new RunnerTemplateWriter(fs);

    const result = await writer.writeTemplates(request);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.writtenFiles).toEqual([".testrunner/package.json"]);
    expect(result.value.skippedFiles).toEqual([".testrunner/src/steps/example.steps.ts"]);
    // The managed package.json is overwritten even though it already exists.
    fs.existing.add("/vault/.testrunner/package.json");
    expect((await writer.writeTemplates(request)).ok).toBe(true);
  });

  it("fails when the vault base path is unavailable", async () => {
    const fs = new FakeAbsoluteFileSystem();
    fs.basePath = null;
    expect((await new RunnerTemplateWriter(fs).writeTemplates(request)).ok).toBe(false);
  });
});
