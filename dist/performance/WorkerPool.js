/**
 * Worker Pool for offloading computation to Web Workers
 * Supports embedding generation, vector search, and other CPU-intensive tasks
 */
/**
 * Manages a pool of Web Workers for parallel computation
 */
export class WorkerPool {
    constructor(config = {}) {
        this.workers = [];
        this.availableWorkers = [];
        this.taskQueue = [];
        this.workerTasks = new Map();
        this.config = {
            maxWorkers: navigator.hardwareConcurrency || 4,
            workerScript: '',
            ...config,
        };
    }
    /**
     * Initialize the worker pool
     */
    async initialize(workerScript) {
        this.config.workerScript = workerScript;
        // Create workers
        for (let i = 0; i < this.config.maxWorkers; i++) {
            try {
                const worker = new Worker(workerScript, { type: 'module' });
                this.workers.push(worker);
                this.availableWorkers.push(worker);
                // Set up message handler
                worker.onmessage = (event) => this.handleWorkerMessage(worker, event);
                worker.onerror = (error) => this.handleWorkerError(worker, error);
            }
            catch (error) {
                console.warn(`Failed to create worker ${i}:`, error);
            }
        }
        if (this.workers.length === 0) {
            throw new Error('Failed to create any workers');
        }
    }
    /**
     * Execute a task in the worker pool
     */
    async execute(task) {
        return new Promise((resolve, reject) => {
            // Add task to queue
            this.taskQueue.push({ task, resolve, reject });
            // Try to process queue
            this.processQueue();
        });
    }
    /**
     * Execute multiple tasks in parallel
     */
    async executeBatch(tasks) {
        return Promise.all(tasks.map(task => this.execute(task)));
    }
    /**
     * Get the number of available workers
     */
    getAvailableWorkerCount() {
        return this.availableWorkers.length;
    }
    /**
     * Get the number of pending tasks
     */
    getPendingTaskCount() {
        return this.taskQueue.length;
    }
    /**
     * Terminate all workers and clean up
     */
    dispose() {
        for (const worker of this.workers) {
            worker.terminate();
        }
        this.workers = [];
        this.availableWorkers = [];
        this.taskQueue = [];
        this.workerTasks.clear();
    }
    /**
     * Process the task queue
     */
    processQueue() {
        while (this.taskQueue.length > 0 && this.availableWorkers.length > 0) {
            const { task, resolve, reject } = this.taskQueue.shift();
            const worker = this.availableWorkers.shift();
            // Store task info for this worker
            this.workerTasks.set(worker, { resolve, reject });
            // Send task to worker
            if (task.transferables) {
                worker.postMessage(task, task.transferables);
            }
            else {
                worker.postMessage(task);
            }
        }
    }
    /**
     * Handle message from worker
     */
    handleWorkerMessage(worker, event) {
        const taskInfo = this.workerTasks.get(worker);
        if (!taskInfo) {
            console.warn('Received message from worker with no associated task');
            return;
        }
        const response = event.data;
        // Remove task info
        this.workerTasks.delete(worker);
        // Return worker to available pool
        this.availableWorkers.push(worker);
        // Resolve or reject the task
        if (response.success) {
            taskInfo.resolve(response.result);
        }
        else {
            taskInfo.reject(new Error(response.error || 'Worker task failed'));
        }
        // Process next task in queue
        this.processQueue();
    }
    /**
     * Handle worker error
     */
    handleWorkerError(worker, error) {
        const taskInfo = this.workerTasks.get(worker);
        if (taskInfo) {
            this.workerTasks.delete(worker);
            taskInfo.reject(new Error(`Worker error: ${error.message}`));
        }
        // Return worker to available pool (it might still be usable)
        if (!this.availableWorkers.includes(worker)) {
            this.availableWorkers.push(worker);
        }
        // Process next task
        this.processQueue();
    }
}
//# sourceMappingURL=WorkerPool.js.map