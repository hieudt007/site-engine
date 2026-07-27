import { MCPTool } from "../core/ToolRegistry.js";

export const getPostTool: MCPTool = {
  name: "get_post",
  description: "{\"id\": \"post_id\"}",
  execute: async (args, context) => {
    const postId = args.id;
    if (!postId) return "Error: missing id.";
    return `Current content of post [${postId}]:\n<h1>Sample post</h1><p>This is the old content...</p>`;
  }
};

