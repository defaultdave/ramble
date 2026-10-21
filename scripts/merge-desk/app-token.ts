// Mints a one-hour installation token for the Ramble agents App and prints only the token (runbook B1).
// Config comes from ~/.config/ramble-agents/app.conf; the private key path is read from there and the
// key file is read here, never logged. Run: bun scripts/merge-desk/app-token.ts
import { createSign } from "node:crypto";
import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

export const DEFAULT_CONF = join(homedir(), ".config", "ramble-agents", "app.conf");

export interface AppConf {
  appId: string;
  clientId: string | null;
  installationId: string;
  keyPath: string;
}

/** Parses KEY=VALUE lines. Required: RAMBLE_APP_ID, RAMBLE_APP_INSTALLATION_ID, RAMBLE_APP_KEY. */
export function parseConf(text: string): AppConf {
  const values: Record<string, string> = {};
  for (const line of text.split("\n")) {
    const match = line.match(/^\s*([A-Z_]+)=(.*)$/);
    if (match) values[match[1]] = match[2].trim().replace(/^(["'])(.*)\1$/, "$2");
  }
  for (const key of ["RAMBLE_APP_ID", "RAMBLE_APP_INSTALLATION_ID", "RAMBLE_APP_KEY"]) {
    if (!values[key]) throw new Error(`app.conf is missing ${key}`);
  }
  return {
    appId: values.RAMBLE_APP_ID,
    clientId: values.RAMBLE_APP_CLIENT_ID || null,
    installationId: values.RAMBLE_APP_INSTALLATION_ID,
    keyPath: values.RAMBLE_APP_KEY.replace(/^~(?=\/)/, homedir()),
  };
}

const b64url = (input: string | Buffer) => Buffer.from(input).toString("base64url");

/** RS256 JWT for the App: iat 60 s back, exp 9 min ahead, iss the Client ID or else the App ID. */
export function signAppJwt(conf: AppConf, privateKeyPem: string, nowSeconds: number): string {
  const header = b64url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const payload = b64url(
    JSON.stringify({ iat: nowSeconds - 60, exp: nowSeconds + 9 * 60, iss: conf.clientId ?? conf.appId }),
  );
  const signature = createSign("RSA-SHA256").update(`${header}.${payload}`).sign(privateKeyPem);
  return `${header}.${payload}.${b64url(signature)}`;
}

export interface MintOptions {
  confPath?: string;
  fetch?: typeof fetch;
  now?: () => number;
}

export async function mintToken(options: MintOptions = {}): Promise<string> {
  const conf = parseConf(readFileSync(options.confPath ?? process.env.RAMBLE_APP_CONF ?? DEFAULT_CONF, "utf8"));
  const now = options.now?.() ?? Math.floor(Date.now() / 1000);
  const jwt = signAppJwt(conf, readFileSync(conf.keyPath, "utf8"), now);
  const response = await (options.fetch ?? fetch)(
    `https://api.github.com/app/installations/${conf.installationId}/access_tokens`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${jwt}`,
        Accept: "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
      },
    },
  );
  if (!response.ok) throw new Error(`GitHub refused the token request: HTTP ${response.status}`);
  const body = (await response.json()) as { token?: string };
  if (!body.token) throw new Error("GitHub's reply had no token");
  return body.token;
}

if (import.meta.main) {
  try {
    process.stdout.write(`${await mintToken()}\n`);
  } catch (error) {
    console.error((error as Error).message);
    process.exit(1);
  }
}
