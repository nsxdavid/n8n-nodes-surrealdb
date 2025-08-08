import type {
    IDataObject,
    IExecuteFunctions,
    INodeExecutionData,
} from "n8n-workflow";
import { NodeOperationError } from "n8n-workflow";
import type { Surreal } from "surrealdb";
import {
    prepareSurrealQuery,
    validateRequiredField,
    buildCredentialsObject,
    checkQueryResult,
} from "../../../GenericFunctions";
import { normalizeRecordId } from "../../../utilities";
import type { IOperationHandler } from "../../../types/operation.types";

import { DEBUG, debugLog } from "../../../debug";

/**
 * Implementation of the "Create Relationship" operation
 * This operation creates a relationship between two records using the RELATE statement
 */
export const createRelationshipOperation: IOperationHandler = {
    async execute(
        client: Surreal,
        items: INodeExecutionData[],
        executeFunctions: IExecuteFunctions,
        itemIndex: number,
    ): Promise<INodeExecutionData[]> {
        const returnData: INodeExecutionData[] = [];

        debugLog("createRelationship", "Starting operation", itemIndex);

        // Get credentials
        const credentials =
            await executeFunctions.getCredentials("surrealDbApi");

        // Get parameters
        const fromRecordIdInput = executeFunctions.getNodeParameter(
            "fromRecordId",
            itemIndex,
        );
        const relationshipType = executeFunctions.getNodeParameter(
            "relationshipType",
            itemIndex,
        ) as string;
        const toRecordIdInput = executeFunctions.getNodeParameter(
            "toRecordId",
            itemIndex,
        );

        // Normalize record IDs to handle both object and string formats
        const fromRecordId = normalizeRecordId(fromRecordIdInput);
        const toRecordId = normalizeRecordId(toRecordIdInput);

        // Validate required fields
        validateRequiredField(
            executeFunctions,
            fromRecordId,
            "From Record ID",
            itemIndex,
        );
        validateRequiredField(
            executeFunctions,
            relationshipType,
            "Relationship Type",
            itemIndex,
        );
        validateRequiredField(
            executeFunctions,
            toRecordId,
            "To Record ID",
            itemIndex,
        );

        // Validate record IDs format after normalization
        if (!fromRecordId.includes(":")) {
            throw new NodeOperationError(
                executeFunctions.getNode(),
                `From Record ID must be in the format "table:id" (e.g., person:john) or {tb: "table", id: "id"}`,
                { itemIndex },
            );
        }

        if (!toRecordId.includes(":")) {
            throw new NodeOperationError(
                executeFunctions.getNode(),
                `To Record ID must be in the format "table:id" (e.g., person:jane) or {tb: "table", id: "id"}`,
                { itemIndex },
            );
        }

        // Get options
        const options = executeFunctions.getNodeParameter(
            "options",
            itemIndex,
            {},
        ) as IDataObject;

        // Build the resolved credentials object using the utility function
        const resolvedCredentials = buildCredentialsObject(
            credentials,
            options,
        );

        // Get properties to set on the relationship
        const properties = executeFunctions.getNodeParameter(
            "properties.propertyValues",
            itemIndex,
            [],
        ) as IDataObject[];

        // Build the RELATE statement
        let query = "";
        const only = options.only === true ? "ONLY " : "";
        const returnType = options.returnType
            ? ` RETURN ${options.returnType}`
            : "";

        // Start building the query
        query = `RELATE ${only}${fromRecordId}->${relationshipType}->${toRecordId}`;

        // Add properties if any
        if (properties.length > 0) {
            query += " SET ";
            const setStatements = properties.map(property => {
                const key = property.key as string;
                const value = property.value as string;

                // Try to parse the value as JSON if it looks like a JSON object or array
                let parsedValue = value;
                if (
                    (value.startsWith("{") && value.endsWith("}")) ||
                    (value.startsWith("[") && value.endsWith("]"))
                ) {
                    try {
                        const jsonValue = JSON.parse(value);
                        parsedValue = JSON.stringify(jsonValue);
                    } catch {
                        // If parsing fails, use the original value
                        parsedValue = `"${value}"`;
                    }
                } else if (
                    value === "true" ||
                    value === "false" ||
                    value === "null" ||
                    !isNaN(Number(value))
                ) {
                    // Handle boolean, null, and numeric values
                    parsedValue = value;
                } else {
                    // Handle string values
                    parsedValue = `"${value}"`;
                }

                return `${key} = ${parsedValue}`;
            });

            query += setStatements.join(", ");
        }

        // Add return type if specified
        query += returnType;

        // Finalize the query
        query += ";";

        const preparedQuery = prepareSurrealQuery(query, resolvedCredentials);

        if (DEBUG) {
            // DEBUG: Log query
            debugLog(
                "createRelationship",
                "Prepared query",
                itemIndex,
                preparedQuery,
            );
        }

        // Execute the query

        const result = await client.query(preparedQuery);

        // Check for query errors
        const queryCheck = checkQueryResult(result, "Query failed");
        if (!queryCheck.success) {
            if (executeFunctions.continueOnFail()) {
                returnData.push({
                    json: {
                        error: queryCheck.errorMessage,
                    },
                    pairedItem: { item: itemIndex },
                });
            } else {
                throw new NodeOperationError(
                    executeFunctions.getNode(),
                    queryCheck.errorMessage || "Unknown error",
                    {
                        itemIndex,
                    },
                );
            }
        }

        if (DEBUG) {
            // DEBUG: Log raw result
            debugLog(
                "createRelationship",
                "Raw query result",
                itemIndex,
                JSON.stringify(result),
            );
        }

        // Process the result
        if (Array.isArray(result) && result.length > 0) {
            const relationshipResult = result[0];

            if (relationshipResult === null) {
                throw new NodeOperationError(
                    executeFunctions.getNode(),
                    `Failed to create relationship from ${fromRecordId} to ${toRecordId}`,
                    { itemIndex },
                );
            }

            // Return the relationship information
            if (Array.isArray(relationshipResult)) {
                // Multiple relationships were created
                for (const relationship of relationshipResult) {
                    returnData.push({
                        json: relationship,
                        pairedItem: { item: itemIndex },
                    });
                }
            } else {
                // Single relationship was created
                returnData.push({
                    json: relationshipResult as IDataObject,
                    pairedItem: { item: itemIndex },
                });
            }
        } else {
            throw new NodeOperationError(
                executeFunctions.getNode(),
                `Failed to create relationship from ${fromRecordId} to ${toRecordId}`,
                { itemIndex },
            );
        }

        return returnData;
    },
};
