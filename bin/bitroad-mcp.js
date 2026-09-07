#!/usr/bin/env node
import { createInterface } from "node:readline";
import { forward } from "../src/bridge.js";

// ponytail: messages are forwarded one at a time; a single agent never
// needs more, and it keeps stdout ordering trivial.
let queue = Promise.resolve();

createInterface({ input: process.stdin }).on("line", (line) => {
  if (!line.trim()) return;
  queue = queue
    .then(async () => {
      const reply = await forward(line);
      if (reply) process.stdout.write(`${reply}\n`);
    })
    .catch((error) => {
      process.stderr.write(`bitroad-mcp: ${error.message}\n`);
    });
});
