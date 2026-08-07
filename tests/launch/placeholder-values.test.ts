import { describe, expect, it } from "vitest";
import { asAzureClientId } from "../../src/auth/client-id";
import { asPlayerUuid } from "../../src/core/uuid";
import { buildPlaceholderValues } from "../../src/launch/placeholder-values";
import { AuthModes, type OnlineAuth } from "../../src/types/auth";
import { fakeTarget } from "../helpers/fake-kit";

const onlineAuth = (overrides: Partial<OnlineAuth> = {}): OnlineAuth => ({
  mode: AuthModes.ONLINE,
  username: "Player",
  uuid: asPlayerUuid("f81d4fae-7dec-11d0-a765-00a0c91e6bf6"),
  accessToken: "token",
  userType: "msa",
  ...overrides,
});

const valuesFor = (auth: OnlineAuth): Readonly<Record<string, string>> =>
  buildPlaceholderValues({
    target: fakeTarget,
    versionId: "1.20.1",
    auth,
    classpath: ["/a.jar"],
    options: { auth },
  });

describe("buildPlaceholderValues", () => {
  it("resolves absent Microsoft fields to the empty string so callers need not fabricate one", () => {
    const values = valuesFor(onlineAuth());
    expect(values.clientid).toBe("");
    expect(values.auth_xuid).toBe("");
  });

  it("passes the Microsoft fields through when the session actually has them", () => {
    const values = valuesFor(
      onlineAuth({
        clientId: asAzureClientId("11111111-2222-3333-4444-555555555555"),
        xuid: "2535412345",
      }),
    );
    expect(values.clientid).toBe("11111111-2222-3333-4444-555555555555");
    expect(values.auth_xuid).toBe("2535412345");
  });
});
