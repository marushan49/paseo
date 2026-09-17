import { describe, expect, it } from "vitest";
import { PaseoConfigRawSchema, PaseoConfigSchema } from "@getpaseo/protocol/paseo-config-schema";

describe("paseo config schema", () => {
  it("parses an empty config without metadata generation", () => {
    const parsed = PaseoConfigSchema.parse({});

    expect(parsed).toEqual({});
    expect(parsed.metadataGeneration).toBeUndefined();
  });

  it("parses old-style worktree and scripts config unchanged", () => {
    const config = {
      worktree: {
        setup: "npm install",
        teardown: ["npm run clean"],
      },
      scripts: {
        dev: {
          type: "service",
          command: "npm run dev",
          port: 5173,
        },
      },
    };

    expect(PaseoConfigSchema.parse(config)).toEqual({
      worktree: {
        setup: ["npm install"],
        teardown: ["npm run clean"],
      },
      scripts: config.scripts,
    });
  });

  it("parses service port allocation", () => {
    expect(
      PaseoConfigSchema.parse({
        worktree: {
          servicePorts: { range: "3000-4000", portScript: "/usr/bin/portmake" },
        },
      }),
    ).toEqual({
      worktree: {
        setup: [],
        teardown: [],
        servicePorts: { range: "3000-4000", portScript: "/usr/bin/portmake" },
      },
    });
  });

  it("rejects invalid service port ranges", () => {
    expect(() =>
      PaseoConfigRawSchema.parse({ worktree: { servicePorts: { range: "4000-3000" } } }),
    ).toThrow("Expected an inclusive TCP port range");
  });

  it("normalizes partial worktree lifecycle config without dropping present commands", () => {
    expect(
      PaseoConfigSchema.parse({
        worktree: {
          setup: 'echo "setup ran" > setup.log',
        },
      }),
    ).toEqual({
      worktree: {
        setup: ['echo "setup ran" > setup.log'],
        teardown: [],
      },
    });

    expect(
      PaseoConfigSchema.parse({
        worktree: {
          teardown: ["npm run clean"],
        },
      }),
    ).toEqual({
      worktree: {
        setup: [],
        teardown: ["npm run clean"],
      },
    });
  });

  it("parses all metadata generation instruction entries", () => {
    expect(
      PaseoConfigSchema.parse({
        metadataGeneration: {
          title: { instructions: "Keep titles to a few words." },
          branchName: { instructions: "Prefix branches with feat/." },
          commitMessage: { instructions: "Use imperative mood." },
          pullRequest: { instructions: "Include risk notes." },
        },
      }),
    ).toEqual({
      metadataGeneration: {
        title: { instructions: "Keep titles to a few words." },
        branchName: { instructions: "Prefix branches with feat/." },
        commitMessage: { instructions: "Use imperative mood." },
        pullRequest: { instructions: "Include risk notes." },
      },
    });
  });

  it("parses partial metadata generation instructions with missing entries undefined", () => {
    const parsed = PaseoConfigSchema.parse({
      metadataGeneration: {
        branchName: { instructions: "Keep it short." },
      },
    });

    expect(parsed.metadataGeneration).toEqual({
      branchName: { instructions: "Keep it short." },
    });
    expect(parsed.metadataGeneration?.commitMessage).toBeUndefined();
    expect(parsed.metadataGeneration?.pullRequest).toBeUndefined();
  });

  it("preserves legacy agentTitle metadata instructions as passthrough", () => {
    expect(
      PaseoConfigSchema.parse({
        metadataGeneration: {
          agentTitle: { instructions: "Use concise titles." },
        },
      }),
    ).toEqual({
      metadataGeneration: {
        agentTitle: { instructions: "Use concise titles." },
      },
    });
  });

  it("passes through unknown metadata generation fields", () => {
    expect(
      PaseoConfigSchema.parse({
        metadataGeneration: {
          futureField: 42,
        },
      }),
    ).toEqual({
      metadataGeneration: {
        futureField: 42,
      },
    });
  });

  it("passes through unknown metadata generator entry fields", () => {
    expect(
      PaseoConfigSchema.parse({
        metadataGeneration: {
          branchName: {
            instructions: "Use concise titles.",
            model: "haiku",
          },
        },
      }),
    ).toEqual({
      metadataGeneration: {
        branchName: {
          instructions: "Use concise titles.",
          model: "haiku",
        },
      },
    });
  });

  it("falls back to an empty metadata generator entry when instructions has an invalid type", () => {
    expect(
      PaseoConfigSchema.parse({
        metadataGeneration: {
          branchName: { instructions: 42 },
        },
      }),
    ).toEqual({
      metadataGeneration: {
        branchName: {},
      },
    });
  });

  it("raw schema preserves old-style config while accepting legacy agentTitle", () => {
    const config = {
      worktree: {
        setup: "npm install",
        teardown: ["npm run clean"],
      },
      scripts: {
        dev: {
          type: "service",
          command: "npm run dev",
        },
      },
      metadataGeneration: {
        agentTitle: { instructions: "Use concise titles." },
        branchName: { instructions: "Use concise branches." },
      },
    };

    expect(PaseoConfigRawSchema.parse(config)).toEqual(config);
  });

  it("raw schema falls back to an empty metadata generator entry when instructions has an invalid type", () => {
    expect(
      PaseoConfigRawSchema.parse({
        metadataGeneration: {
          branchName: { instructions: 42 },
        },
      }),
    ).toEqual({
      metadataGeneration: {
        branchName: {},
      },
    });
  });

  it("parses browser credentials and verification recipes", () => {
    const config = {
      browser: {
        defaultProfile: "aip-dev",
        credentials: {
          "aip-admin": {
            usernameEnv: "AIP_ADMIN_EMAIL",
            passwordEnv: "AIP_ADMIN_PASSWORD",
            allowedOrigins: ["http://127.0.0.1:4001"],
          },
        },
      },
      verification: {
        recipes: {
          "verify-case-report": {
            profile: "aip-dev",
            params: ["caseId"],
            steps: [
              { action: "navigate", service: "frontend", path: "/en/case/{{caseId}}" },
              {
                action: "ensure-authenticated",
                credential: "aip-admin",
                login: {
                  service: "frontend",
                  path: "/login",
                  username: { role: "textbox", name: "Email" },
                  password: { role: "textbox", name: "Password" },
                  submit: { role: "button", name: "Sign in" },
                },
                check: {
                  service: "frontend",
                  path: "/en/case/{{caseId}}",
                  visible: { role: "heading", name: "Current Report" },
                },
              },
              { action: "assert-visible", role: "heading", name: "Current Report" },
              { action: "assert-console-errors", max: 0 },
              { action: "assert-failed-requests", max: 0 },
              { action: "screenshot", name: "report" },
            ],
          },
        },
      },
    };

    const parsed = PaseoConfigSchema.parse(config);
    expect(parsed.browser?.defaultProfile).toBe("aip-dev");
    expect(parsed.browser?.credentials["aip-admin"]?.usernameEnv).toBe("AIP_ADMIN_EMAIL");
    expect(parsed.verification?.recipes["verify-case-report"]?.params).toEqual(["caseId"]);
    expect(parsed.verification?.recipes["verify-case-report"]?.steps).toHaveLength(6);
  });

  it("defaults credentials and recipes to empty objects", () => {
    const parsed = PaseoConfigSchema.parse({ browser: {}, verification: {} });
    expect(parsed.browser).toEqual({ credentials: {} });
    expect(parsed.verification).toEqual({ recipes: {} });
  });

  it("rejects fill steps with neither value nor credential source", () => {
    expect(() =>
      PaseoConfigRawSchema.parse({
        verification: {
          recipes: {
            broken: {
              steps: [{ action: "fill", role: "textbox", name: "Email" }],
            },
          },
        },
      }),
    ).toThrow();
  });

  it("rejects empty recipes", () => {
    expect(() =>
      PaseoConfigRawSchema.parse({
        verification: {
          recipes: {
            empty: { steps: [] },
          },
        },
      }),
    ).toThrow();
  });

  it("keeps configs without browser or verification sections parseable", () => {
    expect(PaseoConfigSchema.parse({})).toEqual({});
  });
});
