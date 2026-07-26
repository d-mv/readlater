import { describe, expect, test } from "bun:test";
import { vttToPlainText } from "../src/vtt";

describe("vttToPlainText", () => {
  test("strips header, timing lines, and cue settings", () => {
    const vtt = [
      "WEBVTT",
      "Kind: captions",
      "Language: en",
      "",
      "00:00:00.080 --> 00:00:02.560 align:start position:0%",
      "hello everyone welcome",
      "",
    ].join("\n");
    expect(vttToPlainText(vtt)).toBe("hello everyone welcome");
  });

  test("strips inline karaoke timestamp/class tags from auto-generated captions", () => {
    const vtt = [
      "WEBVTT",
      "",
      "00:00:00.080 --> 00:00:02.560 align:start position:0%",
      "hello<00:00:00.560><c> everyone</c><00:00:01.120><c> welcome</c>",
      "",
    ].join("\n");
    expect(vttToPlainText(vtt)).toBe("hello everyone welcome");
  });

  test("dedupes consecutive repeated lines from rolling captions", () => {
    const vtt = [
      "WEBVTT",
      "",
      "00:00:00.000 --> 00:00:02.000 align:start position:0%",
      "hello everyone welcome",
      "",
      "00:00:02.000 --> 00:00:02.010 align:start position:0%",
      "hello everyone welcome",
      "",
      "00:00:02.010 --> 00:00:05.000 align:start position:0%",
      "hello everyone welcome",
      "back to the show",
      "",
    ].join("\n");
    expect(vttToPlainText(vtt)).toBe("hello everyone welcome back to the show");
  });

  test("skips NOTE blocks", () => {
    const vtt = [
      "WEBVTT",
      "",
      "NOTE this is a comment",
      "",
      "00:00:00.000 --> 00:00:02.000",
      "actual caption text",
      "",
    ].join("\n");
    expect(vttToPlainText(vtt)).toBe("actual caption text");
  });

  test("returns empty string for captions with no cues", () => {
    expect(vttToPlainText("WEBVTT\nKind: captions\nLanguage: en\n")).toBe("");
  });
});
