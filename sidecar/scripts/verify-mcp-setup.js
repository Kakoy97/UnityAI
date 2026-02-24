#!/usr/bin/env node
"use strict";

/**
 * MCP 接入验证脚本
 * 检查所有必要的配置和文件是否存在
 */

const fs = require("fs");
const path = require("path");
const os = require("os");
const http = require("http");

function getCursorConfigPath(useNative = false) {
  const platform = os.platform();
  const homeDir = os.homedir();

  if (useNative) {
    // Cursor 原生 MCP 配置
    if (platform === "win32") {
      const appData = process.env.APPDATA || path.join(homeDir, "AppData", "Roaming");
      return path.join(appData, "Cursor", "mcp.json");
    } else {
      return path.join(homeDir, ".cursor", "mcp.json");
    }
  } else {
    // Cline 插件配置
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

function checkCursorConfigNative() {
  const configPath = getCursorConfigPath(true);
  return checkConfigFile(configPath, "原生 MCP");
}

function checkCursorConfigCline() {
  const configPath = getCursorConfigPath(false);
  return checkConfigFile(configPath, "Cline 插件");
}

function checkConfigFile(configPath, configType) {
  if (!fs.existsSync(configPath)) {
    console.log(`✗ ${configType} 配置文件不存在: ${configPath}`);
    return false;
  }

  try {
    const content = fs.readFileSync(configPath, "utf8");
    const config = JSON.parse(content);
    
    if (config.mcpServers && config.mcpServers["unity-sidecar"]) {
      const unityConfig = config.mcpServers["unity-sidecar"];
      console.log(`✓ ${configType} 配置文件存在: ${configPath}`);
      console.log(`  - command: ${unityConfig.command}`);
      console.log(`  - args: ${unityConfig.args ? unityConfig.args.join(" ") : "无"}`);
      console.log(`  - SIDECAR_BASE_URL: ${unityConfig.env?.SIDECAR_BASE_URL || "未设置"}`);
      
      if (unityConfig.args && unityConfig.args.length > 0) {
        const mcpPath = unityConfig.args[0];
        if (path.isAbsolute(mcpPath)) {
          console.log(`  ✓ MCP 服务器路径是绝对路径`);
        } else {
          console.log(`  ✗ MCP 服务器路径不是绝对路径: ${mcpPath}`);
        }
      }
      
      return true;
    } else {
      console.log(`✗ ${configType} 配置文件中没有 unity-sidecar 配置`);
      return false;
    }
  } catch (err) {
    console.log(`✗ ${configType} 配置文件格式错误: ${err.message}`);
    return false;
  }
}

function checkNodeVersion() {
  const version = process.version;
  const major = parseInt(version.slice(1).split(".")[0], 10);
  if (major >= 16) {
    console.log(`✓ Node.js 版本: ${version} (>= 16)`);
    return true;
  } else {
    console.log(`✗ Node.js 版本: ${version} (需要 >= 16)`);
    return false;
  }
}

function checkMcpServerFile() {
  const mcpServerPath = path.resolve(__dirname, "..", "src", "mcp", "mcpServer.js");
  if (fs.existsSync(mcpServerPath)) {
    console.log(`✓ MCP 服务器文件存在: ${mcpServerPath}`);
    return true;
  } else {
    console.log(`✗ MCP 服务器文件不存在: ${mcpServerPath}`);
    return false;
  }
}

function checkCursorConfig() {
  // 优先检查原生 MCP 配置
  const nativeOk = checkCursorConfigNative();
  const clineOk = checkCursorConfigCline();
  
  if (nativeOk) {
    console.log(`\n提示: 检测到原生 MCP 配置，这是推荐方式（无需插件）`);
    return true;
  } else if (clineOk) {
    console.log(`\n提示: 检测到 Cline 插件配置，如果未安装 Cline 插件，请使用: npm run mcp:setup-cursor -- --native`);
    return true;
  } else {
    console.log(`\n提示: 未找到任何配置，运行: npm run mcp:setup-cursor -- --native`);
    return false;
  }
}

function checkSidecarHealth() {
  return new Promise((resolve) => {
    const req = http.get("http://127.0.0.1:46321/health", (res) => {
      let data = "";
      res.on("data", (chunk) => {
        data += chunk;
      });
      res.on("end", () => {
        try {
          const body = JSON.parse(data);
          // 支持多种健康检查响应格式
          if (body.status === "ok" || body.ok === true || (body.service && body.timestamp)) {
            console.log(`✓ Sidecar 正在运行 (http://127.0.0.1:46321)`);
            if (body.service) {
              console.log(`  - Service: ${body.service}`);
              console.log(`  - State: ${body.active_state || "unknown"}`);
            }
            resolve(true);
          } else {
            console.log(`✗ Sidecar 响应异常: ${data}`);
            resolve(false);
          }
        } catch {
          console.log(`✗ Sidecar 响应格式错误: ${data}`);
          resolve(false);
        }
      });
    });

    req.on("error", (err) => {
      console.log(`✗ Sidecar 未运行或无法连接: ${err.message}`);
      console.log(`  运行: npm run start:mcp`);
      resolve(false);
    });

    req.setTimeout(3000, () => {
      req.destroy();
      console.log(`✗ Sidecar 连接超时`);
      console.log(`  运行: npm run start:mcp`);
      resolve(false);
    });
  });
}

async function main() {
  console.log("MCP 接入验证\n");
  console.log("=".repeat(50));

  const results = {
    nodeVersion: checkNodeVersion(),
    mcpServerFile: checkMcpServerFile(),
    cursorConfig: checkCursorConfig(),
    sidecarHealth: await checkSidecarHealth(),
  };

  console.log("\n" + "=".repeat(50));
  console.log("验证结果:\n");

  const allPassed = Object.values(results).every((v) => v === true);

  if (allPassed) {
    console.log("✓ 所有检查通过！");
    console.log("\n下一步:");
    console.log("1. 完全重启 Cursor IDE");
    console.log("2. 在 Cursor 中查看工具列表（输入 @ 或查看可用工具）");
    console.log("3. 应该能看到 submit_unity_task 等工具");
  } else {
    console.log("✗ 部分检查未通过，请根据上述提示修复问题");
  }

  process.exit(allPassed ? 0 : 1);
}

if (require.main === module) {
  main().catch(console.error);
}

module.exports = { checkNodeVersion, checkMcpServerFile, checkCursorConfig, checkSidecarHealth };
