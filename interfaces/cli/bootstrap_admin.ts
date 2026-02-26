import { parseArgs } from "node:util";

import { createPgClient } from "../../infra/db/client.js";
import { hashPasswordArgon2id } from "../../infra/security/password.js";

type ExistingUserRow = {
  id: string;
  role: "user" | "admin";
  status: "active" | "disabled";
};

function normalizeEmail(rawEmail: string): string {
  const email = rawEmail.trim().toLowerCase();
  if (!email || !email.includes("@")) {
    throw new Error("Valid --email is required");
  }
  return email;
}

async function readPasswordFromStdin(): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  return Buffer.concat(chunks).toString("utf8").replace(/\r?\n$/, "");
}

async function resolvePassword(usePasswordStdin: boolean): Promise<string> {
  if (usePasswordStdin) {
    const password = await readPasswordFromStdin();
    if (!password) {
      throw new Error("Empty password on stdin");
    }
    return password;
  }

  const password = process.env.BOOTSTRAP_ADMIN_PASSWORD;
  if (!password) {
    throw new Error(
      "Provide password via --password-stdin or BOOTSTRAP_ADMIN_PASSWORD",
    );
  }
  return password;
}

async function main(): Promise<void> {
  const { values } = parseArgs({
    options: {
      email: { type: "string" },
      "password-stdin": { type: "boolean", default: false },
    },
  });

  const email = normalizeEmail(values.email ?? process.env.BOOTSTRAP_ADMIN_EMAIL ?? "");
  const password = await resolvePassword(values["password-stdin"]);
  if (password.length < 12) {
    throw new Error("Password must be at least 12 characters");
  }

  const client = createPgClient();
  await client.connect();
  try {
    await client.query("BEGIN");

    const existing = await client.query<ExistingUserRow>(
      `
      SELECT id, role, status
      FROM users
      WHERE email = $1
      FOR UPDATE
      `,
      [email],
    );

    if (existing.rowCount && existing.rows[0]) {
      const row = existing.rows[0];
      if (row.role === "admin") {
        await client.query("COMMIT");
        console.log(
          JSON.stringify(
            {
              result: "noop",
              reason: "admin_already_exists",
              email,
              userId: row.id,
            },
            null,
            2,
          ),
        );
        return;
      }

      throw new Error(`User with email ${email} already exists and is not admin`);
    }

    const passwordHash = await hashPasswordArgon2id(password);
    const insertResult = await client.query<{ id: string }>(
      `
      INSERT INTO users (email, password_hash, role, status)
      VALUES ($1, $2, 'admin', 'active')
      RETURNING id
      `,
      [email, passwordHash],
    );

    await client.query("COMMIT");
    console.log(
      JSON.stringify(
        {
          result: "created",
          email,
          userId: insertResult.rows[0]?.id ?? null,
        },
        null,
        2,
      ),
    );
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
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
