import type { Pool } from "pg";

import type {
  CreateProcessingFileInput,
  FileDetailsItem,
  FileListItem,
  FileListCursor,
  FileMetadataRepository,
} from "../../app/files/contracts.js";

export class PostgresFileRepository implements FileMetadataRepository {
  constructor(private readonly pool: Pool) {}

  async createProcessingFile(input: CreateProcessingFileInput): Promise<void> {
    await this.pool.query(
      `
      INSERT INTO files (
        id,
        user_id,
        storage_bucket,
        storage_key_original,
        original_filename,
        extension,
        mime_type,
        size_bytes,
        status,
        created_at,
        updated_at
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'processing', NOW(), NOW())
      `,
      [
        input.id,
        input.userId,
        input.storageBucket,
        input.storageKeyOriginal,
        input.originalFilename,
        input.extension,
        input.mimeType,
        input.sizeBytes,
      ],
    );
  }

  async markFileUploaded(input: { id: string; userId: string }): Promise<void> {
    const result = await this.pool.query(
      `
      UPDATE files
      SET
        status = 'uploaded',
        error_code = NULL,
        error_message = NULL,
        updated_at = NOW()
      WHERE id = $1 AND user_id = $2
      `,
      [input.id, input.userId],
    );

    if ((result.rowCount ?? 0) !== 1) {
      throw new Error("file_not_found_for_upload_finalize");
    }
  }

  async markFileFailed(input: {
    id: string;
    userId: string;
    errorCode: string;
    errorMessage: string;
  }): Promise<void> {
    const result = await this.pool.query(
      `
      UPDATE files
      SET
        status = 'failed',
        error_code = $3,
        error_message = $4,
        updated_at = NOW()
      WHERE id = $1 AND user_id = $2
      `,
      [input.id, input.userId, input.errorCode, input.errorMessage],
    );

    if ((result.rowCount ?? 0) !== 1) {
      throw new Error("file_not_found_for_failed_update");
    }
  }

  async listFilesForUser(input: {
    userId: string;
    limit: number;
    cursor: FileListCursor | null;
  }): Promise<FileListItem[]> {
    if (input.cursor) {
      const result = await this.pool.query<{
        id: string;
        original_filename: string;
        extension: FileListItem["extension"];
        size_bytes: string;
        status: FileListItem["status"];
        created_at: Date;
        updated_at: Date;
      }>(
        `
        SELECT
          id,
          original_filename,
          extension,
          size_bytes,
          status,
          created_at,
          updated_at
        FROM files
        WHERE
          user_id = $1
          AND (created_at, id) < ($2, $3::uuid)
        ORDER BY created_at DESC, id DESC
        LIMIT $4
        `,
        [input.userId, input.cursor.createdAt.toISOString(), input.cursor.id, input.limit],
      );

      return result.rows.map(mapListRow);
    }

    const result = await this.pool.query<{
      id: string;
      original_filename: string;
      extension: FileListItem["extension"];
      size_bytes: string;
      status: FileListItem["status"];
      created_at: Date;
      updated_at: Date;
    }>(
      `
      SELECT
        id,
        original_filename,
        extension,
        size_bytes,
        status,
        created_at,
        updated_at
      FROM files
      WHERE user_id = $1
      ORDER BY created_at DESC, id DESC
      LIMIT $2
      `,
      [input.userId, input.limit],
    );

    return result.rows.map(mapListRow);
  }

  async findFileForUser(input: { id: string; userId: string }): Promise<FileDetailsItem | null> {
    const result = await this.pool.query<{
      id: string;
      original_filename: string;
      extension: FileDetailsItem["extension"];
      size_bytes: string;
      status: FileDetailsItem["status"];
      created_at: Date;
      updated_at: Date;
      error_code: string | null;
      error_message: string | null;
    }>(
      `
      SELECT
        id,
        original_filename,
        extension,
        size_bytes,
        status,
        created_at,
        updated_at,
        error_code,
        error_message
      FROM files
      WHERE id = $1::uuid AND user_id = $2::uuid
      LIMIT 1
      `,
      [input.id, input.userId],
    );

    const row = result.rows[0];
    if (!row) {
      return null;
    }

    return mapDetailsRow(row);
  }
}

function mapListRow(row: {
  id: string;
  original_filename: string;
  extension: FileListItem["extension"];
  size_bytes: string;
  status: FileListItem["status"];
  created_at: Date;
  updated_at: Date;
}): FileListItem {
  return {
    id: row.id,
    originalFilename: row.original_filename,
    extension: row.extension,
    sizeBytes: Number(row.size_bytes),
    status: row.status,
    createdAt: new Date(row.created_at),
    updatedAt: new Date(row.updated_at),
  };
}

function mapDetailsRow(row: {
  id: string;
  original_filename: string;
  extension: FileDetailsItem["extension"];
  size_bytes: string;
  status: FileDetailsItem["status"];
  created_at: Date;
  updated_at: Date;
  error_code: string | null;
  error_message: string | null;
}): FileDetailsItem {
  return {
    id: row.id,
    originalFilename: row.original_filename,
    extension: row.extension,
    sizeBytes: Number(row.size_bytes),
    status: row.status,
    createdAt: new Date(row.created_at),
    updatedAt: new Date(row.updated_at),
    errorCode: row.error_code,
    errorMessage: row.error_message,
  };
}
