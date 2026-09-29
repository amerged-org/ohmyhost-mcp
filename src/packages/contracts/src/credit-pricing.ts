export interface OrganizationCreditUsage {
  organization_id: string;
  month: string;
  as_of: string;
  unit: "microcredits";
  data: {
    project_id: string;
    reserved_micros: string;
    meters: {
      environment_id: string | null;
      meter: string;
      unit: string;
      rate_card_id: string;
      quantity: string;
      charged_micros: string;
      funded_micros: string;
      platform_overrun_micros: string;
    }[];
  }[];
  next_cursor: string | null;
}

/** A bounded read model, not a new source of accounting or billing authorization. */
export function assertOrganizationCreditUsage(
  value: unknown,
): asserts value is OrganizationCreditUsage {
  const record = (input: unknown, keys: string) => {
    if (
      !input ||
      typeof input !== "object" ||
      Array.isArray(input) ||
      Object.keys(input).sort().join() !== keys.split(",").sort().join()
    )
      throw new TypeError("Invalid usage fields");
    return input as Record<string, unknown>;
  };
  const identifier = (input: unknown) =>
    typeof input === "string" && /^[0-7][0-9A-HJKMNP-TV-Z]{25}$/u.test(input);
  const amount = (input: unknown) =>
    typeof input === "string" && /^(0|[1-9][0-9]{0,37})$/u.test(input);
  const report = record(value, "organization_id,month,as_of,unit,data,next_cursor");
  if (
    !identifier(report["organization_id"]) ||
    typeof report["month"] !== "string" ||
    !/^20[0-9]{2}-(0[1-9]|1[0-2])$/u.test(report["month"]) ||
    typeof report["as_of"] !== "string" ||
    !Number.isFinite(Date.parse(report["as_of"])) ||
    new Date(report["as_of"]).toISOString() !== report["as_of"] ||
    report["unit"] !== "microcredits" ||
    !Array.isArray(report["data"]) ||
    report["data"].length > 20 ||
    (report["next_cursor"] !== null && !identifier(report["next_cursor"]))
  )
    throw new TypeError("Invalid usage report");
  let previous = "";
  for (const input of report["data"]) {
    const project = record(input, "project_id,reserved_micros,meters");
    if (
      !identifier(project["project_id"]) ||
      String(project["project_id"]) <= previous ||
      !amount(project["reserved_micros"]) ||
      !Array.isArray(project["meters"]) ||
      project["meters"].length > 1000
    )
      throw new TypeError("Invalid usage project");
    previous = String(project["project_id"]);
    for (const input of project["meters"]) {
      const meter = record(
        input,
        "environment_id,meter,unit,rate_card_id,quantity,charged_micros,funded_micros,platform_overrun_micros",
      );
      if (meter["environment_id"] !== null && !identifier(meter["environment_id"]))
        throw new TypeError("Invalid usage environment");
      for (const key of ["meter", "unit", "rate_card_id"])
        if (typeof meter[key] !== "string" || !/^[A-Za-z0-9_.:/-]{1,128}$/u.test(meter[key]))
          throw new TypeError("Invalid usage meter");
      for (const key of ["quantity", "charged_micros", "funded_micros", "platform_overrun_micros"])
        if (!amount(meter[key])) throw new TypeError("Invalid usage amount");
      if (
        BigInt(String(meter["charged_micros"])) !==
        BigInt(String(meter["funded_micros"])) + BigInt(String(meter["platform_overrun_micros"]))
      )
        throw new TypeError("Inconsistent usage charge");
    }
  }
  if (report["next_cursor"] !== null && report["next_cursor"] !== previous)
    throw new TypeError("Invalid usage cursor");
}

export interface PublishedCreditRateCard {
  readonly id: string;
  readonly currency: "USD";
  readonly published_at: string;
  readonly effective_from: string;
  readonly rates: readonly {
    readonly meter: string;
    readonly unit: string;
    readonly units_per_charge: string;
    readonly provider_cost_micros: string;
    readonly credit_micros: string;
  }[];
}

/** Shared wire validation only; clients never recompute accounting decisions. */
export function assertPublishedCreditRateCards(
  value: unknown,
): asserts value is readonly PublishedCreditRateCard[] {
  if (!Array.isArray(value) || value.length > 4) throw new TypeError("Invalid published prices");
  const ids = new Set<string>();
  for (const input of value) {
    if (
      !input ||
      typeof input !== "object" ||
      Array.isArray(input) ||
      Object.keys(input).sort().join() !== "currency,effective_from,id,published_at,rates"
    )
      throw new TypeError("Invalid published price fields");
    const card = input as Record<string, unknown>;
    if (
      typeof card["id"] !== "string" ||
      !/^[a-z0-9_.-]{1,128}$/u.test(card["id"]) ||
      ids.has(card["id"]) ||
      card["currency"] !== "USD"
    )
      throw new TypeError("Invalid price identity");
    ids.add(card["id"]);
    for (const key of ["published_at", "effective_from"]) {
      const date = card[key];
      if (
        typeof date !== "string" ||
        !Number.isFinite(Date.parse(date)) ||
        new Date(date).toISOString() !== date
      )
        throw new TypeError("Invalid price dates");
    }
    if (
      String(card["published_at"]) > String(card["effective_from"]) ||
      !Array.isArray(card["rates"]) ||
      card["rates"].length < 1 ||
      card["rates"].length > 32
    )
      throw new TypeError("Invalid price publication");
    const meters = new Set<string>();
    for (const item of card["rates"]) {
      if (
        !item ||
        typeof item !== "object" ||
        Array.isArray(item) ||
        Object.keys(item).sort().join() !==
          "credit_micros,meter,provider_cost_micros,unit,units_per_charge"
      )
        throw new TypeError("Invalid rate fields");
      const rate = item as Record<string, unknown>;
      for (const key of ["meter", "unit"])
        if (typeof rate[key] !== "string" || !/^[a-z0-9_.-]{1,128}$/u.test(String(rate[key])))
          throw new TypeError("Invalid rate unit");
      const identity = String(rate["meter"]) + "/" + String(rate["unit"]);
      if (meters.has(identity)) throw new TypeError("Duplicate rate");
      meters.add(identity);
      for (const key of ["units_per_charge", "provider_cost_micros", "credit_micros"]) {
        const amount = rate[key];
        if (
          typeof amount !== "string" ||
          !/^(0|[1-9][0-9]{0,18})$/u.test(amount) ||
          BigInt(amount) > 9223372036854775807n ||
          (key === "units_per_charge" && amount === "0")
        )
          throw new TypeError("Invalid rate amount");
      }
    }
  }
}

/** Effective feature access and credit buckets from the existing ledger. */
export function assertOrganizationAccount(value: unknown): void {
  if (
    !value ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    Object.keys(value).sort().join(",") !==
      "as_of,available_micros,monthly_micros,name,next_expiry,one_time_micros,organization_id,paid_until,plan,plan_source,reserved_micros,workos_organization_id"
  )
    throw new TypeError("Invalid account fields");
  const v = value as Record<string, unknown>;
  if (
    typeof v["organization_id"] !== "string" ||
    !/^[0-7][0-9A-HJKMNP-TV-Z]{25}$/u.test(v["organization_id"]) ||
    typeof v["name"] !== "string" ||
    v["name"].length > 128 ||
    typeof v["workos_organization_id"] !== "string" ||
    !/^org_[A-Za-z0-9_]+$/u.test(v["workos_organization_id"]) ||
    (v["plan"] !== "paid" && v["plan"] !== "free") ||
    !["free", "stripe", "granted", "manual"].includes(String(v["plan_source"])) ||
    (v["plan"] === "free") !== (v["plan_source"] === "free")
  )
    throw new TypeError("Invalid account scope");
  for (const field of ["available_micros", "monthly_micros", "one_time_micros", "reserved_micros"])
    if (typeof v[field] !== "string" || !/^(0|[1-9][0-9]{0,18})$/u.test(v[field] as string))
      throw new TypeError("Invalid account credits");
  if (
    BigInt(String(v["monthly_micros"])) + BigInt(String(v["one_time_micros"])) !==
    BigInt(String(v["available_micros"]))
  )
    throw new TypeError("Account credit buckets do not balance");
  for (const field of ["as_of", "paid_until", "next_expiry"]) {
    if (field !== "as_of" && v[field] === null) continue;
    if (
      typeof v[field] !== "string" ||
      !Number.isFinite(Date.parse(v[field] as string)) ||
      new Date(v[field] as string).toISOString() !== v[field]
    )
      throw new TypeError("Invalid account timestamp");
  }
}
