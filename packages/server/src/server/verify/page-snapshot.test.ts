import { describe, expect, it } from "vitest";

import {
  collectSnapshotNodes,
  findSnapshotRef,
  formatSnapshotYaml,
  type CollectedSnapshotNode,
} from "./page-snapshot.js";

const nodes: CollectedSnapshotNode[] = [
  { role: "heading", name: "Current Report", selector: "h1:nth-of-type(1)" },
  { role: "textbox", name: "Email", selector: "#email" },
  { role: "button", name: "Sign in", selector: "button:nth-of-type(1)" },
];

describe("formatSnapshotYaml", () => {
  it("renders one line per node with stable refs", () => {
    const formatted = formatSnapshotYaml(nodes);

    expect(formatted.yaml).toBe(
      ['- heading "Current Report" @e1', '- textbox "Email" @e2', '- button "Sign in" @e3'].join(
        "\n",
      ),
    );
    expect(formatted.stats).toEqual({ nodeCount: 3, refCount: 3, textLength: 26 });
    expect(formatted.truncated).toBe(false);
  });

  it("escapes quotes in accessible names", () => {
    const formatted = formatSnapshotYaml([
      { role: "button", name: 'Say "hi"', selector: "button:nth-of-type(1)" },
    ]);

    expect(formatted.yaml).toBe('- button "Say \\"hi\\"" @e1');
  });
});

describe("findSnapshotRef", () => {
  const withRefs = formatSnapshotYaml(nodes).nodes;

  it("matches role and name case-insensitively", () => {
    expect(findSnapshotRef(withRefs, { role: "HEADING", name: "current report" })).toBe("@e1");
    expect(findSnapshotRef(withRefs, { role: "textbox", name: "  Email " })).toBe("@e2");
  });

  it("returns null when nothing matches", () => {
    expect(findSnapshotRef(withRefs, { role: "button", name: "Delete" })).toBeNull();
    expect(findSnapshotRef([], { role: "button", name: "Sign in" })).toBeNull();
  });
});

describe("browser snapshot privacy", () => {
  it("does not treat mutable input values as accessible names", () => {
    const source = collectSnapshotNodes.toString();

    expect(source).not.toContain('element.getAttribute("value")');
  });
});
