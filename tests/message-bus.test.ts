import { describe, it, expect, beforeEach, vi } from "vitest";
import { MessageBus } from "../src/core/message-bus";

describe("MessageBus", () => {
  let bus: MessageBus;

  beforeEach(() => {
    bus = new MessageBus();
  });

  it("should allow subscribing and publishing messages", async () => {
    const handler = vi.fn();
    bus.subscribe("topic:test", "Test Topic", handler);
    await bus.publish("topic:test", "Test Topic", { payload: 42 });
    expect(handler).toHaveBeenCalledWith({ payload: 42 });
  });

  it("should match wildcard topics", async () => {
    const handler = vi.fn();
    bus.subscribe("topic:*", "Wildcard Topic", handler);
    await bus.publish("topic:demo", "Demo Topic", {});
    expect(handler).toHaveBeenCalled();
  });
});
