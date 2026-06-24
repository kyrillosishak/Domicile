/**
 * Centralized logger for Domicile.
 * 
 * Replaces scattered console.warn/error/debug/log calls with a configurable
 * logger that can be silenced in production, redirected to a custom sink,
 * or enhanced with structured logging.
 */

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

export interface LogEntry {
  level: LogLevel;
  message: string;
  timestamp: number;
  context?: Record<string, unknown>;
}

export interface Logger {
  debug(message: string, context?: Record<string, unknown>): void;
  info(message: string, context?: Record<string, unknown>): void;
  warn(message: string, context?: Record<string, unknown>): void;
  error(message: string, context?: Record<string, unknown>): void;
  setLevel(level: LogLevel): void;
  getLevel(): LogLevel;
}

const LEVEL_ORDER: LogLevel[] = ['debug', 'info', 'warn', 'error'];

function shouldLog(currentLevel: LogLevel, messageLevel: LogLevel): boolean {
  return LEVEL_ORDER.indexOf(messageLevel) >= LEVEL_ORDER.indexOf(currentLevel);
}

class ConsoleLogger implements Logger {
  private level: LogLevel = 'info';
  private prefix = '[Domicile]';

  setLevel(level: LogLevel): void {
    this.level = level;
  }

  getLevel(): LogLevel {
    return this.level;
  }

  private log(level: LogLevel, message: string, context?: Record<string, unknown>): void {
    if (!shouldLog(this.level, level)) return;

    const timestamp = new Date().toISOString();
    const contextStr = context ? ` ${JSON.stringify(context)}` : '';
    const formatted = `${this.prefix} [${level.toUpperCase()}] ${timestamp} - ${message}${contextStr}`;

    switch (level) {
      case 'debug':
        console.debug(formatted);
        break;
      case 'info':
        console.log(formatted);
        break;
      case 'warn':
        console.warn(formatted);
        break;
      case 'error':
        console.error(formatted);
        break;
    }
  }

  debug(message: string, context?: Record<string, unknown>): void {
    this.log('debug', message, context);
  }

  info(message: string, context?: Record<string, unknown>): void {
    this.log('info', message, context);
  }

  warn(message: string, context?: Record<string, unknown>): void {
    this.log('warn', message, context);
  }

  error(message: string, context?: Record<string, unknown>): void {
    this.log('error', message, context);
  }
}

export const logger = new ConsoleLogger();

export function setLogLevel(level: LogLevel): void {
  logger.setLevel(level);
}

export function getLogLevel(): LogLevel {
  return logger.getLevel();
}