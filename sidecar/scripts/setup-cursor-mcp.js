#!/usr/bin/env node
"use strict";

/**
 * Cursor MCP 配置助手脚本
 * 
 * 此脚本帮助生成 Cursor MCP 配置文件
 */

const fs = require("fs");
const path = require("path");
const os = require("os");

function getCursorConfigPath(useNative = false) {
  const platform = os.platform();
  const homeDir = os.homedir();

  if (useNative) {
    // Cursor 原生 MCP 配置路径
    if (platform === "win32") {
      const appData = process.env.APPDATA || path.join(homeDir, "AppData", "Roaming");
      return path.join(appData, "Cursor", "mcp.json");
    } else {
      return path.join(homeDir, ".cursor", "mcp.json");
    }
  } else {
    // Cline 插件配置路径（如果安装了 Cline 插件）
    if (platform === "win32") {
      const appData = process.env.APPDATA || path.join(homeDir, "AppData", "Roaming");
      return path.join(
        appData,
        "Cursor",
        "User",
        "globalStorage",
        "saoudrizwan.claude-dev",
        "settings",
        "cline_mcp_settings.json"
      );
    } else {
      return path.join(
        homeDir,
        ".config",
        "Cursor",
        "User",
        "globalStorage",
        "saoudrizwan.claude-dev",
        "settings",
        "cline_mcp_settings.json"
      );
    }
  }
}

function getMcpServerPath() {
  const sidecarRoot = path.resolve(__dirname, "..");
  return path.join(sidecarRoot, "src", "mcp", "mcpServer.js");
}

function getNodePath() {
  return process.execPath;
}

function generateConfig(sidecarBaseUrl, useNative = false) {
  const mcpServerPath = getMcpServerPath();
  const nodePath = getNodePath();

  if (useNative) {
    // Cursor 原生 MCP 配置格式
    return {
      mcpServers: {
        "unity-sidecar": {
          command: nodePath,
          args: [mcpServerPath],
          env: {
            SIDECAR_BASE_URL: sidecarBaseUrl || "http://127.0.0.1:46321",
          },
        },
      },
    };
  } else {
    // Cline 插件配置格式（相同格式）
    return {
      mcpServers: {
        "unity-sidecar": {
          command: nodePath,
          args: [mcpServerPath],
          env: {
            SIDECAR_BASE_URL: sidecarBaseUrl || "http://127.0.0.1:46321",
          },
        },
      },
    };
  }
}

function main() {
  // 检查是否使用原生 MCP 配置
  const useNative = process.argv.includes("--native");
  const sidecarBaseUrlArg = process.argv.find((arg, i) => 
    i > 0 && process.argv[i - 1] !== "--native" && !arg.startsWith("--") && arg.startsWith("http")
  );
  const sidecarBaseUrl = sidecarBaseUrlArg || process.argv[2] || "http://127.0.0.1:46321";

  const configPath = getCursorConfigPath(useNative);
  const configDir = path.dirname(configPath);

  console.log("Cursor MCP 配置助手");
  console.log("==================\n");
  if (useNative) {
    console.log("使用 Cursor 原生 MCP 配置");
  } else {
    console.log("使用 Cline 插件配置（如果未安装 Cline，请使用 --native 参数）");
  }
  console.log(`配置文件路径: ${configPath}`);
  console.log(`Sidecar URL: ${sidecarBaseUrl}`);
  console.log(`MCP 服务器: ${getMcpServerPath()}`);
  console.log(`Node.js: ${getNodePath()}\n`);

  // 检查 MCP 服务器是否存在
  const mcpServerPath = getMcpServerPath();
  if (!fs.existsSync(mcpServerPath)) {
    console.error(`错误: MCP 服务器文件不存在: ${mcpServerPath}`);
    process.exit(1);
  }

  // 创建配置目录
  if (!fs.existsSync(configDir)) {
    console.log(`创建配置目录: ${configDir}`);
    fs.mkdirSync(configDir, { recursive: true });
  }

  // 读取现有配置（如果存在）
  let existingConfig = {};
  if (fs.existsSync(configPath)) {
    try {
      const existingContent = fs.readFileSync(configPath, "utf8");
      existingConfig = JSON.parse(existingContent);
      console.log("已读取现有配置文件");
    } catch (err) {
      console.warn(`警告: 无法解析现有配置文件: ${err.message}`);
    }
  }

  // 生成新配置
  const newConfig = generateConfig(sidecarBaseUrl, useNative);

  // 合并配置（保留其他 MCP 服务器）
  const mergedConfig = {
    ...existingConfig,
    mcpServers: {
      ...existingConfig.mcpServers,
      ...newConfig.mcpServers,
    },
  };

  // 写入配置文件
  try {
    fs.writeFileSync(configPath, JSON.stringify(mergedConfig, null, 2), "utf8");
    console.log("✓ 配置文件已生成/更新\n");
    console.log("下一步:");
    console.log("1. 确保 Sidecar 已启动并启用 MCP Adapter:");
    console.log("   cd sidecar");
    console.log("   export ENABLE_MCP_ADAPTER=true");
    console.log("   npm start");
    console.log("\n2. 重启 Cursor IDE 以加载 MCP 配置");
    console.log("\n3. 在 Cursor 中测试:");
    console.log('   输入: "使用 Unity 工具创建一个测试脚本"');
  } catch (err) {
    console.error(`错误: 无法写入配置文件: ${err.message}`);
    console.error(`请手动创建配置文件: ${configPath}`);
    console.error("\n配置内容:");
    console.error(JSON.stringify(mergedConfig, null, 2));
    process.exit(1);
  }
}

if (require.main === module) {
  main();
}

module.exports = { generateConfig, getCursorConfigPath };
