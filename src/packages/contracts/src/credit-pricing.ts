export interface OrganizationCreditUsage {
  organization_id: string;
  as_of: string;
  unit: "microcredits";
  /** The UTC month (`YYYY-MM`) that `projects[].used_micros` counts. */
  period: string;
  /** The first instant of the daily lines: the start of the oldest UTC day that is reported. */
  from: string;
  /** What each project has used so far in `period`. */
  projects: { project_id: string; used_micros: string }[];
  /** The credit-log lines of the last up to 14 UTC days, grouped by day, project and meter, oldest day first. */
  days: {
    day: string;
    projects: {
      project_id: string;
      meters: {
        environment_id: string | null;
        meter: string;
        unit: string;
        rate_card_id: string;
        quantity: string;
        charged_micros: string;
      }[];
    }[];
  }[];
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
  const instant = (input: unknown) =>
    typeof input === "string" &&
    Number.isFinite(Date.parse(input)) &&
    new Date(input).toISOString() === input;
  const report = record(value, "organization_id,as_of,unit,period,from,projects,days");
  if (
    !identifier(report["organization_id"]) ||
    !instant(report["as_of"]) ||
    !instant(report["from"]) ||
    report["unit"] !== "microcredits" ||
    typeof report["period"] !== "string" ||
    !/^20[0-9]{2}-(0[1-9]|1[0-2])$/u.test(report["period"]) ||
    !Array.isArray(report["projects"]) ||
    report["projects"].length > 1000 ||
    !Array.isArray(report["days"]) ||
    report["days"].length > 15
  )
    throw new TypeError("Invalid usage report");
  let previous = "";
  for (const input of report["projects"]) {
    const project = record(input, "project_id,used_micros");
    if (
      !identifier(project["project_id"]) ||
      String(project["project_id"]) <= previous ||
      !amount(project["used_micros"])
    )
      throw new TypeError("Invalid usage project");
    previous = String(project["project_id"]);
  }
  let previousDay = "";
  for (const input of report["days"]) {
    const day = record(input, "day,projects");
    if (
      typeof day["day"] !== "string" ||
      !/^20[0-9]{2}-(0[1-9]|1[0-2])-(0[1-9]|[12][0-9]|3[01])$/u.test(day["day"]) ||
      day["day"] <= previousDay ||
      !Array.isArray(day["projects"]) ||
      day["projects"].length > 1000
    )
      throw new TypeError("Invalid usage day");
    previousDay = day["day"];
    previous = "";
    for (const projectInput of day["projects"]) {
      const project = record(projectInput, "project_id,meters");
      if (
        !identifier(project["project_id"]) ||
        String(project["project_id"]) <= previous ||
        !Array.isArray(project["meters"]) ||
        project["meters"].length > 1000
      )
        throw new TypeError("Invalid usage project");
      previous = String(project["project_id"]);
      for (const meterInput of project["meters"]) {
        const meter = record(
          meterInput,
          "environment_id,meter,unit,rate_card_id,quantity,charged_micros",
        );
        if (meter["environment_id"] !== null && !identifier(meter["environment_id"]))
          throw new TypeError("Invalid usage environment");
        for (const key of ["meter", "unit", "rate_card_id"])
          if (typeof meter[key] !== "string" || !/^[A-Za-z0-9_.:/-]{1,128}$/u.test(meter[key]))
            throw new TypeError("Invalid usage meter");
        if (
          typeof meter["quantity"] !== "string" ||
          !/^(0|[1-9][0-9]{0,29})(\.[0-9]{1,12})?$/u.test(meter["quantity"]) ||
          !amount(meter["charged_micros"])
        )
          throw new TypeError("Invalid usage amount");
      }
    }
  }
}

/** Effective feature access and the credit account: the monthly and one-time credit and what the open reservations hold. */
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
  const held = BigInt(String(v["reserved_micros"]));
  const balance = BigInt(String(v["monthly_micros"])) + BigInt(String(v["one_time_micros"]));
  if (BigInt(String(v["available_micros"])) !== (balance > held ? balance - held : 0n))
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
