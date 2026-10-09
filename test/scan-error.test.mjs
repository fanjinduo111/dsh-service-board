/**
 * The scan failure message must name a cause, never the command.
 *
 * Reported from a machine where the panel showed `扫描错误：Command failed: powershell.exe
 * -NoProfile …` — the whole six-kilobyte command line, because `execFile`'s rejection message
 * carries the command and nothing else, while the reason sits unread in `error.stderr`.
 *
 * These cases are the error objects execFile actually produces, fed in by hand so the shapes
 * are pinned without needing PowerShell to fail on demand.
 *
 * Run: node test/scan-error.test.mjs
 */
import { describeScanFailure } from "../src/host/scanner.js";

const COMMAND = "powershell.exe -NoProfile -NonInteractive -ExecutionPolicy Bypass -Command $ErrorActionPreference='Stop' Add-Type -TypeDefinition ' using System; …'";
const cases = [
  {
    label: "a blocked Add-Type names the language mode",
    error: { message: `Command failed: ${COMMAND}`, stdout: "", stderr: "Cannot invoke method. Method invocation is supported only on core types in this language mode.\r\nAt line:1 char:1\r\n+ Add-Type -TypeDefinition ' using System;'\r\n+ ~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~\r\n    + CategoryInfo : InvalidOperation: (:) [Add-Type], RuntimeException\r\n    + FullyQualifiedErrorId : MethodInvocationNotSupportedInConstrainedLanguage" },
    expect: /受限语言模式/,
  },
  {
    label: "a dead WMI service is named",
    error: { message: `Command failed: ${COMMAND}`, stdout: "", stderr: "Get-CimInstance : The RPC server is unavailable. (Exception from HRESULT: 0x800706BA)" },
    expect: /WMI\/CIM/,
  },
  {
    label: "a killed command is named as a timeout",
    error: { message: `Command failed: ${COMMAND}`, stdout: "", stderr: "", killed: true, signal: "SIGTERM", code: null },
    expect: /超时/,
  },
  {
    label: "an execution policy refusal is named",
    error: { message: `Command failed: ${COMMAND}`, stdout: "", stderr: "File C:\\x.ps1 cannot be loaded because running scripts is disabled on this system. For more information, see about_Execution_Policies" },
    expect: /执行策略|受限语言模式/,
  },
  {
    label: "spawn ENOENT keeps Node's own message",
    error: { message: "spawn powershell.exe ENOENT", code: "ENOENT" },
    expect: /不存在|ENOENT/,
  },
];

let failures = 0;
for (const { label, error, expect } of cases) {
  const text = describeScanFailure(error);
  const ok = expect.test(text) && !text.includes("-ExecutionPolicy Bypass") && !text.includes("Add-Type -TypeDefinition ' using System; …'");
  console.log(`${ok ? "ok  " : "FAIL"} ${label} — ${text.slice(0, 150)}`);
  if (!ok) failures += 1;
}

// Negative control: the previous behaviour was `String(error)` on an Error whose message is
// "Command failed: <command>". Whatever the new one returns, it must not be that — this is the
// assertion that would have failed before the fix.
const previous = String(new Error(`Command failed: ${COMMAND}`));
const now = describeScanFailure({ message: `Command failed: ${COMMAND}`, stdout: "", stderr: "" });
const controlOk = previous.includes("-ExecutionPolicy Bypass") && !now.includes("-ExecutionPolicy Bypass") && now.includes("没有输出错误详情");
console.log(`${controlOk ? "ok  " : "FAIL"} control: the old message was the command, the new one is not`);
if (!controlOk) failures += 1;

console.log(`\n${failures === 0 ? "PASSED" : `FAILED: ${failures} check(s)`}`);
process.exit(failures === 0 ? 0 : 1);
