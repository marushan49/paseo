import { describe, expect, it } from "vitest";

import { parseTeamIdentifier, verifyMacBundleSignatures } from "./mac-signature-check.js";

const ADHOC_OUTPUT = `Executable=/Applications/Paseo.app/Contents/MacOS/Paseo
Identifier=sh.paseo.desktop
Format=app bundle with Mach-O thin (arm64)
Signature=adhoc
TeamIdentifier=not set
`;

const SIGNED_OUTPUT = `Executable=/Applications/Paseo.app/Contents/MacOS/Paseo
Identifier=sh.paseo.desktop
Format=app bundle with Mach-O thin (arm64)
Authority=Developer ID Application: Example (TEAM123456)
TeamIdentifier=TEAM123456
`;

function stubRunVvv(teams) {
  return (target) => {
    if (target.endsWith("Electron Framework")) {
      return teams.framework;
    }
    return teams.main;
  };
}

describe("parseTeamIdentifier", () => {
  it("maps ad-hoc signatures to an empty team", () => {
    expect(parseTeamIdentifier(ADHOC_OUTPUT)).toBe("");
  });

  it("reads the Developer ID team", () => {
    expect(parseTeamIdentifier(SIGNED_OUTPUT)).toBe("TEAM123456");
  });

  it("returns null when the output carries no team", () => {
    expect(parseTeamIdentifier("Executable=/tmp/x\n")).toBeNull();
  });
});

describe("verifyMacBundleSignatures", () => {
  it("passes when both sides share the Developer ID team", () => {
    const result = verifyMacBundleSignatures({
      appPath: "/tmp/Paseo.app",
      runVvv: stubRunVvv({ main: SIGNED_OUTPUT, framework: SIGNED_OUTPUT }),
      runVerify: () => undefined,
      expectedTeamId: "TEAM123456",
      signedBuild: true,
    });

    expect(result.teamId).toBe("TEAM123456");
  });

  it("passes local ad-hoc builds when both sides match", () => {
    const result = verifyMacBundleSignatures({
      appPath: "/tmp/Paseo.app",
      runVvv: stubRunVvv({ main: ADHOC_OUTPUT, framework: ADHOC_OUTPUT }),
      runVerify: () => undefined,
    });

    expect(result.teamId).toBe("");
  });

  it("fails on the DYLD different-Team-IDs mix from the crash report", () => {
    expect(() =>
      verifyMacBundleSignatures({
        appPath: "/Applications/Paseo.app",
        runVvv: stubRunVvv({ main: ADHOC_OUTPUT, framework: SIGNED_OUTPUT }),
        runVerify: () => undefined,
      }),
    ).toThrow(/different Team IDs/);
  });

  it("fails release builds that stayed ad-hoc", () => {
    expect(() =>
      verifyMacBundleSignatures({
        appPath: "/tmp/Paseo.app",
        runVvv: stubRunVvv({ main: ADHOC_OUTPUT, framework: ADHOC_OUTPUT }),
        runVerify: () => undefined,
        signedBuild: true,
      }),
    ).toThrow(/ad-hoc/);
  });

  it("fails when the cert team does not match APPLE_TEAM_ID", () => {
    expect(() =>
      verifyMacBundleSignatures({
        appPath: "/tmp/Paseo.app",
        runVvv: stubRunVvv({ main: SIGNED_OUTPUT, framework: SIGNED_OUTPUT }),
        runVerify: () => undefined,
        expectedTeamId: "OTHERTEAM1",
        signedBuild: true,
      }),
    ).toThrow(/APPLE_TEAM_ID/);
  });

  it("surfaces a failed deep verification", () => {
    expect(() =>
      verifyMacBundleSignatures({
        appPath: "/tmp/Paseo.app",
        runVvv: stubRunVvv({ main: SIGNED_OUTPUT, framework: SIGNED_OUTPUT }),
        runVerify: () => {
          throw new Error("invalid signature");
        },
      }),
    ).toThrow(/codesign --verify/);
  });
});
