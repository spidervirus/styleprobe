#!/usr/bin/env node

import { startMcpServer } from './mcp.js';

startMcpServer().catch((err) => {
  console.error('Fatal MCP Server Error:', err);
  process.exit(1);
});
