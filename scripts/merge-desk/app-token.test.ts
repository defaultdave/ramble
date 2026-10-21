import { expect, test } from "bun:test";
import { createVerify, generateKeyPairSync } from "node:crypto";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { mintToken, parseConf, signAppJwt } from "./app-token.ts";

// A throwaway keypair made for these tests; the real App key is never read here.
const { privateKey, publicKey } = generateKeyPairSync("rsa", {
  modulusLength: 2048,
  privateKeyEncoding: { type: "pkcs8", format: "pem" },
  publicKeyEncoding: { type: "spki", format: "pem" },
});

function setup(conf: string) {
  const dir = mkdtempSync(join(tmpdir(), "app-token-"));
  const keyFile = join(dir, "test-signing-key");
  writeFileSync(keyFile, privateKey);
  const confPath = join(dir, "app.conf");
  writeFileSync(confPath, conf.replace("KEYFILE", keyFile));
  return confPath;
}

const decode = (part: string) => JSON.parse(Buffer.from(part, "base64url").toString());
const MINIMAL = "RAMBLE_APP_ID=123\nRAMBLE_APP_INSTALLATION_ID=456\nRAMBLE_APP_KEY=/k\n";

test("parseConf reads the ids and the key path, and treats a missing Client ID as null", () => {
  expect(parseConf(MINIMAL)).toEqual({ appId: "123", clientId: null, installationId: "456", keyPath: "/k" });
});

test("parseConf rejects a file with a required entry missing", () => {
  expect(() => parseConf("RAMBLE_APP_ID=123\n")).toThrow("RAMBLE_APP_INSTALLATION_ID");
});

test("the JWT is RS256, backdated 60 s, lives 9 min, and verifies against the public key", () => {
  const [header, payload, signature] = signAppJwt(parseConf(MINIMAL), privateKey, 1_000_000).split(".");
  expect(decode(header)).toEqual({ alg: "RS256", typ: "JWT" });
  expect(decode(payload)).toEqual({ iat: 999_940, exp: 1_000_540, iss: "123" });
  const valid = createVerify("RSA-SHA256")
    .update(`${header}.${payload}`)
    .verify(publicKey, Buffer.from(signature, "base64url"));
  expect(valid).toBe(true);
});

test("the Client ID is the issuer when one is recorded", () => {
  const conf = parseConf(`${MINIMAL}RAMBLE_APP_CLIENT_ID=Iv1.abc\n`);
  expect(decode(signAppJwt(conf, privateKey, 0).split(".")[1]).iss).toBe("Iv1.abc");
});

test("mintToken posts to the installation endpoint with the JWT and returns only the token", async () => {
  const confPath = setup("RAMBLE_APP_ID=123\nRAMBLE_APP_INSTALLATION_ID=456\nRAMBLE_APP_KEY=KEYFILE\n");
  let seen: { url: string; init: RequestInit } | undefined;
  const fakeFetch = (async (url: string, init: RequestInit) => {
    seen = { url, init };
    return new Response(JSON.stringify({ token: "ghs_fake", expires_at: "x" }), { status: 201 });
  }) as unknown as typeof fetch;
  const token = await mintToken({ confPath, fetch: fakeFetch, now: () => 1_000_000 });
  expect(token).toBe("ghs_fake");
  expect(seen!.url).toBe("https://api.github.com/app/installations/456/access_tokens");
  expect(seen!.init.method).toBe("POST");
  const auth = (seen!.init.headers as Record<string, string>).Authorization;
  expect(auth.startsWith("Bearer ")).toBe(true);
  expect(decode(auth.slice(7).split(".")[1]).iss).toBe("123");
});

test("mintToken fails with the status and nothing else when GitHub refuses", async () => {
  const confPath = setup("RAMBLE_APP_ID=123\nRAMBLE_APP_INSTALLATION_ID=456\nRAMBLE_APP_KEY=KEYFILE\n");
  const fakeFetch = (async () => new Response('{"message":"Bad credentials"}', { status: 401 })) as unknown as typeof fetch;
  const error = await mintToken({ confPath, fetch: fakeFetch }).catch((e: Error) => e);
  expect((error as Error).message).toBe("GitHub refused the token request: HTTP 401");
});
