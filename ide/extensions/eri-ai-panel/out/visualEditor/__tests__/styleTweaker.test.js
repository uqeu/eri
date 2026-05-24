"use strict";
// Unit tests for the style-tweaker store + slider mapping.
Object.defineProperty(exports, "__esModule", { value: true });
const node_assert_1 = require("node:assert");
const styleTweaker_1 = require("../styleTweaker");
function findMeta(property) {
    const meta = styleTweaker_1.PROPERTY_META.find((m) => m.property === property);
    if (!meta) {
        throw new Error(`meta for ${property} not found`);
    }
    return meta;
}
function testSliderProducesPxString() {
    const meta = findMeta("font-size");
    node_assert_1.strict.equal((0, styleTweaker_1.sliderValueToCss)(meta, 20), "20px");
}
function testSliderClampsAboveMax() {
    const meta = findMeta("padding");
    node_assert_1.strict.equal((0, styleTweaker_1.sliderValueToCss)(meta, 9999), `${meta.max}px`);
}
function testSliderClampsBelowMin() {
    const meta = findMeta("padding");
    node_assert_1.strict.equal((0, styleTweaker_1.sliderValueToCss)(meta, -50), `${meta.min}px`);
}
function testSliderRoundsFractional() {
    const meta = findMeta("border-radius");
    node_assert_1.strict.equal((0, styleTweaker_1.sliderValueToCss)(meta, 7.6), "8px");
}
function testNormalizeColorAccepts6Digit() {
    node_assert_1.strict.equal((0, styleTweaker_1.normalizeColor)("#ABCDEF"), "#abcdef");
}
function testNormalizeColorExpands3Digit() {
    node_assert_1.strict.equal((0, styleTweaker_1.normalizeColor)("#abc"), "#aabbcc");
}
function testNormalizeColorRejectsBadInput() {
    node_assert_1.strict.equal((0, styleTweaker_1.normalizeColor)("rgb(1,2,3)"), null);
    node_assert_1.strict.equal((0, styleTweaker_1.normalizeColor)("not a color"), null);
}
function testTweakStoreSetAndList() {
    const store = new styleTweaker_1.TweakStore();
    store.set({ property: "color", value: "#ef4444", source: "voice" });
    store.set({ property: "font-size", value: "20px", source: "slider" });
    const list = store.list();
    node_assert_1.strict.equal(list.length, 2);
    const json = store.toJson();
    node_assert_1.strict.equal(json["color"], "#ef4444");
    node_assert_1.strict.equal(json["font-size"], "20px");
}
function testTweakStoreOverwritesByProperty() {
    const store = new styleTweaker_1.TweakStore();
    store.set({ property: "color", value: "#000000", source: "color" });
    store.set({ property: "color", value: "#ffffff", source: "voice" });
    node_assert_1.strict.equal(store.list().length, 1);
    node_assert_1.strict.equal(store.get("color")?.value, "#ffffff");
}
function testTweakStoreCssBody() {
    const store = new styleTweaker_1.TweakStore();
    store.set({ property: "color", value: "#ef4444", source: "voice" });
    store.set({ property: "font-size", value: "20px", source: "slider" });
    const body = store.toCssBody();
    node_assert_1.strict.ok(body.includes("color: #ef4444;"));
    node_assert_1.strict.ok(body.includes("font-size: 20px;"));
}
function testTweakStoreClearAndRemove() {
    const store = new styleTweaker_1.TweakStore();
    store.set({ property: "color", value: "#000", source: "color" });
    store.remove("color");
    node_assert_1.strict.equal(store.list().length, 0);
    store.set({ property: "padding", value: "8px", source: "slider" });
    store.clear();
    node_assert_1.strict.equal(store.list().length, 0);
}
function run() {
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
//# sourceMappingURL=styleTweaker.test.js.map