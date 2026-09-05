/**
 * Google GenAI SDK Adapter
 *
 * Converts core tool definitions to Google GenAI CallableTool format.
 * Uses SDK's Automatic Function Calling (AFC) for cleaner agent loops.
 */

import { CallableTool, FunctionCall, Part, Type } from '@google/genai';
import { z } from 'zod';
import { arcTools } from '../core';

// Convert Zod schema to Google GenAI format
function zodToGoogleSchema(schema: z.ZodTypeAny): Record<string, unknown> {
  const jsonSchema = z.toJSONSchema(schema) as Record<string, unknown>;
  return {
    type: Type.OBJECT,
    properties: jsonSchema.properties || {},
    required: jsonSchema.required || [],
  };
}

// Function declarations for all Arc tools
const functionDeclarations = Object.values(arcTools).map((tool) => ({
  name: tool.name,
  description: tool.description,
  parameters: zodToGoogleSchema(tool.inputSchema),
}));

/**
 * CallableTool for Google GenAI SDK
 *
 * When using FunctionCallingConfigMode.AUTO, the SDK will:
 * 1. Call tool() to get function declarations
 * 2. Send to Gemini
 * 3. If Gemini returns function calls, SDK calls callTool()
 * 4. SDK sends results back to Gemini
 * 5. Loop until Gemini stops calling functions
 */
export const arcCallableTool: CallableTool = {
  tool: async () => ({ functionDeclarations }),

  callTool: async (functionCalls: FunctionCall[]): Promise<Part[]> => {
    const results: Part[] = [];

    for (const call of functionCalls) {
      const toolDef = arcTools[call.name!];
      if (!toolDef) {
        results.push({
          functionResponse: {
            name: call.name!,
            response: { error: `Unknown tool: ${call.name}` },
          },
        });
        continue;
      }

      try {
        const parsed = toolDef.inputSchema.parse(call.args || {});
        const result = await toolDef.execute(parsed);
        results.push({
          functionResponse: {
            name: call.name!,
            response: result,
          },
        });
      } catch (error) {
        results.push({
          functionResponse: {
            name: call.name!,
            response: { error: String(error) },
          },
        });
      }
    }

    return results;
  },
};
