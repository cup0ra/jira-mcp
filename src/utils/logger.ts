import type { Config } from '../config/config.js';
import { redact } from './errors.js';
export function createLogger(config: Pick<Config, 'pat' | 'logLevel'>) {
  const levels = ['error', 'warn', 'info', 'debug'];
  return (level: Config['logLevel'], message: string) => {
    if (levels.indexOf(level) <= levels.indexOf(config.logLevel)) {
      process.stderr.write(`[${level}] ${redact(message, config.pat)}\n`);
    }
  };
}
