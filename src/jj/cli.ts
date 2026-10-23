import { execFile } from "node:child_process";

export interface CommandLog {
  append(line: string): void;
}

export class CommandError extends Error {
  constructor(
    readonly command: string,
    readonly stderr: string,
    readonly exitCode: number | null,
  ) {
    super(stderr.trim() || `${command} failed`);
  }
}

export interface RunOptions {
  /** Hide the command from the command log (used for frequent read-only queries). */
  quiet?: boolean;
  stdin?: string;
}

/**
 * Runs a CLI tool in the repo, one command at a time.
 *
 * jj copes with concurrent operations, but running them in order keeps the
 * graph and the command log easy to follow.
 */
export class Runner {
  private queue: Promise<unknown> = Promise.resolve();

  constructor(
    private readonly executable: () => string,
    readonly cwd: string,
    private readonly log: CommandLog,
    private readonly baseArgs: string[] = [],
    private readonly env: NodeJS.ProcessEnv = {},
  ) {}

  run(args: string[], opts: RunOptions = {}): Promise<string> {
    const next = this.queue.then(() => this.exec(args, opts));
    this.queue = next.catch(() => undefined);
    return next;
  }

  private exec(args: string[], opts: RunOptions): Promise<string> {
    const exe = this.executable();
    const display = [exe, ...args].map(quote).join(" ");
    if (!opts.quiet) this.log.append(`$ ${display}`);
    return new Promise((resolve, reject) => {
      const child = execFile(
        exe,
        [...this.baseArgs, ...args],
        { cwd: this.cwd, env: { ...process.env, ...this.env }, maxBuffer: 64 * 1024 * 1024 },
        (err, stdout, stderr) => {
          if (err) {
            const code = typeof err.code === "number" ? err.code : null;
            const message = stderr || err.message;
            // Failures are always logged, even for quiet queries.
            if (opts.quiet) this.log.append(`$ ${display}`);
            this.log.append(message.trimEnd());
            reject(new CommandError(display, message, code));
            return;
          }
          if (!opts.quiet && stderr.trim()) this.log.append(stderr.trimEnd());
          resolve(stdout);
        },
      );
      if (opts.stdin !== undefined) {
        child.stdin?.end(opts.stdin);
      }
    });
  }
}

function quote(arg: string): string {
  return /^[\w@%+=:,./-]+$/.test(arg) ? arg : `'${arg.replace(/'/g, `'\\''`)}'`;
}
