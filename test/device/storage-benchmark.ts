import type { MapModel } from "../../app/model.ts";

const route = [
  [107.733333, 168, 4],
  [145, 101, 6],
  [128, 128, 7],
  [64, 64, 5],
] as const;
export function createStorageBenchmark(
  map: () => MapModel | undefined,
  setLabel: (label: string) => void,
  nowMilliseconds = Date.now,
) {
  let initializedStage = -1;
  let stage = 0,
    frames = 0,
    started = 0,
    awaiting = false,
    finished = false,
    before = "";
  let panning = false,
    previous = 0,
    fallbackFrames = 0,
    over20ms = 0,
    distance = 0;
  return () => {
    const s = map();
    if (!s || finished) return;
    if (initializedStage >= 0 && !s.online()) {
      finished = true;
      setLabel("Storage test: disconnected");
      return;
    }
    if (!s.info() || !s.online() || s.switching() || awaiting) return;
    if (!s.planar()) {
      s.switchMap("hyrule");
      return;
    }
    const local = stage % 2 === 0,
      pan = stage >= 8,
      point = pan ? ([72, 160, 6] as const) : route[Math.floor(stage / 2)]!;
    if (initializedStage !== stage) {
      initializedStage = stage;
      s.annotations.setLayer("off");
      s.setLocalTiles(local);
      s.clearBack();
      s.camera.jump(point[0], point[1], point[2]);
      started = nowMilliseconds();
      before = s.diagnostics().pack ?? "";
      setLabel(
        `${local ? "SD" : "Mac"} ${pan ? "pan" : "load"} test ${stage + 1}/10`,
      );
    }
    frames++;
    // Ignore the previous front layer during the first camera reconciliation.
    const visible = s.front()?.tiles ?? [];
    const ready = visible.filter(
      (t) => s.frontView.state(t.input).status === "ready",
    ).length;
    const now = nowMilliseconds(),
      readyNow =
        !!ready && ready === visible.length && s.front()?.level === point[2];
    if (pan && !panning && frames >= 3 && readyNow) {
      panning = true;
      s.camera.beginDrag();
      started = previous = now;
      frames = fallbackFrames = over20ms = 0;
      distance = 0;
      before = s.diagnostics().pack ?? "";
    }
    if (pan && panning) {
      if (!readyNow) fallbackFrames++;
      const elapsed = now - previous;
      if (elapsed > 20) over20ms++;
      const move = Math.min(100, elapsed) * 0.32;
      distance += move;
      s.camera.drag(-move / Math.SQRT2, move / Math.SQRT2);
      previous = now;
      if (now - started < 8000) return;
      s.camera.endDrag(0, 0);
    } else if (frames < 3 || (!readyNow && now - started < 20000)) return;
    const row = {
      stage,
      local,
      mode: pan ? "pan" : "cold-view",
      point,
      milliseconds: now - started,
      frames,
      ready,
      visible: visible.length,
      level: s.front()?.level,
      storage: s.tileStorage(),
      complete: pan ? panning : readyNow,
      fallbackFrames,
      over20ms,
      distance,
      packBefore: before,
      packAfter: s.diagnostics().pack ?? "",
    };
    // One small receipt after each leg; its acknowledgement is outside the
    // measured interval. Date.now is the native clock, not virtual frame time.
    awaiting = true;
    const id = s.io.request("map.benchmark", JSON.stringify(row), (result) => {
      awaiting = false;
      if (!result.ok) {
        finished = true;
        setLabel("Storage test: receipt failed");
        return;
      }
      stage++;
      frames = 0;
      panning = false;
      if (stage === 10) {
        finished = true;
        s.setLocalTiles(true);
        s.camera.jump(...route[0]);
        setLabel("Storage test saved on Mac");
      }
    });
    if (!id) {
      finished = true;
      setLabel("Storage test: no receipt credit");
    }
  };
}
