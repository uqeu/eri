// Unit tests for the style-tweaker store + slider mapping.

import { strict as assert } from "node:assert";
import {
  PROPERTY_META,
  TweakStore,
  normalizeColor,
  sliderValueToCss,
} from "../styleTweaker";

function findMeta(property: string) {
  const meta = PROPERTY_META.find((m) => m.property === property);
  if (!meta) {
    throw new Error(`meta for ${property} not found`);
  }
  return meta;
}

function testSliderProducesPxString(): void {
  const meta = findMeta("font-size");
  assert.equal(sliderValueToCss(meta, 20), "20px");
}

function testSliderClampsAboveMax(): void {
  const meta = findMeta("padding");
  assert.equal(sliderValueToCss(meta, 9999), `${meta.max}px`);
}

function testSliderClampsBelowMin(): void {
  const meta = findMeta("padding");
  assert.equal(sliderValueToCss(meta, -50), `${meta.min}px`);
}

function testSliderRoundsFractional(): void {
  const meta = findMeta("border-radius");
  assert.equal(sliderValueToCss(meta, 7.6), "8px");
}

function testNormalizeColorAccepts6Digit(): void {
  assert.equal(normalizeColor("#ABCDEF"), "#abcdef");
}

function testNormalizeColorExpands3Digit(): void {
  assert.equal(normalizeColor("#abc"), "#aabbcc");
}

function testNormalizeColorRejectsBadInput(): void {
  assert.equal(normalizeColor("rgb(1,2,3)"), null);
  assert.equal(normalizeColor("not a color"), null);
}

function testTweakStoreSetAndList(): void {
  const store = new TweakStore();
  store.set({ property: "color", value: "#ef4444", source: "voice" });
  store.set({ property: "font-size", value: "20px", source: "slider" });
  const list = store.list();
  assert.equal(list.length, 2);
  const json = store.toJson();
  assert.equal(json["color"], "#ef4444");
  assert.equal(json["font-size"], "20px");
}

function testTweakStoreOverwritesByProperty(): void {
  const store = new TweakStore();
  store.set({ property: "color", value: "#000000", source: "color" });
  store.set({ property: "color", value: "#ffffff", source: "voice" });
  assert.equal(store.list().length, 1);
  assert.equal(store.get("color")?.value, "#ffffff");
}

function testTweakStoreCssBody(): void {
  const store = new TweakStore();
  store.set({ property: "color", value: "#ef4444", source: "voice" });
  store.set({ property: "font-size", value: "20px", source: "slider" });
  const body = store.toCssBody();
  assert.ok(body.includes("color: #ef4444;"));
  assert.ok(body.includes("font-size: 20px;"));
}

function testTweakStoreClearAndRemove(): void {
  const store = new TweakStore();
  store.set({ property: "color", value: "#000", source: "color" });
  store.remove("color");
  assert.equal(store.list().length, 0);
  store.set({ property: "padding", value: "8px", source: "slider" });
  store.clear();
  assert.equal(store.list().length, 0);
}

function run(): void {
  testSliderProducesPxString();
  testSliderClampsAboveMax();
  testSliderClampsBelowMin();
  testSliderRoundsFractional();
  testNormalizeColorAccepts6Digit();
  testNormalizeColorExpands3Digit();
  testNormalizeColorRejectsBadInput();
  testTweakStoreSetAndList();
  testTweakStoreOverwritesByProperty();
  testTweakStoreCssBody();
  testTweakStoreClearAndRemove();
  process.stdout.write("styleTweaker.test.ts: 11 cases passed\n");
}

run();
