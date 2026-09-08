/** Capture real GE framebuffers at smoke-driver checkpoints via PSPLINK. */
import { readdirSync, readFileSync, mkdirSync, statSync } from "node:fs";
import { resolve } from "node:path";
const root = resolve(import.meta.dir, ".."),
  mail = resolve(root, "dist/psplink/pocket-offload/c7771f0167312c63"),
  out = resolve(root, "dist/qa/psp");
mkdirSync(out, { recursive: true });
const started = Date.now();
const seen = new Set<string>();
let done = false;
let capturing = false;
const timer = setInterval(async () => {
  if (capturing || done) return;
  capturing = true;
  try {
    for (const name of readdirSync(mail).filter((n) => /^req[0-7]$/.test(n))) {
      try {
        if (statSync(resolve(mail, name)).mtimeMs < started) continue;
        const b = readFileSync(resolve(mail, name));
        const q = JSON.parse(b.toString("utf8", 64)),
          payload = JSON.parse(q.payload);
        if (!payload.qa || seen.has(payload.qa)) continue;
        seen.add(payload.qa);
        console.log(payload.qa);
        const stage = String(payload.qa).replace(/[^a-z0-9-]/gi, "-");
        await Bun.sleep(200);
        await Bun.spawn(["pspsh", "-e", "thsusp @pocketjs_main"], {
          stdout: "ignore",
        }).exited;
        try {
          await Bun.sleep(25);
          const shot = Bun.spawn(
            ["pspsh", "-e", `scrshot host0:/qa-${stage}.bmp`],
            { stdout: "ignore", stderr: "inherit" },
          );
          if (await shot.exited) throw Error("PSP screenshot failed");
        } finally {
          await Bun.spawn(["pspsh", "-e", "thresm @pocketjs_main"], {
            stdout: "ignore",
          }).exited;
        }
        const png = Bun.spawn(
          [
            "sips",
            "-s",
            "format",
            "png",
            resolve(root, `dist/psplink/qa-${stage}.bmp`),
            "--out",
            resolve(out, `${stage}.png`),
          ],
          { stdout: "ignore", stderr: "inherit" },
        );
        await png.exited;
        await Bun.write(
          resolve(out, "smoke.json"),
          JSON.stringify(
            { checkpoints: [...seen], time: new Date().toISOString() },
            null,
            2,
          ),
        );
        if (stage === "done" || stage.startsWith("FAILED")) {
          done = true;
          clearInterval(timer);
        }
      } catch {}
    }
  } finally {
    capturing = false;
  }
}, 40);
setTimeout(() => {
  if (!done) {
    clearInterval(timer);
    console.error("Smoke capture deadline");
    process.exitCode = 1;
  }
}, 240000).unref();
