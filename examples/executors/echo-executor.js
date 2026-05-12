#!/usr/bin/env node

let input = "";

process.stdin.setEncoding("utf8");
process.stdin.on("data", (chunk) => {
  input += chunk;
});

process.stdin.on("end", () => {
  const bytes = Buffer.byteLength(input, "utf8");
  const firstHeading = input.match(/^#\s+(.+?)\s*$/m)?.[1] ?? "handoff";
  console.log(`echo executor received handoff: ${firstHeading}`);
  console.log(`bytes=${bytes}`);
  console.log("status=ok");
});
