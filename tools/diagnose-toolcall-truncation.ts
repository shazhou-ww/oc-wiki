#!/usr/bin/env npx tsx
/**
 * copilot-api streaming tool call 截断诊断脚本
 * 
 * 测试 copilot-api 的 streaming response 是否会截断 tool_calls 的 arguments。
 * 已知问题：非 Linux 平台（Windows/macOS）的 copilot-api 在 streaming 模式下
 * 可能截断长 tool call arguments（>2000 字符）。
 * 
 * 用法：
 *   COPILOT_API_URL=http://localhost:4141 npx tsx diagnose-toolcall-truncation.ts
 * 
 * 需要 copilot-api 在本地运行。
 * 
 * 🐉 Created by 敖丙 (RAKU) — 2026-03-31
 */

const COPILOT_API_URL = process.env.COPILOT_API_URL || "http://localhost:4141";
const MODEL = process.env.MODEL || "claude-sonnet-4.6";

interface StreamDelta {
  tool_calls?: Array<{
    index: number;
    function?: { name?: string; arguments?: string };
  }>;
}

async function testStreamingToolCall(charTarget: number): Promise<{
  passed: boolean;
  expected: number;
  received: number;
  truncated: boolean;
  error?: string;
}> {
  const prompt = `You must call the "echo_back" tool with a JSON argument "data" containing a string of exactly ${charTarget} 'x' characters. Do not explain, just call the tool immediately. The data field should be: "${"x".repeat(charTarget)}"`;

  const body = {
    model: MODEL,
    stream: true,
    messages: [
      { role: "system", content: "You are a test assistant. Always use tools when instructed. Never refuse." },
      { role: "user", content: prompt },
    ],
    tools: [
      {
        type: "function",
        function: {
          name: "echo_back",
          description: "Echoes back the data string. Used for testing.",
          parameters: {
            type: "object",
            properties: {
              data: { type: "string", description: "The string to echo back" },
            },
            required: ["data"],
          },
        },
      },
    ],
    tool_choice: { type: "function", function: { name: "echo_back" } },
  };

  try {
    const resp = await fetch(`${COPILOT_API_URL}/v1/chat/completions`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: "Bearer dummy" },
      body: JSON.stringify(body),
    });

    if (!resp.ok) {
      return { passed: false, expected: charTarget, received: 0, truncated: false, error: `HTTP ${resp.status}: ${await resp.text()}` };
    }

    // Parse SSE stream
    const text = await resp.text();
    const lines = text.split("\n").filter((l) => l.startsWith("data: ") && l !== "data: [DONE]");

    let collectedArgs = "";
    let toolName = "";

    for (const line of lines) {
      try {
        const json = JSON.parse(line.slice(6));
        const delta: StreamDelta = json.choices?.[0]?.delta || {};
        if (delta.tool_calls) {
          for (const tc of delta.tool_calls) {
            if (tc.function?.name) toolName = tc.function.name;
            if (tc.function?.arguments) collectedArgs += tc.function.arguments;
          }
        }
      } catch {
        // skip non-JSON lines
      }
    }

    // Try to parse the collected arguments
    let dataLength = 0;
    try {
      const parsed = JSON.parse(collectedArgs);
      dataLength = (parsed.data || "").length;
    } catch {
      // Arguments might be truncated JSON
      const match = collectedArgs.match(/"data"\s*:\s*"(x+)/);
      dataLength = match ? match[1].length : 0;
    }

    const truncated = dataLength < charTarget * 0.9; // Allow 10% tolerance (LLM might not generate exact count)
    return {
      passed: !truncated,
      expected: charTarget,
      received: dataLength,
      truncated,
    };
  } catch (err: any) {
    return { passed: false, expected: charTarget, received: 0, truncated: false, error: err.message };
  }
}

async function main() {
  console.log("╔══════════════════════════════════════════════════════════════╗");
  console.log("║  copilot-api Streaming Tool Call 截断诊断                    ║");
  console.log("╚══════════════════════════════════════════════════════════════╝");
  console.log();
  console.log(`API:   ${COPILOT_API_URL}`);
  console.log(`Model: ${MODEL}`);
  console.log();

  // Test connectivity first
  try {
    const ping = await fetch(`${COPILOT_API_URL}/v1/models`, {
      headers: { Authorization: "Bearer dummy" },
    });
    if (!ping.ok) {
      console.error(`❌ API 连接失败: HTTP ${ping.status}`);
      process.exit(1);
    }
    console.log("✅ API 连接正常\n");
  } catch (err: any) {
    console.error(`❌ API 连接失败: ${err.message}`);
    process.exit(1);
  }

  const testSizes = [500, 1000, 2000, 3000, 5000];
  let allPassed = true;

  console.log("测试 | 目标字符数 | 实收字符数 | 结果");
  console.log("-----|----------|----------|------");

  for (const size of testSizes) {
    process.stdout.write(`  ${size.toString().padStart(4)}  |`);
    const result = await testStreamingToolCall(size);

    if (result.error) {
      console.log(` ${size.toString().padStart(8)} |          | ❌ ${result.error}`);
      allPassed = false;
      continue;
    }

    const status = result.passed ? "✅ PASS" : "❌ TRUNCATED";
    const ratio = ((result.received / result.expected) * 100).toFixed(0);
    console.log(` ${result.expected.toString().padStart(8)} | ${result.received.toString().padStart(8)} | ${status} (${ratio}%)`);

    if (!allPassed && result.truncated) allPassed = false;
    if (result.truncated) allPassed = false;
  }

  console.log();
  if (allPassed) {
    console.log("🎉 所有测试通过！Streaming tool call 没有截断问题。");
  } else {
    console.log("⚠️  检测到截断！建议：");
    console.log("  1. 检查 copilot-api 版本和平台");
    console.log("  2. Linux 平台通常没有此问题");
    console.log("  3. macOS/Windows 可以考虑：");
    console.log("     a) 升级 copilot-api 到最新版");
    console.log("     b) 使用 stream-strip-proxy 中间层");
    console.log("     c) 关闭 streaming（性能代价大）");
    console.log("  4. 参考 RAKU 的经验：迁移到 Linux 后问题消失");
  }

  process.exit(allPassed ? 0 : 1);
}

main().catch(console.error);
