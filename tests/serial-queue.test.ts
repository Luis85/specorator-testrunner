import { describe, expect, it } from "vitest";
import { KeyedSerialQueue, SerialQueue } from "../src/shared/async/serial-queue";

const deferred = <T>() => {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
};

describe("SerialQueue", () => {
  it("runs tasks strictly in order — a queued task cannot start before the previous settles", async () => {
    const queue = new SerialQueue();
    const order: string[] = [];
    const gate = deferred<undefined>();
    const first = queue.run(async () => {
      order.push("first:start");
      await gate.promise;
      order.push("first:end");
    });
    const second = queue.run(async () => {
      order.push("second");
    });
    await Promise.resolve();
    expect(order).toEqual(["first:start"]);
    gate.resolve(undefined);
    await Promise.all([first, second]);
    expect(order).toEqual(["first:start", "first:end", "second"]);
  });

  it("survives a failing task: the failure reaches its caller, the next task still runs", async () => {
    const queue = new SerialQueue();
    const failing = queue.run(async () => {
      throw new Error("boom");
    });
    const next = queue.run(async () => "ran");
    await expect(failing).rejects.toThrow("boom");
    await expect(next).resolves.toBe("ran");
  });

  it("whenSettled resolves only after the queued tail settles (including failures)", async () => {
    const queue = new SerialQueue();
    let done = false;
    const gate = deferred<undefined>();
    // Fire-and-forget callers own their rejections (see SerialQueue.run docs).
    queue
      .run(async () => {
        await gate.promise;
        throw new Error("still counts as settled");
      })
      .catch(() => undefined);
    void queue.run(async () => {
      done = true;
    });
    const settled = queue.whenSettled().then(() => done);
    gate.resolve(undefined);
    await expect(settled).resolves.toBe(true);
  });

  it("a queued task never observes the previous task's value or rejection", async () => {
    const queue = new SerialQueue();
    void queue.run(async () => "leaky value");
    const observed: unknown[] = [];
    await queue.run(async (...args: unknown[]) => {
      observed.push(...args);
    });
    expect(observed).toEqual([]);
  });
});

describe("KeyedSerialQueue", () => {
  it("serializes per key while other keys proceed independently", async () => {
    const queues = new KeyedSerialQueue();
    const order: string[] = [];
    const gate = deferred<undefined>();
    const a1 = queues.run("a", async () => {
      await gate.promise;
      order.push("a1");
    });
    const a2 = queues.run("a", async () => {
      order.push("a2");
    });
    const b1 = queues.run("b", async () => {
      order.push("b1");
    });
    await b1;
    expect(order).toEqual(["b1"]);
    gate.resolve(undefined);
    await Promise.all([a1, a2]);
    expect(order).toEqual(["b1", "a1", "a2"]);
  });

  it("whenSettled on an unknown key resolves immediately; delete drops a key's queue", async () => {
    const queues = new KeyedSerialQueue();
    await expect(queues.whenSettled("none")).resolves.toBeUndefined();
    await queues.run("k", async () => undefined);
    queues.delete("k");
    await expect(queues.whenSettled("k")).resolves.toBeUndefined();
  });
});
