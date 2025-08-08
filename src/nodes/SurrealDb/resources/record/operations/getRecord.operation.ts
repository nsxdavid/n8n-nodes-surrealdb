import type { IExecuteFunctions, INodeExecutionData } from "n8n-workflow";
import { NodeOperationError } from "n8n-workflow";
import type { IOperationHandler } from "../../../types/operation.types";
import type { Surreal } from "surrealdb";
import {
    validateRequiredField,
    cleanTableName,
} from "../../../GenericFunctions";
import {
    formatSingleResult,
    createRecordId,
    parseAndValidateRecordId,
} from "../../../utilities";

import { debugLog } from "../../../debug";

/**
 * Get Record operation handler for Record resource
 */
export const getRecordOperation: IOperationHandler = {
    async execute(
        client: Surreal,
        items: INodeExecutionData[],
        executeFunctions: IExecuteFunctions,
        itemIndex: number,
    ): Promise<INodeExecutionData[]> {
        try {
            debugLog("getRecord", "Starting operation", itemIndex);
            // Get parameters for the specific item
            let table = executeFunctions.getNodeParameter(
                "table",
                itemIndex,
            ) as string;
            const idInput = executeFunctions.getNodeParameter("id", itemIndex);

            // Clean and standardize the table name if provided
            if (table) {
                table = cleanTableName(table);
            }

            debugLog("getRecord", "Original table:", itemIndex, table);
            debugLog("getRecord", "Record ID input:", itemIndex, idInput);

            // Try to extract table from the ID if no table is specified
            if (!table) {
                // Handle object format {tb: "table", id: "id"}
                if (
                    idInput &&
                    typeof idInput === "object" &&
                    !Array.isArray(idInput)
                ) {
                    const idObj = idInput as Record<string, unknown>;
                    if ("tb" in idObj && idObj.tb) {
                        table = cleanTableName(String(idObj.tb));
                        debugLog(
                            "getRecord",
                            "Extracted table from object:",
                            itemIndex,
                            table,
                        );
                    }
                }
                // Handle string format "table:id"
                else if (
                    idInput &&
                    typeof idInput === "string" &&
                    idInput.includes(":")
                ) {
                    table = cleanTableName(idInput.split(":")[0]);
                    debugLog(
                        "getRecord",
                        "Extracted table from string:",
                        itemIndex,
                        table,
                    );
                }
            }

            debugLog("getRecord", "Final table:", itemIndex, table);

            // Only validate table as required if it couldn't be extracted from the Record ID
            if (!table) {
                throw new NodeOperationError(
                    executeFunctions.getNode(),
                    'Either Table field must be provided or Record ID must include a table prefix (e.g., "table:id" or {tb: "table", id: "id"})',
                    { itemIndex },
                );
            }
            validateRequiredField(
                executeFunctions,
                idInput,
                "Record ID",
                itemIndex,
            );

            // Parse and validate the record ID string
            const validatedId = parseAndValidateRecordId(
                idInput,
                table,
                executeFunctions.getNode(),
                itemIndex,
            );

            // Create the record ID
            const recordId = createRecordId(table, validatedId);

            // Execute the select operation
            const result = await client.select(recordId);
            debugLog(
                "getRecord",
                "Raw result from SurrealDB:",
                itemIndex,
                result,
            );

            // Check if the record was found (result is not null/undefined/empty object)
            // SurrealDB's client.select returns the record object if found, or null/undefined if not found.
            // An empty object check is included for robustness, though less likely.
            if (
                result !== null &&
                result !== undefined &&
                (typeof result !== "object" || Object.keys(result).length > 0)
            ) {
                // Format the result only if found
                const formattedResult = formatSingleResult(result);
                return [
                    {
                        ...formattedResult,
                        pairedItem: { item: itemIndex },
                    },
                ];
            }

            // If not found, return an empty JSON object for this item,
            // ensuring an output item corresponding to the input item.
            return [
                {
                    json: {},
                    pairedItem: { item: itemIndex },
                },
            ];
        } catch (error) {
            // Handle errors based on continueOnFail setting
            if (executeFunctions.continueOnFail()) {
                return [
                    {
                        json: { error: error.message },
                        pairedItem: { item: itemIndex },
                    },
                ];
            }

            // If continueOnFail is not enabled, re-throw the error
            throw error;
        }
    },
};
