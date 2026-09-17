export type ImportedClip = {
  sequence: number;
  clipNumber: string;
  label: string;
  expectedFilename: string;
  sourceRow: number;
  speaker: string;
  englishSource: string;
  germanTarget: string;
  direction: string;
};

export type ImportIssue = {
  row: number;
  field: string;
  severity: "warning" | "error";
  message: string;
};

export type ImportPreview = {
  clips: ImportedClip[];
  issues: ImportIssue[];
  summary: {
    sourceRows: number;
    validClips: number;
    errors: number;
    warnings: number;
  };
};

const MAX_ROWS = 5000;
const MAX_FIELD_LENGTH = 20_000;

function parseRows(input: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;

  for (let index = 0; index < input.length; index += 1) {
    const char = input[index];
    const next = input[index + 1];
    if (char === '"' && quoted && next === '"') {
      field += '"';
      index += 1;
    } else if (char === '"') {
      quoted = !quoted;
    } else if (char === "," && !quoted) {
      row.push(field.trim());
      field = "";
    } else if ((char === "\n" || char === "\r") && !quoted) {
      if (char === "\r" && next === "\n") index += 1;
      row.push(field.trim());
      field = "";
      if (row.some(Boolean)) rows.push(row);
      row = [];
      if (rows.length > MAX_ROWS) throw new Error(`CSV files are limited to ${MAX_ROWS} rows.`);
    } else {
      field += char;
      if (field.length > MAX_FIELD_LENGTH)
        throw new Error(`CSV fields are limited to ${MAX_FIELD_LENGTH} characters.`);
    }
  }
  row.push(field.trim());
  if (row.some(Boolean)) rows.push(row);
  return rows;
}

function normalizeHeader(value: string) {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function findColumn(headers: string[], candidates: string[]) {
  return headers.findIndex((header) => candidates.includes(header));
}

function filename(projectCode: string, targetLanguage: string, number: string) {
  const project = projectCode.toUpperCase().replace(/[^A-Z0-9]+/g, "_").replace(/^_|_$/g, "") || "PROJECT";
  const language = targetLanguage.toUpperCase().replace(/[^A-Z]/g, "").slice(0, 3) || "DE";
  return `${project}_${language}_${number}_v1.mp3`;
}

export function previewCsv(
  csv: string,
  projectCode = "PROJECT",
  targetLanguage = "DE",
): ImportPreview {
  const rows = parseRows(csv.replace(/^\uFEFF/, ""));
  if (rows.length < 2) throw new Error("The CSV must include a header row and at least one data row.");

  const headers = rows[0].map(normalizeHeader);
  const speakerIndex = findColumn(headers, ["speaker", "speakers", "speaker s"]);
  const englishIndex = findColumn(headers, ["english source", "english", "source", "source text", "english script"]);
  const germanIndex = findColumn(headers, ["german target", "german", "target", "target text", "german script", "localized text"]);
  const directionIndex = findColumn(headers, ["direction", "custom direction", "delivery direction", "voice direction"]);
  const filenameIndex = findColumn(headers, ["file name", "filename", "audio filename", "audio file"]);

  if (englishIndex < 0 || germanIndex < 0)
    throw new Error("Map columns named English Source and German Target before importing.");

  const issues: ImportIssue[] = [];
  const grouped: Array<{ row: number; speaker: string; english: string[]; german: string[]; direction: string }> = [];
  let active: (typeof grouped)[number] | null = null;

  rows.slice(1).forEach((cells, offset) => {
    const sourceRow = offset + 2;
    const incomingFilename = filenameIndex >= 0 ? cells[filenameIndex]?.trim() : "";
    const english = cells[englishIndex]?.trim() || "";
    const german = cells[germanIndex]?.trim() || "";
    const speaker = speakerIndex >= 0 ? cells[speakerIndex]?.trim() || "" : "";
    const direction = directionIndex >= 0 ? cells[directionIndex]?.trim() || "" : "";

    if (!english && !german && !incomingFilename) return;
    // Without a filename column, every populated row is a clip. When the
    // column exists, a blank filename intentionally continues the prior clip.
    if (filenameIndex < 0 || incomingFilename || !active) {
      active = { row: sourceRow, speaker, english: [], german: [], direction };
      grouped.push(active);
    }
    if (english) active.english.push(english);
    if (german) active.german.push(german);
    if (!active.speaker && speaker) active.speaker = speaker;
    if (!active.direction && direction) active.direction = direction;
  });

  const width = Math.max(3, String(grouped.length).length);
  const clips = grouped.map((group, index) => {
    const clipNumber = String(index + 1).padStart(width, "0");
    const englishSource = group.english.join("\n").trim();
    const germanTarget = group.german.join("\n").trim();
    if (!englishSource)
      issues.push({ row: group.row, field: "englishSource", severity: "error", message: "English source is missing." });
    if (!germanTarget)
      issues.push({ row: group.row, field: "germanTarget", severity: "error", message: "German target is missing." });
    if (!group.speaker)
      issues.push({ row: group.row, field: "speaker", severity: "warning", message: "Speaker is blank; project default will be used." });
    return {
      sequence: index + 1,
      clipNumber,
      label: `Clip ${clipNumber}`,
      expectedFilename: filename(projectCode, targetLanguage, clipNumber),
      sourceRow: group.row,
      speaker: group.speaker || "Project default",
      englishSource,
      germanTarget,
      direction: group.direction,
    };
  });

  return {
    clips,
    issues,
    summary: {
      sourceRows: rows.length - 1,
      validClips: clips.filter((clip) => clip.englishSource && clip.germanTarget).length,
      errors: issues.filter((issue) => issue.severity === "error").length,
      warnings: issues.filter((issue) => issue.severity === "warning").length,
    },
  };
}
