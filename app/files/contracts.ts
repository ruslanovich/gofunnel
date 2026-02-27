export const FILE_UPLOAD_MAX_BYTES = 10 * 1024 * 1024;

export const ALLOWED_FILE_EXTENSIONS = ["txt", "vtt"] as const;

export type AllowedFileExtension = (typeof ALLOWED_FILE_EXTENSIONS)[number];

export type FileStatus =
  | "queued"
  | "processing"
  | "uploaded"
  | "succeeded"
  | "failed";

export type CreateProcessingFileInput = {
  id: string;
  userId: string;
  storageBucket: string;
  storageKeyOriginal: string;
  originalFilename: string;
  extension: AllowedFileExtension;
  mimeType: string | null;
  sizeBytes: number;
};

export type FileRecord = CreateProcessingFileInput & {
  status: FileStatus;
  errorCode: string | null;
  errorMessage: string | null;
  createdAt: Date;
  updatedAt: Date;
};

export type FileListCursor = {
  createdAt: Date;
  id: string;
};

export type FileListItem = {
  id: string;
  originalFilename: string;
  extension: AllowedFileExtension;
  sizeBytes: number;
  status: FileStatus;
  createdAt: Date;
  updatedAt: Date;
};

export type FileDetailsItem = {
  id: string;
  originalFilename: string;
  extension: AllowedFileExtension;
  sizeBytes: number;
  status: FileStatus;
  createdAt: Date;
  updatedAt: Date;
  errorCode: string | null;
  errorMessage: string | null;
};

export type FileReportItem = {
  id: string;
  status: FileStatus;
  storageKeyReport: string | null;
};

export interface FileMetadataRepository {
  createProcessingFile(input: CreateProcessingFileInput): Promise<void>;
  markFileQueued(input: { id: string; userId: string }): Promise<void>;
  markFileFailed(input: {
    id: string;
    userId: string;
    errorCode: string;
    errorMessage: string;
  }): Promise<void>;
  listFilesForUser(input: {
    userId: string;
    limit: number;
    cursor: FileListCursor | null;
  }): Promise<FileListItem[]>;
  findFileForUser(input: { id: string; userId: string }): Promise<FileDetailsItem | null>;
  findFileReportForUser(input: { id: string; userId: string }): Promise<FileReportItem | null>;
}

export interface ProcessingJobQueueRepository {
  enqueueForFile(input: { fileId: string }): Promise<void>;
}

export interface FileObjectStorage {
  putObject(key: string, body: Buffer, contentType: string): Promise<void>;
  deleteObject(key: string): Promise<void>;
}

export interface FileReportStorage {
  getObjectText(key: string): Promise<string>;
}
