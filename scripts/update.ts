import { resolve } from "node:path";

const root = resolve(import.meta.dir, "..");
const args = process.argv.slice(2);
if (args.length > 1 || args[0]?.startsWith("-")) {
  throw new Error("Usage: bun run update [3ds-ip] (Pocket Map must be running)");
}
async function run(args: string[]): Promise<void> {
  const child = Bun.spawn([process.execPath, ...args], { cwd: root, stdin: "inherit", stdout: "inherit", stderr: "inherit" });
  if (await child.exited !== 0) throw new Error(`Command failed: ${args[0]}`);
}
await run(["scripts/build.ts", "--pocket-only"]);
await run(["runtime/tools/3ds-dev.ts", "push", "--package", resolve(root, "dist/pocketmap-main.pocket"),
  ...(args[0] ? ["--host", args[0]] : [])]);
