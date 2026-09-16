const path = require("node:path");

const { smokePackagedDesktopApp } = require("../e2e/packaged-app-smoke.js");
const { EXECUTABLE_NAME, verifyMacBundleSignatures } = require("./mac-signature-check");

exports.default = async function afterSign(context) {
  if (context.electronPlatformName !== "darwin") {
    return;
  }

  const appPath = path.join(context.appOutDir, `${EXECUTABLE_NAME}.app`);
  // Fail the build when the bundle would die at launch with DYLD
  // "different Team IDs" (mixed ad-hoc/Developer ID binaries from a merge or
  // a wrong cert). Local ad-hoc builds pass as long as both sides match.
  verifyMacBundleSignatures({
    appPath,
    executableName: EXECUTABLE_NAME,
    expectedTeamId: (process.env.APPLE_TEAM_ID ?? "").trim(),
    signedBuild: Boolean((process.env.CSC_LINK ?? "").trim()),
  });

  if (process.env.PASEO_DESKTOP_SMOKE !== "1") {
    return;
  }

  await smokePackagedDesktopApp({ appPath });
};
