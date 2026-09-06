import { test, expect } from "bun:test";
import { createServer, type Socket } from "node:net";
import { createCanvas } from "@napi-rs/canvas";
import { connectOffloadProvider } from "@pocketjs/framework/offload/provider";
import { encodeOffloadRecord } from "../runtime/tools/offload-wire.ts";
import { defaultConfig } from "../host/config.ts";
function queue<T>() {
  const items: T[] = [], waits: ((value: T) => void)[] = [];
  return { push(v: T) { const take = waits.shift(); if (take) take(v); else items.push(v); },
    take(): Promise<T> { return items.length ? Promise.resolve(items.shift()!) : new Promise(resolve => waits.push(resolve)); } };
}
test("actual map provider reconnects during PNG fetch and returns intact image pixels in a fresh process", async () => {
  const canvas = createCanvas(256, 256), ctx = canvas.getContext("2d"); ctx.fillStyle = "red"; ctx.fillRect(0, 0, 256, 256);
  const png = canvas.toBuffer("image/png"), fetched = queue<void>(); let hold = true;
  const http = Bun.serve({ hostname: "127.0.0.1", port: 0, async fetch() { fetched.push(); if (hold) await Bun.sleep(250); return new Response(png); } });
  const peers = queue<{ socket: Socket; read(): Promise<Buffer>; send(method: string, id: number, payload?: unknown, image?: boolean): void }>();
  const sockets = new Set<Socket>();
  const server = createServer(socket => {
    sockets.add(socket); socket.on("close", () => sockets.delete(socket)); socket.on("error", () => {});
    let paired = false, buffer = Buffer.alloc(0); const replies = queue<Buffer>();
    socket.on("data", bytes => {
      buffer = Buffer.concat([buffer, Buffer.from(bytes)]);
      if (!paired) {
        if (buffer.length < 64) return;
        expect(buffer.subarray(0, 64).toString()).toBe("ab".repeat(32)); buffer = buffer.subarray(64); paired = true;
        peers.push({ socket, read: replies.take, send(method, id, payload = {}, image = false) { socket.write(encodeOffloadRecord(JSON.stringify({ v: 1, id, method, payload: JSON.stringify(payload), ...(image ? { response: "image" } : {}) }))); } });
      }
      while (buffer.length >= 4) {
        const length = buffer.readUInt32BE() & 0x7fffffff; expect(length).toBeLessThanOrEqual(131088);
        if (buffer.length < length + 4) break;
        replies.push(buffer.subarray(4, length + 4)); buffer = buffer.subarray(length + 4);
      }
    });
  });
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  const provider = connectOffloadProvider({ address: "127.0.0.1", port: (server.address() as { port: number }).port,
    key: "ab".repeat(32), isolation: "process", worker: new URL("../host/worker.ts", import.meta.url),
    data: { ...defaultConfig, tileURL: `${http.url}{z}/{x}/{y}.png`, searchURL: String(http.url), cache: ":memory:" } });
  try {
    for (let n = 0; n < 3; n++) {
      const peer = await peers.take(); peer.send("map.info", 1); const info = JSON.parse(JSON.parse((await peer.read()).toString()).payload);
      peer.send("map.tile", 2, { source: info.source, z: 1, x: 0, y: 0 }, true); await fetched.take(); peer.socket.destroy();
    }
    hold = false;
    const peer = await peers.take(); peer.send("map.info", 1); const info = JSON.parse(JSON.parse((await peer.read()).toString()).payload);
    peer.send("map.tile", 2, { source: info.source, z: 1, x: 0, y: 0 }, true);
    const image = await peer.read(); expect(image.length).toBe(131088); expect(image.subarray(0, 4).toString()).toBe("PIMG"); expect(image.readUInt32LE(4)).toBe(2);
    for (let i = 16; i < image.length; i += 2) if (image[i] !== 31 || image[i + 1] !== 0) throw new Error(`Corrupted RGB565 pixel at ${i}`);
  } finally { provider.close(); for (const socket of sockets) socket.destroy(); await new Promise<void>(resolve => server.close(() => resolve())); http.stop(true); }
}, 12000);
