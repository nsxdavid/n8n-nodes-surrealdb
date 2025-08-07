import type { Surreal } from "surrealdb";
import type { IExecuteFunctions, INodeExecutionData } from "n8n-workflow";
import { createFieldOperation } from "./operations/createField.operation";
import { listFieldsOperation } from "./operations/listFields.operation";
import { deleteFieldOperation } from "./operations/deleteField.operation";
import { createErrorResult } from "../../utilities";

/**
 * Router for field operations
 */
export async function handleFieldOperations(
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
                case "createField":
                    operationResult = await createFieldOperation.execute(
                            client,
                            items,
                            executeFunctions,
                            i,
                        );
                    break;
                case "listFields":
                    operationResult = await listFieldsOperation.execute(
                            client,
                            items,
                            executeFunctions,
                            i,
                        );
                    break;
                case "deleteField":
                    operationResult = await deleteFieldOperation.execute(
                            client,
                            items,
                            executeFunctions,
                            i,
                        );
                    break;
                default:
                    throw new Error(
                        `The operation "${operation}" is not supported for the Field resource!`,
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
