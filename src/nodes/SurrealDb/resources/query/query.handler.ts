import type { IExecuteFunctions, INodeExecutionData } from "n8n-workflow";
import type { Surreal } from "surrealdb";
import { executeQueryOperation } from "./operations/executeQuery.operation";
import { buildSelectQueryOperation } from "./operations/buildSelectQuery.operation";
import { createErrorResult } from "../../utilities";

/**
 * Handle all operations for the Query resource
 */
export async function handleQueryOperations(
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
                case "executeQuery":
                    operationResult = await executeQueryOperation.execute(
                        client,
                        items,
                        executeFunctions,
                        i,
                    );
                    break;
                case "buildSelectQuery":
                    operationResult = await buildSelectQueryOperation.execute(
                        client,
                        items,
                        executeFunctions,
                        i,
                    );
                    break;
                default:
                    throw new Error(
                        `The operation "${operation}" is not supported for the Query resource!`,
                    );
            }

            // Use push with spread for better performance than array spread in loop
            returnData.push(...operationResult);
        } catch (error) {
            if (executeFunctions.continueOnFail()) {
                returnData.push(
                    createErrorResult(error as Error, i, operation),
                );
                continue;
            }
            throw error;
        }
    }

    return returnData;
}
