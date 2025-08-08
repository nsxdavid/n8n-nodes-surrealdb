import type {
    IPairedItemData,
    INodeExecutionData,
    INode,
    IDataObject,
} from "n8n-workflow";
import { NodeOperationError } from "n8n-workflow";
import { RecordId } from "surrealdb";
import { createEnhancedErrorResult } from "./errorHandling";

/**
 * Generate paired item data for the given number of items
 */
export function generatePairedItemData(length: number): IPairedItemData[] {
    return Array.from({ length }, (_, index) => ({
        item: index,
    }));
}

/**
 * Create a RecordId object from table name and ID
 * This is required for SurrealDB operations that work with specific records
 * @param table The table name
 * @param id The record ID
 * @returns A RecordId object that can be used with SurrealDB SDK methods
 */
export function createRecordId(table: string, id: string): RecordId {
    return new RecordId(table, id);
}

/**
 * Normalize a record ID to string format "table:id"
 * Handles both object format {tb: "table", id: "id"} and string format "table:id"
 * @param recordId The record ID in either format
 * @returns The normalized string format "table:id"
 */
export function normalizeRecordId(recordId: unknown): string {
    // Handle object format {tb: "table", id: "id"}
    if (recordId && typeof recordId === "object" && !Array.isArray(recordId)) {
        const idObj = recordId as Record<string, unknown>;
        if ("tb" in idObj && "id" in idObj) {
            return `${idObj.tb}:${idObj.id}`;
        }
    }
    
    // Handle string format or convert to string
    return String(recordId || "");
}

/**
 * Parses and validates a record ID, handling multiple formats:
 * - String format: "table:id" or just "id"
 * - Object format: {tb: "table", id: "id"} (SurrealDB v2+ format)
 * If a composite ID is provided, it verifies that the table prefix matches the expected table.
 * @param recordIdInput The raw record ID from the node parameter (string or object).
 * @param expectedTable The expected table name for the operation.
 * @param node The n8n node instance for error reporting.
 * @param itemIndex The index of the current item for error reporting.
 * @returns The validated and potentially stripped record ID string.
 * @throws {NodeOperationError} If the record ID is invalid or the table prefix does not match.
 */
export function parseAndValidateRecordId(
    recordIdInput: string | unknown,
    expectedTable: string,
    node: INode,
    itemIndex: number,
): string {
    // Handle object format {tb: "table", id: "id"} from SurrealDB v2+
    if (recordIdInput && typeof recordIdInput === "object" && !Array.isArray(recordIdInput)) {
        const idObj = recordIdInput as Record<string, unknown>;
        
        // Check if it has the expected structure
        if ("tb" in idObj && "id" in idObj) {
            const table = String(idObj.tb || "");
            const id = String(idObj.id || "");
            
            // Verify table matches if one was provided
            if (expectedTable && table && table !== expectedTable) {
                throw new NodeOperationError(
                    node,
                    `Record ID table "${table}" does not match the specified table "${expectedTable}".`,
                    { itemIndex },
                );
            }
            
            return id;
        }
    }
    
    // Handle string format
    const idStr = String(recordIdInput || "");

    if (idStr.includes(":")) {
        const [tablePrefix, id] = idStr.split(":");
        if (expectedTable && tablePrefix !== expectedTable) {
            throw new NodeOperationError(
                node,
                `Record ID table prefix "${tablePrefix}" does not match the specified table "${expectedTable}".`,
                { itemIndex },
            );
        }

        // Strip SurrealDB angle brackets ⟨⟩ if present, as the RecordId constructor expects the raw ID
        let cleanId = id;
        if (id.startsWith("⟨") && id.endsWith("⟩")) {
            cleanId = id.slice(1, -1);
        }

        return cleanId;
    }
    return idStr;
}

/**
 * Normalize data to ensure proper JSON serialization
 * Converts undefined values to null so they don't get dropped during JSON serialization
 */
function normalizeForJson(obj: unknown): unknown {
    if (obj === undefined) {
        return null;
    }

    if (Array.isArray(obj)) {
        return obj.map(normalizeForJson);
    }

    if (obj !== null && typeof obj === "object") {
        const normalized: Record<string, unknown> = {};
        for (const key in obj) {
            if (Object.prototype.hasOwnProperty.call(obj, key)) {
                normalized[key] = normalizeForJson(
                    (obj as Record<string, unknown>)[key],
                );
            }
        }
        return normalized;
    }

    return obj;
}

/**
 * Format a single result as INodeExecutionData
 */
export function formatSingleResult(result: unknown): INodeExecutionData {
    return {
        json: normalizeForJson(result) as IDataObject,
    };
}

/**
 * Format an array of results as INodeExecutionData[]
 */
export function formatArrayResult(results: unknown[]): INodeExecutionData[] {
    return results.map(result => formatSingleResult(result));
}

/**
 * Create a success result with proper formatting
 */
export function createSuccessResult(
    data: Record<string, unknown>,
    itemIndex: number,
): INodeExecutionData {
    return {
        json: normalizeForJson(data) as IDataObject,
        pairedItem: {
            item: itemIndex,
        },
    };
}

/**
 * Add a success result to the return data
 */
export function addSuccessResult(
    returnData: INodeExecutionData[],
    data: Record<string, unknown>,
    itemIndex: number,
): void {
    returnData.push(createSuccessResult(data, itemIndex));
}

/**
 * Create an error result for failed operations
 */
export function createErrorResult(
    error: Error | string,
    itemIndex: number,
    operationName?: string,
    context?: Record<string, unknown>,
): INodeExecutionData {
    return createEnhancedErrorResult(
        typeof error === "string" ? new Error(error) : error,
        itemIndex,
        operationName,
        context,
    );
}

/**
 * Add an error result to the return data
 */
export function addErrorResult(
    returnData: INodeExecutionData[],
    error: Error | string,
    itemIndex: number,
    operationName?: string,
    context?: Record<string, unknown>,
): void {
    returnData.push(
        createErrorResult(error, itemIndex, operationName, context),
    );
}

/**
 * Validate connection pool configuration
 */
export function validatePoolConfig(config: Record<string, unknown>): {
    isValid: boolean;
    errors: string[];
} {
    const errors: string[] = [];

    // Validate numeric fields
    const numericFields = [
        "maxConnections",
        "minConnections",
        "acquireTimeout",
        "healthCheckInterval",
        "maxIdleTime",
        "retryAttempts",
        "retryDelay",
        "connectionValidationTimeout",
    ];

    for (const field of numericFields) {
        if (config[field] !== undefined) {
            const value = Number(config[field]);
            if (isNaN(value) || value < 0) {
                errors.push(`${field} must be a positive number`);
            }
        }
    }

    // Validate relationships between fields
    if (
        config.maxConnections !== undefined &&
        config.minConnections !== undefined
    ) {
        const maxConn = Number(config.maxConnections);
        const minConn = Number(config.minConnections);
        if (minConn > maxConn) {
            errors.push("minConnections cannot be greater than maxConnections");
        }
    }

    // Validate boolean fields
    if (config.enableConnectionValidation !== undefined) {
        if (typeof config.enableConnectionValidation !== "boolean") {
            errors.push("enableConnectionValidation must be a boolean");
        }
    }

    return {
        isValid: errors.length === 0,
        errors,
    };
}

/**
 * Format connection pool statistics for display
 */
export function formatPoolStats(stats: {
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
}): string {
    const successRate =
        stats.totalRequests > 0
            ? Math.round(
                  ((stats.totalRequests - stats.failedRequests) /
                      stats.totalRequests) *
                      100,
              )
            : 100;

    return [
        `Pool Status: ${stats.totalConnections} total, ${stats.activeConnections} active, ${stats.idleConnections} idle`,
        `Performance: ${stats.totalRequests} requests, ${successRate}% success rate, ${Math.round(stats.averageResponseTime)}ms avg response`,
        `Health: ${stats.poolUtilization}% utilization, ${stats.connectionErrors} connection errors, ${stats.healthCheckFailures} health check failures`,
        `Queue: ${stats.waitingRequests} waiting requests`,
    ].join(" | ");
}
