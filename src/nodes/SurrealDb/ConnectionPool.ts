import { Surreal } from "surrealdb";
import type { ISurrealCredentials } from "./types/surrealDb.types";
import { DEBUG } from "./debug";
import {
    ErrorCategory,
    EnhancedError,
    retryWithBackoff,
    DEFAULT_RETRY_CONFIG,
} from "./errorHandling";
import { createHash } from "crypto";

/**
 * Connection pool configuration
 */
export interface IConnectionPoolConfig {
    maxConnections: number;
    minConnections: number;
    acquireTimeout: number;
    healthCheckInterval: number;
    maxIdleTime: number;
    retryAttempts: number;
    retryDelay: number;
    enableConnectionValidation: boolean;
    connectionValidationTimeout: number;
}

/**
 * Default connection pool configuration
 */
export const DEFAULT_POOL_CONFIG: IConnectionPoolConfig = {
    maxConnections: 10,
    minConnections: 2,
    acquireTimeout: 30000, // 30 seconds
    healthCheckInterval: 60000, // 1 minute
    maxIdleTime: 300000, // 5 minutes
    retryAttempts: 3,
    retryDelay: 1000, // 1 second
    enableConnectionValidation: true,
    connectionValidationTimeout: 5000, // 5 seconds
};

/**
 * Connection pool entry
 */
interface IPoolEntry {
    client: Surreal;
    lastUsed: number;
    isHealthy: boolean;
    inUse: boolean;
    created: number;
    lastHealthCheck: number;
    errorCount: number;
}

/**
 * Connection pool statistics
 */
export interface IPoolStats {
    totalConnections: number;
    activeConnections: number;
    idleConnections: number;
    waitingRequests: number;
    totalRequests: number;
    failedRequests: number;
    averageResponseTime: number;
    poolUtilization: number;
    connectionErrors: number;
    healthCheckFailures: number;
}

/**
 * SurrealDB Connection Pool
 *
 * Manages a pool of SurrealDB connections to improve performance
 * and reduce connection overhead.
 */
export class SurrealConnectionPool {
    private pool: Map<string, IPoolEntry[]> = new Map();
    private config: IConnectionPoolConfig;
    private healthCheckTimers: Map<string, NodeJS.Timeout> = new Map();
    private stats: {
        totalRequests: number;
        failedRequests: number;
        totalResponseTime: number;
        waitingRequests: number;
        connectionErrors: number;
        healthCheckFailures: number;
    } = {
        totalRequests: 0,
        failedRequests: 0,
        totalResponseTime: 0,
        waitingRequests: 0,
        connectionErrors: 0,
        healthCheckFailures: 0,
    };

    constructor(config: Partial<IConnectionPoolConfig> = {}) {
        this.config = { ...DEFAULT_POOL_CONFIG, ...config };
    }

    /**
     * Get a connection from the pool with enhanced error handling and validation
     */
    async getConnection(credentials: ISurrealCredentials): Promise<Surreal> {
        const poolKey = this.generatePoolKey(credentials);
        const startTime = Date.now();

        try {
            this.stats.totalRequests++;
            this.stats.waitingRequests++;

            const connection = await this.acquireConnection(
                poolKey,
                credentials,
            );

            // Validate connection if enabled
            if (this.config.enableConnectionValidation) {
                await this.validateConnection(connection, poolKey);
            }

            this.stats.totalResponseTime += Date.now() - startTime;
            this.stats.waitingRequests--;

            if (DEBUG) {
                // eslint-disable-next-line no-console
                console.log(
                    `[ConnectionPool] Acquired connection for ${poolKey} in ${Date.now() - startTime}ms`,
                );
            }

            return connection;
        } catch (error) {
            this.stats.failedRequests++;
            this.stats.waitingRequests--;

            if (DEBUG) {
                // eslint-disable-next-line no-console
                console.error(
                    `[ConnectionPool] Failed to acquire connection for ${poolKey}:`,
                    error,
                );
            }

            throw error;
        }
    }

    /**
     * Release a connection back to the pool with enhanced tracking
     */
    releaseConnection(credentials: ISurrealCredentials, client: Surreal): void {
        const poolKey = this.generatePoolKey(credentials);
        const pool = this.pool.get(poolKey);

        if (!pool) {
            if (DEBUG) {
                // eslint-disable-next-line no-console
                console.warn(`[ConnectionPool] No pool found for ${poolKey}`);
            }
            return;
        }

        const entry = pool.find(e => e.client === client);
        if (entry) {
            entry.inUse = false;
            entry.lastUsed = Date.now();

            if (DEBUG) {
                // eslint-disable-next-line no-console
                console.log(
                    `[ConnectionPool] Released connection for ${poolKey}`,
                );
            }
        }
    }

    /**
     * Close all connections in the pool with enhanced cleanup
     */
    async close(): Promise<void> {
        if (DEBUG) {
            // eslint-disable-next-line no-console
            console.log("[ConnectionPool] Closing all connections...");
        }

        // Clear health check timers
        for (const timer of this.healthCheckTimers.values()) {
            clearInterval(timer);
        }
        this.healthCheckTimers.clear();

        // Close all connections with enhanced error handling
        const closePromises: Promise<void>[] = [];

        for (const [poolKey, pool] of this.pool.entries()) {
            for (const entry of pool) {
                closePromises.push(
                    this.closeConnectionSafely(entry.client, poolKey),
                );
            }
        }

        await Promise.all(closePromises);
        this.pool.clear();

        if (DEBUG) {
            // eslint-disable-next-line no-console
            console.log("[ConnectionPool] All connections closed");
        }
    }

    /**
     * Get enhanced pool statistics
     */
    getStats(): IPoolStats {
        let totalConnections = 0;
        let activeConnections = 0;
        let idleConnections = 0;

        for (const pool of this.pool.values()) {
            totalConnections += pool.length;
            for (const entry of pool) {
                if (entry.inUse) {
                    activeConnections++;
                } else {
                    idleConnections++;
                }
            }
        }

        const poolUtilization =
            totalConnections > 0
                ? (activeConnections / totalConnections) * 100
                : 0;

        return {
            totalConnections,
            activeConnections,
            idleConnections,
            waitingRequests: this.stats.waitingRequests,
            totalRequests: this.stats.totalRequests,
            failedRequests: this.stats.failedRequests,
            averageResponseTime:
                this.stats.totalRequests > 0
                    ? this.stats.totalResponseTime / this.stats.totalRequests
                    : 0,
            poolUtilization: Math.round(poolUtilization),
            connectionErrors: this.stats.connectionErrors,
            healthCheckFailures: this.stats.healthCheckFailures,
        };
    }

    /**
     * Acquire a connection from the pool or create a new one with enhanced retry logic
     */
    private async acquireConnection(
        poolKey: string,
        credentials: ISurrealCredentials,
    ): Promise<Surreal> {
        try {
            const pool = this.pool.get(poolKey) || [];
            this.pool.set(poolKey, pool);

            // Try to find an available connection
            const availableEntry = pool.find(
                entry => !entry.inUse && entry.isHealthy,
            );
            if (availableEntry) {
                availableEntry.inUse = true;
                availableEntry.lastUsed = Date.now();
                
                // Validate the connection before returning it
                try {
                    if (this.config.enableConnectionValidation) {
                        await this.validateConnection(availableEntry.client, poolKey);
                    }
                    return availableEntry.client;
                } catch (validationError) {
                    // Mark connection as unhealthy and try another one
                    availableEntry.isHealthy = false;
                    availableEntry.inUse = false;
                    availableEntry.errorCount++;
                    
                    if (DEBUG) {
                        console.warn(
                            `[ConnectionPool] Existing connection validation failed for ${poolKey}, will create new one`,
                            validationError,
                        );
                    }
                    
                    // Remove the unhealthy connection
                    const index = pool.indexOf(availableEntry);
                    if (index > -1) {
                        pool.splice(index, 1);
                        await this.closeConnectionSafely(availableEntry.client, poolKey);
                    }
                }
            }

            // Create a new connection if we haven't reached the limit
            if (pool.length < this.config.maxConnections) {
                try {
                    const client = await this.createConnectionWithRetry(credentials);
                    const entry: IPoolEntry = {
                        client,
                        lastUsed: Date.now(),
                        isHealthy: true,
                        inUse: true,
                        created: Date.now(),
                        lastHealthCheck: Date.now(),
                        errorCount: 0,
                    };

                    pool.push(entry);

                    // Start health check if not already running
                    if (!this.healthCheckTimers.has(poolKey)) {
                        this.startHealthCheck(poolKey);
                    }

                    return client;
                } catch (createError) {
                    // Enhanced error handling for connection creation failures
                    this.stats.connectionErrors++;
                    
                    if (DEBUG) {
                        console.error(
                            `[ConnectionPool] Failed to create new connection for ${poolKey}:`,
                            createError,
                        );
                    }
                    
                    // Re-throw with enhanced context
                    const enhancedError = new EnhancedError(
                        `Failed to create connection: ${createError instanceof Error ? createError.message : 'Unknown error'}`,
                        ErrorCategory.CONNECTION_ERROR,
                    );
                    enhancedError.poolKey = poolKey;
                    enhancedError.poolSize = pool.length;
                    enhancedError.maxConnections = this.config.maxConnections;
                    throw enhancedError;
                }
            }

            // Wait for a connection to become available
            try {
                return await this.waitForConnection(poolKey);
            } catch (waitError) {
                // Enhanced error handling for wait timeout
                const enhancedError = new EnhancedError(
                    `Connection pool exhausted and timeout reached: ${waitError instanceof Error ? waitError.message : 'Unknown error'}`,
                    ErrorCategory.TIMEOUT_ERROR,
                );
                enhancedError.poolKey = poolKey;
                enhancedError.poolSize = pool.length;
                enhancedError.activeConnections = pool.filter(e => e.inUse).length;
                throw enhancedError;
            }
        } catch (error) {
            // Log the error with context
            if (DEBUG) {
                console.error(
                    `[ConnectionPool] Failed to acquire connection for ${poolKey}:`,
                    error,
                );
            }
            
            // Ensure error has proper categorization
            if (!(error instanceof EnhancedError)) {
                const enhancedError = new EnhancedError(
                    error instanceof Error ? error.message : 'Unknown error',
                    ErrorCategory.SYSTEM_ERROR,
                );
                throw enhancedError;
            }
            
            throw error;
        }
    }

    /**
     * Create a new SurrealDB connection with enhanced error handling and retry logic
     */
    private async createConnectionWithRetry(
        credentials: ISurrealCredentials,
    ): Promise<Surreal> {
        return await retryWithBackoff(
            async () => {
                return await this.createConnection(credentials);
            },
            {
                ...DEFAULT_RETRY_CONFIG,
                maxRetries: this.config.retryAttempts,
                baseDelay: this.config.retryDelay,
                retryableErrors: [
                    ErrorCategory.CONNECTION_ERROR,
                    ErrorCategory.TIMEOUT_ERROR,
                    ErrorCategory.SYSTEM_ERROR,
                ],
            },
            {
                operation: "createConnection",
                connectionString:
                    credentials.connectionString.substring(0, 50) + "...",
                authentication: credentials.authentication,
            },
        );
    }

    /**
     * Create a new SurrealDB connection
     */
    private async createConnection(
        credentials: ISurrealCredentials,
    ): Promise<Surreal> {
        const client = new Surreal();
        const startTime = Date.now();

        try {
            // Connect with timeout
            const connectTimeout = 10000; // 10 seconds
            const connectPromise = client.connect(credentials.connectionString);
            
            // Create timeout with cleanup
            let timeoutHandle: NodeJS.Timeout | null = null;
            const timeoutPromise = new Promise<never>((_, reject) => {
                timeoutHandle = setTimeout(
                    () => reject(new Error(`Connection timeout after ${connectTimeout}ms`)),
                    connectTimeout,
                );
            });
            
            try {
                await Promise.race([connectPromise, timeoutPromise]);
            } finally {
                // Clean up the timeout regardless of outcome
                if (timeoutHandle) {
                    clearTimeout(timeoutHandle);
                }
            }

            // Set namespace and database if provided
            if (credentials.namespace) {
                await client.use({
                    namespace: credentials.namespace,
                    database: credentials.database || "test",
                });
            }

            // Authenticate based on authentication type with proper error handling
            try {
                if (credentials.authentication === "Root") {
                    await client.signin({
                        username: credentials.username,
                        password: credentials.password,
                    });
                } else if (credentials.authentication === "Namespace") {
                    await client.signin({
                        username: credentials.username,
                        password: credentials.password,
                        namespace: credentials.namespace,
                    });
                } else if (credentials.authentication === "Database") {
                    await client.signin({
                        username: credentials.username,
                        password: credentials.password,
                        namespace: credentials.namespace,
                        database: credentials.database,
                    });
                }
            } catch (authError) {
                // Enhanced authentication error
                const enhancedError = new EnhancedError(
                    `Authentication failed for ${credentials.authentication} level: ${authError instanceof Error ? authError.message : 'Unknown error'}`,
                    ErrorCategory.AUTHENTICATION_ERROR,
                );
                enhancedError.authentication = credentials.authentication;
                throw enhancedError;
            }

            const connectionTime = Date.now() - startTime;
            if (DEBUG) {
                // eslint-disable-next-line no-console
                console.log(
                    `[ConnectionPool] Created new connection in ${connectionTime}ms`,
                );
            }

            return client;
        } catch (error) {
            this.stats.connectionErrors++;
            
            // Ensure cleanup happens
            await this.closeConnectionSafely(client, 'failed-connection');
            
            // Enhance error with context if not already enhanced
            if (!(error instanceof EnhancedError)) {
                const enhancedError = new EnhancedError(
                    `Connection creation failed: ${error instanceof Error ? error.message : 'Unknown error'}`,
                    ErrorCategory.CONNECTION_ERROR,
                );
                enhancedError.connectionString = credentials.connectionString?.substring(0, 50) + '...';
                throw enhancedError;
            }
            
            throw error;
        }
    }

    /**
     * Validate a connection with a simple health check query
     */
    private async validateConnection(
        client: Surreal,
        poolKey: string,
    ): Promise<void> {
        let timeoutHandle: NodeJS.Timeout | null = null;
        try {
            const timeoutPromise = new Promise<never>((_, reject) => {
                timeoutHandle = setTimeout(
                    () => reject(new Error("Connection validation timeout")),
                    this.config.connectionValidationTimeout,
                );
            });

            const validationPromise = client.query("SELECT 1");

            await Promise.race([validationPromise, timeoutPromise]);
        } catch (error) {
            if (DEBUG) {
                // eslint-disable-next-line no-console
                console.warn(
                    `[ConnectionPool] Connection validation failed for ${poolKey}:`,
                    error,
                );
            }
            throw new Error(
                `Connection validation failed: ${error instanceof Error ? error.message : "Unknown error"}`,
            );
        } finally {
            // Clean up the timeout
            if (timeoutHandle) {
                clearTimeout(timeoutHandle);
            }
        }
    }

    /**
     * Wait for a connection to become available with enhanced timeout handling
     */
    private async waitForConnection(poolKey: string): Promise<Surreal> {
        return new Promise((resolve, reject) => {
            let timeout: NodeJS.Timeout | null = null;
            let checkInterval: NodeJS.Timeout | null = null;
            
            // Cleanup function to ensure all timers are cleared
            const cleanup = () => {
                if (timeout) {
                    clearTimeout(timeout);
                    timeout = null;
                }
                if (checkInterval) {
                    clearInterval(checkInterval);
                    checkInterval = null;
                }
            };
            
            // Set up timeout
            timeout = setTimeout(() => {
                cleanup();
                reject(
                    new Error(
                        `Timeout waiting for connection in pool ${poolKey} after ${this.config.acquireTimeout}ms`,
                    ),
                );
            }, this.config.acquireTimeout);

            // Set up interval to check for available connections
            checkInterval = setInterval(() => {
                try {
                    const pool = this.pool.get(poolKey);
                    if (!pool) {
                        cleanup();
                        reject(
                            new Error(`Pool ${poolKey} was removed while waiting`),
                        );
                        return;
                    }

                    const availableEntry = pool.find(
                        entry => !entry.inUse && entry.isHealthy,
                    );
                    if (availableEntry) {
                        cleanup();
                        availableEntry.inUse = true;
                        availableEntry.lastUsed = Date.now();
                        resolve(availableEntry.client);
                    }
                } catch (error) {
                    // Ensure cleanup happens even if an error occurs
                    cleanup();
                    reject(error);
                }
            }, 100);
        });
    }

    /**
     * Start health check for a pool with enhanced monitoring
     */
    private startHealthCheck(poolKey: string): void {
        const timer = setInterval(async () => {
            await this.performHealthCheck(poolKey);
        }, this.config.healthCheckInterval);

        this.healthCheckTimers.set(poolKey, timer);
    }

    /**
     * Perform health check on connections in a pool with enhanced error tracking
     */
    private async performHealthCheck(poolKey: string): Promise<void> {
        const pool = this.pool.get(poolKey);
        if (!pool) return;

        const healthCheckPromises = pool.map(async entry => {
            if (entry.inUse) return; // Skip connections in use

            try {
                // Simple health check query with timeout
                let timeoutHandle: NodeJS.Timeout | null = null;
                const timeoutPromise = new Promise<never>((_, reject) => {
                    timeoutHandle = setTimeout(
                        () => reject(new Error("Health check timeout")),
                        this.config.connectionValidationTimeout,
                    );
                });

                const healthCheckPromise = entry.client.query("SELECT 1");

                try {
                    await Promise.race([healthCheckPromise, timeoutPromise]);
                } finally {
                    // Clean up the timeout
                    if (timeoutHandle) {
                        clearTimeout(timeoutHandle);
                    }
                }

                entry.isHealthy = true;
                entry.lastHealthCheck = Date.now();
                entry.errorCount = 0;
            } catch (error) {
                this.stats.healthCheckFailures++;
                entry.errorCount++;
                entry.isHealthy = false;

                if (DEBUG) {
                    // eslint-disable-next-line no-console
                    console.warn(
                        `[ConnectionPool] Health check failed for connection in ${poolKey} (error count: ${entry.errorCount}):`,
                        error,
                    );
                }

                // Remove unhealthy connections after multiple failures
                if (entry.errorCount >= 3) {
                    const index = pool.indexOf(entry);
                    if (index > -1) {
                        pool.splice(index, 1);
                        await this.closeConnectionSafely(entry.client, poolKey);
                    }
                }
            }
        });

        await Promise.all(healthCheckPromises);

        // Clean up idle connections
        this.cleanupIdleConnections(poolKey);
    }

    /**
     * Clean up idle connections that exceed maxIdleTime with enhanced tracking
     */
    private cleanupIdleConnections(poolKey: string): void {
        const pool = this.pool.get(poolKey);
        if (!pool) return;

        const now = Date.now();
        const toRemove: IPoolEntry[] = [];

        for (const entry of pool) {
            if (
                !entry.inUse &&
                now - entry.lastUsed > this.config.maxIdleTime
            ) {
                toRemove.push(entry);
            }
        }

        // Remove idle connections while maintaining minimum pool size
        const canRemove = Math.min(
            toRemove.length,
            pool.length - this.config.minConnections,
        );

        for (let i = 0; i < canRemove; i++) {
            const entry = toRemove[i];
            const index = pool.indexOf(entry);
            if (index > -1) {
                pool.splice(index, 1);
                void this.closeConnectionSafely(entry.client, poolKey);
            }
        }

        if (canRemove > 0 && DEBUG) {
            // eslint-disable-next-line no-console
            console.log(
                `[ConnectionPool] Cleaned up ${canRemove} idle connections from ${poolKey}`,
            );
        }
    }

    /**
     * Safely close a connection with error handling
     */
    private async closeConnectionSafely(
        client: Surreal,
        poolKey: string,
    ): Promise<void> {
        try {
            await client.close();
        } catch (error) {
            if (DEBUG) {
                // eslint-disable-next-line no-console
                console.error(
                    `[ConnectionPool] Error closing connection in ${poolKey}:`,
                    error,
                );
            }
        }
    }

    /**
     * Generate a unique key for the connection pool using SHA-256 hashing
     * This provides better security by not exposing sensitive credentials in plain text
     * and prevents potential key collisions
     */
    private generatePoolKey(credentials: ISurrealCredentials): string {
        // Create a deterministic object representation for hashing
        const keyObject = {
            connectionString: credentials.connectionString,
            namespace: credentials.namespace || "default",
            database: credentials.database || "test",
            username: credentials.username || "",
            // Include password in the hash to ensure unique pools for different credentials
            // but don't expose it in plain text
            password: credentials.password || "",
        };
        
        // Generate SHA-256 hash of the serialized credentials
        const hash = createHash("sha256");
        hash.update(JSON.stringify(keyObject));
        return hash.digest("hex");
    }
}

/**
 * Global connection pool instance
 */
let globalConnectionPool: SurrealConnectionPool | null = null;

/**
 * Get or create the global connection pool
 */
export function getGlobalConnectionPool(
    config?: Partial<IConnectionPoolConfig>,
): SurrealConnectionPool {
    if (!globalConnectionPool) {
        globalConnectionPool = new SurrealConnectionPool(config);
    }
    return globalConnectionPool;
}

/**
 * Close the global connection pool
 */
export async function closeGlobalConnectionPool(): Promise<void> {
    if (globalConnectionPool) {
        await globalConnectionPool.close();
        globalConnectionPool = null;
    }
}
