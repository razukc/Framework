import { describe, it, expect, beforeEach } from "vitest";
import { PluginManager } from "../src/core/plugin-manager";

describe("PluginManager", () => {
  let manager: PluginManager;

  beforeEach(() => {
    manager = new PluginManager({});
  });

  it("should register a plugin", async () => {
    const plugin = { name: "test-plugin", install: vi.fn() };
    await manager.use(plugin);
    expect(manager.getPlugin("test-plugin")).toBeDefined();
  });

  it("should throw for duplicate registration", async () => {
    const plugin = { name: "test-plugin", install: vi.fn() };
    await manager.use(plugin);
    await expect(manager.use(plugin)).rejects.toThrow();
  });
});
