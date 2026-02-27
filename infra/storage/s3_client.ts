import {
  DeleteObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  type HeadObjectCommandOutput,
  PutObjectCommand,
  S3Client,
  type GetObjectCommandOutput,
  type S3ClientConfig,
  type PutObjectCommandInput,
} from "@aws-sdk/client-s3";

const REQUIRED_S3_ENV_KEYS = [
  "S3_ENDPOINT",
  "S3_REGION",
  "S3_BUCKET",
  "S3_ACCESS_KEY_ID",
  "S3_SECRET_ACCESS_KEY",
] as const;

export type RequiredS3EnvKey = (typeof REQUIRED_S3_ENV_KEYS)[number];

export type S3StorageEnv = Record<RequiredS3EnvKey, string>;

export type S3ObjectBody = NonNullable<PutObjectCommandInput["Body"]>;

type CommandSender = {
  send(command: unknown): Promise<unknown>;
};

export type S3StorageService = {
  putObject(key: string, body: S3ObjectBody, contentType: string): Promise<void>;
  deleteObject(key: string): Promise<void>;
  getObjectText(key: string): Promise<string>;
  headObject(key: string): Promise<HeadObjectCommandOutput>;
};

export function loadS3StorageEnv(env: NodeJS.ProcessEnv = process.env): S3StorageEnv {
  const missing: RequiredS3EnvKey[] = [];
  const values = {} as S3StorageEnv;

  for (const key of REQUIRED_S3_ENV_KEYS) {
    const value = env[key]?.trim();
    if (!value) {
      missing.push(key);
      continue;
    }
    values[key] = value;
  }

  if (missing.length > 0) {
    throw new Error(formatMissingS3EnvError(missing));
  }

  return values;
}

export function buildS3ClientConfig(env: S3StorageEnv): S3ClientConfig {
  return {
    endpoint: env.S3_ENDPOINT,
    region: env.S3_REGION,
    credentials: {
      accessKeyId: env.S3_ACCESS_KEY_ID,
      secretAccessKey: env.S3_SECRET_ACCESS_KEY,
    },
    forcePathStyle: true,
  };
}

export function createS3Client(env: NodeJS.ProcessEnv = process.env): S3Client {
  const s3Env = loadS3StorageEnv(env);
  return new S3Client(buildS3ClientConfig(s3Env));
}

export function createS3StorageService(options?: {
  env?: NodeJS.ProcessEnv;
  client?: CommandSender;
}): S3StorageService {
  const s3Env = loadS3StorageEnv(options?.env);
  const client = options?.client ?? new S3Client(buildS3ClientConfig(s3Env));
  const bucket = s3Env.S3_BUCKET;

  return {
    async putObject(key: string, body: S3ObjectBody, contentType: string): Promise<void> {
      await client.send(
        new PutObjectCommand({
          Bucket: bucket,
          Key: key,
          Body: body,
          ContentType: contentType,
        }),
      );
    },

    async deleteObject(key: string): Promise<void> {
      await client.send(
        new DeleteObjectCommand({
          Bucket: bucket,
          Key: key,
        }),
      );
    },

    async getObjectText(key: string): Promise<string> {
      const output = await client.send(
        new GetObjectCommand({
          Bucket: bucket,
          Key: key,
        }),
      ) as GetObjectCommandOutput;

      const body = output.Body;
      if (!body || typeof (body as { transformToString?: unknown }).transformToString !== "function") {
        throw new Error("s3_get_object_missing_body");
      }

      return await (body as { transformToString: () => Promise<string> }).transformToString();
    },

    async headObject(key: string): Promise<HeadObjectCommandOutput> {
      const output = await client.send(
        new HeadObjectCommand({
          Bucket: bucket,
          Key: key,
        }),
      );

      return output as HeadObjectCommandOutput;
    },
  };
}

function formatMissingS3EnvError(missingKeys: RequiredS3EnvKey[]): string {
  return [
    `Missing required S3 environment variables: ${missingKeys.join(", ")}`,
    "Set these server-side variables before starting the app:",
    "S3_ENDPOINT=https://storage.yandexcloud.net",
    "S3_REGION=ru-central1",
    "S3_BUCKET=<your-bucket-name>",
    "S3_ACCESS_KEY_ID=<your-access-key-id>",
    "S3_SECRET_ACCESS_KEY=<your-secret-access-key>",
  ].join("\n");
}
