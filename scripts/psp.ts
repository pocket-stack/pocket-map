import { mkdirSync, copyFileSync } from "node:fs";
import { resolve } from "node:path";
const root = resolve(import.meta.dir, ".."),
  runtime = resolve(process.env.POCKETJS_RUNTIME ?? resolve(root, "runtime")),
  out = resolve(root, "dist/psp");
const { validateAndResolveBuildPlan } = await import(
  `${runtime}/framework/src/manifest/resolve.ts`
);
const result = validateAndResolveBuildPlan(
  await Bun.file(resolve(root, "pocket.psp.json")).json(),
  { target: "psp" },
);
if (!result.ok) throw Error(JSON.stringify(result.diagnostics));
mkdirSync(out, { recursive: true });
const plan = resolve(out, "plan.json");
await Bun.write(plan, JSON.stringify(result.plan, null, 2));
const smoke = process.argv.includes("--smoke");
if (smoke) {
  const build = Bun.spawn(
    [
      process.execPath,
      `${runtime}/tools/build.ts`,
      `--plan=${plan}`,
      `--project-root=${root}`,
      `--outdir=${out}`,
    ],
    { cwd: runtime, stdout: "inherit", stderr: "inherit" },
  );
  if (await build.exited) process.exit(1);
  const bundle = resolve(out, "pocketmap-psp.js");
  await Bun.write(
    bundle,
    (await Bun.file(bundle).text()) +
      "\n" +
      (await Bun.file(resolve(root, "scripts/psp-smoke.js")).text()),
  );
}
const child = Bun.spawn(
  [
    process.execPath,
    `${runtime}/tools/psp.ts`,
    `--plan=${plan}`,
    `--project-root=${root}`,
    `--outdir=${out}`,
    "--release",
    ...(smoke ? ["--skip-build", "--capture"] : []),
    ...process.argv.slice(2).filter((a) => a !== "--smoke"),
  ],
  {
    env: {
      ...process.env,
      ...(smoke ? { POCKETJS_CAPTURE_INPUT: "0:0", POCKETJS_CAP_N: "0" } : {}),
    },
    cwd: runtime,
    stdin: "inherit",
    stdout: "inherit",
    stderr: "inherit",
  },
);
if (await child.exited) process.exit(1);
const target = resolve(runtime, "hosts/psp/target/mipsel-sony-psp/release");
mkdirSync(resolve(root, "dist/psplink"), { recursive: true });
copyFileSync(
  resolve(target, "pocketjs-psp.prx"),
  resolve(root, "dist/psplink/pocket-map.prx"),
);
copyFileSync(resolve(target, "EBOOT.PBP"), resolve(out, "EBOOT.PBP"));
