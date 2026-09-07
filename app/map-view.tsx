import { createSignal, For, Show } from "solid-js";
import { Image, Text, View, type NodeMirror } from "@pocketjs/framework/components";
import { ResourceImage, ResourceMesh } from "@pocketjs/framework/resource";
import { createResourceView } from "@pocketjs/framework/resource-view";
import { onFrame } from "@pocketjs/framework/lifecycle";
import * as hot from "@pocketjs/framework/hot";
import { labelWidth, labelMetrics } from "./annotations.ts";
import type { MapModel, Layer } from "./model.ts";
import type { Place, MapMarker } from "../shared/types.ts";
const MARKER_ICONS = { landmark: "marker-landmark.svg", tower: "marker-tower.svg", shrine: "marker-shrine.svg", stable: "marker-stable.svg", village: "marker-village.svg", seed: "marker-seed.svg", treasure: "marker-treasure.svg", enemy: "marker-enemy.svg", special: "marker-special.svg" };
const box = (x: number, y: number, w: number, h: number) => ({ posType: 1, insetL: x, insetT: y, width: w, height: h });

export function TileLayer(p: { s: MapModel; back?: boolean }) {
  let world: NodeMirror | undefined;
  let last:{layer:Layer;x:number;y:number;zoom:number}|undefined;
  const layer = () => (p.back ? p.s.back() : p.s.front());
  const resources = p.back ? p.s.backView : p.s.frontView;
  onFrame(() => {
    const l = layer(); if (!l || !world) return;
    const view = p.s.camera.view();if(last?.layer===l&&last.x===view.x&&last.y===view.y&&last.zoom===view.zoom)return;last={layer:l,...view};
    const scale = 2 ** (view.zoom - l.level);
    const worldWidth = 256 * 2 ** l.level;
    let offsetX = l.originX - view.x * 2 ** l.level;
    // Rebase at the viewport, including the nearest copy across the date line.
    if (!p.s.planar()) offsetX -= Math.round(offsetX / worldWidth) * worldWidth;
    hot.prop(world, "translateX", p.s.viewport.width / 2 + offsetX * scale);
    hot.prop(world, "translateY", p.s.viewport.height / 2 + (l.originY - view.y * 2 ** l.level) * scale);
    hot.prop(world, "scaleX", scale); hot.prop(world, "scaleY", scale);
  });
  return <View ref={world} debugName={p.back ? "PreviousTiles" : "VisibleTiles"} style={{ ...box(0, 0, 1, 1), originX: -0.5, originY: -0.5 }}>
    <For each={layer()?.tiles}>{tile => { const Tile = p.s.vector() ? ResourceMesh : ResourceImage; return <Tile debugName="MapTile" style={{ ...box(tile.column * 256 - layer()!.originX, tile.row * 256 - layer()!.originY, 256, 256), overflow: 1 }}
      state={() => resources.state(tile.input)} fallback={() => p.back || p.s.back() ? <View /> : <View class="w-full h-full bg-[#e6e7de]">
        <View class="absolute left-[30] top-0 w-[3] h-full bg-[#f5f4eb]" /><View class="absolute left-0 top-[94] w-full h-[3] bg-[#f5f4eb]" />
        <View class="absolute left-[65] top-[114] w-[108] h-[8] rounded-[3] bg-[#d4d8cb] animate-pulse" />
      </View>} errorFallback={() => <View class="w-full h-full bg-[#e6e7de]"><Text class="absolute left-[60] top-[112] text-xs text-[#73796c]">Tile unavailable</Text></View>} />; }}</For>
  </View>;
}
function UnicodeAnnotation(p:{s:MapModel;place:Place;width:number}) {
  const image=createResourceView(p.s.labels,{demand:()=>[{input:p.place,priority:30,pin:true}]});
  return <ResourceImage style={{...box(0,0,p.width,16),overflow:1}} state={()=>image.state(p.place)} fallback={()=><View class="w-full h-full rounded-[2] bg-[#e1e3d4] animate-pulse" />} />;
}
export function Annotation(p: { s: MapModel; marker: MapMarker }) {
  let root: NodeMirror | undefined;
  const [visible,setVisible]=createSignal(false);
  const vector=p.s.vector(),unicode=vector && /[^\x20-\x7e]/.test(p.marker[1]);
  const place:Place={id:`label:${p.marker[0]}`,name:labelMetrics(p.marker[1]).text,detail:"",lat:0,lon:0,zoom:14};
  let lastPlacement:ReturnType<MapModel["annotations"]["placement"]>;
  const width=vector?labelWidth(p.marker[1]):118;
  onFrame(() => {
    if(vector){const at=p.s.annotations.placement(p.marker[0]);if(at===lastPlacement)return;lastPlacement=at;setVisible(!!at);hot.prop(root,"display",at?0:1);if(at){hot.prop(root,"translateX",at.x);hot.prop(root,"translateY",at.y);}return;}
    const v = p.s.camera.view(), x = p.s.viewport.width / 2 + (p.marker[3] - v.x) * v.scale, y = p.s.viewport.height / 2 + (p.marker[4] - v.y) * v.scale;
    hot.prop(root, "translateX", x - 7); hot.prop(root, "translateY", y - 7);
    hot.prop(root, "display", x < -100 || x > p.s.viewport.width + 10 || y < 18 || y > p.s.viewport.height - 5 ? 1 : 0);
  });
  return <View ref={root} debugName="MapAnnotation" style={{...box(0,0,width,17),display:vector?1:0}}>
    <Show when={vector} fallback={<>
      <View class="absolute left-[12] top-[1] w-[105] h-[14] rounded-[2] bg-[#fff8e9df]" />
      <Image src={MARKER_ICONS[p.marker[2]]} style={box(0, 0, 15, 15)} />
      <Text class="absolute left-[17] top-[2] text-xs text-[#3b3027]">{p.marker[1].length > 16 ? p.marker[1].slice(0, 13) + "..." : p.marker[1]}</Text>
    </>}>
      <Show when={unicode} fallback={<>
        <View class="absolute left-0 top-0 h-[16] rounded-[2] bg-[#fffdf3df]" style={{width}} />
        <Text class="absolute left-[4] top-[2] text-xs text-[#454438]">{labelMetrics(p.marker[1]).text}</Text>
      </>}><Show when={visible()}><UnicodeAnnotation s={p.s} place={place} width={width} /></Show></Show>
    </Show>
  </View>;
}
