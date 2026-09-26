type Level = 'debug' | 'info' | 'warn' | 'error'

export function logger(scope: string): Record<Level, (...args: unknown[]) => void> {
  const write = (level: Level, args: unknown[]): void => {
    const line = `[${new Date().toISOString()}] [${scope}] ${args.map((a) => (a instanceof Error ? a.stack ?? a.message : typeof a === 'string' ? a : JSON.stringify(a))).join(' ')}`
    if (level === 'error' || level === 'warn') process.stderr.write(line + '\n')
    else process.stdout.write(line + '\n')
  }
  return {
    debug: (...a) => write('debug', a),
    info: (...a) => write('info', a),
    warn: (...a) => write('warn', a),
    error: (...a) => write('error', a),
  }
}
