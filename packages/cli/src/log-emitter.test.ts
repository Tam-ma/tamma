import { describe, it, expect, vi } from 'vitest';
import { createLogEmitter, createLoggerBridge } from './log-emitter.js';

describe('createLogEmitter', () => {
  it('should emit entries to subscribers', () => {
    const emitter = createLogEmitter();
    const received: string[] = [];
    emitter.subscribe((entry) => { received.push(entry.message); });

    emitter.emit('info', 'hello');
    emitter.emit('warn', 'caution');

    expect(received).toEqual(['hello', 'caution']);
  });

  it('should store entries in history', () => {
    const emitter = createLogEmitter();
    emitter.emit('info', 'first');
    emitter.emit('error', 'second');

    const history = emitter.getHistory();
    expect(history).toHaveLength(2);
    expect(history[0]!.message).toBe('first');
    expect(history[0]!.level).toBe('info');
    expect(history[1]!.message).toBe('second');
    expect(history[1]!.level).toBe('error');
  });

  it('should bound history to maxHistory', () => {
    const emitter = createLogEmitter(3);
    emitter.emit('info', 'a');
    emitter.emit('info', 'b');
    emitter.emit('info', 'c');
    emitter.emit('info', 'd');

    const history = emitter.getHistory();
    expect(history).toHaveLength(3);
    expect(history[0]!.message).toBe('b');
    expect(history[2]!.message).toBe('d');
  });

  it('should return unsubscribe function', () => {
    const emitter = createLogEmitter();
    const received: string[] = [];
    const unsubscribe = emitter.subscribe((entry) => { received.push(entry.message); });

    emitter.emit('info', 'before');
    unsubscribe();
    emitter.emit('info', 'after');

    expect(received).toEqual(['before']);
  });

  it('should support multiple listeners', () => {
    const emitter = createLogEmitter();
    const a: string[] = [];
    const b: string[] = [];
    emitter.subscribe((entry) => { a.push(entry.message); });
    emitter.subscribe((entry) => { b.push(entry.message); });

    emitter.emit('info', 'msg');

    expect(a).toEqual(['msg']);
    expect(b).toEqual(['msg']);
  });

  it('should include timestamp and context in entries', () => {
    const emitter = createLogEmitter();
    const before = Date.now();
    emitter.emit('debug', 'test', { key: 'value' });
    const after = Date.now();

    const entry = emitter.getHistory()[0]!;
    expect(entry.timestamp).toBeGreaterThanOrEqual(before);
    expect(entry.timestamp).toBeLessThanOrEqual(after);
    expect(entry.context).toEqual({ key: 'value' });
  });
});

describe('createLoggerBridge', () => {
  it('should route debug/info/warn/error through emitter', () => {
    const emitter = createLogEmitter();
    const logger = createLoggerBridge(emitter);

    logger.debug('d msg');
    logger.info('i msg');
    logger.warn('w msg');
    logger.error('e msg');

    const history = emitter.getHistory();
    expect(history).toHaveLength(4);
    expect(history[0]!.level).toBe('debug');
    expect(history[0]!.message).toBe('d msg');
    expect(history[1]!.level).toBe('info');
    expect(history[2]!.level).toBe('warn');
    expect(history[3]!.level).toBe('error');
  });

  it('should pass context through', () => {
    const emitter = createLogEmitter();
    const logger = createLoggerBridge(emitter);

    logger.info('msg', { foo: 'bar' });

    const entry = emitter.getHistory()[0]!;
    expect(entry.context).toEqual({ foo: 'bar' });
  });
});
