import { describe, it, expect, beforeEach, vi } from 'vitest';
import { WorkerPool, type WorkerTask } from './WorkerPool';

describe('WorkerPool', () => {
  let pool: WorkerPool;

  beforeEach(() => {
    vi.resetModules();
    vi.stubGlobal('Worker', vi.fn().mockImplementation(() => ({
      onmessage: null,
      onerror: null,
      postMessage: vi.fn(),
      terminate: vi.fn(),
    })));
    vi.stubGlobal('navigator', { hardwareConcurrency: 2 });
    pool = new WorkerPool({ maxWorkers: 2 });
  });

  it('should create with default config', () => {
    expect(pool.getAvailableWorkerCount()).toBe(0);
    expect(pool.getPendingTaskCount()).toBe(0);
  });

  it('should throw if no workers can be created', async () => {
    vi.stubGlobal('Worker', vi.fn().mockImplementation(() => {
      throw new Error('Worker creation failed');
    }));
    const failingPool = new WorkerPool({ maxWorkers: 1 });
    await expect(failingPool.initialize('worker.js')).rejects.toThrow('Failed to create any workers');
  });

  it('should execute a task', async () => {
    const mockWorker = {
      onmessage: null as ((event: MessageEvent) => void) | null,
      onerror: null as ((error: ErrorEvent) => void) | null,
      postMessage: vi.fn(),
      terminate: vi.fn(),
    };
    vi.stubGlobal('Worker', vi.fn().mockReturnValue(mockWorker));
    const newPool = new WorkerPool({ maxWorkers: 1 });
    await newPool.initialize('worker.js');

    const task: WorkerTask = { type: 'test', data: 'hello' };
    const executePromise = newPool.execute(task);

    // Simulate worker response
    const response = { success: true, result: 'done' };
    mockWorker.onmessage?.({ data: response } as MessageEvent);

    await expect(executePromise).resolves.toBe('done');
  });

  it('should reject task on worker error response', async () => {
    const mockWorker = {
      onmessage: null as ((event: MessageEvent) => void) | null,
      onerror: null as ((error: ErrorEvent) => void) | null,
      postMessage: vi.fn(),
      terminate: vi.fn(),
    };
    vi.stubGlobal('Worker', vi.fn().mockReturnValue(mockWorker));
    const newPool = new WorkerPool({ maxWorkers: 1 });
    await newPool.initialize('worker.js');

    const task: WorkerTask = { type: 'test', data: 'hello' };
    const executePromise = newPool.execute(task);

    // Simulate worker error response
    const response = { success: false, error: 'Task failed' };
    mockWorker.onmessage?.({ data: response } as MessageEvent);

    await expect(executePromise).rejects.toThrow('Task failed');
  });

  it('should reject task on worker error event', async () => {
    const mockWorker = {
      onmessage: null as ((event: MessageEvent) => void) | null,
      onerror: null as ((error: ErrorEvent) => void) | null,
      postMessage: vi.fn(),
      terminate: vi.fn(),
    };
    vi.stubGlobal('Worker', vi.fn().mockReturnValue(mockWorker));
    const newPool = new WorkerPool({ maxWorkers: 1 });
    await newPool.initialize('worker.js');

    const task: WorkerTask = { type: 'test', data: 'hello' };
    const executePromise = newPool.execute(task);

    // Simulate worker error event
    mockWorker.onerror?.({ message: 'Worker crashed' } as ErrorEvent);

    await expect(executePromise).rejects.toThrow('Worker error: Worker crashed');
  });

  it('should execute batch of tasks', async () => {
    const mockWorker = {
      onmessage: null as ((event: MessageEvent) => void) | null,
      onerror: null as ((error: ErrorEvent) => void) | null,
      postMessage: vi.fn(),
      terminate: vi.fn(),
    };
    vi.stubGlobal('Worker', vi.fn().mockReturnValue(mockWorker));
    const newPool = new WorkerPool({ maxWorkers: 1 });
    await newPool.initialize('worker.js');

    const tasks: WorkerTask[] = [
      { type: 'test', data: '1' },
      { type: 'test', data: '2' },
    ];

    const executePromise = newPool.executeBatch(tasks);

    // Simulate responses
    mockWorker.onmessage?.({ data: { success: true, result: 'done1' } } as MessageEvent);
    mockWorker.onmessage?.({ data: { success: true, result: 'done2' } } as MessageEvent);

    await expect(executePromise).resolves.toEqual(['done1', 'done2']);
  });

  it('should dispose all workers', async () => {
    const mockWorker = {
      onmessage: null as ((event: MessageEvent) => void) | null,
      onerror: null as ((error: ErrorEvent) => void) | null,
      postMessage: vi.fn(),
      terminate: vi.fn(),
    };
    vi.stubGlobal('Worker', vi.fn().mockReturnValue(mockWorker));
    const newPool = new WorkerPool({ maxWorkers: 1 });
    await newPool.initialize('worker.js');

    newPool.dispose();
    expect(mockWorker.terminate).toHaveBeenCalled();
    expect(newPool.getAvailableWorkerCount()).toBe(0);
    expect(newPool.getPendingTaskCount()).toBe(0);
  });
});