import type { Surreal } from "surrealdb";
import type { IExecuteFunctions, INodeExecutionData } from "n8n-workflow";
import { createIndexOperation } from "./operations/createIndex.operation";
import { dropIndexOperation } from "./operations/dropIndex.operation";
import { listIndexesOperation } from "./operations/listIndexes.operation";
import { describeIndexOperation } from "./operations/describeIndex.operation";
import { rebuildIndexOperation } from "./operations/rebuildIndex.operation";
import { createErrorResult } from "../../utilities";

/**
 * Router for index operations
 */
export async function handleIndexOperations(
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
                case "createIndex":
                    operationResult = await createIndexOperation.execute(
                        client,
                        items,
                        executeFunctions,
                        i,
                    );
                    break;
                case "dropIndex":
                    operationResult = await dropIndexOperation.execute(
                        client,
                        items,
                        executeFunctions,
                        i,
                    );
                    break;
                case "listIndexes":
                    operationResult = await listIndexesOperation.execute(
                        client,
                        items,
                        executeFunctions,
                        i,
                    );
                    break;
                case "describeIndex":
                    operationResult = await describeIndexOperation.execute(
                        client,
                        items,
                        executeFunctions,
                        i,
                    );
                    break;
                case "rebuildIndex":
                    operationResult = await rebuildIndexOperation.execute(
                        client,
                        items,
                        executeFunctions,
                        i,
                    );
                    break;
                default:
                    throw new Error(
                        `The operation "${operation}" is not supported for the Index resource!`,
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
