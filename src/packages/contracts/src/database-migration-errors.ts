export type DatabaseMigrationAdmissionReason =
  | "destructive"
  | "invalid"
  | "provider_specific"
  | "unsupported";

export class DatabaseMigrationAdmissionError extends Error {
  public readonly code = "database_migration_not_admitted";

  public constructor(public readonly reason: DatabaseMigrationAdmissionReason) {
    super("Database migration is not admitted");
    this.name = "DatabaseMigrationAdmissionError";
  }
}
