import type { IExecuteFunctions, INodeExecutionData } from "n8n-workflow";
import type { Surreal } from "surrealdb";
import { createRecordOperation } from "./operations/createRecord.operation";
import { getRecordOperation } from "./operations/getRecord.operation";
import { updateRecordOperation } from "./operations/updateRecord.operation";
import { mergeRecordOperation } from "./operations/mergeRecord.operation";
import { deleteRecordOperation } from "./operations/deleteRecord.operation";
import { upsertRecordOperation } from "./operations/upsertRecord.operation";
import { createErrorResult } from "../../utilities";

/**
 * Handle all operations for the Record resource
 */
export async function handleRecordOperations(
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
                case "createRecord":
                    operationResult = await createRecordOperation.execute(
                        client,
                        items,
                        executeFunctions,
                        i,
                    );
                    break;
                case "deleteRecord":
                    operationResult = await deleteRecordOperation.execute(
                        client,
                        items,
                        executeFunctions,
                        i,
                    );
                    break;
                case "getRecord":
                    operationResult = await getRecordOperation.execute(
                        client,
                        items,
                        executeFunctions,
                        i,
                    );
                    break;
                case "updateRecord":
                    operationResult = await updateRecordOperation.execute(
                        client,
                        items,
                        executeFunctions,
                        i,
                    );
                    break;
                case "mergeRecord":
                    operationResult = await mergeRecordOperation.execute(
                        client,
                        items,
                        executeFunctions,
                        i,
                    );
                    break;
                case "upsertRecord":
                    operationResult = await upsertRecordOperation.execute(
                        client,
                        items,
                        executeFunctions,
                        i,
                    );
                    break;
                default:
                    throw new Error(
                        `The operation "${operation}" is not supported for the Record resource!`,
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
