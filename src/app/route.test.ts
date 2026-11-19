import { describe, expect, it } from "vite-plus/test";
import { parseRoute, workspaceIdFromName, workspaceUrl } from "./route.ts";

describe("parseRoute", () => {
  it("reads / as the scratch bench", () => {
    expect(parseRoute("")).toStrictEqual({ kind: "scratch" });
    expect(parseRoute("?tool=&workspace=")).toStrictEqual({ kind: "scratch" });
  });

  it("reads a workspace id", () => {
    expect(parseRoute("?workspace=work")).toStrictEqual({ kind: "workspace", id: "work" });
  });

  it("splits ?tool= on commas, and skips empty parts", () => {
    expect(parseRoute("?tool=counter")).toStrictEqual({ kind: "embed", toolIds: ["counter"] });
    expect(parseRoute("?tool=qr-code-reader,,counter,")).toStrictEqual({
      kind: "embed",
      toolIds: ["qr-code-reader", "counter"],
    });
  });

  it("keeps an embed locked even with a workspace in the URL", () => {
    expect(parseRoute("?workspace=work&tool=counter").kind).toBe("embed");
  });
});

describe("workspaceIdFromName", () => {
  it("makes a tidy id from a name", () => {
    expect(workspaceIdFromName("  My Desk!  ")).toBe("my-desk");
    expect(workspaceIdFromName("a / b")).toBe("a-b");
  });

  it("keeps letters of any script", () => {
    expect(workspaceIdFromName("งาน ประจำวัน")).toBe("งาน-ประจำวัน");
  });

  it("gives null when nothing is left", () => {
    expect(workspaceIdFromName(" !? ")).toBeNull();
  });
});

describe("workspaceUrl", () => {
  it("encodes the id", () => {
    expect(workspaceUrl("งาน")).toBe("?workspace=%E0%B8%87%E0%B8%B2%E0%B8%99");
    expect(parseRoute(workspaceUrl("a&b"))).toStrictEqual({ kind: "workspace", id: "a&b" });
  });
});
