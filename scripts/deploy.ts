import { randomBytes, createHash } from "node:crypto";
import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
const address = process.argv[2] ?? "192.168.8.102";
const benchmark = process.argv.includes("--benchmark");
const artifact = benchmark ? "runtime/dist/3ds/pocketmap-sd-benchmark.3dsx" : "dist/pocketmap-main.3dsx";
const filename = benchmark ? "pocketmap-sd-benchmark.3dsx" : "pocketmap-main.3dsx";
const bytes = readFileSync(artifact);
if (bytes.includes(Buffer.from("pocketjs-captures"))) throw new Error("Rebuild without capture before device deployment");
mkdirSync(".local", { recursive: true });
if (!existsSync(".local/pair.key")) writeFileSync(".local/pair.key", randomBytes(32).toString("hex"), { mode: 0o600, flag: "wx" });
chmodSync(".local/pair.key", 0o600);
const manifest = await Bun.file("pocket.json").json();
const slot = createHash("sha256").update(manifest.id).digest("hex").slice(0, 16);
const script = `import ftplib, hashlib, io, json, pathlib, sys
ftp=ftplib.FTP(); ftp.connect(sys.argv[1],5000,timeout=20); ftp.login()
for path in ['/3DS','/pocketjs','/pocketjs/offload']:
    try: ftp.mkd(path)
    except ftplib.error_perm as error:
        if not str(error).startswith('550'): raise
receipt=[]
for local,remote in [('.local/pair.key','/pocketjs/offload/'+sys.argv[2]+'.key'),(sys.argv[3],'/3DS/'+sys.argv[4])]:
    data=pathlib.Path(local).read_bytes()
    ftp.storbinary('STOR '+remote,io.BytesIO(data),blocksize=65536)
    read=io.BytesIO(); ftp.retrbinary('RETR '+remote,read.write)
    assert read.getvalue()==data,'FTP readback mismatch'
    receipt.append({'path':remote,'bytes':len(data),'verified':True,**({'sha256':hashlib.sha256(data).hexdigest()} if local.endswith('.3dsx') else {})})
ftp.quit(); print(json.dumps(receipt,indent=2))
`;
const result = Bun.spawnSync(["python3", "-c", script, address, slot, artifact, filename], { stdout: "pipe", stderr: "pipe" });
if (result.exitCode) throw new Error(result.stderr.toString());
mkdirSync("dist/qa", { recursive: true });
await Bun.write(benchmark ? "dist/qa/deploy-benchmark.json" : "dist/qa/deploy.json", result.stdout); console.log(result.stdout.toString());
