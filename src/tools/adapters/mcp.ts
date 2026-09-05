/**
 * MCP (Model Context Protocol) Adapter
 *
 * Converts core tool definitions to MCP format.
 * Use with MCP servers for Claude Code integration.
 *
 * Usage:
 *   import { mcpTools, executeTool } from './adapters/mcp';
 *
 *   server.setRequestHandler(ListToolsRequestSchema, async () => ({
 *     tools: mcpTools,
 *   }));
 *
 *   server.setRequestHandler(CallToolRequestSchema, async (request) => {
 *     return executeTool(request.params.name, request.params.arguments);
 *   });
 */

import { z } from 'zod';
import type { Tool, CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { arcTools } from '../core.js';

// Convert core tools to MCP format using Zod 4's built-in z.toJSONSchema()
export const mcpTools: Tool[] = Object.values(arcTools).map((t) => ({
  name: t.name,
  description: t.description,
  inputSchema: z.toJSONSchema(t.inputSchema) as Tool['inputSchema'],
}));

/**
 * Execute a tool and return MCP-formatted result
 */
export async function executeTool(name: string, args: unknown): Promise<CallToolResult> {
  const tool = arcTools[name];
  if (!tool) {
    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify({ success: false, error: `Unknown tool: ${name}` }, null, 2),
        },
      ],
      isError: true,
    };
  }

  try {
    const parsed = tool.inputSchema.parse(args);
    const result = await tool.execute(parsed);
    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify(result, null, 2),
        },
      ],
    };
  } catch (error: any) {
    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify(
            {
              success: false,
              error: error.message,
              stack: error.stack,
            },
            null,
            2
          ),
        },
      ],
      isError: true,
    };
  }
}

// Re-export for convenience
export { arcTools } from '../core.js';
