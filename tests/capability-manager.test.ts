import { describe, it, expect } from "vitest";
import { CapabilityManager } from "../src/core/capability-manager";

describe("CapabilityManager", () => {
  it("should grant valid capabilities", () => {
    const cm = new CapabilityManager();
    cm.registerCapability("storage", { read: true, write: false });
    const result = cm.grantCapabilities(["storage"], "plugin-A");
    expect(result[0].granted).toBe(true);
  });
});
