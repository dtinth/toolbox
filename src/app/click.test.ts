import { describe, expect, it } from "vite-plus/test";
import { shouldInterceptClick } from "./click.ts";

describe("shouldInterceptClick", () => {
  it("intercepts a plain left-click (button 0, no modifiers)", () => {
    expect(
      shouldInterceptClick({
        button: 0,
        metaKey: false,
        ctrlKey: false,
        shiftKey: false,
        altKey: false,
      }),
    ).toBeTruthy();
  });

  it("does not intercept a left-click with the meta key held", () => {
    expect(
      shouldInterceptClick({
        button: 0,
        metaKey: true,
        ctrlKey: false,
        shiftKey: false,
        altKey: false,
      }),
    ).toBeFalsy();
  });

  it("does not intercept a left-click with the ctrl key held", () => {
    expect(
      shouldInterceptClick({
        button: 0,
        metaKey: false,
        ctrlKey: true,
        shiftKey: false,
        altKey: false,
      }),
    ).toBeFalsy();
  });

  it("does not intercept a left-click with the shift key held", () => {
    expect(
      shouldInterceptClick({
        button: 0,
        metaKey: false,
        ctrlKey: false,
        shiftKey: true,
        altKey: false,
      }),
    ).toBeFalsy();
  });

  it("does not intercept a middle-click (button 1)", () => {
    expect(
      shouldInterceptClick({
        button: 1,
        metaKey: false,
        ctrlKey: false,
        shiftKey: false,
        altKey: false,
      }),
    ).toBeFalsy();
  });

  it("does not intercept a right-click (button 2)", () => {
    expect(
      shouldInterceptClick({
        button: 2,
        metaKey: false,
        ctrlKey: false,
        shiftKey: false,
        altKey: false,
      }),
    ).toBeFalsy();
  });
});
