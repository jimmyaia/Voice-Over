import { previewCsv } from "@/lib/clip-import";

export const runtime = "nodejs";

const MAX_UPLOAD_BYTES = 2_000_000;

export async function POST(request: Request) {
  try {
    const contentType = request.headers.get("content-type") || "";
    if (!contentType.includes("multipart/form-data"))
      return Response.json({ error: "Upload a CSV file." }, { status: 415 });

    const contentLength = Number(request.headers.get("content-length") || 0);
    if (contentLength > MAX_UPLOAD_BYTES)
      return Response.json({ error: "CSV files are limited to 2 MB." }, { status: 413 });

    const form = await request.formData();
    const file = form.get("file");
    if (!(file instanceof File) || !file.name.toLowerCase().endsWith(".csv"))
      return Response.json({ error: "Select a .csv file." }, { status: 400 });
    if (file.size > MAX_UPLOAD_BYTES)
      return Response.json({ error: "CSV files are limited to 2 MB." }, { status: 413 });

    const preview = previewCsv(
      await file.text(),
      String(form.get("projectCode") || "PROJECT").slice(0, 50),
      String(form.get("targetLanguage") || "DE").slice(0, 10),
    );
    return Response.json(preview);
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : "The CSV could not be processed." },
      { status: 400 },
    );
  }
}
