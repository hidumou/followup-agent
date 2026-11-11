import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { createHash } from 'node:crypto';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';

const exec = promisify(execFile);
interface SchedulerTarget { root: string; dbUrl: string }
export interface RunnerStatus { supported: boolean; installed: boolean; loaded: boolean; lastExitCode?: number }
const cache = new Map<string, { at: number; status: RunnerStatus }>();
const escapeXml = (value: string) => value.replace(/[<>&"']/g, char => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;', "'": '&apos;' })[char]!);

export function launchdIdentity(target: SchedulerTarget) {
  const hash = createHash('sha256').update(`${target.root}\n${target.dbUrl}`).digest('hex').slice(0, 12);
  const label = `local.followup-agent.schedule.${hash}`;
  return { label, file: join(homedir(), 'Library/LaunchAgents', `${label}.plist`), service: `gui/${process.getuid?.()}/${label}` };
}
export function launchdPlist(target: SchedulerTarget, executable = process.execPath): string {
  const { label } = launchdIdentity(target);
  const args = [executable, '--env-file-if-exists=.env', join(target.root, 'src/cli/schedule-tick.ts')];
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
<key>Label</key><string>${label}</string>
<key>ProgramArguments</key><array>${args.map(arg => `<string>${escapeXml(arg)}</string>`).join('')}</array>
<key>WorkingDirectory</key><string>${escapeXml(target.root)}</string>
<key>EnvironmentVariables</key><dict><key>DB_URL</key><string>${escapeXml(target.dbUrl)}</string></dict>
<key>StartInterval</key><integer>30</integer>
<key>ProcessType</key><string>Background</string>
<key>StandardOutPath</key><string>${escapeXml(join(target.root, 'logs/schedule.log'))}</string>
<key>StandardErrorPath</key><string>${escapeXml(join(target.root, 'logs/schedule-error.log'))}</string>
</dict></plist>
`;
}
export async function runnerStatus(target: SchedulerTarget, fresh = false): Promise<RunnerStatus> {
  const { file, service } = launchdIdentity(target);
  const cached = cache.get(service);
  if (!fresh && cached && Date.now() - cached.at < 5000) return cached.status;
  const status: RunnerStatus = { supported: process.platform === 'darwin', installed: false, loaded: false };
  if (status.supported) {
    try { await readFile(file); status.installed = true; } catch { /* Not installed. */ }
    try {
      const { stdout } = await exec('/bin/launchctl', ['print', service], { timeout: 3000, maxBuffer: 64 * 1024 });
      status.loaded = true;
      const exit = stdout.match(/last exit code = (\d+)/);
      if (exit) status.lastExitCode = Number(exit[1]);
    } catch { /* No loaded user agent. */ }
  }
  cache.set(service, { at: Date.now(), status });
  return status;
}
export async function installRunner(target: SchedulerTarget): Promise<void> {
  if (process.platform !== 'darwin') throw new Error('LAUNCHD_UNSUPPORTED');
  const { file } = launchdIdentity(target);
  const current = await runnerStatus(target, true);
  if (current.loaded) return;
  await mkdir(dirname(file), { recursive: true });
  await mkdir(join(target.root, 'logs'), { recursive: true });
  await writeFile(file, launchdPlist(target), { mode: 0o600 });
  await exec('/usr/bin/plutil', ['-lint', file]);
  await exec('/bin/launchctl', ['bootstrap', `gui/${process.getuid?.()}`, file], { timeout: 10_000 });
  cache.clear();
}
export async function wakeRunner(target: SchedulerTarget): Promise<void> {
  await exec('/bin/launchctl', ['kickstart', launchdIdentity(target).service], { timeout: 10_000 });
}
export async function uninstallRunner(target: SchedulerTarget): Promise<void> {
  const { file, service } = launchdIdentity(target);
  if ((await runnerStatus(target, true)).loaded) await exec('/bin/launchctl', ['bootout', service], { timeout: 10_000 });
  await rm(file, { force: true });
  cache.clear();
}
