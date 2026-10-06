/**
 * hermes send — delivers messages through Hermes' OWN messaging gateway
 * on the VM, via SSH stdin (no LLM, no agent loop, no quoting pitfalls).
 *
 * This is what makes "Hermes posted it" literally true: the message goes
 * out through the same Discord/Telegram bot credentials the gateway uses,
 * from the VM, as the openclaw user.
 *
 * Message text travels over ssh stdin:
 *   ssh -i <key> user@host "sudo -nu openclaw bash -lc 'cd ~/.hermes && python -m hermes_cli.main send -t discord'"
 * `hermes send` reads the message from stdin when no positional arg is given,
 * so arbitrary text (newlines, quotes, emoji) is safe unescaped.
 */
import { spawn } from 'node:child_process';
import { config } from '../config.js';

const REMOTE_WORKDIR = '/home/openclaw/.hermes';
const REMOTE_PYTHON = './hermes-agent/venv/bin/python';
const SEND_TIMEOUT_MS = 25_000;

export function hermesSendConfigured(): boolean {
  return Boolean(config.hermes.sendSshHost && config.hermes.sendSshUser);
}

export async function hermesSend(
  message: string,
  target?: string,
): Promise<void> {
  if (!hermesSendConfigured()) {
    throw new Error(
      'hermes send not configured — set HERMES_SEND_SSH_HOST and HERMES_SEND_SSH_USER in .env',
    );
  }
  const dest = target ?? config.hermes.sendTarget;
  const remoteCmd =
    `cd ${REMOTE_WORKDIR} && ${REMOTE_PYTHON} -m hermes_cli.main send -t ${dest}`;
    const full = `sudo -nu ${config.hermes.sendSudoUser} bash -lc '${remoteCmd}'`;

  const whichSsh =
    process.env.HERMES_SSH_BIN ??
    (process.platform === 'win32'
      ? 'C:/Windows/System32/OpenSSH/ssh.exe'
      : 'ssh');

  const sshArgs = [
    '-i',
    config.hermes.sendSshKey,
    '-o',
    'BatchMode=yes',
    '-o',
    'ConnectTimeout=10',
    '-o',
    'StrictHostKeyChecking=no',
    `${config.hermes.sendSshUser}@${config.hermes.sendSshHost}`,
    full,
  ];

  await new Promise<void>((resolvePromise, reject) => {
    const child = spawn(whichSsh, sshArgs, { stdio: ['pipe', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    const timer = setTimeout(() => {
      child.kill('SIGKILL');
      reject(new Error('hermes send timed out'));
    }, SEND_TIMEOUT_MS);
    child.stdout.on('data', (d) => (stdout += d));
    child.stderr.on('data', (d) => (stderr += d));
    child.on('error', (err) => {
      clearTimeout(timer);
      reject(err);
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      if (code === 0) {
        resolvePromise();
      } else {
        reject(
          new Error(
            `hermes send exited ${code}: ${(stderr || stdout).slice(0, 200)}`,
          ),
        );
      }
    });
    child.stdin.write(message);
    child.stdin.end();
  });
}
