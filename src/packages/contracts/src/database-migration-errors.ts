export type DatabaseMigrationAdmissionReason =
  | "destructive"
  | "invalid"
  | "provider_specific"
  | "unsupported";

export class DatabaseMigrationAdmissionError extends Error {
  public readonly code = "database_migration_not_admitted";

  /** `detail` names the exact requirement for a refusal whose cause the customer can change; the code and reason do not change. */
  public constructor(
    public readonly reason: DatabaseMigrationAdmissionReason,
    public readonly detail?: string,
  ) {
    super(
      detail === undefined
        ? "Database migration is not admitted"
        : `Database migration is not admitted: ${detail}`,
    );
    this.name = "DatabaseMigrationAdmissionError";
  }
}
