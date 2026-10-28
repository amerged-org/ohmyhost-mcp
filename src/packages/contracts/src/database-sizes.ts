export type DatabaseMemoryMiB = 256 | 512 | 1024 | 2048 | 4096;
export type DatabaseComputeSelection =
  | { readonly memoryMiB: DatabaseMemoryMiB; readonly profile?: never }
  | { readonly profile: "standard" | "performance"; readonly memoryMiB?: never };

export function parseDatabaseComputeChangeRequest(value: unknown): {
  readonly environment: "dev" | "prod";
  readonly selection: DatabaseComputeSelection;
} {
  if (value === null || typeof value !== "object" || Array.isArray(value))
    throw new TypeError("Invalid database compute change");
  const input = value as Record<string, unknown>;
  const keys = Object.keys(input).sort().join(",");
  if (
    (keys !== "confirm,environment,memory_mib" && keys !== "confirm,environment,profile") ||
    input["confirm"] !== true ||
    (input["environment"] !== "dev" && input["environment"] !== "prod")
  )
    throw new TypeError("Invalid database compute change");
  if (keys === "confirm,environment,memory_mib")
    return {
      environment: input["environment"],
      selection: { memoryMiB: databaseSizeForMemory(input["memory_mib"]).memoryMiB },
    };
  if (input["profile"] !== "standard" && input["profile"] !== "performance")
    throw new TypeError("Invalid transitional database profile");
  return { environment: input["environment"], selection: { profile: input["profile"] } };
}

export interface DatabaseSize {
  readonly memoryMiB: DatabaseMemoryMiB;
  readonly storageMiB: number;
  readonly cpuMillicores: number;
  readonly maxConnections: number;
  readonly sizeClassId: string;
  readonly creditsPerAwakeHour: number;
  readonly paidRequired: boolean;
}

/** Operator-approved product sizes; storage is total nominal volume, including WAL. */
export const DATABASE_SIZES: readonly DatabaseSize[] = Object.freeze([
  Object.freeze({
    memoryMiB: 256,
    storageMiB: 500,
    cpuMillicores: 250,
    maxConnections: 20,
    sizeClassId: "r256-s500m",
    creditsPerAwakeHour: 10,
    paidRequired: false,
  } as const),
  Object.freeze({
    memoryMiB: 512,
    storageMiB: 1024,
    cpuMillicores: 250,
    maxConnections: 40,
    sizeClassId: "r512-s1g",
    creditsPerAwakeHour: 20,
    paidRequired: true,
  } as const),
  Object.freeze({
    memoryMiB: 1024,
    storageMiB: 2048,
    cpuMillicores: 500,
    maxConnections: 80,
    sizeClassId: "r1024-s2g",
    creditsPerAwakeHour: 40,
    paidRequired: true,
  } as const),
  Object.freeze({
    memoryMiB: 2048,
    storageMiB: 4096,
    cpuMillicores: 1000,
    maxConnections: 160,
    sizeClassId: "r2048-s4g",
    creditsPerAwakeHour: 80,
    paidRequired: true,
  } as const),
  Object.freeze({
    memoryMiB: 4096,
    storageMiB: 8192,
    cpuMillicores: 2000,
    maxConnections: 200,
    sizeClassId: "r4096-s8g",
    creditsPerAwakeHour: 160,
    paidRequired: true,
  } as const),
]);

export function databaseSizeForMemory(value: unknown): DatabaseSize {
  const size = DATABASE_SIZES.find((candidate) => candidate.memoryMiB === value);
  if (size === undefined) throw new TypeError("Unsupported database memory size");
  return size;
}

export function databaseSizeForClass(value: unknown): DatabaseSize {
  const size = DATABASE_SIZES.find((candidate) => candidate.sizeClassId === value);
  if (size === undefined) throw new TypeError("Unsupported database size class");
  return size;
}

/** A downgrade never silently reduces a database's physical allocation. */
export function assertDatabaseSizeChange(input: {
  readonly memoryMiB: unknown;
  readonly paid: boolean;
  readonly currentStorageMiB: number;
}): DatabaseSize {
  const size = databaseSizeForMemory(input.memoryMiB);
  if (size.paidRequired && !input.paid) throw new TypeError("Database size requires Paid");
  if (!Number.isSafeInteger(input.currentStorageMiB) || input.currentStorageMiB < 0)
    throw new TypeError("Invalid current database allocation");
  if (size.storageMiB < input.currentStorageMiB)
    throw new TypeError("A smaller database volume requires a separate data migration");
  return size;
}
