import type { IExecuteFunctions, INodeExecutionData } from "n8n-workflow";
import { NodeOperationError } from "n8n-workflow";
import type { IOperationHandler } from "../../../types/operation.types";
import type { Surreal } from "surrealdb";
import {
    validateRequiredField,
    cleanTableName,
} from "../../../GenericFunctions";
import {
    createRecordId,
    parseAndValidateRecordId,
    addSuccessResult,
    addErrorResult,
} from "../../../utilities";

import { debugLog } from "../../../debug";

/**
 * Delete Record operation handler for Record resource
 */
export const deleteRecordOperation: IOperationHandler = {
    async execute(
        client: Surreal,
        items: INodeExecutionData[],
        executeFunctions: IExecuteFunctions,
        itemIndex: number,
    ): Promise<INodeExecutionData[]> {
        const returnData: INodeExecutionData[] = [];

        try {
            debugLog("deleteRecord", "Starting operation", itemIndex);
            // Get parameters
            let table = executeFunctions.getNodeParameter(
                "table",
                itemIndex,
            ) as string;
            const idInput = executeFunctions.getNodeParameter("id", itemIndex);

            // Clean and standardize the table name if provided
            if (table) {
                table = cleanTableName(table);
            }

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
                    }
                }
                // Handle string format "table:id"
                else if (
                    idInput &&
                    typeof idInput === "string" &&
                    idInput.includes(":")
                ) {
                    table = cleanTableName(idInput.split(":")[0]);
                }
            }

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

            // Execute the delete operation
            const result = await client.delete(recordId);

            // Check if the delete was successful
            if (result === null || result === undefined) {
                throw new NodeOperationError(
                    executeFunctions.getNode(),
                    `Failed to delete record: ${recordId.toString()}`,
                    { itemIndex },
                );
            }

            // Add a success result to the returnData array
            addSuccessResult(returnData, result, itemIndex);
        } catch (error) {
            // Handle errors based on continueOnFail setting
            if (executeFunctions.continueOnFail()) {
                debugLog(
                    "deleteRecord",
                    "Error with continueOnFail enabled",
                    itemIndex,
                    error.message,
                );
                addErrorResult(returnData, error, itemIndex);
            } else {
                // If continueOnFail is not enabled, re-throw the error
                debugLog(
                    "deleteRecord",
                    "Error, stopping execution",
                    itemIndex,
                    error.message,
                );
                throw error;
            }
        }

        debugLog(
            "deleteRecord",
            `Completed, returning ${returnData.length} items`,
            itemIndex,
        );
        return returnData;
    },
};
