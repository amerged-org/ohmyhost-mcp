/**
 * Declared cron schedules for the Worker module of a project environment.
 * Five-field UTC cron, at most eight unique entries, minimum five-minute interval.
 */
export function normalizeCrons(value: readonly unknown[]): readonly string[] {
  if (!Array.isArray(value) || value.length === 0 || value.length > 8) {
    throw new TypeError("ohmyhost.yaml functions.crons must list one to eight schedules");
  }
  const crons = value.map((entry) => {
    if (typeof entry !== "string") throw new TypeError("ohmyhost.yaml cron is invalid");
    return normalizeCron(entry);
  });
  const sorted = [...crons].sort((left, right) => (left < right ? -1 : left > right ? 1 : 0));
  for (let index = 1; index < sorted.length; index += 1) {
    if (sorted[index - 1] === sorted[index]) {
      throw new TypeError("ohmyhost.yaml functions.crons must be unique");
    }
  }
  return Object.freeze(sorted);
}

export function normalizeCron(value: string): string {
  if (value !== value.trim() || value.includes("  ")) {
    throw new TypeError("ohmyhost.yaml cron is invalid");
  }
  const fields = value.split(" ");
  if (fields.length !== 5) throw new TypeError("ohmyhost.yaml cron is invalid");
  const [minute, hour, day, month, weekday] = fields;
  if (
    minute === undefined ||
    hour === undefined ||
    day === undefined ||
    month === undefined ||
    weekday === undefined ||
    !validCronMinute(minute) ||
    !validCronField(hour, 0, 23) ||
    !validCronField(day, 1, 31) ||
    !validCronField(month, 1, 12) ||
    !validCronField(weekday, 0, 6)
  ) {
    throw new TypeError("ohmyhost.yaml cron is invalid");
  }
  return value;
}

function validCronMinute(value: string): boolean {
  const step = /^\*\/([1-9]|[1-5][0-9])$/u.exec(value);
  if (step !== null) return Number(step[1]) >= 5;
  return value !== "*" && validCronField(value, 0, 59);
}

function validCronField(value: string, minimum: number, maximum: number): boolean {
  if (value === "*") return true;
  if (!/^(?:0|[1-9][0-9]?)$/u.test(value)) return false;
  const parsed = Number(value);
  return parsed >= minimum && parsed <= maximum;
}

/** Whether a validated five-field UTC cron fires in the minute that contains `at`. */
export function isCronDue(cron: string, at: Date): boolean {
  const fields = normalizeCron(cron).split(" ");
  const [minute, hour, day, month, weekday] = fields as [string, string, string, string, string];
  const utcMinute = at.getUTCMinutes();
  const minuteDue = minute.startsWith("*/")
    ? utcMinute % Number(minute.slice(2)) === 0
    : Number(minute) === utcMinute;
  const matches = (field: string, value: number): boolean =>
    field === "*" || Number(field) === value;
  return (
    minuteDue &&
    matches(hour, at.getUTCHours()) &&
    matches(day, at.getUTCDate()) &&
    matches(month, at.getUTCMonth() + 1) &&
    matches(weekday, at.getUTCDay())
  );
}
