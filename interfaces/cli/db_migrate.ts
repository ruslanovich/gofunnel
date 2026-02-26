import { parseArgs } from "node:util";

import { createPgClient } from "../../infra/db/client.js";
import { migrateUp, migrationStatus, rollbackLast } from "../../infra/db/migrator.js";

async function main(): Promise<void> {
  const { positionals, values } = parseArgs({
    allowPositionals: true,
    options: {
      steps: {
        type: "string",
      },
    },
  });

  const command = (positionals[0] ?? "up") as "up" | "down" | "status";
  if (!["up", "down", "status"].includes(command)) {
    throw new Error(`Unsupported db_migrate command: ${command}`);
  }

  const client = createPgClient();
  await client.connect();
  try {
    if (command === "up") {
      const result = await migrateUp(client);
      console.log(JSON.stringify({ command, ...result }, null, 2));
      return;
    }

    if (command === "down") {
      const steps = Number.parseInt(values.steps ?? "1", 10);
      if (!Number.isFinite(steps) || steps < 1) {
        throw new Error("--steps must be a positive integer");
      }
      const result = await rollbackLast(client, steps);
      console.log(JSON.stringify({ command, steps, ...result }, null, 2));
      return;
    }

    const result = await migrationStatus(client);
    console.log(JSON.stringify({ command, ...result }, null, 2));
  } finally {
    await client.end();
  }
}

main().catch((error) => {
  console.error(
    JSON.stringify(
      {
        error: error instanceof Error ? error.message : String(error),
      },
      null,
      2,
    ),
  );
  process.exitCode = 1;
});
