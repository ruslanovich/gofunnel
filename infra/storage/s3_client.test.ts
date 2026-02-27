import assert from "node:assert/strict";
import { test } from "node:test";

import {
  buildS3ClientConfig,
  createS3StorageService,
  loadS3StorageEnv,
} from "./s3_client.js";

const BASE_ENV: NodeJS.ProcessEnv = {
  S3_ENDPOINT: "https://storage.yandexcloud.net",
  S3_REGION: "ru-central1",
  S3_BUCKET: "gofunnel-uploads",
  S3_ACCESS_KEY_ID: "test-access-key",
  S3_SECRET_ACCESS_KEY: "test-secret-key",
};

type TestCommand = {
  constructor: { name: string };
  input: Record<string, unknown>;
};

class FakeS3Client {
  readonly sent: TestCommand[] = [];

  async send(command: TestCommand): Promise<{ ContentLength?: number }> {
    this.sent.push(command);
    if (command.constructor.name === "HeadObjectCommand") {
      return { ContentLength: 5 };
    }
    return {};
  }
}

test("loadS3StorageEnv throws an actionable error when required vars are missing", () => {
  assert.throws(
    () => loadS3StorageEnv({}),
    (error: unknown) => {
      assert.ok(error instanceof Error);
      assert.match(error.message, /Missing required S3 environment variables/);
      assert.match(error.message, /S3_ENDPOINT/);
      assert.match(error.message, /S3_REGION/);
      assert.match(error.message, /S3_BUCKET/);
      assert.match(error.message, /S3_ACCESS_KEY_ID/);
      assert.match(error.message, /S3_SECRET_ACCESS_KEY/);
      assert.match(error.message, /S3_ENDPOINT=https:\/\/storage\.yandexcloud\.net/);
      return true;
    },
  );
});

test("createS3StorageService fails fast when required env vars are missing", () => {
  assert.throws(
    () =>
      createS3StorageService({
        env: {
          S3_ENDPOINT: "https://storage.yandexcloud.net",
        },
      }),
    /Missing required S3 environment variables/,
  );
});

test("buildS3ClientConfig includes endpoint, region and forcePathStyle", () => {
  const env = loadS3StorageEnv(BASE_ENV);
  const config = buildS3ClientConfig(env);

  assert.equal(config.endpoint, BASE_ENV.S3_ENDPOINT);
  assert.equal(config.region, BASE_ENV.S3_REGION);
  assert.equal(config.forcePathStyle, true);
  assert.deepEqual(config.credentials, {
    accessKeyId: BASE_ENV.S3_ACCESS_KEY_ID,
    secretAccessKey: BASE_ENV.S3_SECRET_ACCESS_KEY,
  });
});

test("S3 storage service sends put, delete and head commands using configured bucket", async () => {
  const client = new FakeS3Client();
  const service = createS3StorageService({
    env: BASE_ENV,
    client,
  });

  const key = "users/u1/files/f1/original.txt";
  const body = Buffer.from("hello");

  await service.putObject(key, body, "text/plain");
  await service.deleteObject(key);
  const head = await service.headObject(key);

  assert.equal(head.ContentLength, 5);
  assert.deepEqual(
    client.sent.map((command) => command.constructor.name),
    ["PutObjectCommand", "DeleteObjectCommand", "HeadObjectCommand"],
  );
  assert.deepEqual(client.sent[0]?.input, {
    Bucket: BASE_ENV.S3_BUCKET,
    Key: key,
    Body: body,
    ContentType: "text/plain",
  });
  assert.deepEqual(client.sent[1]?.input, {
    Bucket: BASE_ENV.S3_BUCKET,
    Key: key,
  });
  assert.deepEqual(client.sent[2]?.input, {
    Bucket: BASE_ENV.S3_BUCKET,
    Key: key,
  });
});
