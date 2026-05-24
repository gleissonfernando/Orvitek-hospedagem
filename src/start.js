const { spawn } = require("node:child_process");
const path = require("node:path");

const children = [];
const tsxCli = path.join(process.cwd(), "node_modules", "tsx", "dist", "cli.mjs");

function start(name, command, args) {
  const child = spawn(command, args, {
    cwd: process.cwd(),
    env: process.env,
    stdio: "inherit"
  });

  children.push(child);

  child.on("exit", (code, signal) => {
    if (signal) {
      return;
    }

    console.error(`${name} stopped with code ${code}.`);
    stopAll();
    process.exitCode = code || 1;
  });
}

function stopAll() {
  for (const child of children) {
    if (!child.killed) {
      child.kill();
    }
  }
}

process.on("SIGINT", () => {
  stopAll();
  process.exit();
});

process.on("SIGTERM", () => {
  stopAll();
  process.exit();
});

start("API", process.execPath, [tsxCli, "src/api/server.ts"]);
start("Discord bot", process.execPath, ["src/index.js"]);
