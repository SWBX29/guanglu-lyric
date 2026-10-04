#!/usr/bin/env node
/**
 * 用「项目内临时目录」运行命令的包装器。
 *
 * 背景（本机实测）：
 * esbuild 在 Windows 上会把中间产物写到 `%TEMP%\esbuild-<hash>`，随后立即删除。
 * 本机该删除偶发 `Access is denied`（Windows Defender 实时扫描刚写入的临时文件，
 * 或历史 ACL 残留），表现为 Vite 构建随机失败：
 *   [vite:esbuild-transpile] remove C:\Users\...\Temp\esbuild-xxxx: Access is denied.
 *
 * 处理：把 TEMP/TMP/TMPDIR 指到项目内的 `.tmp/`（已 gitignore），
 * 使构建完全不依赖系统临时目录；Linux/CI 下同样无害。
 *
 * 用法：node scripts/run.mjs <command> [args...]
 */
import { spawn } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import path from 'node:path';

const appRoot = path.resolve(import.meta.dirname, '..');
const tmp = path.join(appRoot, '.tmp');
mkdirSync(tmp, { recursive: true });

process.env.TEMP = tmp;
process.env.TMP = tmp;
process.env.TMPDIR = tmp;

// wrangler 的调试日志默认写全局配置目录（%APPDATA%\xdg.config\.wrangler\logs），
// 受限沙箱拒绝写入时，即使真实命令已成功，它也会以 exit 1 结束（误判为失败）。
// 指到项目内兜住 —— 见 docs/HANDOFF.md §8 陷阱 12。
process.env.WRANGLER_LOG_PATH = path.join(tmp, 'wrangler-logs');

// 把本地 bin 目录加入 PATH：npm 运行脚本时会自动注入，但直接执行
// `node scripts/run.mjs wrangler ...` 时不会，这里统一兜住。
const binDir = path.join(appRoot, 'node_modules', '.bin');
process.env.PATH = `${binDir}${path.delimiter}${process.env.PATH ?? ''}`;

const [command, ...args] = process.argv.slice(2);
if (!command) {
  console.error('usage: node scripts/run.mjs <command> [args...]');
  process.exit(2);
}

const spawnOptions = {
  // 继承 stdio：既保留实时输出，也避免通过管道捕获子进程输出
  stdio: 'inherit',
  cwd: appRoot,
  env: process.env,
};

let child;
if (process.platform === 'win32') {
  // Windows 上 npm bin 是 .cmd，必须经 cmd.exe 启动。这里自行拼接并转义参数：
  // spawn(cmd, args, {shell:true}) 会把参数原样用空格连接，导致
  // `--command "SELECT * FROM t WHERE a='b'"` 这类带空格/引号的参数被拆散。
  const quote = (value) => `"${value.replace(/"/g, '""')}"`;
  const line = [command, ...args]
    .map((value) => (/[\s"&|<>^()]/.test(value) ? quote(value) : value))
    .join(' ');
  child = spawn(line, { ...spawnOptions, shell: true });
} else {
  child = spawn(command, args, spawnOptions);
}

child.on('error', (error) => {
  console.error(`[run] failed to start "${command}":`, error.message);
  process.exit(1);
});

child.on('exit', (code, signal) => {
  if (signal) {
    console.error(`[run] "${command}" terminated by signal ${signal}`);
    process.exit(1);
  }
  process.exit(code ?? 0);
});
