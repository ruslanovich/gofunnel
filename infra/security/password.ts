import argon2 from "argon2";

const ARGON2_MEMORY_COST_KIB = 19 * 1024;
const ARGON2_TIME_COST = 2;
const ARGON2_PARALLELISM = 1;

export async function hashPasswordArgon2id(password: string): Promise<string> {
  return argon2.hash(password, {
    type: argon2.argon2id,
    memoryCost: ARGON2_MEMORY_COST_KIB,
    timeCost: ARGON2_TIME_COST,
    parallelism: ARGON2_PARALLELISM,
  });
}

export async function verifyPasswordArgon2id(
  password: string,
  passwordHash: string,
): Promise<boolean> {
  return argon2.verify(passwordHash, password);
}
