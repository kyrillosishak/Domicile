import { describe, it, expect, vi } from 'vitest';
import { logger, setLogLevel, getLogLevel, type LogLevel } from './logger.js';

describe('Logger', () => {
  let consoleDebug: ReturnType<typeof vi.spyOn>;
  let consoleLog: ReturnType<typeof vi.spyOn>;
  let consoleWarn: ReturnType<typeof vi.spyOn>;
  let consoleError: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    consoleDebug = vi.spyOn(console, 'debug').mockImplementation(() => {});
    consoleLog = vi.spyOn(console, 'log').mockImplementation(() => {});
    consoleWarn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
    setLogLevel('debug');
  });

  afterEach(() => {
    vi.restoreAllMocks();
    setLogLevel('info');
  });

  it('should log debug when level is debug', () => {
    logger.debug('test message');
    expect(consoleDebug).toHaveBeenCalledWith(expect.stringContaining('test message'));
  });

  it('should log info when level is info', () => {
    setLogLevel('info');
    logger.info('test message');
    expect(consoleLog).toHaveBeenCalledWith(expect.stringContaining('test message'));
  });

  it('should log warn when level is warn', () => {
    setLogLevel('warn');
    logger.warn('test message');
    expect(consoleWarn).toHaveBeenCalledWith(expect.stringContaining('test message'));
  });

  it('should log error when level is error', () => {
    setLogLevel('error');
    logger.error('test message');
    expect(consoleError).toHaveBeenCalledWith(expect.stringContaining('test message'));
  });

  it('should not log debug when level is info', () => {
    setLogLevel('info');
    logger.debug('test message');
    expect(consoleDebug).not.toHaveBeenCalled();
  });

  it('should not log info when level is warn', () => {
    setLogLevel('warn');
    logger.info('test message');
    expect(consoleLog).not.toHaveBeenCalled();
  });

  it('should not log warn when level is error', () => {
    setLogLevel('error');
    logger.warn('test message');
    expect(consoleWarn).not.toHaveBeenCalled();
  });

  it('should always log error regardless of level', () => {
    setLogLevel('error');
    logger.error('test message');
    expect(consoleError).toHaveBeenCalledWith(expect.stringContaining('test message'));
  });

  it('should include context in log output', () => {
    logger.info('test', { key: 'value', num: 42 });
    expect(consoleLog).toHaveBeenCalledWith(expect.stringContaining('key'));
    expect(consoleLog).toHaveBeenCalledWith(expect.stringContaining('value'));
  });

  it('should set and get log level', () => {
    setLogLevel('debug');
    expect(getLogLevel()).toBe('debug');
    setLogLevel('warn');
    expect(getLogLevel()).toBe('warn');
  });

  it('should accept all valid log levels', () => {
    const levels: LogLevel[] = ['debug', 'info', 'warn', 'error'];
    for (const level of levels) {
      setLogLevel(level);
      expect(getLogLevel()).toBe(level);
    }
  });
});