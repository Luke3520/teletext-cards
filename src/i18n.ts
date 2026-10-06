// Labels and date formats. Teletext headers use fixed-width dates, so we build
// them ourselves instead of trusting Intl's locale-specific punctuation.

export type Locale = 'en' | 'da';

export interface Strings {
  numberLocale: string;
  weekdays: readonly string[];
  months: readonly string[];
  contributions: string;
  commits: string;
  pullRequests: string;
  merged: string;
  reviews: string;
  repos: string;
  notOwned: string;
  orgs: string;
  privateOrgs: (n: number) => string;
  more: (n: number) => string;
  languages: string;
  languagesBy: { authorship: string; commits: string; bytes: string };
  other: string;
  weeks: string;
  streak: string;
  days: (n: number) => string;
  best: string;
  since: (year: number) => string;
  noLanguages: string;
}

export const STRINGS: Readonly<Record<Locale, Strings>> = {
  en: {
    numberLocale: 'en-GB',
    weekdays: ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'],
    months: ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'],
    contributions: 'CONTRIBUTIONS',
    commits: 'COMMITS',
    pullRequests: 'PULL REQUESTS',
    merged: 'merged',
    reviews: 'CODE REVIEWS',
    repos: 'REPOSITORIES',
    notOwned: 'org/team',
    orgs: 'ORGS',
    privateOrgs: (n) => `+${n} private`,
    more: (n) => `+${n} more`,
    languages: 'LANGUAGES',
    languagesBy: { authorship: 'by code you wrote', commits: 'by your commits', bytes: 'by repo size' },
    other: 'Other',
    weeks: '52 WEEKS',
    streak: 'STREAK',
    days: (n) => `${n} ${n === 1 ? 'day' : 'days'}`,
    best: 'best',
    since: (year) => `on GitHub since ${year}`,
    noLanguages: 'No code yet',
  },
  da: {
    numberLocale: 'da-DK',
    weekdays: ['søn', 'man', 'tir', 'ons', 'tor', 'fre', 'lør'],
    months: ['jan', 'feb', 'mar', 'apr', 'maj', 'jun', 'jul', 'aug', 'sep', 'okt', 'nov', 'dec'],
    contributions: 'BIDRAG I ALT',
    commits: 'COMMITS',
    pullRequests: 'PULL REQUESTS',
    merged: 'merget',
    reviews: 'KODE-REVIEWS',
    repos: 'REPOSITORIER',
    notOwned: 'org/team',
    orgs: 'ORG.',
    privateOrgs: (n) => `+${n} private`,
    more: (n) => `+${n} flere`,
    languages: 'SPROG',
    languagesBy: { authorship: 'efter kode du skrev', commits: 'efter dine commits', bytes: 'efter repo-størrelse' },
    other: 'Andet',
    weeks: '52 UGER',
    streak: 'STIME',
    days: (n) => `${n} ${n === 1 ? 'dag' : 'dage'}`,
    best: 'bedst',
    since: (year) => `på GitHub siden ${year}`,
    noLanguages: 'Ingen kode endnu',
  },
};

export function strings(locale: string): Strings {
  return STRINGS[(locale in STRINGS ? locale : 'en') as Locale];
}

export function formatNumber(value: number, s: Strings): string {
  return new Intl.NumberFormat(s.numberLocale).format(value);
}

/** Date and time parts in a time zone, e.g. ["Tue 06 Oct", "21:37"]. */
export function clock(date: Date, timeZone: string, s: Strings): { date: string; time: string } {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-GB', {
      timeZone,
      year: 'numeric',
      month: 'numeric',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23',
    })
      .formatToParts(date)
      .map((p) => [p.type, p.value]),
  );
  const y = Number(parts.year);
  const m = Number(parts.month);
  const d = Number(parts.day);
  const weekday = new Date(Date.UTC(y, m - 1, d)).getUTCDay();
  return {
    date: `${s.weekdays[weekday]} ${String(d).padStart(2, '0')} ${s.months[m - 1]}`,
    time: `${parts.hour}:${parts.minute}`,
  };
}
