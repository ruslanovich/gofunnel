export type StoredReportShare = {
  reportRef: string;
  expiresAt: Date | null;
  revokedAt: Date | null;
};

export interface ReportShareRepository {
  findByTokenHash(tokenHash: string): Promise<StoredReportShare | null>;
}
