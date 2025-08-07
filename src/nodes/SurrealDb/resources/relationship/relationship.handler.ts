import type { Surreal } from "surrealdb";
import type { IExecuteFunctions, INodeExecutionData } from "n8n-workflow";
import { createRelationshipOperation } from "./operations/createRelationship.operation";
import { deleteRelationshipOperation } from "./operations/deleteRelationship.operation";
import { queryRelationshipsOperation } from "./operations/queryRelationships.operation";
import { createErrorResult } from "../../utilities";

/**
 * Router for relationship operations
 */
export async function handleRelationshipOperations(
    operation: string,
    client: Surreal,
    items: INodeExecutionData[],
    executeFunctions: IExecuteFunctions,
): Promise<INodeExecutionData[]> {
    let returnData: INodeExecutionData[] = [];

    const itemsLength = items.length;

    for (let i = 0; i < itemsLength; i++) {
        try {
            let operationResult: INodeExecutionData[];
            
            switch (operation) {
                case "createRelationship":
                    operationResult = await createRelationshipOperation.execute(
                            client,
                            items,
                            executeFunctions,
                            i,
                        );
                    break;
                case "deleteRelationship":
                    operationResult = await deleteRelationshipOperation.execute(
                            client,
                            items,
                            executeFunctions,
                            i,
                        );
                    break;
                case "queryRelationships":
                    operationResult = await queryRelationshipsOperation.execute(
                            client,
                            items,
                            executeFunctions,
                            i,
                        );
                    break;
                default:
                    throw new Error(
                        `The operation "${operation}" is not supported for the Relationship resource!`,
                    );
            }
            
            // Use push with spread for better performance than array spread in loop
            returnData.push(...operationResult);
        } catch (error) {
            if (executeFunctions.continueOnFail()) {
                returnData.push(createErrorResult(error as Error, i, operation));
                continue;
            }
            throw error;
        }
    }

    return returnData;
}
