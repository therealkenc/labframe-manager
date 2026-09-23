import assert from 'node:assert/strict';
import { execFile, spawn, type ChildProcess } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { cp, mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { createServer } from 'node:net';
import { resolve } from 'node:path';
import { setTimeout } from 'node:timers/promises';
import { promisify } from 'node:util';

const execute = promisify(execFile);
const repository = resolve(import.meta.dirname, '../..');
const startupAttempts = 80;
const pollMilliseconds = 100;
const requestTimeoutMilliseconds = 2_000;

const unusedPort = async (): Promise<number> => {
  const listener = createServer();
  await new Promise<void>((ready: () => void) => listener.listen(0, '127.0.0.1', ready));
  const address = listener.address();
  assert.ok(address !== null && typeof address !== 'string');
  await new Promise<void>((closed: () => void) => listener.close(() => closed()));
  return address.port;
};

const writeJson = (path: string, value: object): Promise<void> =>
  writeFile(path, JSON.stringify(value));

const configure = async (scratch: string, origin: string, password: string): Promise<string> => {
  const configPath = resolve(scratch, 'config.json');
  const queryConfigFile = resolve(scratch, 'targets.json');
  const secretsFile = resolve(scratch, 'secrets.json');
  await writeJson(secretsFile, { version: 1, values: { 'management.password': password } });
  await writeJson(queryConfigFile, {
    schemaVersion: 1,
    timeZone: 'UTC',
    targets: [
      {
        id: 'smoke',
        label: 'Artifact smoke',
        retentionDays: 1,
        timeoutMs: 1_000,
        provider: { kind: 'loki', baseUrl: 'http://127.0.0.1:3100/' },
      },
    ],
  });
  await writeJson(configPath, {
    listen: origin,
    basePath: '/console',
    queryConfigFile,
    onlyOffice: { documentServerUrl: 'http://127.0.0.1' },
    telemetry: { collectorOrigin: 'http://127.0.0.1:4318' },
    onlyOfficeNativeProbe: { kind: 'disabled' },
    authentication: {
      secretsFile,
      passwordSecret: 'management.password',
      publicOrigin: origin,
      policy: {
        sessionLifetimeSeconds: 60,
        maximumSessions: 4,
        attemptWindowMilliseconds: 1_000,
        maximumAttemptsPerWindow: 4,
        maximumConcurrentAuthentications: 1,
      },
    },
  });
  return configPath;
};

const request = (url: string, options: RequestInit): Promise<Response> =>
  fetch(url, { ...options, signal: AbortSignal.timeout(requestTimeoutMilliseconds) });

const ready = async (process: ChildProcess, base: string, attempts: number): Promise<void> => {
  assert.equal(process.exitCode, null, 'Artifact exited during startup');
  const response = await request(`${base}/health`, {}).catch(() => undefined);
  if (response?.status === 200) {
    assert.deepEqual(await response.json(), { service: 'labframe-manager', status: 'ok' });
    return;
  }
  assert.ok(attempts > 0, 'Artifact did not become healthy');
  await setTimeout(pollMilliseconds);
  await ready(process, base, attempts - 1);
};

const verifyHttp = async (origin: string, password: string): Promise<void> => {
  const base = `${origin}/console`;
  assert.equal((await request(`${base}/api/v1/telemetry/targets`, {})).status, 401);
  const page = await request(`${base}/`, {});
  assert.equal(page.status, 200);
  assert.match(await page.text(), /password/iu);
  const login = await request(`${base}/auth/login`, {
    method: 'POST',
    redirect: 'manual',
    headers: { Origin: origin, 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ password }).toString(),
  });
  assert.equal(login.status, 303);
  const cookie = login.headers.get('set-cookie')?.split(';')[0];
  assert.ok(cookie !== undefined && cookie.length > 0);
  const dashboard = await request(`${base}/`, { headers: { Cookie: cookie } });
  assert.equal(dashboard.status, 200);
  assert.match(await dashboard.text(), /assets\/app\.js/u);
  const asset = await request(`${base}/assets/app.js`, { headers: { Cookie: cookie } });
  assert.equal(asset.status, 200);
  assert.ok((await asset.text()).length > 1_000);
};

const smoke = async (): Promise<void> => {
  const selected = process.argv[2];
  assert.ok(selected, 'Usage: pnpm test:artifact <release-directory>');
  const parent = resolve(repository, 'build/deploy');
  await mkdir(parent, { recursive: true });
  const scratch = await mkdtemp(resolve(parent, 'manager-artifact-'));
  const relocated = resolve(scratch, 'relocated');
  await cp(resolve(selected), relocated, { recursive: true });
  const executable = resolve(relocated, 'labframe-manager.exe');
  const identity = await execute(executable, ['--build-info'], { cwd: scratch });
  assert.equal(
    identity.stdout.trim(),
    (await readFile(resolve(relocated, 'build-identity.json'), 'utf8')).trim()
  );
  const origin = `http://127.0.0.1:${await unusedPort()}`;
  const password = randomBytes(32).toString('base64url');
  const config = await configure(scratch, origin, password);
  const child = spawn(executable, ['--config', config], { cwd: scratch, windowsHide: true });
  const chunks: string[] = [];
  child.stdout.on('data', (chunk: Buffer): void => {
    chunks.push(chunk.toString());
  });
  child.stderr.on('data', (chunk: Buffer): void => {
    chunks.push(chunk.toString());
  });
  try {
    await ready(child, `${origin}/console`, startupAttempts);
    await verifyHttp(origin, password);
    process.stdout.write(
      `PASS relocated Manager identity, health, sign-in, dashboard and assets: ${scratch}\n`
    );
  } finally {
    child.kill();
    await writeFile(resolve(scratch, 'process.log'), chunks.join(''));
  }
};

void smoke().catch((error: unknown): void => {
  console.error('Manager artifact smoke failed:', error);
  process.exitCode = 1;
});
